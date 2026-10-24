const encoder=new TextEncoder();
export const SESSION_SECONDS=7*24*60*60;
const COOKIE='__Host-holic100';
const WINDOW=15*60;
const hex=bytes=>Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
async function mac(secret,message){
 const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(message)));
}
function equal(a,b){let difference=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)difference|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return difference===0;}
export function configured(env){return typeof env.HOLIC100_PASSWORD==='string'&&env.HOLIC100_PASSWORD.length>0&&encoder.encode(env.HOLIC100_PASSWORD).length<=1024&&typeof env.HOLIC100_SESSION_SECRET==='string'&&encoder.encode(env.HOLIC100_SESSION_SECRET).length>=32&&env.HOLIC100_SESSION_SECRET!==env.HOLIC100_PASSWORD&&typeof env.AUTH_DB?.prepare==='function';}
export async function passwordMatches(env,password){return equal(await mac(env.HOLIC100_SESSION_SECRET,password),await mac(env.HOLIC100_SESSION_SECRET,env.HOLIC100_PASSWORD));}
async function signingKey(env){return mac(env.HOLIC100_SESSION_SECRET,`password:${env.HOLIC100_PASSWORD}`);}
export async function createSession(env,origin,now=Math.floor(Date.now()/1000)){
 const nonce=hex(crypto.getRandomValues(new Uint8Array(16)));
 const payload=`v1.${now}.${now+SESSION_SECONDS}.${nonce}`;
 const token=`${payload}.${await mac(await signingKey(env),`${origin}|${payload}`)}`;
 const id=await mac(env.HOLIC100_SESSION_SECRET,`session:${token}`);
 await env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE expires <= ?').bind(now).run();
 const result=await env.AUTH_DB.prepare('INSERT INTO auth_sessions (id, expires) VALUES (?, ?)').bind(id,now+SESSION_SECONDS).run();
 if(!result.success)throw Error('session storage unavailable');
 return token;
}
export async function validSession(request,env,now=Math.floor(Date.now()/1000)){
 const matches=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(`${COOKIE}=`));
 if(matches.length!==1)return false;
 const token=matches[0].slice(COOKIE.length+1);
 const match=/^v1\.(\d{1,12})\.(\d{1,12})\.([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(token);
 if(!match)return false;
 const issued=Number(match[1]),expires=Number(match[2]);
 if(issued>now||expires<=now||expires-issued!==SESSION_SECONDS)return false;
 const payload=token.slice(0,token.lastIndexOf('.'));
 if(!equal(match[4],await mac(await signingKey(env),`${new URL(request.url).origin}|${payload}`)))return false;
 const id=await mac(env.HOLIC100_SESSION_SECRET,`session:${token}`);
 const result=await env.AUTH_DB.prepare('SELECT expires FROM auth_sessions WHERE id = ?').bind(id).all();
 if(!result.success)throw Error('session storage unavailable');
 return result.results.length===1&&result.results[0].expires===expires;
}
export function cookie(token,clear=false){return `${COOKIE}=${clear?'':token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear?0:SESSION_SECONDS}`;}
export function secure(response){
 const headers=new Headers(response.headers);
 for(const [name,value] of Object.entries({'Cache-Control':'private, no-store, max-age=0','CDN-Cache-Control':'no-store','Cloudflare-CDN-Cache-Control':'no-store','Pragma':'no-cache','Vary':'Cookie','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'"}))headers.set(name,value);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
function response(body,status=200,headers={}){return secure(new Response(body,{status,headers}));}
function redirect(path,headers={}){return response(null,303,{Location:path,...headers});}
const loginPage=error=>`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Holic100 ログイン</title><link rel="stylesheet" href="/login.css"><main><h1>Holic100</h1><p>共通パスワードを入力してください。</p><p role="alert">${error}</p><form action="/login" method="post"><label for="password">パスワード</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="1024"><button type="submit">ログイン</button></form></main></html>`;
const loginCSS='*{box-sizing:border-box}body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#101b29;color:#eff3f8;font:18px -apple-system,BlinkMacSystemFont,sans-serif;padding:24px}main{width:min(440px,100%);background:#1a2b42;border:1px solid #425975;border-radius:18px;padding:28px}h1{color:#f5ca7b}form{display:grid;gap:14px}input,button{font:inherit;min-height:48px;border-radius:8px;padding:10px;width:100%}button{background:#f5ca7b;color:#101b29;border:0;font-weight:700}[role=alert]{color:#ffb3bc;font-size:15px}';
async function consumeLimit(env,request,now){
 const ip=request.headers.get('CF-Connecting-IP');
 if(!ip)throw Error('missing trusted client IP');
 // HMAC avoids storing IP addresses. Two atomic counters cover per-IP and distributed attacks.
 const bucket=Math.floor(now/WINDOW),key=await mac(env.HOLIC100_SESSION_SECRET,`ip:${ip}`);
 const sql=`INSERT INTO auth_rate_limits (key, bucket, attempts) VALUES (?, ?, 1)
 ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN bucket=excluded.bucket THEN attempts+1 ELSE 1 END, bucket=excluded.bucket RETURNING attempts`;
 const results=await env.AUTH_DB.batch([env.AUTH_DB.prepare(sql).bind(key,bucket),env.AUTH_DB.prepare(sql).bind('global',bucket)]);
 if(results.some(r=>!r.success||!Number.isInteger(r.results?.[0]?.attempts)))throw Error('rate limit unavailable');
 // Keep a bounded history; no password, session token, or raw IP is persisted.
 await env.AUTH_DB.prepare('DELETE FROM auth_rate_limits WHERE bucket < ?').bind(bucket-2).run();
 return results[0].results[0].attempts<=10&&results[1].results[0].attempts<=1000;
}
export async function handle(context){
 const {request,env}=context,url=new URL(request.url),path=url.pathname;
 try{
  if(url.protocol!=='https:')return response('HTTPS is required.',403);
  // Public retirement worker contains no game assets; old workers must be able to update before login.
  if(path==='/sw.js'&&(request.method==='GET'||request.method==='HEAD')){
   return response(request.method==='HEAD'?null:RETIRE_WORKER,200,{'Content-Type':'text/javascript; charset=utf-8','Service-Worker-Allowed':'/'});
  }
  if(!configured(env))return response('Authentication is unavailable.',503);
  // Verify the binding and schema even for a previously issued session (fail closed).
  const ready=await env.AUTH_DB.prepare('SELECT 1 AS ready FROM auth_rate_limits LIMIT 1').all();
  if(!ready.success)throw Error('database unavailable');
  if(path==='/login.css'&&request.method==='GET')return response(loginCSS,200,{'Content-Type':'text/css; charset=utf-8'});
  if(path==='/login'){
   if(request.method==='GET')return response(loginPage(''),200,{'Content-Type':'text/html; charset=utf-8'});
   if(request.method!=='POST')return response('Method not allowed',405,{Allow:'GET, POST'});
   if(request.headers.get('Origin')!==url.origin)return response('Forbidden',403);
   if(!await consumeLimit(env,request,Math.floor(Date.now()/1000)))return response(loginPage('試行回数の上限です。15分後に再試行してください。'),429,{'Content-Type':'text/html; charset=utf-8','Retry-After':String(WINDOW)});
   if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/x-www-form-urlencoded')return response('Unsupported content type',415);
   if(Number(request.headers.get('Content-Length'))>4096)return response('Request too large',413);
   const reader=request.body?.getReader();if(!reader)return response('Invalid request',400);
   let bytes=0,chunks=[];
   while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>4096){await reader.cancel();return response('Request too large',413);}chunks.push(value);}
   const data=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
   const passwords=new URLSearchParams(new TextDecoder().decode(data)).getAll('password');
   if(passwords.length!==1||!await passwordMatches(env,passwords[0]))return response(loginPage('パスワードが違います。'),401,{'Content-Type':'text/html; charset=utf-8'});
   return redirect('/',{'Set-Cookie':cookie(await createSession(env,url.origin))});
  }
  if(path==='/logout'){
   if(request.method!=='POST')return response('Method not allowed',405,{Allow:'POST'});
   if(request.headers.get('Origin')!==url.origin)return response('Forbidden',403);
   if(await validSession(request,env)){
    const token=(request.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${COOKIE}=`)).slice(COOKIE.length+1);
    const id=await mac(env.HOLIC100_SESSION_SECRET,`session:${token}`);
    const result=await env.AUTH_DB.prepare('DELETE FROM auth_sessions WHERE id = ?').bind(id).run();
    if(!result.success)throw Error('session revocation unavailable');
   }
   return redirect('/login',{'Set-Cookie':cookie('',true),'Clear-Site-Data':'"cache", "storage"'});
  }
  if(!await validSession(request,env)){
   if(request.method==='GET'&&(path==='/'||path.endsWith('.html')||request.headers.get('Sec-Fetch-Dest')==='document'))return redirect('/login',{'Set-Cookie':cookie('',true)});
   return response('Authentication required',401,{'Set-Cookie':cookie('',true)});
  }
  if(path==='/auth/session')return response(null,204);
  if(!['GET','HEAD'].includes(request.method))return response('Method not allowed',405,{Allow:'GET, HEAD'});
  return secure(await context.next());
 }catch{return response('Authentication is unavailable.',503);}
}
// Replacing a previously cache-first worker requires deleting its caches and reloading old documents.
// Do not await navigation inside activate: the navigation itself waits for activation to finish.
export const RETIRE_WORKER=`self.addEventListener('install',e=>{self.skipWaiting();});
self.addEventListener('activate',e=>e.waitUntil((async()=>{for(const key of await caches.keys())if(key.startsWith('holic100-'))await caches.delete(key);await self.clients.claim();for(const client of await self.clients.matchAll({type:'window'}))void client.navigate(client.url).catch(()=>null);})()));
self.addEventListener('fetch',e=>{if(new URL(e.request.url).origin===self.location.origin)e.respondWith(fetch(new Request(e.request,{cache:'no-store'})));});`;
