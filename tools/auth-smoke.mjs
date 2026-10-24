import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {createSession,SESSION_SECONDS} from '../server/auth.js';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'https://127.0.0.1:8788';
// Only local disposable test secrets are read; no values are logged or included in screenshots.
const env=Object.fromEntries((await readFile('.dev.vars','utf8')).trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const runID=Math.floor(Math.random()*240)+1;
const signingEnv={...env,AUTH_DB:{prepare:()=>({bind(){return this;},async run(){return {success:true};}})}};
const {browserOptions}=await import('./local-browser-options.mjs');
const browser=await chromium.launch(await browserOptions(base));
let passed=0;
async function fits(page,selectors){
 const layout=await page.evaluate(selectors=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,rects:selectors.map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {selector,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})}),selectors);
 assert.ok(layout.sw<=layout.w&&layout.sh<=layout.h,JSON.stringify(layout));
 for(const r of layout.rects)assert.ok(r.x>=0&&r.y>=0&&r.right<=layout.w&&r.bottom<=layout.h,JSON.stringify(r));
}
await mkdir('/tmp/holic100-auth-shots',{recursive:true});
try{
 for(const [width,height] of [[1024,768],[1194,834]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true,extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${runID}.${width===1024?10:11}`}});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  for(const file of ['/','/index.html','/app.js','/game.js','/style.css','/manifest.webmanifest','/icons/icon-192.png']){
   const result=await context.request.get(base+file,{maxRedirects:0});assert.ok([303,401].includes(result.status()),`${file} ${result.status()}`);assert.match(result.headers()['cache-control'],/no-store/);
  }
  await page.goto(base);assert.equal(new URL(page.url()).pathname,'/login');await fits(page,['main','input','button']);
  await page.locator('#password').fill(crypto.randomUUID());await page.locator('button').tap();await page.locator('[role="alert"]').filter({hasText:'パスワードが違います'}).waitFor();
  async function login(){await page.goto(base+'/login');await page.locator('#password').fill(env.HOLIC100_PASSWORD);await page.locator('button').tap();await page.waitForURL(base+'/');await page.locator('[data-slot="3"]').waitFor();}
  await login();await page.waitForFunction(async()=>{const r=await navigator.serviceWorker.getRegistration();return Boolean(r?.active);});
  // Allow retirement-worker activation/reload to finish before manipulating the session.
  await page.waitForTimeout(1000);await page.locator('[data-slot="3"]').waitFor();
  const [session]= (await context.cookies()).filter(c=>c.name==='__Host-holic100');assert.ok(session.httpOnly&&session.secure);assert.equal(session.sameSite,'Strict');assert.ok(session.expires-Date.now()/1000>SESSION_SECONDS-120);
  assert.equal(await page.locator('#human-hand button').count(),4);assert.equal(await page.locator('.cpu-back').count(),12);
  await fits(page,['.bar','.human-area','#action','[data-slot="0"]','[data-slot="3"]','form[action="/logout"]']);
  await page.screenshot({path:`/tmp/holic100-auth-shots/game-${width}.png`});
  await page.reload();await page.locator('[data-slot="3"]').waitFor();assert.equal((await context.request.get(base+'/game.js')).status(),200);
  for(const token of [session.value.slice(0,-1)+(session.value.endsWith('a')?'b':'a'),await createSession(signingEnv,base,Math.floor(Date.now()/1000)-SESSION_SECONDS)]){
   await context.addCookies([{...session,value:token}]);await page.goto(base);await page.waitForURL(base+'/login');assert.equal((await context.request.get(base+'/app.js',{maxRedirects:0})).status(),401);
  }
  await login();const logoutToken=(await context.cookies()).find(c=>c.name==='__Host-holic100').value;await page.locator('form[action="/logout"] button').tap();await page.waitForURL(base+'/login');assert.equal((await context.cookies()).some(c=>c.name==='__Host-holic100'),false);
  assert.equal((await context.request.get(base+'/game.js',{headers:{Cookie:`__Host-holic100=${logoutToken}`},maxRedirects:0})).status(),401);
  assert.equal((await context.request.get(base+'/style.css',{maxRedirects:0})).status(),401);
  await login();await context.setOffline(true);
  // An already loaded document exits when it loses network; reload cannot retrieve a cached game.
  await page.waitForTimeout(300);let offlineDenied=false;
  try{await page.goto(base+'/',{waitUntil:'domcontentloaded',timeout:5000});}catch{offlineDenied=true;}
  assert.equal(offlineDenied,true);assert.equal(await page.locator('#human-hand').count(),0);
  assert.deepEqual(errors,[]);console.log(`PASS ${width}x${height}: asset denial, wrong/correct login, cookie flags, tamper/expiry, reload, logout, layout, offline denial`);passed++;
  await context.close();
 }
 // Rate limiting runs against the real local D1 binding, not an in-memory test double.
 const context=await browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.18.${runID}.90`}});
 for(let i=0;i<10;i++){const r=await context.request.post(base+'/login',{headers:{Origin:base},form:{password:crypto.randomUUID()}});assert.equal(r.status(),401);}
 const blocked=await context.request.post(base+'/login',{headers:{Origin:base},form:{password:env.HOLIC100_PASSWORD},maxRedirects:0});assert.equal(blocked.status(),429);passed++;await context.close();
 console.log(`Auth browser scenarios: ${passed} passed, 0 failed`);
}finally{await browser.close();}
