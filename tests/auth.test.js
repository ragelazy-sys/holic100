import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {handle,createSession,validSession,cookie,SESSION_SECONDS,RETIRE_WORKER} from '../server/auth.js';
function environment(){
 const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../migrations/0001_auth_rate_limits.sql',import.meta.url),'utf8'));db.exec(readFileSync(new URL('../migrations/0002_auth_sessions.sql',import.meta.url),'utf8'));
 const wrap=(sql,values=[])=>({bind(...args){return wrap(sql,args);},async all(){return {success:true,results:db.prepare(sql).all(...values)};},async run(){db.prepare(sql).run(...values);return {success:true};}});
 return {HOLIC100_PASSWORD:crypto.randomUUID(),HOLIC100_SESSION_SECRET:crypto.randomUUID(),AUTH_DB:{prepare:wrap,async batch(statements){return Promise.all(statements.map(s=>s.all()));}},db};
}
function request(path='/',options={}){
 const {headers,...rest}=options;
 return new Request(`https://preview.holic100.test${path}`,{...rest,headers:{'CF-Connecting-IP':'192.0.2.1',...headers}});
}
function run(env,req){return handle({env,request:req,next:()=>new Response('protected asset')});}
function login(env,password=env.HOLIC100_PASSWORD,headers={}){return run(env,request('/login',{method:'POST',body:new URLSearchParams({password}),headers:{Origin:'https://preview.holic100.test',...headers}}));}

test('all unauthenticated game assets are denied, including PWA and arbitrary paths',async()=>{
 const env=environment();for(const path of ['/','/index.html','/app.js','/game.js','/style.css','/manifest.webmanifest','/icons/icon-192.png','/foo','/docs/x']){
  const result=await run(env,request(path));assert.ok([303,401].includes(result.status));assert.notEqual(await result.text(),'protected asset');assert.match(result.headers.get('cache-control'),/no-store/);
 }
});
test('missing or invalid secrets and DB fail closed for both login and assets',async()=>{
 for(const override of [{HOLIC100_PASSWORD:''},{HOLIC100_PASSWORD:undefined},{HOLIC100_SESSION_SECRET:''},{HOLIC100_SESSION_SECRET:'short'},{AUTH_DB:undefined}]){
  const env={...environment(),...override};for(const path of ['/','/app.js','/login'])assert.equal((await run(env,request(path))).status,503);
 }
 const env=environment();env.HOLIC100_SESSION_SECRET=env.HOLIC100_PASSWORD;assert.equal((await run(env,request())).status,503);
});
test('DB/schema failure denies even a correctly signed existing session',async()=>{
 const env=environment(),token=await createSession(env,'https://preview.holic100.test');env.db.exec('DROP TABLE auth_rate_limits');
 assert.equal((await run(env,request('/',{headers:{Cookie:cookie(token)}}))).status,503);
});
test('correct login issues host-only secure HttpOnly strict seven-day cookie',async()=>{
 const env=environment(),res=await login(env);assert.equal(res.status,303);assert.equal(res.headers.get('location'),'/');
 const value=res.headers.get('set-cookie');for(const flag of ['__Host-holic100=','HttpOnly','Secure','SameSite=Strict','Path=/','Max-Age=604800'])assert.ok(value.includes(flag));
 assert.ok(!value.includes('Domain='));assert.ok(!value.includes(env.HOLIC100_PASSWORD));
 assert.equal(await validSession(request('/',{headers:{Cookie:value.split(';')[0]}}),env),true);
 const asset=await run(env,request('/game.js',{headers:{Cookie:value.split(';')[0]}}));assert.equal(await asset.text(),'protected asset');assert.match(asset.headers.get('cache-control'),/no-store/);
});
test('incorrect password is rejected and never reflected',async()=>{
 const env=environment(),attempt=crypto.randomUUID(),res=await login(env,attempt);assert.equal(res.status,401);assert.ok(!(await res.text()).includes(attempt));assert.equal(res.headers.get('set-cookie'),null);
});
test('tampered, expired, future, duplicate and cross-origin cookies are rejected',async()=>{
 const env=environment(),origin='https://preview.holic100.test',now=Math.floor(Date.now()/1000),token=await createSession(env,origin);
 const invalid=[token.slice(0,-1)+(token.endsWith('a')?'b':'a'),await createSession(env,origin,now-SESSION_SECONDS),await createSession(env,origin,now+60),'invalid'];
 for(const t of invalid)assert.equal(await validSession(request('/',{headers:{Cookie:cookie(t)}}),env),false);
 assert.equal(await validSession(request('/',{headers:{Cookie:`${cookie(token).split(';')[0]}; ${cookie(token).split(';')[0]}`}}),env),false);
 assert.equal(await validSession(new Request('https://production.holic100.test/',{headers:{Cookie:cookie(token)}}),env),false);
});
test('password and signing-key rotation invalidate existing sessions',async()=>{
 const env=environment(),token=await createSession(env,'https://preview.holic100.test'),req=request('/',{headers:{Cookie:cookie(token)}});
 assert.equal(await validSession(req,env),true);const password=env.HOLIC100_PASSWORD;env.HOLIC100_PASSWORD=crypto.randomUUID();assert.equal(await validSession(req,env),false);
 env.HOLIC100_PASSWORD=password;env.HOLIC100_SESSION_SECRET=crypto.randomUUID();assert.equal(await validSession(req,env),false);
});
test('logout is POST-only, same-origin, clears cookie and browser caches/storage',async()=>{
 const env=environment();assert.equal((await run(env,request('/logout'))).status,405);
 assert.equal((await run(env,request('/logout',{method:'POST',headers:{Origin:'https://evil.test'}}))).status,403);
 const res=await run(env,request('/logout',{method:'POST',headers:{Origin:'https://preview.holic100.test'}}));assert.equal(res.status,303);assert.match(res.headers.get('set-cookie'),/Max-Age=0/);assert.match(res.headers.get('clear-site-data'),/cache/);
});
test('login rejects cross-origin and missing origin posts',async()=>{
 const env=environment();assert.equal((await login(env,env.HOLIC100_PASSWORD,{Origin:'https://evil.test'})).status,403);
 assert.equal((await run(env,request('/login',{method:'POST',body:new URLSearchParams({password:env.HOLIC100_PASSWORD})}))).status,403);
});
test('rate limit blocks the eleventh request even with a correct password',async()=>{
 const env=environment();for(let i=0;i<10;i++)assert.equal((await login(env,crypto.randomUUID())).status,401);
 const res=await login(env);assert.equal(res.status,429);assert.equal(res.headers.get('retry-after'),'900');
 const rows=env.db.prepare('SELECT key FROM auth_rate_limits').all();assert.equal(rows.length,2);assert.ok(!JSON.stringify(rows).includes('192.0.2.1'));
});
test('global limit also blocks requests from a fresh IP',async()=>{
 const env=environment();env.db.prepare('INSERT INTO auth_rate_limits VALUES (?, ?, ?)').run('global',Math.floor(Date.now()/1000/900),1000);
 assert.equal((await login(env)).status,429);
});
test('old rate-limit windows reset and stale hashed IP entries are removed',async()=>{
 const env=environment();env.db.prepare('INSERT INTO auth_rate_limits VALUES (?, ?, ?)').run('global',0,10000);env.db.prepare('INSERT INTO auth_rate_limits VALUES (?, ?, ?)').run('stale',0,100);
 assert.equal((await login(env)).status,303);assert.equal(env.db.prepare('SELECT * FROM auth_rate_limits WHERE key=?').get('stale'),undefined);
});
test('missing trusted IP or rate-limit backend failure denies login',async()=>{
 const env=environment();const req=request('/login',{method:'POST',body:new URLSearchParams({password:env.HOLIC100_PASSWORD}),headers:{Origin:'https://preview.holic100.test'}});req.headers.delete('CF-Connecting-IP');assert.equal((await run(env,req)).status,503);
 env.AUTH_DB.batch=async()=>{throw Error('unavailable');};assert.equal((await login(env)).status,503);
});
test('oversize bodies and duplicate password parameters are rejected',async()=>{
 const env=environment();assert.equal((await login(env,'x'.repeat(5000))).status,413);
 const res=await run(env,request('/login',{method:'POST',body:`password=a&password=b`,headers:{Origin:'https://preview.holic100.test','Content-Type':'application/x-www-form-urlencoded'}}));assert.equal(res.status,401);
});
test('HTTPS is mandatory and auth session endpoint requires a session',async()=>{
 const env=environment();assert.equal((await run(env,new Request('http://preview.holic100.test/'))).status,403);
 assert.equal((await run(env,request('/auth/session'))).status,401);
 const token=await createSession(env,'https://preview.holic100.test');assert.equal((await run(env,request('/auth/session',{headers:{Cookie:cookie(token)}}))).status,204);
});
test('only a game-free retirement worker is public, even during missing configuration',async()=>{
 for(const env of [{},environment()]){const res=await run(env,request('/sw.js'));assert.equal(res.status,200);assert.equal(await res.text(),RETIRE_WORKER);assert.ok(!RETIRE_WORKER.includes('caches.match'));assert.match(RETIRE_WORKER,/caches.delete/);}
});

test('logout revokes a copied session token on the server',async()=>{
 const env=environment(),token=await createSession(env,'https://preview.holic100.test');
 const headers={Origin:'https://preview.holic100.test',Cookie:cookie(token)};
 assert.equal(await validSession(request('/',{headers}),env),true);
 assert.equal((await run(env,request('/logout',{method:'POST',headers}))).status,303);
 assert.equal(await validSession(request('/',{headers}),env),false);
});
