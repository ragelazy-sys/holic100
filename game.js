// Holic100 rule engine: no DOM / network dependency.
export const TOTAL_CARDS = 58;
export const TYPES = Object.freeze({MINUS:'minus', REVERSE:'reverse', HOLIC:'holic', CHANGE2:'change2', CHANGE4:'change4', DOUBLE:'double'});
export const CARD_LABEL = card => !card ? '' : card.type === 'number' ? String(card.value) : ({minus:'−10',reverse:'Reverse',holic:'Holic100',change2:'Change 2',change4:'Change 4',double:'Double'}[card.type]);
export const isDoubleFirstEligible = card => card?.type === 'number' || card?.type === 'minus';
export function createDeck(){
  const cards=[];
  let id=0;
  const add=(type,value,count)=>{for(let i=0;i<count;i++) cards.push({id:id++,type,value});};
  for(let n=1;n<=10;n++) add('number',n,4);
  add('minus',-10,4); add('reverse',0,4); add('holic',100,4);
  add('change2',0,2); add('change4',0,2); add('double',0,2);
  return cards;
}
export class HolicGame {
  constructor({rng=Math.random,autoload=null}={}){
    this.rng=rng;
    if(autoload){this.load(autoload);}else{this.newGame();}
  }
  shuffle(items){for(let i=items.length-1;i>0;i--){const j=Math.floor(this.rng()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
  newGame(){
    this.deck=this.shuffle(createDeck()); this.discard=[];this.removed=[];
    this.players=Array.from({length:4},(_,id)=>({id,name:id===0?'あなた':`CPU ${id}`,alive:true,slots:[null,null,null,null]}));
    this.value=0;this.direction=1;this.current=0;this.phase='play';this.pendingChange=null;
    this.pendingDouble=false;this.remainingPlays=1;this.doubleFirst=false;
    this.tick=0;this.winner=null;this.events=[];this.log=[];this.humanBustAcknowledged=false;
    for(let slot=0;slot<4;slot++)for(let player=0;player<4;player++)this.drawInto(player,slot);
    this.emit('start','ゲーム開始。あなたのターンです。');
    this.beginTurn();
  }
  emit(type,message,extra={}){const event={type,message, ...extra}; this.events.push(event);this.log.unshift(event);this.log=this.log.slice(0,75);return event;}
  drawCard(){
    if(this.deck.length===0 && this.discard.length>1){
      const top=this.discard.pop();this.deck=this.shuffle(this.discard.splice(0));this.discard.push(top);
      this.emit('recycle','山札を再構成しました（一番上のカードは場に残します）。');
    }
    return this.deck.pop()??null;
  }
  drawInto(playerId,slot){
    const card=this.drawCard();
    if(card){this.players[playerId].slots[slot]={card,stamp:this.tick};this.emit('draw',`${this.players[playerId].name}：スロット${slot}を補充`,{player:playerId,slot});}
    return card;
  }
  isLegalSlot(slot){
    const p=this.players[this.current];
    return this.phase==='play'&&p?.alive&&Number.isInteger(slot)&&slot>=0&&slot<4&&p.slots[slot]?.card&&(this.doubleFirst ? isDoubleFirstEligible(p.slots[slot].card) : true);
  }
  // Is a card allowed this play, and would it leave the table below 100?
  isSafeCard(card){
    if(!card)return false;
    if(this.doubleFirst&&!isDoubleFirstEligible(card))return false;
    const total=card.type==='number'?this.value+card.value
      :card.type==='minus'?Math.max(0,this.value-10)
      :card.type==='holic'?100:this.value;
    return total<100;
  }
  hasSafePlay(playerId=this.current){
    if(this.phase!=='play'||!this.players[playerId]?.alive)return false;
    return this.players[playerId].slots.some(slot=>this.isSafeCard(slot?.card));
  }
  resolveNoSafePlay(){
    if(this.phase!=='play'||!this.players[this.current]?.alive||this.hasSafePlay())return false;
    const reason=this.doubleFirst
      ? 'Doubleの1枚目に、合計100未満を保てる数字札または−10がありません。'
      : '合計を100未満に保てるカードがありません。';
    this.bust(this.current,reason);
    return true;
  }
  nextAlive(from=this.current){
    for(let i=0;i<4;i++){const k=(from+(i+1)*this.direction+16)%4;if(this.players[k].alive)return k;}
    return null;
  }
  survivorCount(){return this.players.filter(p=>p.alive).length;}
  changeScore(card){
    if(card.type==='number')this.value+=card.value;
    else if(card.type==='minus')this.value=Math.max(0,this.value-10);
    else if(card.type==='holic')this.value=100;
    else if(card.type==='reverse')this.direction*=-1;
    else if(card.type==='double')this.pendingDouble=true;
  }
  play(slot){
    if(!this.isLegalSlot(slot))return {ok:false,reason:'そのカードは現在出せません。'};
    if(this.resolveNoSafePlay())return {ok:true,stage:'burst-no-safe',card:null};
    const actor=this.current;const p=this.players[actor];const card=p.slots[slot].card;
    p.slots[slot]=null;this.discard.push(card);this.tick++;
    this.changeScore(card);
    this.emit('play',`${p.name}：スロット${slot}から ${CARD_LABEL(card)}（合計 ${this.value}）`,{player:actor,slot,card});
    // Confirmed B rule: a Holic100 play immediately busts its owner.
    if(this.value>=100){this.bust(actor,`合計${this.value}が100以上になりました。`);return {ok:true,stage:'burst',card};}
    this.drawInto(actor,slot);
    if(card.type==='change2'||card.type==='change4'){
      this.pendingChange={type:card.type,actor,target:null};this.phase='target';
      this.emit('choose-target',`${p.name}：交換する相手を選びます。`,{player:actor});
      return {ok:true,stage:'target',card};
    }
    this.finishPlay();return {ok:true,stage:'complete',card};
  }
  chooseTarget(target){
    if(this.phase!=='target'||!this.pendingChange)throw Error('交換相手を選ぶ状態ではありません。');
    const actor=this.pendingChange.actor;
    if(!Number.isInteger(target)||target===actor||!this.players[target]?.alive)throw Error('有効な相手を選択してください。');
    this.pendingChange.target=target;
    this.emit('target',`${this.players[actor].name} → ${this.players[target].name} を指名`,{player:actor,target});
    if(this.pendingChange.type==='change4'){
      const a=this.players[actor],b=this.players[target];
      [a.slots,b.slots]=[b.slots,a.slots];
      for(const s of [...a.slots,...b.slots])if(s)s.stamp=this.tick;
      this.emit('swap',`${a.name}と${b.name}の手札4枚を全交換`,{actor,target,slots:[0,1,2,3]});
      this.pendingChange=null;this.phase='play';this.finishPlay();return {stage:'complete'};
    }
    this.phase='gift';this.emit('choose-gift',`${this.players[actor].name}：渡すカードを2枚選びます。`,{player:actor});
    return {stage:'gift'};
  }
  chooseGift(indices){
    if(this.phase!=='gift'||this.pendingChange?.type!=='change2')throw Error('Change 2のカード選択中ではありません。');
    const pair=[...new Set(indices)];
    if(pair.length!==2||pair.some(x=>!Number.isInteger(x)||x<0||x>3||!this.players[this.pendingChange.actor].slots[x]))throw Error('異なる2つのスロットを選んでください。');
    const {actor,target}=this.pendingChange;
    this.pendingChange.giftIndices=pair;
    this.phase='take';
    this.emit('choose-take',`${this.players[actor].name}：${this.players[target].name}の裏向き手札から2枚選びます。`,{actor,target});
    return {stage:'take'};
  }
  // The actor specifies exactly which TWO face-down slots to take. The card
  // contents of the target player are never exposed to the selector.
  chooseTake(indices){
    if(this.phase!=='take'||this.pendingChange?.type!=='change2')
      throw Error('Change 2の相手札を選ぶ状態ではありません。');
    if(!Array.isArray(indices))throw Error('相手のスロットを2つ選んでください。');
    const targetSlots=[...new Set(indices)];
    const {actor,target,giftIndices}=this.pendingChange;
    const a=this.players[actor],b=this.players[target];
    if(targetSlots.length!==2||targetSlots.some(i=>!Number.isInteger(i)||i<0||i>3||!b.slots[i]))
      throw Error('相手の異なる2つのスロットを選んでください。');
    if(!Array.isArray(giftIndices)||giftIndices.length!==2)
      throw Error('自分の交換する2枚が未確定です。');
    // Swap only after BOTH players' positions have been selected. Cards never
    // shift or sort: only selected slots change, and all 58 IDs are preserved.
    for(let j=0;j<2;j++){
      const ai=giftIndices[j],bi=targetSlots[j];
      [a.slots[ai],b.slots[bi]]=[b.slots[bi],a.slots[ai]];
      if(a.slots[ai])a.slots[ai].stamp=this.tick;
      if(b.slots[bi])b.slots[bi].stamp=this.tick;
    }
    this.emit('swap',`${a.name}と${b.name}が各2枚を交換（${a.name}のスロット${giftIndices.join('・')}）`,
      {actor,target,slots:giftIndices,targetSlots});
    this.pendingChange=null;this.phase='play';this.finishPlay();
    return {stage:'complete',targetSlots,giftIndices};
  }
  cpuTake(){
    if(this.phase!=='take'||this.pendingChange?.type!=='change2')
      throw Error('Change 2の相手札を選ぶ状態ではありません。');
    // Uniform random draw from currently occupied face-down slots. Do not
    // examine opponents' card faces or choose based on private information.
    return this.shuffle(this.players[this.pendingChange.target].slots
      .map((slot,i)=>slot?i:null).filter(i=>i!==null)).slice(0,2);
  }
  bust(playerId,reason){
    const p=this.players[playerId];if(!p.alive)return;
    p.alive=false;
    // Eliminated player's unplayed cards leave the game (not recycled).
    for(let slot=0;slot<4;slot++){if(p.slots[slot])this.removed.push(p.slots[slot].card);p.slots[slot]=null;}
    this.emit('bust',`${p.name}がバースト！ ${reason}`,{player:playerId});
    this.pendingChange=null;this.phase='play';
    if(this.survivorCount()===1){this.winner=this.players.find(q=>q.alive).id;this.phase='over';this.emit('win',`${this.players[this.winner].name}の勝利！`,{player:this.winner});return;}
    // Any ongoing double requirement is forfeited by the eliminated player.
    this.pendingDouble=false;this.remainingPlays=1;this.doubleFirst=false;
    this.current=this.nextAlive(playerId);this.beginTurn();
  }
  finishPlay(){
    if(this.phase==='over')return;
    this.phase='play';
    if(this.remainingPlays>1){
      this.remainingPlays--;this.doubleFirst=false;
      this.emit('double-next',`${this.players[this.current].name}：Doubleの2枚目です。`,{player:this.current});
      this.resolveNoSafePlay();
      return;
    }
    this.remainingPlays=1;this.doubleFirst=false;
    this.current=this.nextAlive();
    const doubled=this.pendingDouble;this.pendingDouble=false;
    this.remainingPlays=doubled?2:1;this.doubleFirst=doubled;
    this.beginTurn();
  }
  beginTurn(){
    if(this.phase==='over')return;
    const p=this.players[this.current];
    this.emit('turn',`${p.name}のターン${this.doubleFirst?'（Double：1枚目は数字札または−10）':''}`,{player:this.current});
    this.resolveNoSafePlay();
  }
  stagnantScore(playerId){const p=this.players[playerId];return p.slots.reduce((total,s)=>total+(s?Math.min(30,this.tick-s.stamp):0),0);}
  cpuSlot(){
    const p=this.players[this.current];
    if(!p?.alive)return null;
    // Never force an unsafe card: an unavoidable loss is handled before drawing a card.
    const cards=p.slots.map((s,i)=>({slot:i,card:s?.card})).filter(x=>this.isSafeCard(x.card));
    if(this.doubleFirst){
      const nums=cards.filter(x=>x.card.type==='number');
      if(nums.length)return this.maxNumber(nums).slot;
      return cards.find(x=>x.card.type==='minus')?.slot??null;
    }
    const nums=cards.filter(x=>x.card.type==='number');
    if(this.value<=75&&nums.length)return this.maxNumber(nums).slot;
    if(this.value>=76&&nums.length)return this.maxNumber(nums).slot;
    const specials=cards.filter(x=>x.card.type!=='number');
    // Holic100 is never an attack under B: it is an immediate self-bust.
    const next=this.nextAlive();const suspicious=next!==null&&this.stagnantScore(next)>=12;
    const priorities=this.value>=76
      ?(suspicious?['minus','double','reverse','change4','change2']:['minus','reverse','change4','change2','double'])
      :['reverse','minus','change2','change4','double'];
    for(const type of priorities){const item=specials.find(x=>x.card.type===type);if(item)return item.slot;}
    // No safe card: beginTurn/finishPlay eliminates the player without discarding.
    return null;
  }
  maxNumber(items){return [...items].sort((a,b)=>b.card.value-a.card.value||a.slot-b.slot)[0];}
  minNumber(items){return [...items].sort((a,b)=>a.card.value-b.card.value||a.slot-b.slot)[0];}
  cpuTarget(){
    const candidates=this.players.filter(p=>p.alive&&p.id!==this.current);
    candidates.sort((a,b)=>this.stagnantScore(b.id)-this.stagnantScore(a.id)||a.id-b.id);
    return candidates[0].id;
  }
  cpuGift(){
    const p=this.players[this.current];
    const rank=card=>card.type==='holic'?-100:card.type==='number'?card.value:card.type==='change2'?15:card.type==='change4'?16:card.type==='reverse'?17:card.type==='double'?18:19;
    return p.slots.map((s,i)=>({i,score:rank(s.card)})).sort((a,b)=>a.score-b.score||a.i-b.i).slice(0,2).map(x=>x.i);
  }
  checkCards(){
    const all=[...this.deck,...this.discard,...this.removed,...this.players.flatMap(p=>p.slots.filter(Boolean).map(s=>s.card))];
    return {count:all.length,unique:new Set(all.map(c=>c.id)).size};
  }
  serialize(){
    const {deck,discard,removed,players,value,direction,current,phase,pendingChange,pendingDouble,remainingPlays,doubleFirst,tick,winner,log,humanBustAcknowledged}=this;
    return JSON.stringify({version:1,deck,discard,removed,players,value,direction,current,phase,pendingChange,pendingDouble,remainingPlays,doubleFirst,tick,winner,log,humanBustAcknowledged});
  }
  load(json){
    const state=typeof json==='string'?JSON.parse(json):json;
    if(state.version!==1||!Array.isArray(state.players)||state.players.length!==4||!Array.isArray(state.deck))throw Error('保存データが不正です。');
    Object.assign(this,state);this.events=[];
    this.humanBustAcknowledged=state.humanBustAcknowledged===true;
    if(this.checkCards().count!==TOTAL_CARDS||this.checkCards().unique!==TOTAL_CARDS)throw Error('保存データのカード枚数が不正です。');
    // Normalize an older save whose active player cannot make a safe play.
    this.resolveNoSafePlay();
  }
}
