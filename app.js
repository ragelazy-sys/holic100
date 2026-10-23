import {HolicGame,CARD_LABEL} from './game.js';
const $=id=>document.getElementById(id);
const storageKey='holic100-save-v1';
let game;
try{const saved=localStorage.getItem(storageKey);game=new HolicGame({autoload:saved||null});}
catch{game=new HolicGame();}
let selected=null, gifts=new Set(), busy=false, moving=null, lastUpdated=null, swapHighlight=null, session=0;
let humanBustPromise=null;
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function showIncomingChange(actor,type){
  const modal=$('incoming-change');
  $('incoming-change-title').textContent=`${game.players[actor].name}から${type==='change2'?'Change 2':'Change 4'}！`;
  $('incoming-change-description').textContent=type==='change2'
    ? 'あなたが指名されました。あなたの元の手札4枚からランダムに2枚が選ばれ、相手の2枚と交換されます。'
    : 'あなたが指名されました。あなたと相手の手札4枚すべてを交換します。';
  return new Promise(resolve=>{
    const acknowledge=$('incoming-change-accept');
    acknowledge.addEventListener('click',()=>{
      modal.close();
      resolve();
    },{once:true});
    modal.showModal();
    acknowledge.focus();
  });
}
$('incoming-change').addEventListener('cancel',e=>e.preventDefault());
const safe=s=>String(s).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function save(){try{localStorage.setItem(storageKey,game.serialize());}catch{}}
function notifyHumanBust(){
  if(game.players[0].alive||game.humanBustAcknowledged)return Promise.resolve();
  if(humanBustPromise)return humanBustPromise;
  const modal=$('human-bust');
  const event=game.log.find(e=>e.type==='bust'&&e.player===0);
  $('human-bust-reason').textContent=event?.message??'出せる安全なカードがありません。';
  $('human-bust-continue').textContent=game.phase==='over'?'結果を見る':'CPU同士の対戦を観戦する';
  humanBustPromise=new Promise(resolve=>{
    $('human-bust-continue').addEventListener('click',()=>{
      modal.close();
      game.humanBustAcknowledged=true;
      humanBustPromise=null;
      save();
      render();
      resolve();
    },{once:true});
    modal.showModal();
    $('human-bust-continue').focus();
  });
  return humanBustPromise;
}
$('human-bust').addEventListener('cancel',e=>e.preventDefault());
function cpuMarkup(id){
  const p=game.players[id],active=p.alive&&game.current===id&&game.phase!=='over';
  const targetable=game.current===0&&game.phase==='target'&&p.alive;
  const slots=p.slots.map((s,i)=>{
    const isMove=moving?.player===id&&moving.slot===i;
    const updated=(lastUpdated?.player===id&&lastUpdated.slot===i)||(swapHighlight?.[id]?.includes(i));
    return `<div class="cpu-back ${!p.alive?'empty':''} ${isMove?'moving':''} ${updated?'just-updated':''}" aria-label="スロット${i}${p.alive?'、裏向き':'、脱落'}"><span class="idx">${i}</span></div>`;
  }).join('');
  return `<div class="cpu-head"><strong>${p.name}</strong><span class="small-badge">${p.alive?(active?'● 思考中':'● 生存'):'✕ 脱落'}</span></div><div class="cpu-hand">${slots}</div>`;
}
function humanCard(s,i){
  if(!s)return `<button class="hand-card" disabled>空き</button>`;
  const card=s.card,cat=card.type,label=CARD_LABEL(card),word=card.type!=='number'&&card.type!=='minus';
  const active=game.current===0&&game.phase!=='over'&&!busy;
  const legal=active&&(game.phase==='gift'||game.isLegalSlot(i));
  let cls=`hand-card ${cat}`;
  if(game.phase==='gift'&&gifts.has(i))cls+=' gift-selected';
  if(game.phase==='play'&&selected===i)cls+=' selected';
  if(swapHighlight?.[0]?.includes(i))cls+=' just-swapped';
  return `<button type="button" class="${cls}" data-slot="${i}" ${!legal?'disabled':''} aria-label="スロット${i}、${safe(label)}"><span class="corner">${i}</span><span class="card-title ${word?'word':''}">${safe(label)}</span><span class="card-sub">${card.type==='number'?'NUMBER':card.type==='holic'?'SELF BUST':card.type==='minus'?'ESCAPE':card.type==='reverse'?'DIRECTION':card.type==='change2'||card.type==='change4'?'SWAP':'TWO PLAYS'}</span>${card.type==='holic'?'<span class="warning">出すと即脱落</span>':''}<span class="slot-no">SLOT ${i}</span></button>`;
}
function instruction(){
  if(!game.players[0].alive)return game.phase==='over'?'観戦終了':'あなたは脱落しました。CPU同士の対戦を観戦中';
  if(game.phase==='over')return game.winner===0?'あなたの勝利！':'ゲーム終了';
  if(game.current!==0)return `${game.players[game.current].name}が考えています…`;
  if(game.phase==='target')return '交換するCPUをタップしてください';
  if(game.phase==='gift')return '相手に渡すカードを2枚選択してください';
  if(game.doubleFirst)return 'Double：1枚目は数字札（1〜10）または−10';
  if(game.remainingPlays===1&&game.log[0]?.type==='double-next')return 'Double：2枚目は自由に選べます';
  return '出すカードを選択してください';
}
function render(){
  $('score').textContent=game.value;
  $('score').className='score '+(game.value>=100?'over':game.value>=76?'danger':'');
  $('deck-info').textContent=`山札 ${game.deck.length}枚`;
  $('direction').textContent=game.direction===1?'↻ 時計回り':'↺ 反時計回り';
  const top=game.discard.at(-1),type=top?.type??'';
  $('top-card').className='pile '+type;
  $('top-card').innerHTML=`<span>${top?safe(CARD_LABEL(top)):'START'}</span>`;
  for(const id of [1,2,3]){
    const el=$(`cpu${id}`);el.innerHTML=cpuMarkup(id);
    el.className=`cpu seat cpu-${id===1?'left':id===2?'top':'right'}${game.current===id&&game.phase!=='over'?' active':''}${!game.players[id].alive?' busted':''}${game.current===0&&game.phase==='target'&&game.players[id].alive?' targetable':''}`;
  }
  const human=game.players[0];
  $('human-hand').innerHTML=human.slots.map(humanCard).join('');
  $('human-state').textContent=!human.alive?(game.phase==='over'?'観戦終了':'観戦中'):game.phase==='over'?'対戦終了':game.current===0?'あなたのターン':'CPUのターン';
  $('instruction').textContent=instruction();
  $('status').textContent=game.log[0]?.message??'';
  $('history').innerHTML=game.log.filter(x=>!['draw','turn'].includes(x.type)).slice(0,3).map(e=>`<div>${safe(e.message)}</div>`).join('');
  const btn=$('action'),cancel=$('cancel');
  cancel.hidden=true;
  if(game.phase==='over'){$('selection-label').textContent='対戦終了';btn.textContent='もう一度';btn.disabled=false;return;}
  if(game.current!==0||busy){$('selection-label').textContent='CPUのターン';btn.textContent='カードを出す';btn.disabled=true;return;}
  if(game.phase==='target'){$('selection-label').textContent='CPUを選択';btn.textContent='交換相手を指名';btn.disabled=true;return;}
  if(game.phase==='gift'){$('selection-label').textContent=`選択 ${gifts.size}/2枚`;btn.textContent='2枚を渡す';btn.disabled=gifts.size!==2;cancel.hidden=false;return;}
  $('selection-label').textContent=selected===null?'未選択':`SLOT ${selected}: ${CARD_LABEL(human.slots[selected]?.card)}`;
  btn.textContent='カードを出す';btn.disabled=selected===null;
}
async function afterMove(){
  const mySession=session;
  save();render();
  await notifyHumanBust();
  if(mySession!==session)return;
  if(game.phase!=='over'&&game.current!==0)driveCpu();
}
$('human-hand').addEventListener('click',e=>{
  const btn=e.target.closest('[data-slot]');if(!btn||busy||game.current!==0||game.phase==='over')return;
  const i=Number(btn.dataset.slot);
  if(game.phase==='gift'){
    if(gifts.has(i))gifts.delete(i);else if(gifts.size<2)gifts.add(i);
  }else if(game.phase==='play'&&game.isLegalSlot(i))selected=selected===i?null:i;
  render();
});
for(const id of [1,2,3])$(`cpu${id}`).addEventListener('click',()=>{
  if(busy||game.current!==0||game.phase!=='target'||!game.players[id].alive)return;
  const result=game.chooseTarget(id);if(result.stage==='complete'){swapHighlight={[0]:[0,1,2,3],[id]:[0,1,2,3]};setTimeout(()=>{swapHighlight=null;render();},1100);}selected=null;gifts=new Set();afterMove();
});
$('action').addEventListener('click',()=>{
  if(game.phase==='over'){if(confirm('新しいゲームを開始しますか？'))reset();return;}
  if(busy||game.current!==0)return;
  if(game.phase==='gift'){
    if(gifts.size!==2)return;const actor=game.current,target=game.pendingChange.target;const result=game.chooseGift([...gifts]);swapHighlight={[actor]:[...gifts],[target]:result.targetSlots};setTimeout(()=>{swapHighlight=null;render();},1100);gifts.clear();afterMove();return;
  }
  if(game.phase!=='play'||selected===null)return;
  const card=game.players[0].slots[selected]?.card;
  if(card?.type==='holic'&&!confirm('Holic100を出すと、あなたが即バーストします。続けますか？'))return;
  const playedSlot=selected;selected=null;
  game.play(playedSlot);afterMove();
});
$('cancel').addEventListener('click',()=>{gifts.clear();render();});
function reset(){
  session++;busy=false;
  if($('human-bust').open)$('human-bust').close();
  if($('incoming-change').open)$('incoming-change').close();
  humanBustPromise=null;
  game=new HolicGame();selected=null;gifts=new Set();moving=null;lastUpdated=null;swapHighlight=null;
  afterMove();
}
$('reset').addEventListener('click',()=>{if(confirm('現在の対戦を破棄して新しく始めますか？'))reset();});
$('help').addEventListener('click',()=>$('rules').showModal());
$('close-rules').addEventListener('click',()=>$('rules').close());
$('rules').addEventListener('click',e=>{if(e.target===$('rules'))$('rules').close();});
async function driveCpu(){
  if(busy||game.phase==='over'||game.current===0)return;
  const mySession=session;busy=true;render();
  while(mySession===session&&game.phase!=='over'&&game.current!==0){
    await notifyHumanBust();
    if(mySession!==session)return;
    const id=game.current;
    if(game.phase==='target'){
      await delay(440);if(mySession!==session)return;
      const target=game.cpuTarget();
      if(target===0){
        await showIncomingChange(id,game.pendingChange.type);
        if(mySession!==session)return;
      }
      const result=game.chooseTarget(target);if(result.stage==='complete')swapHighlight={[id]:[0,1,2,3],[target]:[0,1,2,3]};save();render();if(result.stage==='complete'){await delay(1100);if(mySession!==session)return;swapHighlight=null;}continue;
    }
    if(game.phase==='gift'){
      await delay(420);if(mySession!==session)return;const target=game.pendingChange.target;const gifted=game.cpuGift();const result=game.chooseGift(gifted);swapHighlight={[id]:gifted,[target]:result.targetSlots};save();render();await delay(1100);if(mySession!==session)return;swapHighlight=null;continue;
    }
    const slot=game.cpuSlot();
    if(slot===null){
      if(!game.resolveNoSafePlay())throw Error('CPUに安全なカードがあるのに選択できません。');
      save();render();continue;
    }
    await delay(440);if(mySession!==session)return;
    moving={player:id,slot};render();await delay(370);if(mySession!==session)return;
    moving=null;
    const result=game.play(slot);
    if(!result.ok)break;
    lastUpdated={player:id,slot};save();render();
    await notifyHumanBust();
    if(mySession!==session)return;
    await delay(550);if(mySession!==session)return;lastUpdated=null;render();
  }
  if(mySession===session){busy=false;save();render();}
}
afterMove();
if('serviceWorker' in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(()=>{}));
