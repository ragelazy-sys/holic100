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
  // Change 2: human chooses two of their own cards, then two of CPU's hidden slots.
  await context.setOffline(false);
  await page.evaluate(async()=>{
    const {HolicGame}=await import('./game.js');
    const game=new HolicGame({rng:()=>0.37});
    game.phase='target';game.current=0;
    game.pendingChange={type:'change2',actor:0,target:null};
    localStorage.setItem('holic100-save-v1',game.serialize());
  });
  await page.reload();
  await page.locator('#cpu2').click();
  assert.ok((await page.locator('#instruction').innerText()).includes('渡すカード'));
  await page.locator('[data-slot="0"]').click();
  await page.locator('[data-slot="3"]').click();
  await page.locator('#action').click();
  assert.ok((await page.locator('#instruction').innerText()).includes('裏向き4枚'));
  assert.equal(await page.locator('#cpu2 [data-take-slot]').count(),4);
  assert.equal(await page.locator('#cpu1 [data-take-slot]').count(),0);
  // Target cards must remain face-down even in accessible labels and source markup.
  const labels=await page.locator('#cpu2 [data-take-slot]').evaluateAll(els=>els.map(e=>e.getAttribute('aria-label')));
  assert.ok(labels.every(label=>label.includes('裏向きスロット')));
  const beforeTake=await page.evaluate(()=>JSON.parse(localStorage.getItem('holic100-save-v1')));
  assert.equal(beforeTake.phase,'take');
  await page.locator('#cpu2 [data-take-slot="1"]').click();
  assert.equal(await page.locator('#action').isDisabled(),true);
  await page.locator('#cpu2 [data-take-slot="3"]').click();
  assert.equal(await page.locator('#action').isEnabled(),true);
  // Picking face-down slots must not swap the hands until the confirm action.
  const whileSelecting=await page.evaluate(()=>JSON.parse(localStorage.getItem('holic100-save-v1')));
  assert.deepEqual(whileSelecting.players.map(p=>p.slots.map(s=>s?.card.id)),beforeTake.players.map(p=>p.slots.map(s=>s?.card.id)));
  await page.locator('#action').click();
  const afterTake=await page.evaluate(()=>JSON.parse(localStorage.getItem('holic100-save-v1')));
  assert.equal(afterTake.players[0].slots[0].card.id,beforeTake.players[2].slots[1].card.id);
  assert.equal(afterTake.players[0].slots[3].card.id,beforeTake.players[2].slots[3].card.id);
  assert.equal(afterTake.players[2].slots[1].card.id,beforeTake.players[0].slots[0].card.id);
  assert.equal(afterTake.players[2].slots[3].card.id,beforeTake.players[0].slots[3].card.id);
  assert.deepEqual(errors,[]);
  // Reproduce a human auto-elimination and verify spectator dialog before CPU resumes.
  await context.setOffline(false);
  await page.evaluate(async()=>{
    const {HolicGame}=await import('./game.js');
    const game=new HolicGame({rng:()=>0.37});
    // At 99, swap the human's only safe Reverse with an unsafe high number.
    const slot=game.players[0].slots.findIndex(s=>s.card.type==='reverse');
    const index=game.deck.findIndex(c=>c.type==='number'&&c.value>1);
    if(slot<0||index<0)throw Error('Failed to seed bust scenario');
    const original=game.players[0].slots[slot].card;
    game.players[0].slots[slot].card=game.deck[index];
    game.deck[index]=original;
    game.value=99;game.resolveNoSafePlay();
    if(game.players[0].alive)throw Error('Human should auto-bust');
    localStorage.setItem('holic100-save-v1',game.serialize());
  });
  await page.reload();
  await page.locator('#human-bust').waitFor({state:'visible'});
  assert.ok((await page.locator('#human-bust-reason').innerText()).includes('バースト'));
  assert.ok((await page.locator('#instruction').innerText()).includes('脱落'));
  await page.locator('#human-bust-continue').click();
  await page.locator('#human-bust').waitFor({state:'hidden'});
  assert.ok((await page.locator('#instruction').innerText()).includes('観戦'));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({viewport:`${width}x${height}`,layout,offline:'passed',humanBustDialog:'passed',errors}));await context.close();
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
