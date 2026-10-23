const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const base=process.env.BASE_URL || 'http://127.0.0.1:8000/';
const key='holic100-save-v1';
async function state(page){return page.evaluate(key=>JSON.parse(localStorage.getItem(key)),key);}
const ids=(s,id)=>s.players[id].slots.map(x=>x?.card.id);
function conserved(s){const cards=[...s.deck,...s.discard,...s.removed,...s.players.flatMap(p=>p.slots.filter(Boolean).map(x=>x.card))];assert.equal(cards.length,58);assert.equal(new Set(cards.map(c=>c.id)).size,58);}
async function fixture(page,type,target=0,phase='play'){
 return page.evaluate(async({key,type,target,phase})=>{
  const {HolicGame}=await import('./game.js');let seed=5;
  const g=new HolicGame({rng:()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;}});
  function put(slot,type){
   const locations=[...g.deck.map((card,i)=>({card,set:c=>g.deck[i]=c})),...g.players.flatMap(p=>p.slots.map((s,i)=>({card:s.card,set:c=>p.slots[i]={card:c,stamp:0}})))];
   const source=locations.find(x=>x.card.type===type);const old=g.players[3].slots[slot].card;
   source.set(old);g.players[3].slots[slot]={card:source.card,stamp:0};
  }
  put(0,type);for(let i=1;i<4;i++)put(i,'holic');
  g.current=3;g.tick=20;
  for(const p of g.players)for(const s of p.slots)s.stamp=p.id===target?0:20;
  if(phase==='gift'){g.play(0);g.chooseTarget(0);}
  const snapshot=JSON.parse(g.serialize());localStorage.setItem(key,g.serialize());return snapshot;
 },{key,type,target,phase});
}
async function fits(page,selectors){
 const result=await page.evaluate(selectors=>({w:innerWidth,h:innerHeight,sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,boxes:selectors.map(s=>{const r=document.querySelector(s).getBoundingClientRect();return {s,x:r.x,y:r.y,right:r.right,bottom:r.bottom};})}),selectors);
 assert.ok(result.sw<=result.w&&result.sh<=result.h,JSON.stringify(result));
 for(const r of result.boxes)assert.ok(r.x>=0&&r.y>=0&&r.right<=result.w&&r.bottom<=result.h,JSON.stringify(r));
}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 let passed=0;
 try{
 for(const [width,height] of [[1024,768],[1194,834]]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:true});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.locator('[data-slot="3"]').waitFor();
  for(const type of ['change2','change4']){
   const initial=await fixture(page,type);await page.reload();
   const modal=page.locator('#incoming-change');await modal.waitFor({state:'visible'});
   assert.match(await modal.innerText(),new RegExp(`CPU 3からChange ${type==='change2'?2:4}`));
   const before=await state(page);assert.equal(before.phase,'target');assert.deepEqual(ids(before,0),ids(initial,0));conserved(before);
   await fits(page,['#incoming-change','#incoming-change-accept']);
   // Escape must not dismiss the notice or perform the exchange.
   await page.keyboard.press('Escape');await page.waitForTimeout(700);
   assert.ok(await modal.isVisible());assert.deepEqual(ids(await state(page),0),ids(before,0));
   await page.screenshot({path:`/tmp/holic100-${type}-notice-${width}.png`});
   await page.locator('#incoming-change-accept').tap();
   await page.waitForFunction(({key,type})=>JSON.parse(localStorage.getItem(key)).log.some(e=>e.type==='swap'&&e.actor===3&&e.target===0),{key,type});
   const after=await state(page);const swap=after.log.find(e=>e.type==='swap');conserved(after);
   const changed=type==='change2'?swap.targetSlots:[0,1,2,3];assert.equal(new Set(changed).size,type==='change2'?2:4);
   for(let i=0;i<4;i++){
    assert.equal(ids(after,0)[i],changed.includes(i)?ids(before,3)[swap.slots[changed.indexOf(i)]]:ids(before,0)[i]);
   }
   assert.equal(await page.locator('.hand-card.just-swapped').count(),changed.length);
   assert.deepEqual(await page.locator('#human-hand button').evaluateAll(nodes=>nodes.map(n=>Number(n.dataset.slot))),[0,1,2,3]);
   await fits(page,['.human-area','#action','[data-slot="0"]','[data-slot="3"]']);
   await page.screenshot({path:`/tmp/holic100-${type}-swapped-${width}.png`});
   await page.waitForTimeout(1400);assert.equal(await page.locator('.hand-card.just-swapped').count(),0);
   assert.equal(await page.locator('.cpu-back').count(),12);assert.equal(await page.locator('.cpu-back .card-title').count(),0);
   console.log(`PASS ${width}x${height} ${type}: notice, wait, tap, swap, fixed slots, highlight`);passed++;
  }
  for(const type of ['change2','change4']){
   await fixture(page,type,1);await page.reload();
   await page.waitForFunction(key=>JSON.parse(localStorage.getItem(key)).log.some(e=>e.type==='swap'&&e.actor===3&&e.target===1),key);
   assert.equal(await page.locator('#incoming-change').isVisible(),false);conserved(await state(page));passed++;
   console.log(`PASS ${width}x${height} ${type}: CPU-to-CPU has no popup`);
  }
  assert.deepEqual(errors,[]);await context.close();
 }
 console.log(`Browser scenarios: ${passed} passed, 0 failed`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
