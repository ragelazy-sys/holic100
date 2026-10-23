import test from 'node:test';
import assert from 'node:assert/strict';
import {HolicGame,createDeck,TOTAL_CARDS} from '../game.js';
const rng=()=>0.37;
function g(){return new HolicGame({rng});}
function setCard(game,who,slot,type,value){
  const i=game.deck.findIndex(x=>x.type===type&&(value===undefined||x.value===value));
  if(i>=0){
    const replacement=game.deck.splice(i,1)[0];
    const previous=game.players[who].slots[slot];
    if(previous)game.deck.push(previous.card);
    game.players[who].slots[slot]={card:replacement,stamp:0};
    return;
  }
  const source=game.players.flatMap(p=>p.slots.map((s,index)=>({p,index,s}))).find(x=>x.s?.card.type===type&&(value===undefined||x.s.card.value===value));
  assert.ok(source,`card ${type} ${value} missing everywhere`);
  [game.players[who].slots[slot],source.p.slots[source.index]]=[source.s,game.players[who].slots[slot]];
}
function assertConservation(game){const r=game.checkCards();assert.deepEqual(r,{count:58,unique:58});}

test('deck composition is exactly 58 unique cards',()=>{
  const deck=createDeck();assert.equal(deck.length,TOTAL_CARDS);
  for(let i=1;i<=10;i++)assert.equal(deck.filter(x=>x.value===i&&x.type==='number').length,4);
  for(const [type,n] of [['minus',4],['reverse',4],['holic',4],['change2',2],['change4',2],['double',2]])assert.equal(deck.filter(x=>x.type===type).length,n);
  assert.equal(new Set(deck.map(x=>x.id)).size,58);
});
test('all four players start in fixed slots with 42 draw-pile cards',()=>{
  const game=g(); assert.equal(game.deck.length,42);assert.equal(game.players.length,4);
  assert.ok(game.players.every(p=>p.slots.length===4&&p.slots.every(Boolean)));
  assertConservation(game);
});
test('playing slot 2 replenishes slot 2 without reordering others',()=>{
  const game=g();setCard(game,0,2,'number',2);
  const before=game.players[0].slots.map(x=>x.card.id);
  game.play(2);const after=game.players[0].slots.map(x=>x.card.id);
  assert.equal(game.value,2);for(const idx of [0,1,3])assert.equal(before[idx],after[idx]);
  assert.notEqual(before[2],after[2]);assert.equal(game.current,1);assertConservation(game);
});
test('B rule: Holic100 always bursts its owner, including from zero',()=>{
  const game=g();setCard(game,0,1,'holic');const res=game.play(1);
  assert.equal(res.stage,'burst');assert.equal(game.value,100);
  assert.equal(game.players[0].alive,false);assert.equal(game.current,1);
  assertConservation(game);
});
test('99+1 bursts; 98+1 stays alive; score 100 cannot be survived by number cards',()=>{
  const game=g();setCard(game,0,0,'number',1);game.value=99;
  game.play(0);assert.equal(game.players[0].alive,false);
  const g2=g();setCard(g2,0,0,'number',1);g2.value=98;g2.play(0);
  assert.equal(g2.players[0].alive,true);assert.equal(g2.value,99);
});
test('minus clamps score at zero; Reverse flips direction',()=>{
  const game=g();setCard(game,0,0,'minus');game.value=4;
  game.play(0);assert.equal(game.value,0);
  setCard(game,1,0,'reverse');game.play(0);assert.equal(game.direction,-1);
  assert.equal(game.current,0);
});
test('Double forces numeric first and keeps actor for a second arbitrary play',()=>{
  const game=g();setCard(game,0,0,'double');setCard(game,1,0,'number',1);setCard(game,1,1,'reverse');
  game.play(0);assert.equal(game.current,1);assert.equal(game.remainingPlays,2);assert.equal(game.doubleFirst,true);
  assert.equal(game.isLegalSlot(1),false);assert.equal(game.isLegalSlot(0),true);
  game.play(0);assert.equal(game.current,1);assert.equal(game.doubleFirst,false);assert.equal(game.remainingPlays,1);
  game.play(1);assert.equal(game.direction,-1);assert.equal(game.current,0);assertConservation(game);
});
test('Double with neither number nor minus immediately eliminates the target',()=>{
  const game=g();setCard(game,0,0,'double');
  for(const [i,t] of ['reverse','change4','holic','change2'].entries())setCard(game,1,i,t);
  game.play(0);assert.equal(game.players[1].alive,false);assert.equal(game.current,2);
  assertConservation(game);
});
test('Change 2 selects two original target slots and preserves the other slots',()=>{
  const game=g();setCard(game,0,0,'change2');game.play(0);
  assert.equal(game.phase,'target');assert.equal(game.players[0].slots.filter(Boolean).length,4);
  game.chooseTarget(2);assert.equal(game.phase,'gift');
  const beforeA=game.players[0].slots.map(s=>s.card.id);
  const beforeB=game.players[2].slots.map(s=>s.card.id);
  const res=game.chooseGift([1,3]);
  assert.equal(game.phase,'play');assert.equal(game.current,1);
  assert.equal(game.players[0].slots[0].card.id,beforeA[0]);
  assert.equal(game.players[0].slots[2].card.id,beforeA[2]);
  assert.deepEqual([1,3].map(i=>game.players[0].slots[i].card.id).sort(),res.targetSlots.map(i=>beforeB[i]).sort());
  assert.deepEqual(res.targetSlots.map(i=>game.players[2].slots[i].card.id).sort(),[beforeA[1],beforeA[3]].sort());
  assertConservation(game);
});
test('Change 4 full 4-slot hand swap occurs after draw',()=>{
  const game=g();setCard(game,0,0,'change4');game.play(0);
  const a=game.players[0].slots.map(s=>s.card.id),b=game.players[3].slots.map(s=>s.card.id);
  game.chooseTarget(3);
  assert.deepEqual(game.players[0].slots.map(s=>s.card.id),b);
  assert.deepEqual(game.players[3].slots.map(s=>s.card.id),a);
  assertConservation(game);
});
test('deck recycle retains only previous discard top and shuffles older cards',()=>{
  const game=g();game.deck=[];
  // artificially move deck into removed for balance, then borrow two removed cards for discard
  const x=game.players[0].slots[0].card;
  const y=game.players[0].slots[1].card;
  const z=game.players[0].slots[2].card;
  // this unit test only examines recycle behavior, not conservation
  game.discard=[x,y,z];
  const drawn=game.drawCard();
  assert.equal(game.discard.length,1);assert.equal(game.discard[0].id,z.id);
  assert.ok([x.id,y.id].includes(drawn.id));
});
test('autosave restores game state and card conservation',()=>{
  const game=g();setCard(game,0,0,'number',1);game.play(0);
  const clone=new HolicGame({rng,autoload:game.serialize()});
  assert.equal(clone.value,game.value);assert.equal(clone.current,game.current);
  assertConservation(clone);
});
test('CPU policy never plays Holic100 when another nonbusting move is available',()=>{
  const game=g();setCard(game,1,0,'holic');setCard(game,1,1,'reverse');
  game.current=1;game.value=99;
  const slot=game.cpuSlot();
  assert.notEqual(game.players[1].slots[slot].card.type,'holic');
});
test('full CPU-only simulations conserve all 58 cards and eventually finish',()=>{
  for(let run=0;run<100;run++){
    let seed=run+1;
    const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/0x100000000;};
    const game=new HolicGame({rng:rand});
    let steps=0;
    while(game.phase!=='over'&&steps<5000){
      assertConservation(game);const slot=game.cpuSlot();
      if(game.phase==='target')game.chooseTarget(game.cpuTarget());
      else if(game.phase==='gift')game.chooseGift(game.cpuGift());
      else if(slot!==null)game.play(slot);
      else game.bust(game.current,'出せるカードなし');
      steps++;
    }
    assert.ok(steps<5000,`simulation ${run} exceeded bound`);
    assert.equal(game.survivorCount(),1);assertConservation(game);
  }
});

test('every fixed slot refills in place without sorting for human and CPUs',()=>{
  for(let actor=0;actor<4;actor++)for(let slot=0;slot<4;slot++){
    const game=g();game.current=actor;setCard(game,actor,slot,'number',1);
    const before=game.players[actor].slots.map(s=>s.card.id),drawn=game.deck.at(-1).id;
    assert.equal(game.play(slot).ok,true);
    assert.deepEqual(game.players[actor].slots.map(s=>s.card.id),before.map((id,i)=>i===slot?drawn:id));
    assertConservation(game);
  }
});
test('B rule bursts immediately above 100 without drawing or a second Double play',()=>{
  const game=g();setCard(game,0,0,'double');setCard(game,1,2,'number',10);
  game.value=95;game.play(0);const deckSize=game.deck.length;
  assert.equal(game.play(2).stage,'burst');assert.equal(game.value,105);
  assert.equal(game.deck.length,deckSize);assert.equal(game.players[1].alive,false);
  assert.equal(game.current,2);assert.equal(game.remainingPlays,1);assert.equal(game.doubleFirst,false);
  assertConservation(game);
});
test('Double first draw refills its slot and second Double chains to the next player',()=>{
  const game=g();setCard(game,0,0,'double');setCard(game,1,0,'number',1);
  setCard(game,1,3,'double');setCard(game,2,0,'number',2);
  game.play(0);const drawn=game.deck.at(-1).id;
  game.play(0);assert.equal(game.players[1].slots[0].card.id,drawn);
  assert.equal(game.current,1);game.play(3);
  assert.equal(game.current,2);assert.equal(game.doubleFirst,true);assert.equal(game.remainingPlays,2);
  assertConservation(game);
});
test('Change 2 samples distinct original target slots and leaves unselected slots unchanged',()=>{
  for(let seed=1;seed<=30;seed++){
    let state=seed;const game=new HolicGame({rng:()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;}});
    setCard(game,0,2,'change2');const drawn=game.deck.at(-1).id;
    game.play(2);assert.equal(game.players[0].slots[2].card.id,drawn);game.chooseTarget(3);
    const a=game.players[0].slots.map(s=>s.card.id),b=game.players[3].slots.map(s=>s.card.id);
    assert.throws(()=>game.chooseGift([1,1]));
    const {targetSlots}=game.chooseGift([0,2]);assert.equal(new Set(targetSlots).size,2);
    for(let i=0;i<4;i++)if(!targetSlots.includes(i))assert.equal(game.players[3].slots[i].card.id,b[i]);
    for(const [j,i] of targetSlots.entries()){
      assert.equal(game.players[0].slots[[0,2][j]].card.id,b[i]);
      assert.equal(game.players[3].slots[i].card.id,a[[0,2][j]]);
    }
    assertConservation(game);
  }
});
test('Change 4 refills played slot before complete ordered exchange',()=>{
  const game=g();setCard(game,0,3,'change4');const drawn=game.deck.at(-1).id;
  const target=game.players[2].slots.map(s=>s.card.id);
  game.play(3);const actor=game.players[0].slots.map(s=>s.card.id);assert.equal(actor[3],drawn);
  assert.throws(()=>game.chooseTarget(0));game.chooseTarget(2);
  assert.deepEqual(game.players[0].slots.map(s=>s.card.id),target);
  assert.deepEqual(game.players[2].slots.map(s=>s.card.id),actor);assertConservation(game);
});

test('Double first accepts −10 and keeps the second play',()=>{
  const game=g();setCard(game,0,0,'double');
  for(const [i,t] of ['minus','reverse','holic','change2'].entries())setCard(game,1,i,t);
  game.value=95;game.play(0);
  assert.equal(game.players[1].alive,true);
  assert.equal(game.doubleFirst,true);
  assert.equal(game.isLegalSlot(0),true);
  assert.equal(game.isLegalSlot(1),false);
  const choice=game.cpuSlot();
  assert.equal(game.players[1].slots[choice].card.type,'minus');
  game.play(0);
  assert.equal(game.value,85);assert.equal(game.remainingPlays,1);
  assert.equal(game.current,1);assertConservation(game);
});
test('Double first eliminates player without either number or minus cards',()=>{
  const game=g();setCard(game,0,0,'double');
  for(const [i,t] of ['reverse','holic','change2','change4'].entries())setCard(game,1,i,t);
  game.play(0);assert.equal(game.players[1].alive,false);assertConservation(game);
});
test('CPU uses −10 to survive a Double when all numbers would bust',()=>{
  const game=g();setCard(game,0,0,'double');
  setCard(game,1,0,'number',9);setCard(game,1,1,'minus');
  game.value=96;game.play(0);
  assert.equal(game.cpuSlot(),1);
  game.play(1);assert.equal(game.players[1].alive,true);assert.equal(game.value,86);
  assertConservation(game);
});

test('Double CPU chooses largest safe number before minus',()=>{
  const game=g();game.current=1;game.doubleFirst=true;game.remainingPlays=2;game.value=94;
  setCard(game,1,0,'number',5);setCard(game,1,1,'minus');
  setCard(game,1,2,'number',3);setCard(game,1,3,'number',6);
  assert.equal(game.cpuSlot(),0);assertConservation(game);
});
test('Double CPU chooses smallest number for unavoidable bust without minus',()=>{
  const game=g();game.current=1;game.doubleFirst=true;game.remainingPlays=2;game.value=99;
  setCard(game,1,0,'number',9);setCard(game,1,1,'reverse');
  setCard(game,1,2,'number',2);setCard(game,1,3,'holic');
  assert.equal(game.cpuSlot(),2);assert.equal(game.play(2).stage,'burst');
  assert.equal(game.players[1].alive,false);assertConservation(game);
});
test('Double minus refills its exact slot and allows any special on second play',()=>{
  const game=g();setCard(game,0,0,'double');
  for(const [i,t] of ['reverse','holic','minus','change4'].entries())setCard(game,1,i,t);
  game.play(0);const before=game.players[1].slots.map(s=>s.card.id),drawn=game.deck.at(-1).id;
  assert.equal(game.play(0).ok,false);assert.equal(game.play(1).ok,false);assert.equal(game.play(3).ok,false);
  game.play(2);assert.deepEqual(game.players[1].slots.map(s=>s.card.id),before.map((id,i)=>i===2?drawn:id));
  assert.equal(game.doubleFirst,false);assert.equal(game.isLegalSlot(3),true);
  game.play(3);game.chooseTarget(0);assertConservation(game);
});
