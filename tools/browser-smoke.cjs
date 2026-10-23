const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 for(const [width,height] of [[1024,768],[1194,834]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true});
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.BASE_URL || 'http://127.0.0.1:8000/');await page.locator('[data-slot]').last().waitFor();
  assert.equal(await page.locator('#human-hand button').count(),4);
  assert.equal(await page.locator('.cpu-back').count(),12);
  assert.equal(await page.locator('.cpu-back .card-title').count(),0);
  const layout=await page.evaluate(()=>{
   const selectors=['.app','.human-area','#action',...Array.from({length:4},(_,i)=>`[data-slot="${i}"]`), '#cpu1','#cpu2','#cpu3'];
   return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,rects:selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,right:r.right,bottom:r.bottom}})};
  });
  assert.ok(layout.scrollWidth<=width);assert.ok(layout.scrollHeight<=height,JSON.stringify(layout));
  for(const r of layout.rects)assert.ok(r.x>=0&&r.y>=0&&r.right<=width&&r.bottom<=height,JSON.stringify(r));
  await page.locator('#help').click();assert.ok(await page.locator('#rules').isVisible());await page.locator('#close-rules').click();
  await page.locator('[data-slot="2"]').click();assert.ok((await page.locator('#selection-label').innerText()).startsWith('SLOT 2:'));
  await page.screenshot({path:`/tmp/holic100-${width}x${height}.png`,fullPage:true});
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
  await page.reload();await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
  await context.setOffline(true);await page.reload();await page.locator('#human-hand button').last().waitFor();
  assert.equal(await page.locator('#human-hand button').count(),4);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:`${width}x${height}`,layout,offline:'passed',errors}));await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
