const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:1024,height:768},hasTouch:true});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  // Serve real worker responses without request interception, which alters offline networking.
  let oldWorker=true;
  const root=path.resolve(__dirname,'..');
  const server=http.createServer(async(req,res)=>{
   try{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    let body=await fs.readFile(file);
    if(pathname==='/sw.js'&&oldWorker)body=Buffer.from(body.toString().replace('holic100-v2','holic100-v1'));
    const mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'};
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'text/plain','Cache-Control':'no-store'});res.end(body);
   }catch{res.writeHead(404).end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  browser.on('disconnected',()=>server.close());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.waitForFunction(async()=> (await caches.keys()).includes('holic100-v1'));
  oldWorker=false;
  await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
  await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('holic100-v2')&&!keys.includes('holic100-v1');});
  await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  await context.setOffline(true);await page.reload();await page.locator('[data-slot="3"]').waitFor();
  assert.equal(await page.locator('#human-hand button').count(),4);
  await page.locator('#help').tap();assert.match(await page.locator('#rules').innerText(),/数字札（1〜10）または−10/);
  assert.ok(await page.locator('#incoming-change-accept').count());assert.deepEqual(errors,[]);
  console.log('PASS Service Worker v1 → v2 update, old cache removal, offline reload with updated rules and notice markup (1 scenario)');
  await context.close();
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
