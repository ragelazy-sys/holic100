import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.BASE_URL||'https://127.0.0.1:8788';
const vars=Object.fromEntries((await readFile('.dev.vars','utf8')).trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
const legacy=`const CACHE='holic100-v4';const FILES=['./','./index.html','./style.css','./game.js','./app.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(self.clients.claim());});
self.addEventListener('fetch',e=>{if(e.request.method==='GET'&&new URL(e.request.url).origin===self.location.origin)e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));});`;
const {browserOptions}=await import('./local-browser-options.mjs');
const browser=await chromium.launch(await browserOptions(base));
try{
 const context=await browser.newContext({extraHTTPHeaders:{'CF-Connecting-IP':`198.19.${Math.floor(Math.random()*240)+1}.1`}}),page=await context.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/sw.js',async route=>{await route.fulfill({status:200,contentType:'text/javascript',body:legacy,headers:{'Cache-Control':'no-store'}});});
 await page.goto(base+'/login');await page.locator('#password').fill(vars.HOLIC100_PASSWORD);await page.locator('button').click();await page.locator('[data-slot="3"]').waitFor();

 await page.waitForFunction(async()=>{const cache=await caches.open('holic100-v4');return Boolean(await cache.match(new URL('/app.js',location.origin)));});
 await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
 await context.clearCookies();await context.unroute('**/sw.js');
 await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
 await page.waitForURL(base+'/login');await page.waitForFunction(async()=>!(await caches.keys()).some(key=>key.startsWith('holic100-')));
 assert.equal(await page.locator('#human-hand').count(),0);
 for(const asset of ['/app.js','/game.js','/style.css'])assert.equal((await context.request.get(base+asset,{maxRedirects:0})).status(),401);
 assert.deepEqual(errors,[]);
 console.log('PASS legacy cache-first worker -> retirement worker: cached game removed, old document reloaded to login, asset requests denied');await context.close();
}finally{await browser.close();}
