/**
 * ZOMBIE TSUNAMI — script.js v5 (reescrita limpa)
 *
 * ARQUITETURA:
 * - Câmera: worldX avança. Objetos em "world space".
 *   #holes e #world movem via CSS transform (GPU).
 * - Física: valores fixos por frame (60fps base).
 *   Movimento lateral usa dt para suavidade.
 * - Colisão: AABB simples. Veículos só colidem se y<=2 (no chão).
 * - Horda: array de zumbis. Todos pulam juntos.
 *   Morte remove o último. Game over quando array vazia.
 */
'use strict';

/* ════════════════════════════════════════════════
   CONSTANTES — nunca mudam durante o jogo
════════════════════════════════════════════════ */
const CFG = {
  /* física */
  GRAVITY:    0.52,
  JUMP_V:    -12,
  HOLD_BOOST: 0.06,   // impulso extra enquanto segura
  HOLD_MAX:   220,    // ms máximo de hold

  /* mundo */
  PLAYER_X:   82,     // posição X do líder na tela
  ZOMBIE_GAP: 26,     // espaço entre zumbis da fila
  GROUND_PCT: 18,     // % de altura do chão

  /* velocidade */
  SPD_START:  4.0,
  SPD_MAX:    10.0,
  SPD_INC:    0.0007,

  /* spawn */
  SPAWN_FIRST: 1600,  // ms antes do primeiro objeto
  SPAWN_MIN:   800,
  SPAWN_MAX:   2200,

  /* veículos parados: largura, req zombis, recompensa */
  VEH: {
    car:  { w:68,  req:4,  rew:1, label:'4🧟'  },
    bus:  { w:96,  req:8,  rew:3, label:'8🧟'  },
    tank: { w:88,  req:12, rew:3, label:'12🧟' },
    plane:{ w:118, req:16, rew:5, label:'16🧟' },
  },

  HUMAN_T: ['npc-m','npc-f','npc-s','npc-fat'],

  BONUS: {
    ninja:      { lbl:'NINJA',       color:'#00ff88', icon:'🥷', ms:8000  },
    dragon:     { lbl:'DRAGÃO',      color:'#ff6600', icon:'🐉', ms:8000  },
    giantz:     { lbl:'GIANT Z',     color:'#ff0044', icon:'👾', ms:8000  },
    qb:         { lbl:'QUARTERBACK', color:'#ff8800', icon:'🏈', ms:8000  },
    ufo:        { lbl:'UFO',         color:'#00ffff', icon:'🛸', ms:10000 },
    gold:       { lbl:'GOLD',        color:'#f5a623', icon:'✨', ms:8000  },
    balloon:    { lbl:'BALLOON',     color:'#ff66cc', icon:'🎈', ms:8000  },
    tsunami:    { lbl:'TSUNAMI',     color:'#0066ff', icon:'🌊', ms:7000  },
  },
};
const BONUS_KEYS = Object.keys(CFG.BONUS);

/* ════════════════════════════════════════════════
   SAVE
════════════════════════════════════════════════ */
const SAVE_KEY = 'zt5';
function mkSave(){ return { best:0, coins:0, upg:{ startZ:0, spd:0, bonMs:0 } }; }
let S = (() => { try{ return JSON.parse(localStorage.getItem(SAVE_KEY)||'null')||mkSave(); }catch{ return mkSave(); } })();
let _saveQ = false;
function writeSave(){
  if(_saveQ) return; _saveQ=true;
  setTimeout(()=>{ try{localStorage.setItem(SAVE_KEY,JSON.stringify(S));}catch{} _saveQ=false; },300);
}

/* ════════════════════════════════════════════════
   ESTADO DO JOGO
════════════════════════════════════════════════ */
const G = {
  on: false, paused: false,

  /* mundo */
  worldX: 0,       // câmera: quantos px o mundo avançou
  speed: CFG.SPD_START,
  score: 0,

  /* horda */
  horde: [],       // [{el, y, vy, onGround, jCount, dead}]
  holding: false,
  holdMs: 0,

  /* coleta */
  coins: 0, brains: 0, eaten: 0,

  /* objetos do mundo */
  objs: [],        // [{el, wx, w, type, extra}]
  holes: [],       // [{el, wx, w}]

  /* bonus */
  bonus: null,
  bonusTid: null, ufoTid: null, giantTid: null,
  ufoEl: null,

  /* loop */
  fid: null, spawnTid: null, lastTs: 0,
};

/* ════════════════════════════════════════════════
   DOM
════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const EL = {
  sStart: $('screen-start'), sPause: $('screen-pause'),
  sGO:    $('screen-gameover'), sShop: $('screen-shop'),
  hHorde: $('h-horde'), hScore: $('h-score'),
  hBrains:$('h-brains'), hCoins: $('h-coins'),
  bonusBar: $('bonus-bar'),
  worldEl:  $('world'), holesEl: $('holes'),
  hordeEl:  $('horde'), fxEl:    $('fx'),
  bonVfx:   $('bonus-vfx'),
  city: $('city'), stars: $('stars'), clouds: $('clouds'),
  toast: $('toast'), shopGrid: $('shop-grid'),
};

/* ════════════════════════════════════════════════
   UTILITÁRIOS
════════════════════════════════════════════════ */
const rnd  = (a,b)   => Math.random()*(b-a)+a;
const rInt = (a,b)   => Math.floor(rnd(a,b+1));
const clamp= (v,a,b) => v<a?a:v>b?b:v;
const groundH = ()   => window.innerHeight * CFG.GROUND_PCT / 100;

// HUD — só escreve no DOM quando muda
let _hH=-1,_hS=-1,_hB=-1,_hC=-1;
function hudHorde(){
  let n=0; for(let i=0;i<G.horde.length;i++) if(!G.horde[i].dead) n++;
  if(n!==_hH){ EL.hHorde.textContent=n; _hH=n; }
}
function hudScore(){
  const s=Math.floor(G.score);
  if(s!==_hS){ EL.hScore.textContent=s; _hS=s; }
}
function hudBrains(){
  if(G.brains!==_hB){ EL.hBrains.textContent=G.brains; _hB=G.brains; }
}
function hudCoins(){
  if(S.coins!==_hC){ EL.hCoins.textContent=S.coins; _hC=S.coins; }
}
function hudAll(){ _hH=_hS=_hB=_hC=-1; hudHorde(); hudScore(); hudBrains(); hudCoins(); }

function showScreen(el){
  [EL.sStart,EL.sPause,EL.sGO,EL.sShop].forEach(s=>s.classList.remove('active'));
  if(el) el.classList.add('active');
}

function toast(txt,color='#fff',ms=1100){
  EL.toast.textContent=txt; EL.toast.style.color=color;
  EL.toast.style.borderColor=color; EL.toast.classList.remove('hidden');
  clearTimeout(EL.toast._t);
  EL.toast._t=setTimeout(()=>EL.toast.classList.add('hidden'),ms);
}

/* ════════════════════════════════════════════════
   CÂMERA
════════════════════════════════════════════════ */
let _camTx = '';
function applyCamera(){
  const tx=`translateX(${(-G.worldX+CFG.PLAYER_X).toFixed(1)}px)`;
  if(tx===_camTx) return;
  _camTx=tx;
  EL.worldEl.style.transform=tx;
  EL.holesEl.style.transform=tx;
}

/* ════════════════════════════════════════════════
   CENA (estrelas, nuvens, prédios)
════════════════════════════════════════════════ */
let _blds=[];

function buildScene(){
  // Estrelas
  EL.stars.innerHTML='';
  for(let i=0;i<50;i++){
    const s=document.createElement('div'); s.className='star';
    const sz=rnd(1,2.5);
    s.style.cssText=`left:${rnd(0,100)}%;top:${rnd(0,60)}%;
      width:${sz}px;height:${sz}px;
      --a:${rnd(.2,.5).toFixed(2)};--b:${rnd(.7,1).toFixed(2)};
      --dur:${rnd(2,5).toFixed(1)}s;animation-delay:${rnd(0,3).toFixed(1)}s`;
    EL.stars.appendChild(s);
  }
  // Nuvens (animação CSS pura)
  EL.clouds.innerHTML='';
  for(let i=0;i<4;i++){
    const c=document.createElement('div'); c.className='cloud';
    const sp=rnd(50,100);
    c.style.cssText=`width:${rnd(120,280)}px;height:${rnd(26,60)}px;
      top:${rnd(5,42)}%;opacity:${rnd(.15,.4).toFixed(2)};
      animation-duration:${sp.toFixed(0)}s;animation-delay:-${rnd(0,sp).toFixed(0)}s`;
    EL.clouds.appendChild(c);
  }
  buildBuildings();
}

function buildBuildings(){
  EL.city.innerHTML=''; _blds=[];
  const vw=window.innerWidth;
  const pal=['#0e0e22','#111128','#0c0c1e','#141430','#0a0a18','#181830'];
  let x=-50;
  while(x<vw+220){
    const w=rInt(55,110), h=rInt(80,240);
    const el=document.createElement('div'); el.className='bld';
    el.style.cssText=`left:${x}px;width:${w}px`;
    const body=document.createElement('div'); body.className='bld-body';
    body.style.cssText=`width:${w}px;height:${h}px;--bc:${pal[rInt(0,pal.length-1)]}`;
    if(Math.random()>.5){ const a=document.createElement('div'); a.className='ant'; body.appendChild(a); }
    const cols=Math.min(Math.floor(w/20),5), rows=Math.min(Math.floor(h/22),10);
    for(let r=0;r<rows;r++) for(let c=0;c<cols;c++){
      const win=document.createElement('div');
      win.className='bw '+(Math.random()<.25?'o':Math.random()<.5?'w':'c');
      win.style.cssText=`left:${8+c*18}px;top:${10+r*20}px`;
      body.appendChild(win);
    }
    el.appendChild(body); EL.city.appendChild(el);
    _blds.push({ el, curX:x, w });
    x+=w+rInt(8,22);
  }
}

function updateParallax(dt){
  const vw=window.innerWidth, spd=G.speed*0.28*dt;
  for(let i=0;i<_blds.length;i++){
    const b=_blds[i]; b.curX-=spd;
    b.el.style.left=b.curX+'px';
    if(b.curX+b.w<-60){ b.curX=vw+rInt(10,50); b.el.style.left=b.curX+'px'; }
  }
}

/* ════════════════════════════════════════════════
   HORDA — criação e física
════════════════════════════════════════════════ */
function makeZEl(idx){
  const el=document.createElement('div');
  el.className=`zu zc${idx%4}`;
  el.innerHTML=`<div style="position:relative">
    <div class="zarms"><div class="zarm"></div><div class="zarm"></div></div>
    <div class="zhead"></div><div class="ztorso"></div>
    <div class="zlegs"><div class="zleg"></div><div class="zleg"></div></div>
  </div><div class="zshadow"></div>`;
  const sx=CFG.PLAYER_X-idx*CFG.ZOMBIE_GAP;
  el.style.left=sx+'px';
  el.style.bottom=CFG.GROUND_PCT+'%';
  if(G.bonus) el.classList.add('bns-'+G.bonus);
  EL.hordeEl.appendChild(el);
  return { el, sx, y:0, vy:0, onGround:true, jCount:0, dead:false };
}

function addZombies(n=1){
  for(let i=0;i<n;i++) G.horde.push(makeZEl(G.horde.length));
  hudHorde();
}

function killZombie(reason){
  // Mata o último zumbi vivo
  for(let i=G.horde.length-1;i>=0;i--){
    const z=G.horde[i]; if(z.dead) continue;
    z.dead=true;
    if(reason==='bomb'||reason==='car') fx(z.sx,32,'blood',4);
    if(reason==='hole') fx(z.sx,2,'dust',3);
    z.el.style.transition='opacity .25s'; z.el.style.opacity='0';
    setTimeout(()=>{ z.el.remove(); G.horde=G.horde.filter(h=>h!==z); checkDead(); hudHorde(); },270);
    break;
  }
}

function checkDead(){
  let alive=0; for(let i=0;i<G.horde.length;i++) if(!G.horde[i].dead) alive++;
  if(alive===0 && !G.bonus) setTimeout(gameOver,300);
}

function posHorde(){
  for(let i=0;i<G.horde.length;i++){
    const z=G.horde[i]; if(z.dead) continue;
    z.el.style.transform=`translateY(${-z.y}px)`;
  }
}

/* ════════════════════════════════════════════════
   FÍSICA DE PULO
════════════════════════════════════════════════ */
function jump(){
  if(!G.on||G.paused||G.bonus==='balloon') return;
  const maxJ=G.bonus==='ninja'?2:1;
  let leader=null;
  for(let i=0;i<G.horde.length;i++) if(!G.horde[i].dead){ leader=G.horde[i]; break; }
  if(!leader||leader.jCount>=maxJ) return;

  const v=G.bonus==='dragon'?CFG.JUMP_V*0.82:CFG.JUMP_V;
  for(let i=0;i<G.horde.length;i++){
    const z=G.horde[i]; if(z.dead) continue;
    z.vy=v; z.onGround=false; z.jCount++;
  }
  G.holding=true; G.holdMs=0;
  fx(CFG.PLAYER_X+8,2,'dust',3);
}

function releaseJump(){ G.holding=false; }

function stepPhysics(){
  // Balloon: flutua suavemente — sem pulo, sem buracos
  if(G.bonus==='balloon'){
    const target=52+Math.sin(performance.now()*0.003)*14;
    for(let i=0;i<G.horde.length;i++){
      const z=G.horde[i]; if(z.dead) continue;
      z.y+=(target-z.y)*0.08; z.vy=0; z.onGround=false; z.jCount=1;
    }
    posHorde(); return;
  }

  for(let i=0;i<G.horde.length;i++){
    const z=G.horde[i]; if(z.dead||z.onGround) continue;
    // hold prolonga pulo
    if(G.holding && G.holdMs<CFG.HOLD_MAX && z.vy<0){
      z.vy-=CFG.HOLD_BOOST; G.holdMs+=16;
    }
    // dragon plana
    if(G.bonus==='dragon' && G.holding && z.vy>0) z.vy*=0.92;
    z.vy+=CFG.GRAVITY;
    z.y -=z.vy;
    if(z.y<=0){ z.y=0; z.vy=0; z.onGround=true; z.jCount=0; }
  }
  posHorde();
}

/* ════════════════════════════════════════════════
   SPAWN DE OBJETOS
   nextWX() → coordenada world-space logo além da tela
════════════════════════════════════════════════ */
function nextWX(){ return G.worldX+window.innerWidth+80; }

function scheduleSpawn(delay){
  clearTimeout(G.spawnTid);
  if(!G.on) return;
  const d=delay ?? Math.max(CFG.SPAWN_MIN, rnd(CFG.SPAWN_MIN,CFG.SPAWN_MAX)-G.score*0.1);
  G.spawnTid=setTimeout(doSpawn,d);
}

function doSpawn(){
  if(!G.on||G.paused) return;
  const r=Math.random();
  // Probabilidades balanceadas: humanos frequentes, buracos raros no início
  if     (r<.15) spawnHole();
  else if(r<.35) spawnHumans();
  else if(r<.50) spawnVStop();
  else if(r<.58) spawnVMove();
  else if(r<.68) spawnBombs();
  else if(r<.78) spawnBox();
  else if(r<.90) spawnCoins();
  else           spawnBrain();
  scheduleSpawn();
}

/* ── Buraco ── */
function spawnHole(){
  const wx=nextWX(), w=rInt(60,120);
  const el=document.createElement('div'); el.className='hole';
  el.style.cssText=`left:${wx}px;width:${w}px`;
  EL.holesEl.appendChild(el);
  G.holes.push({el,wx,w});
}

/* ── Humanos ── */
function spawnHumans(n=rInt(1,3)){
  for(let i=0;i<n;i++){
    const wx=nextWX()+i*38;
    const t=CFG.HUMAN_T[rInt(0,CFG.HUMAN_T.length-1)];
    const el=document.createElement('div'); el.className=`wobj human ${t}`;
    el.innerHTML=`<div class="hhead"></div><div class="hbody"></div>
      <div class="hlegs"><div class="hleg"></div><div class="hleg"></div></div>`;
    el.style.left=wx+'px';
    EL.worldEl.appendChild(el);
    G.objs.push({el,wx,w:16,type:'human',extra:{}});
  }
}

/* ── Veículo parado ── */
function spawnVStop(){
  const keys=Object.keys(CFG.VEH);
  const maxI=G.score<150?1:G.score<400?2:3;
  const key=keys[rInt(0,maxI)];
  const v=CFG.VEH[key];
  const wx=nextWX();

  const wrap=document.createElement('div');
  wrap.className=`wobj vehicle v${key[0]}`;
  wrap.style.left=wx+'px';

  const req=document.createElement('div'); req.className='vreq'; req.textContent=v.label;
  const body=document.createElement('div'); body.className='vbody';

  if(key==='car'){
    ['wl','wr'].forEach(c=>{const w=document.createElement('div');w.className='wh '+c;body.appendChild(w);});
  }else if(key==='bus'){
    ['wl','wm','wr'].forEach(c=>{const w=document.createElement('div');w.className='wh '+c;body.appendChild(w);});
  }else if(key==='tank'){
    const tr=document.createElement('div');tr.className='track';
    const cn=document.createElement('div');cn.className='cannon';
    [6,30,62].forEach(l=>{const w=document.createElement('div');w.className='wh';w.style.left=l+'px';body.appendChild(w);});
    body.appendChild(tr);body.appendChild(cn);
  }else if(key==='plane'){
    ['wing','tail'].forEach(c=>{const d=document.createElement('div');d.className=c;body.appendChild(d);});
  }

  wrap.appendChild(req); wrap.appendChild(body);
  EL.worldEl.appendChild(wrap);
  G.objs.push({el:wrap,wx,w:v.w,type:'vstop',extra:{key,v}});
}

/* ── Veículo em movimento ── */
function spawnVMove(){
  const isCar=Math.random()<.65;
  const key=isCar?'car':'bus'; const v=CFG.VEH[key];
  const wx=nextWX()+180;
  const wrap=document.createElement('div');
  wrap.className=`wobj vehicle v${key[0]} moving`;
  wrap.style.left=wx+'px';
  const body=document.createElement('div'); body.className='vbody';
  if(isCar){['wl','wr'].forEach(c=>{const w=document.createElement('div');w.className='wh '+c;body.appendChild(w);});}
  else{['wl','wm','wr'].forEach(c=>{const w=document.createElement('div');w.className='wh '+c;body.appendChild(w);});}
  wrap.appendChild(body);
  EL.worldEl.appendChild(wrap);
  G.objs.push({el:wrap,wx,w:v.w,type:'vmove',extra:{spd:G.speed*1.5}});

  // Aviso
  const warn=document.createElement('div'); warn.className='warn'; warn.textContent='⚠ ATENÇÃO!';
  document.body.appendChild(warn); setTimeout(()=>warn.remove(),1000);
}

/* ── Bombas ── */
function spawnBombs(){
  const isAir=Math.random()<.28, n=isAir?1:rInt(1,4);
  for(let i=0;i<n;i++){
    const wx=nextWX()+i*38;
    const el=document.createElement('div'); el.className='wobj bomb'+(isAir?' air':'');
    el.style.left=wx+'px';
    EL.worldEl.appendChild(el);
    G.objs.push({el,wx,w:26,type:isAir?'bomb_air':'bomb',extra:{}});
  }
}

/* ── Caixa misteriosa ── */
function spawnBox(){
  const wx=nextWX();
  const el=document.createElement('div'); el.className='wobj box'; el.textContent='?';
  el.style.left=wx+'px';
  EL.worldEl.appendChild(el);
  G.objs.push({el,wx,w:36,type:'box',extra:{}});
}

/* ── Moedas ── */
function spawnCoins(){
  const n=rInt(3,8), bh=rInt(10,80);
  for(let i=0;i<n;i++){
    const wx=nextWX()+i*26;
    const el=document.createElement('div'); el.className='wobj coin';
    el.style.cssText=`left:${wx}px;bottom:${bh}px`;
    EL.worldEl.appendChild(el);
    G.objs.push({el,wx,w:18,type:'coin',extra:{bh}});
  }
}

/* ── Cérebro ── */
function spawnBrain(){
  const wx=nextWX(), bh=rInt(20,80);
  const el=document.createElement('div'); el.className='wobj brain'; el.textContent='🧠';
  el.style.cssText=`left:${wx}px;bottom:${bh}px`;
  EL.worldEl.appendChild(el);
  G.objs.push({el,wx,w:22,type:'brain',extra:{bh}});
}

/* ════════════════════════════════════════════════
   ATUALIZAR MUNDO (mover objetos com câmera)
════════════════════════════════════════════════ */
function stepWorld(dt){
  G.worldX+=G.speed*dt;
  applyCamera();

  // Veículos em movimento: têm velocidade extra além da câmera
  for(let i=0;i<G.objs.length;i++){
    const o=G.objs[i];
    if(o.type==='vmove'){ o.wx-=o.extra.spd*dt; o.el.style.left=o.wx+'px'; }
  }

  // Remove objetos que saíram pela esquerda
  const cutX=G.worldX-200;
  let rm=false;
  for(let i=0;i<G.objs.length;i++){
    if(G.objs[i].wx<cutX){ G.objs[i].el.remove(); G.objs[i]._rm=true; rm=true; }
  }
  if(rm) G.objs=G.objs.filter(o=>!o._rm);

  let rmH=false;
  for(let i=0;i<G.holes.length;i++){
    if(G.holes[i].wx<cutX){ G.holes[i].el.remove(); G.holes[i]._rm=true; rmH=true; }
  }
  if(rmH) G.holes=G.holes.filter(h=>!h._rm);
}

/* ════════════════════════════════════════════════
   COLISÃO
   
   Regras fiéis ao original:
   - Humanos: come → +1 zumbi
   - Veículo PARADO: horda suficiente → vira (recompensa)
                     horda insuficiente → mata 1 zumbi
   - Veículo MOVIMENTO: sempre mata 1 (a menos que bonus)
   - Bomba: mata 1 (a menos que bonus)
   - Buraco: zumbi no chão → cai e morre (a menos que balloon)
   - Caixa: ativa bonus aleatório
   - Moeda/cérebro: coleta

   HITBOX X: líder está sempre em px=CFG.PLAYER_X.
   Para veículos: o objeto está em world-space,
   convertido para screen-space: oSX = wx - worldX + PLAYER_X
   Portanto colide quando PLAYER_X está dentro de [oSX, oSX+w].
   Simplificado: colide se worldX está dentro de [wx-PLAYER_X, wx+w-PLAYER_X]
   Ou seja: wx <= worldX+PLAYER_X && wx+w >= worldX
   
   HITBOX Y veículos: só colide se líder.y <= 10 (no chão).
   Isso permite pular por cima de qualquer veículo.
════════════════════════════════════════════════ */
function stepCollisions(){
  // Líder = primeiro zumbi vivo
  let leader=null;
  for(let i=0;i<G.horde.length;i++) if(!G.horde[i].dead){ leader=G.horde[i]; break; }
  if(!leader) return;

  const leaderY=leader.y;  // 0=chão, >0=ar
  const wx=G.worldX;       // posição da câmera

  // ── BURACOS ──
  if(G.bonus!=='balloon'){
    for(let hi=0;hi<G.holes.length;hi++){
      const h=G.holes[hi];
      // Posição do buraco em screen: hSX = h.wx - wx + PLAYER_X
      // O zumbi (i) está em screen sx = CFG.PLAYER_X - i*GAP
      for(let zi=0;zi<G.horde.length;zi++){
        const z=G.horde[zi]; if(z.dead) continue;
        const zSX=CFG.PLAYER_X-zi*CFG.ZOMBIE_GAP;
        const hSX=h.wx-wx+CFG.PLAYER_X;
        const inH=(zSX+16)>hSX+4 && zSX<hSX+h.w-4;
        if(inH && z.y<=1 && !z._hole){
          z._hole=true;
          setTimeout(()=>{ if(!z.dead){ killZombie('hole'); z._hole=false; } },120);
        }
        if(!inH) z._hole=false;
      }
    }
  }

  // ── OBJETOS ──
  const kill=[];
  for(let oi=0;oi<G.objs.length;oi++){
    const o=G.objs[oi]; if(o._hit) continue;

    // Colisão X: objeto entra na faixa do líder?
    // líder está em PLAYER_X, objeto em world-space
    // colide se: o.wx <= worldX && o.wx+o.w >= worldX (i.e. PLAYER_X está no objeto)
    // Margem de 12px para hitbox justa
    const oLeft  = o.wx-wx;           // posição relativa ao PLAYER_X
    const oRight = oLeft+o.w;
    if(oLeft > 14 || oRight < -14) continue;  // fora do range X

    // Veículos: só colidem se no chão
    const isVeh=o.type==='vstop'||o.type==='vmove';
    if(isVeh && leaderY>10) continue;  // pulando → passa por cima

    // Bomba no ar: só colide se no ar
    if(o.type==='bomb_air' && leaderY<=20) continue;

    // Moeda/cérebro: checa altura
    if(o.type==='coin'||o.type==='brain'){
      const bh=o.extra.bh||0;
      if(leaderY+56<bh || leaderY>bh+20) continue;
    }

    o._hit=true;

    switch(o.type){
      case 'human':
        fx(CFG.PLAYER_X+6,10,'blood',3);
        G.eaten++; G.brains++;
        addZombies(1);
        toast('+1 🧟','#00ff88',700);
        hudBrains();
        kill.push(o);
        break;

      case 'vstop': {
        let alive=0; for(let i=0;i<G.horde.length;i++) if(!G.horde[i].dead) alive++;
        const bypass=['giantz','qb','tsunami','gold'].includes(G.bonus);
        if(alive>=o.extra.v.req||bypass){
          o.el.style.transform='rotate(-13deg)';
          fx(CFG.PLAYER_X+28,20,'coin-fx',4);
          const rw=o.extra.v.rew;
          addZombies(rw); S.coins+=rw; G.brains+=rw;
          if(G.bonus==='gold') S.coins+=o.extra.v.req;
          toast(`+${rw}🧟 DESTRUÍDO!`,'#f5a623',900);
          writeSave(); hudCoins(); hudBrains();
          setTimeout(()=>o.el.remove(),340); kill.push(o);
        } else {
          killZombie('car'); o._hit=false; o.wx+=4;
        }
        break;
      }

      case 'vmove':
        if(['balloon','ninja','qb','tsunami'].includes(G.bonus)){
          fx(CFG.PLAYER_X+28,20,'coin-fx',3); kill.push(o);
        } else {
          fx(CFG.PLAYER_X+10,22,'blood',4); killZombie('car'); kill.push(o);
        }
        break;

      case 'bomb':
        if(['balloon','ninja','qb','tsunami','gold'].includes(G.bonus)){
          if(G.bonus==='gold'){ S.coins+=2; hudCoins(); }
          fx(CFG.PLAYER_X+10,16,'star-fx',4);
        } else {
          boom(CFG.PLAYER_X+10,16); killZombie('bomb');
        }
        kill.push(o);
        break;

      case 'bomb_air':
        if(['ninja','qb','tsunami'].includes(G.bonus)){
          fx(CFG.PLAYER_X+10,leaderY+14,'star-fx',3);
        } else {
          boom(CFG.PLAYER_X+10,leaderY+14); killZombie('bomb');
        }
        kill.push(o);
        break;

      case 'box':
        activateBonus(BONUS_KEYS[rInt(0,BONUS_KEYS.length-1)]);
        kill.push(o);
        break;

      case 'coin':
        S.coins++; G.coins++;
        fx(o.wx-wx+CFG.PLAYER_X,o.extra.bh||0,'coin-fx',2);
        if(G.coins%5===0) writeSave();
        hudCoins(); kill.push(o);
        break;

      case 'brain':
        G.brains++;
        fx(o.wx-wx+CFG.PLAYER_X,o.extra.bh||0,'star-fx',1);
        hudBrains(); kill.push(o);
        break;
    }
  }

  for(let i=0;i<kill.length;i++){
    const o=kill[i];
    if(!o._removed){ o._removed=true; if(o.el.parentNode) o.el.remove(); }
    const idx=G.objs.indexOf(o); if(idx!==-1) G.objs.splice(idx,1);
  }
}

/* ════════════════════════════════════════════════
   BONUS / POWER-UPS
════════════════════════════════════════════════ */
function activateBonus(key){
  clearBonus();
  G.bonus=key;
  const b=CFG.BONUS[key];
  const dur=b.ms+(S.upg.bonMs||0)*2000;

  EL.bonusBar.textContent=`${b.icon} ${b.lbl}`;
  EL.bonusBar.style.color=b.color;
  EL.bonusBar.classList.remove('hidden');
  for(let i=0;i<G.horde.length;i++) if(!G.horde[i].dead) G.horde[i].el.classList.add('bns-'+key);
  toast(`${b.icon} ${b.lbl}!`,b.color,1400);

  if(key==='ufo')     doUFO();
  if(key==='tsunami') doTsunami();
  if(key==='giantz')  doGiantZ();

  G.bonusTid=setTimeout(clearBonus,dur);
}

function clearBonus(){
  if(!G.bonus) return;
  const prev=G.bonus; G.bonus=null;
  EL.bonusBar.classList.add('hidden');
  for(let i=0;i<G.horde.length;i++) G.horde[i].el.classList.remove('bns-'+prev);
  clearInterval(G.ufoTid); G.ufoTid=null;
  clearInterval(G.giantTid); G.giantTid=null;
  if(G.ufoEl){ G.ufoEl.remove(); G.ufoEl=null; }
  EL.bonVfx.innerHTML='';
  checkDead(); // se UFO estava mantendo vivo
}

function doUFO(){
  const wrap=document.createElement('div'); wrap.className='ufo-wrap';
  wrap.innerHTML='🛸<div class="ufo-beam" id="ufo-beam"></div>';
  EL.bonVfx.appendChild(wrap); G.ufoEl=wrap;
  G.ufoTid=setInterval(()=>{
    if(!G.on||G.paused||G.bonus!=='ufo') return;
    const beam=document.getElementById('ufo-beam');
    if(beam){ beam.style.height='110px'; setTimeout(()=>beam.style.height='0',500); }
    addZombies(1); toast('🛸 CLONE!','#00ffff',600);
  },3000);
}

function doTsunami(){
  const el=document.createElement('div'); el.className='tsunami';
  el.style.height='34%'; el.textContent='🧟🌊🧟🌊🧟';
  EL.bonVfx.appendChild(el);
  // Limpa obstáculos
  for(let i=0;i<G.objs.length;i++){
    const o=G.objs[i];
    if(!['coin','brain','box'].includes(o.type)){ o.el.remove(); o._rm=true; }
  }
  G.objs=G.objs.filter(o=>!o._rm);
  for(let i=0;i<G.holes.length;i++) G.holes[i].el.remove();
  G.holes=[];
}

function doGiantZ(){
  const el=document.createElement('div');
  el.style.cssText=`position:absolute;left:${CFG.PLAYER_X-14}px;bottom:${CFG.GROUND_PCT}%;font-size:3rem;z-index:12`;
  el.textContent='👾';
  EL.bonVfx.appendChild(el);
  G.giantTid=setInterval(()=>{
    if(!G.on||G.paused||G.bonus!=='giantz') return;
    fx(CFG.PLAYER_X+60,42,'star-fx',6);
    let best=null,bestD=Infinity;
    const wx=G.worldX;
    for(let i=0;i<G.objs.length;i++){
      const o=G.objs[i];
      if(['coin','brain'].includes(o.type)) continue;
      const d=o.wx-wx; if(d>20&&d<bestD){ bestD=d; best=o; }
    }
    if(best){ best.el.remove(); G.objs.splice(G.objs.indexOf(best),1); }
    if(G.holes.length){ G.holes[0].el.remove(); G.holes.shift(); }
  },1200);
  setTimeout(()=>{ EL.bonVfx.innerHTML=''; clearInterval(G.giantTid); },CFG.BONUS.giantz.ms);
}

/* ════════════════════════════════════════════════
   EFEITOS VISUAIS
════════════════════════════════════════════════ */
function fx(sx,sy,type,n){
  for(let i=0;i<n;i++){
    const p=document.createElement('div'); p.className='fx '+type;
    p.style.cssText=`left:${sx+rnd(-5,5)}px;bottom:${sy}px;
      --tx:${rnd(-28,8)}px;--ty:${rnd(-32,-4)}px;
      animation-duration:${rnd(.22,.5).toFixed(2)}s;
      animation-delay:${(i*.03).toFixed(2)}s`;
    EL.fxEl.appendChild(p); setTimeout(()=>p.remove(),550);
  }
}
function boom(sx,sy){
  const p=document.createElement('div'); p.className='boom';
  p.textContent='💥'; p.style.cssText=`left:${sx}px;bottom:${sy}px;position:absolute`;
  EL.fxEl.appendChild(p); setTimeout(()=>p.remove(),500);
}

/* ════════════════════════════════════════════════
   LOOP PRINCIPAL
════════════════════════════════════════════════ */
const FPS60=1000/60;
function loop(ts){
  if(!G.on||G.paused) return;
  const raw=ts-G.lastTs; G.lastTs=ts;
  // dt: normalizado para 60fps. Máximo 1.0 para não criar saltos.
  const dt=clamp(raw/FPS60,0.2,1.0);

  G.speed=clamp(G.speed+CFG.SPD_INC*dt, CFG.SPD_START, CFG.SPD_MAX);
  G.score+=G.speed*0.025*dt;

  stepPhysics();        // física vertical: valores fixos (sem dt)
  stepWorld(dt);        // movimento horizontal: com dt
  updateParallax(dt);   // paralax: com dt
  stepCollisions();     // AABB

  hudScore();
  G.fid=requestAnimationFrame(loop);
}

/* ════════════════════════════════════════════════
   CONTROLE DO JOGO
════════════════════════════════════════════════ */
function startGame(){
  cancelAnimationFrame(G.fid);
  clearTimeout(G.spawnTid); clearTimeout(G.bonusTid);
  clearInterval(G.ufoTid); clearInterval(G.giantTid);

  G.on=false; G.paused=false;
  G.worldX=0; G.score=0; G.coins=0; G.brains=0; G.eaten=0;
  G.speed=Math.max(CFG.SPD_START-(S.upg.spd||0)*.3, CFG.SPD_START*.65);
  G.bonus=null; G.holding=false; G.holdMs=0;
  _camTx='';
  if(G.ufoEl){ G.ufoEl.remove(); G.ufoEl=null; }

  EL.worldEl.innerHTML=''; EL.holesEl.innerHTML='';
  EL.hordeEl.innerHTML=''; EL.fxEl.innerHTML=''; EL.bonVfx.innerHTML='';
  EL.worldEl.style.transform=''; EL.holesEl.style.transform='';
  EL.bonusBar.classList.add('hidden');
  G.horde=[]; G.objs=[]; G.holes=[];
  _hH=_hS=_hB=_hC=-1;

  applyCamera();
  addZombies(1+(S.upg.startZ||0));

  showScreen(null);
  G.on=true; G.lastTs=performance.now();
  G.fid=requestAnimationFrame(loop);
  scheduleSpawn(CFG.SPAWN_FIRST);
  hudAll();
}

function pauseGame(){
  if(!G.on) return;
  G.paused=!G.paused;
  if(G.paused){
    cancelAnimationFrame(G.fid); clearTimeout(G.spawnTid);
    showScreen(EL.sPause);
  } else {
    showScreen(null);
    G.lastTs=performance.now();
    G.fid=requestAnimationFrame(loop);
    scheduleSpawn();
  }
}

function gameOver(){
  G.on=false;
  cancelAnimationFrame(G.fid);
  clearTimeout(G.spawnTid); clearTimeout(G.bonusTid);
  clearInterval(G.ufoTid); clearInterval(G.giantTid);

  const sc=Math.floor(G.score);
  const isNew=sc>S.best;
  if(isNew){ S.best=sc; writeSave(); }

  $('go-score').textContent=sc;
  $('go-eaten').textContent=G.eaten;
  $('go-coins').textContent=G.coins;
  $('go-best').textContent=S.best;
  $('go-new').classList.toggle('hidden',!isNew);
  setTimeout(()=>showScreen(EL.sGO),400);
}

function goMenu(){
  G.on=false; G.paused=false;
  cancelAnimationFrame(G.fid);
  clearTimeout(G.spawnTid); clearTimeout(G.bonusTid);
  clearInterval(G.ufoTid); clearInterval(G.giantTid);
  EL.worldEl.innerHTML=''; EL.holesEl.innerHTML='';
  EL.hordeEl.innerHTML=''; EL.fxEl.innerHTML=''; EL.bonVfx.innerHTML='';
  G.horde=[]; G.objs=[]; G.holes=[];
  $('start-best').textContent=S.best;
  $('start-coins').textContent=S.coins;
  showScreen(EL.sStart);
}

/* ════════════════════════════════════════════════
   LOJA
════════════════════════════════════════════════ */
const SHOP=[
  {id:'startZ', icon:'🧟', name:'Horda Inicial',  desc:'Começa com mais zumbis.',      costs:[500,1200,2500], max:3},
  {id:'spd',    icon:'🐢', name:'Velocidade',       desc:'Reduz velocidade inicial.',     costs:[400,900],       max:2},
  {id:'bonMs',  icon:'⏱', name:'Bonus+',            desc:'+2s de duração nos power-ups.', costs:[600,1400,3000], max:3},
];

function buildShop(){
  EL.shopGrid.innerHTML='';
  $('shop-coins').textContent=S.coins;
  SHOP.forEach(item=>{
    const lv=S.upg[item.id]||0, maxed=lv>=item.max;
    const cost=maxed?0:item.costs[lv], can=S.coins>=cost;
    const el=document.createElement('div');
    el.className='si'+(maxed?' owned':!can?' locked':'');
    el.innerHTML=`<div class="si-icon">${item.icon}</div>
      <div class="si-name">${item.name}</div>
      <div class="si-desc">${item.desc}</div>
      <div class="si-lv">${maxed?'✅ MÁXIMO':`Nível ${lv}/${item.max}`}</div>
      <div class="si-price">${maxed?'—':`💰 ${cost}`}</div>`;
    if(!maxed&&can) el.addEventListener('click',()=>{
      S.coins-=cost; S.upg[item.id]=lv+1; writeSave();
      toast(`${item.icon} Aprimorado!`,'#f5a623',1100); buildShop(); hudCoins();
    });
    EL.shopGrid.appendChild(el);
  });
}

/* ════════════════════════════════════════════════
   EVENTOS
════════════════════════════════════════════════ */
document.addEventListener('keydown',e=>{
  if(e.repeat) return;
  if(e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW'){ e.preventDefault(); jump(); }
  if((e.code==='KeyP'||e.code==='Escape')&&G.on) pauseGame();
});
document.addEventListener('keyup',e=>{
  if(e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW') releaseJump();
});
document.addEventListener('touchstart',e=>{ e.preventDefault(); jump(); },{passive:false});
document.addEventListener('touchend',  e=>{ e.preventDefault(); releaseJump(); },{passive:false});
document.addEventListener('mousedown', e=>{ if(e.target.tagName!=='BUTTON'&&!e.target.closest('.card')) jump(); });
document.addEventListener('mouseup',   releaseJump);

$('btn-start').addEventListener('click',         startGame);
$('btn-resume').addEventListener('click',        pauseGame);
$('btn-restart-pause').addEventListener('click', startGame);
$('btn-restart').addEventListener('click',       startGame);
$('btn-menu').addEventListener('click',          goMenu);
$('btn-pause-hud').addEventListener('click',     pauseGame);

function openShop(){ buildShop(); showScreen(EL.sShop); }
$('btn-shop-pause').addEventListener('click', ()=>{ G.paused=true; openShop(); });
$('btn-shop-go').addEventListener('click',    openShop);
$('btn-shop-close').addEventListener('click', ()=>{
  if(G.on&&G.paused) showScreen(EL.sPause);
  else showScreen(G.on?null:EL.sStart);
});

let _rTid=null;
window.addEventListener('resize',()=>{ clearTimeout(_rTid); _rTid=setTimeout(buildBuildings,200); });

/* ════════════════════════════════════════════════
   INIT
════════════════════════════════════════════════ */
(function init(){
  buildScene();
  $('start-best').textContent=S.best;
  $('start-coins').textContent=S.coins;
  EL.hCoins.textContent=S.coins;
  showScreen(EL.sStart);
})();
