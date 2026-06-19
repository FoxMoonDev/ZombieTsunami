/**
 * ZOMBIE TSUNAMI — script.js
 * Fiel ao jogo original da Mobigame:
 * - Horda de zumbis (múltiplos personagens)
 * - Humanos → viram zumbis ao ser comidos
 * - Veículos parados (requerem X zumbis para virar)
 * - Veículos em movimento (matam 1 zumbi)
 * - Buracos no chão (zumbis caem e morrem)
 * - Bombas (no chão e no ar)
 * - Caixas misteriosas → 8 power-ups
 * - Moedas e cérebros
 * - Shop com upgrades permanentes
 * - Sistema de horda escalável
 */
'use strict';

/* ══════════════════════════════════════════════════
   CONSTANTES
══════════════════════════════════════════════════ */
const C = {
  GRAVITY:        0.6,
  JUMP_FORCE:    -13,
  JUMP_HOLD:      0.45,   // multiplicador do hold
  PLAYER_X_BASE:  60,     // X do primeiro zumbi
  ZOMBIE_SPACING: 28,     // espaço entre zumbis da horda
  GROUND_H:       0.18,   // % do viewport height
  SPEED_BASE:     4.5,
  SPEED_MAX:      11,
  SPEED_INC:      0.001,
  SCORE_PER_FRAME:0.06,

  // Veículos: [tipo, largura, altura, zombiesNecessários, recompensaHumanos]
  VEHICLES: {
    car:   { w:70,  h:36,  req:4,  humans:1, label:'4🧟' },
    bus:   { w:100, h:46,  req:8,  humans:3, label:'8🧟' },
    tank:  { w:90,  h:42,  req:12, humans:3, label:'12🧟' },
    plane: { w:120, h:48,  req:16, humans:5, label:'16🧟' },
  },

  // Humanos NPC
  HUMAN_TYPES: ['npc-m','npc-f','npc-soldier','npc-fat'],

  // Bonus (power-ups)
  BONUSES: {
    ninja:      { label:'NINJA',      color:'#00ff88', icon:'🥷', duration:8000  },
    dragon:     { label:'DRAGÃO',     color:'#ff6600', icon:'🐉', duration:8000  },
    giantz:     { label:'GIANT Z',    color:'#ff0044', icon:'👾', duration:8000  },
    quarterback:{ label:'QUARTERBACK',color:'#ff8800', icon:'🏈', duration:8000  },
    ufo:        { label:'UFO',        color:'#00ffff', icon:'🛸', duration:10000 },
    gold:       { label:'GOLD',       color:'#f5a623', icon:'✨', duration:8000  },
    balloon:    { label:'BALLOON',    color:'#ff66cc', icon:'🎈', duration:8000  },
    tsunami:    { label:'TSUNAMI',    color:'#0066ff', icon:'🌊', duration:7000  },
  },

  BONUS_KEYS: ['ninja','dragon','giantz','quarterback','ufo','gold','balloon','tsunami'],
};

/* ══════════════════════════════════════════════════
   SAVE / PERSISTÊNCIA
══════════════════════════════════════════════════ */
function loadData() {
  try { return JSON.parse(localStorage.getItem('zt_save') || 'null') || defaultSave(); }
  catch { return defaultSave(); }
}
function defaultSave() {
  return {
    best: 0,
    coins: 0,
    upgrades: {
      startZombies: 0,   // nível 0=1, 1=2, 2=3 zumbis iniciais
      speed: 0,          // redução de velocidade inicial
      bonusDuration: 0,  // +tempo nos bonuses
      hordeMagnet: 0,    // atrai moedas/cérebros
    }
  };
}
function saveData() {
  try { localStorage.setItem('zt_save', JSON.stringify(save)); } catch {}
}

let save = loadData();

/* ══════════════════════════════════════════════════
   ESTADO DO JOGO
══════════════════════════════════════════════════ */
const G = {
  running:    false,
  paused:     false,
  score:      0,
  brains:     0,
  coinsRun:   0,   // moedas desta run
  eaten:      0,   // humanos comidos
  speed:      C.SPEED_BASE,

  // Horda
  zombies:    [],  // array de {el, x, y, vy, onGround, jumpCount, dead}
  hordeSize:  1,

  // Física de pulo (compartilhada: todos pulam juntos)
  jumping:    false,
  holdTime:   0,
  isHolding:  false,

  // Bonus ativo
  bonus:      null,    // string do tipo, ou null
  bonusTimer: null,
  ufoEl:      null,
  ufoCloneTimer: null,
  tsunamiEl:  null,

  // Objetos do mundo
  worldObjs:  [],   // {el, x, w, type, data}
  holes:      [],   // {el, x, w}
  coins:      [],   // {el, x, y}
  brainItems: [],

  frameId:    null,
  spawnTimer: null,
  lastTs:     0,
};

/* ══════════════════════════════════════════════════
   DOM
══════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);
const D = {
  screenStart:   $('screen-start'),
  screenShop:    $('screen-shop'),
  screenPause:   $('screen-pause'),
  screenGameover:$('screen-gameover'),
  hud:           $('hud'),
  hHorde:        $('h-horde'),
  hScore:        $('h-score'),
  hBrains:       $('h-brains'),
  hCoins:        $('h-coins'),
  bonusInd:      $('bonus-indicator'),
  worldLayer:    $('world-layer'),
  holesLayer:    $('holes-layer'),
  hordeLayer:    $('horde-layer'),
  fxLayer:       $('fx-layer'),
  bonusLayer:    $('bonus-layer'),
  cityLayer:     $('city-layer'),
  starsLayer:    $('stars-layer'),
  cloudsLayer:   $('clouds-layer'),
  toast:         $('toast'),
  shopGrid:      $('shop-grid'),
};

/* ══════════════════════════════════════════════════
   UTILIDADES
══════════════════════════════════════════════════ */
const rand    = (a,b)  => Math.random() * (b-a) + a;
const randInt = (a,b)  => Math.floor(rand(a,b+1));
const clamp   = (v,a,b)=> Math.min(Math.max(v,a),b);
const groundPx = ()    => window.innerHeight * C.GROUND_H;

function showScreen(el) {
  [D.screenStart, D.screenShop, D.screenPause, D.screenGameover]
    .forEach(s => s.classList.remove('active'));
  if (el) el.classList.add('active');
}

function showToast(text, color = '#fff', dur = 2000) {
  D.toast.textContent = text;
  D.toast.style.color = color;
  D.toast.style.borderColor = color;
  D.toast.classList.remove('hidden');
  clearTimeout(D.toast._t);
  D.toast._t = setTimeout(() => D.toast.classList.add('hidden'), dur);
}

function updateHUD() {
  let aliveCount = 0;
  for (let i = 0; i < G.zombies.length; i++) if (!G.zombies[i].dead) aliveCount++;
  D.hHorde.textContent  = aliveCount;
  D.hScore.textContent  = Math.floor(G.score);
  D.hBrains.textContent = G.brains;
  D.hCoins.textContent  = save.coins;
}

/* ══════════════════════════════════════════════════
   CENA: ESTRELAS, NUVENS, CIDADE
══════════════════════════════════════════════════ */
function buildScene() {
  // Estrelas
  D.starsLayer.innerHTML = '';
  for (let i = 0; i < 70; i++) {
    const s = document.createElement('div');
    s.className = 'star';
    const sz = rand(1,3);
    s.style.cssText = `left:${rand(0,100)}%;top:${rand(0,62)}%;
      width:${sz}px;height:${sz}px;
      --a:${rand(0.2,0.5).toFixed(2)};--b:${rand(0.7,1).toFixed(2)};
      --dur:${rand(1.5,4).toFixed(1)}s;animation-delay:${rand(0,3).toFixed(1)}s`;
    D.starsLayer.appendChild(s);
  }

  // Nuvens
  D.cloudsLayer.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const c = document.createElement('div');
    c.className = 'cloud';
    const spd = rand(35,80);
    c.style.cssText = `width:${rand(100,280)}px;height:${rand(25,60)}px;
      top:${rand(5,42)}%;opacity:${rand(0.18,0.45).toFixed(2)};
      animation-duration:${spd.toFixed(0)}s;
      animation-delay:-${rand(0,spd).toFixed(0)}s;
      left:-320px`;
    D.cloudsLayer.appendChild(c);
  }

  // Prédios
  buildBuildings();
}

function buildBuildings() {
  D.cityLayer.innerHTML = '';
  const vw = window.innerWidth;
  const colors = ['#0e0e22','#111128','#0c0c1e','#141430','#0a0a18','#181830'];
  let x = -40;
  while (x < vw + 200) {
    const w = randInt(55,120);
    const h = randInt(80,260);
    const bld = document.createElement('div');
    bld.className = 'bld';
    bld.style.cssText = `left:${x}px;width:${w}px`;
    const body = document.createElement('div');
    body.className = 'bld-body';
    body.style.cssText = `height:${h}px;--bc:${colors[randInt(0,colors.length-1)]}`;
    // Antena
    if (Math.random() > 0.5) {
      const ant = document.createElement('div');
      ant.className = 'antenna';
      body.appendChild(ant);
    }
    // Janelas
    const cols = Math.floor(w/18), rows = Math.floor(h/20);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const win = document.createElement('div');
      const t = Math.random() < 0.25 ? 'o' : Math.random() < 0.5 ? 'w' : 'c';
      win.className = `bld-win ${t}`;
      win.style.cssText = `width:8px;height:7px;left:${8+c*16}px;top:${10+r*18}px`;
      body.appendChild(win);
    }
    bld.appendChild(body);
    D.cityLayer.appendChild(bld);
    x += w + randInt(8,25);
  }
}

/* ══════════════════════════════════════════════════
   HORDA — criação e gestão
══════════════════════════════════════════════════ */
function createZombieEl(index) {
  const el = document.createElement('div');
  const colorClass = `zc${index % 4}`;
  let bonusCls = G.bonus ? `bonus-${G.bonus}` : '';
  el.className = `zombie-unit ${colorClass} ${bonusCls}`;
  el.innerHTML = `
    <div style="position:relative">
      <div class="z-arms"><div class="z-arm"></div><div class="z-arm"></div></div>
      <div class="z-head"></div>
      <div class="z-torso"></div>
      <div class="z-legs"><div class="z-leg"></div><div class="z-leg"></div></div>
    </div>
    <div class="z-shadow"></div>
  `;
  D.hordeLayer.appendChild(el);
  return el;
}

function addZombie(count = 1) {
  for (let i = 0; i < count; i++) {
    const idx = G.zombies.length;
    const xPos = C.PLAYER_X_BASE - idx * C.ZOMBIE_SPACING;
    const el = createZombieEl(idx);
    G.zombies.push({ el, x: xPos, y: 0, vy: 0, onGround: true, jumpCount: 0, dead: false });
    positionZombie(G.zombies[G.zombies.length - 1]);
  }
  updateHUD();
}

function removeZombie(reason = 'hit') {
  const alive = G.zombies.filter(z => !z.dead);
  if (alive.length === 0) return;
  const last = alive[alive.length - 1];
  last.dead = true;
  // FX de morte
  if (reason === 'bomb' || reason === 'vehicle') spawnFX(last.x + 10, groundPx() + last.y + 30, 'blood', 6);
  if (reason === 'hole') spawnFX(last.x + 10, groundPx(), 'dust', 5);
  // Fade out
  last.el.style.transition = 'opacity .3s';
  last.el.style.opacity = '0';
  setTimeout(() => { last.el.remove(); G.zombies = G.zombies.filter(z => z !== last); updateHUD(); }, 320);

  const remaining = G.zombies.filter(z => !z.dead).length;
  if (remaining === 0 && !G.bonus) {
    setTimeout(triggerGameOver, 400);
  }
}

function positionZombie(z) {
  const gPx = groundPx();
  const px = 100 - (gPx / window.innerHeight) * 100;
  z.el.style.left = z.x + 'px';
  z.el.style.bottom = px + '%';
  z.el.style.transform = `translateY(-${z.y}px)`;
}

/* ══════════════════════════════════════════════════
   FÍSICA DE PULO
══════════════════════════════════════════════════ */
function initiateJump() {
  if (!G.running || G.paused) return;
  // Ninja tem double jump; outros têm 1 pulo
  const maxJumps = G.bonus === 'ninja' ? 2 : 1;
  const alive = G.zombies.filter(z => !z.dead);
  if (alive.length === 0) return;

  const leader = alive[0];
  if (leader.jumpCount < maxJumps) {
    const force = G.bonus === 'dragon' ? C.JUMP_FORCE * 0.85 : C.JUMP_FORCE;
    alive.forEach(z => {
      z.vy = force;
      z.onGround = false;
      z.jumpCount++;
    });
    G.jumping = true;
    G.isHolding = true;
    G.holdTime = 0;
    spawnFX(alive[0].x + 10, groundPx(), 'dust', 4);
  }
}

function releaseJump() {
  G.isHolding = false;
}

function updateHorde() {
  // Usa índice para evitar criar array novo a cada frame
  let aliveCount = 0;
  for (let i = 0; i < G.zombies.length; i++) {
    if (!G.zombies[i].dead) aliveCount++;
  }
  if (aliveCount === 0) return;

  const t = Date.now();

  for (let i = 0, aliveIdx = 0; i < G.zombies.length; i++) {
    const z = G.zombies[i];
    if (z.dead) continue;

    if (G.bonus === 'balloon') {
      // Balloon: flutua suavemente ACIMA do chão, sempre visível
      // Oscila entre 35px e 65px acima do chão
      const targetY = 48 + Math.sin(t * 0.003 + aliveIdx * 0.8) * 16;
      z.y += (targetY - z.y) * 0.08; // suaviza a transição
      z.vy = 0;
      z.onGround = false;
      z.jumpCount = 1; // impede pulo duplo acidental
    } else {
      // Física normal
      if (!z.onGround) {
        // Hold acrescenta leve impulso para cima
        if (G.isHolding && G.holdTime < 300 && z.vy < 0) {
          z.vy += G.bonus === 'dragon' ? -0.15 : -0.08;
          G.holdTime += 16;
        }
        // Dragon plana ao segurar após pulo
        if (G.bonus === 'dragon' && G.isHolding && z.vy > 0) z.vy *= 0.92;

        z.vy += C.GRAVITY;
        z.y  -= z.vy;

        if (z.y <= 0) {
          z.y  = 0;
          z.vy = 0;
          z.onGround  = true;
          z.jumpCount = 0;
          G.jumping   = false;
        }
      }
    }

    positionZombie(z);
    aliveIdx++;
  }
}

/* ══════════════════════════════════════════════════
   SPAWN DE OBJETOS DO MUNDO
══════════════════════════════════════════════════ */
let spawnCooldown = 0;
const SPAWN_MIN = 900, SPAWN_MAX = 2600;

function scheduleSpawn() {
  clearTimeout(G.spawnTimer);
  if (!G.running) return;
  const delay = rand(SPAWN_MIN, SPAWN_MAX) * Math.max(0.4, 1 - (G.score / 5000));
  G.spawnTimer = setTimeout(spawnWorldObject, delay);
}

function spawnWorldObject() {
  if (!G.running || G.paused) return;
  const r = Math.random();
  const vw = window.innerWidth;
  const gPx = groundPx();

  if (r < 0.20) spawnHole();
  else if (r < 0.35) spawnHuman();
  else if (r < 0.48) spawnVehicleStationary();
  else if (r < 0.56) spawnVehicleMoving();
  else if (r < 0.67) spawnBomb();
  else if (r < 0.77) spawnMysteryBox();
  else if (r < 0.88) spawnCoinRow();
  else spawnBrainItem();

  scheduleSpawn();
}

/* ── BURACO ─────────────────────────────────────── */
function spawnHole() {
  const vw  = window.innerWidth;
  const gPx = groundPx();
  const w   = randInt(55, 140);
  const el  = document.createElement('div');
  el.className = 'hole';
  el.style.cssText = `left:${vw + 10}px;width:${w}px;height:${gPx * 0.95}px`;
  D.holesLayer.appendChild(el);
  G.holes.push({ el, x: vw + 10, w });
}

/* ── HUMANO ─────────────────────────────────────── */
function spawnHuman(count = 1) {
  const vw = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const type = C.HUMAN_TYPES[randInt(0, C.HUMAN_TYPES.length - 1)];
    const el = document.createElement('div');
    el.className = `wobj human ${type}`;
    el.innerHTML = `<div class="h-head"></div><div class="h-body"></div><div class="h-legs"><div class="h-leg"></div><div class="h-leg"></div></div>`;
    el.style.left = (vw + 10 + i * 40) + 'px';
    D.worldLayer.appendChild(el);
    G.worldObjs.push({ el, x: vw + 10 + i * 40, w: 16, type: 'human', data: {} });
  }
}

/* ── VEÍCULO PARADO ─────────────────────────────── */
function spawnVehicleStationary() {
  const vw    = window.innerWidth;
  const keys  = Object.keys(C.VEHICLES);
  // Veículos mais difíceis aparecem mais tarde
  const maxIdx = G.score < 200 ? 1 : G.score < 500 ? 2 : 3;
  const key   = keys[randInt(0, maxIdx)];
  const cfg   = C.VEHICLES[key];

  const wrap  = document.createElement('div');
  wrap.className = 'wobj vehicle v-' + key;
  wrap.style.cssText = `left:${vw + 10}px;bottom:${groundPx()}px;position:absolute`;

  const req   = document.createElement('div');
  req.className = 'v-req';
  req.textContent = cfg.label;

  const body  = document.createElement('div');
  body.className = 'v-body';
  body.style.cssText = `width:${cfg.w}px;height:${cfg.h}px`;

  if (key === 'car' || key === 'bus') {
    ['wl','wm','wr'].slice(0, key === 'car' ? 2 : 3).forEach(cls => {
      const w = document.createElement('div');
      w.className = 'wheel ' + cls;
      body.appendChild(w);
    });
  }
  if (key === 'tank') {
    const cannon = document.createElement('div'); cannon.className = 'cannon';
    const track  = document.createElement('div'); track.className  = 'track';
    [['wl',6],['wm',30],['wr',58]].forEach(([c,l]) => {
      const w = document.createElement('div'); w.className = 'wheel ' + c;
      w.style.left = l + 'px'; body.appendChild(w);
    });
    body.appendChild(cannon); body.appendChild(track);
  }
  if (key === 'plane') {
    ['wing','tail'].forEach(c => { const d = document.createElement('div'); d.className=c; body.appendChild(d); });
  }

  wrap.appendChild(req);
  wrap.appendChild(body);
  D.worldLayer.appendChild(wrap);
  G.worldObjs.push({ el: wrap, x: vw + 10, w: cfg.w, type: 'vehicle_stop', data: { key, cfg, flipped: false } });
}

/* ── VEÍCULO EM MOVIMENTO ───────────────────────── */
function spawnVehicleMoving() {
  const vw = window.innerWidth;
  const isCar = Math.random() < 0.7;
  const el = document.createElement('div');
  el.className = 'wobj vehicle v-' + (isCar ? 'car' : 'bus');
  const cfg = isCar ? C.VEHICLES.car : C.VEHICLES.bus;
  el.style.cssText = `left:${vw + 200}px;bottom:${groundPx()}px;position:absolute`;

  const body = document.createElement('div');
  body.className = 'v-body';
  body.style.cssText = `width:${cfg.w}px;height:${cfg.h}px;background:linear-gradient(to bottom,#991111,#660000)`;
  el.appendChild(body);

  // Sinal de aviso
  const warn = document.createElement('div');
  warn.className = 'warn-sign';
  warn.textContent = '⚠ VEÍCULO EM MOVIMENTO!';
  document.body.appendChild(warn);
  setTimeout(() => warn.remove(), 1200);

  D.worldLayer.appendChild(el);
  G.worldObjs.push({ el, x: vw + 200, w: cfg.w, type: 'vehicle_move', data: { speed: G.speed * 1.8 } });
}

/* ── BOMBA ──────────────────────────────────────── */
function spawnBomb(air = false) {
  const count = randInt(1, air ? 1 : 4);
  const vw    = window.innerWidth;
  for (let i = 0; i < count; i++) {
    const el  = document.createElement('div');
    el.className = 'wobj bomb' + (air ? ' air' : '');
    el.style.left = (vw + 10 + i * 40) + 'px';
    if (!air) el.style.bottom = groundPx() + 'px';
    D.worldLayer.appendChild(el);
    G.worldObjs.push({ el, x: vw + 10 + i * 40, w: 28, type: air ? 'bomb_air' : 'bomb', data: {} });
  }
}

/* ── CAIXA MISTERIOSA ───────────────────────────── */
function spawnMysteryBox() {
  const vw = window.innerWidth;
  const el = document.createElement('div');
  el.className = 'wobj mystery-box';
  el.textContent = '?';
  el.style.cssText = `left:${vw + 10}px;bottom:${groundPx()}px;position:absolute`;
  D.worldLayer.appendChild(el);
  G.worldObjs.push({ el, x: vw + 10, w: 36, type: 'mystery', data: {} });
}

/* ── MOEDAS ─────────────────────────────────────── */
function spawnCoinRow() {
  const vw    = window.innerWidth;
  const count = randInt(3, 8);
  const baseH = groundPx() + rand(10, 80);
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'wobj coin';
    el.style.cssText = `left:${vw + i * 28}px;bottom:${baseH}px;position:absolute`;
    D.worldLayer.appendChild(el);
    G.worldObjs.push({ el, x: vw + i * 28, w: 18, type: 'coin', data: {} });
  }
}

/* ── CÉREBRO ─────────────────────────────────────── */
function spawnBrainItem() {
  const vw = window.innerWidth;
  const el = document.createElement('div');
  el.className = 'wobj brain-item';
  el.textContent = '🧠';
  el.style.cssText = `left:${vw + 10}px;bottom:${groundPx() + rand(20, 90)}px;position:absolute`;
  D.worldLayer.appendChild(el);
  G.worldObjs.push({ el, x: vw + 10, w: 22, type: 'brain', data: {} });
}

/* ══════════════════════════════════════════════════
   ATUALIZAR OBJETOS DO MUNDO
══════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════
   ATUALIZAR OBJETOS DO MUNDO — for loops, sem forEach
══════════════════════════════════════════════════ */
function updateWorldObjects() {
  let removeCount = 0;
  for (let i = 0; i < G.worldObjs.length; i++) {
    const obj = G.worldObjs[i];
    const spd = obj.type === 'vehicle_move' ? obj.data.speed + G.speed : G.speed;
    obj.x -= spd;
    obj.el.style.left = obj.x + 'px';
    if (obj.x + obj.w < -20) { obj.el.remove(); obj._remove = true; removeCount++; }
  }
  if (removeCount > 0) G.worldObjs = G.worldObjs.filter(o => !o._remove);

  // Buracos
  let removeHoles = 0;
  for (let i = 0; i < G.holes.length; i++) {
    const h = G.holes[i];
    h.x -= G.speed;
    h.el.style.left = h.x + 'px';
    if (h.x + h.w < -20) { h.el.remove(); h._remove = true; removeHoles++; }
  }
  if (removeHoles > 0) G.holes = G.holes.filter(h => !h._remove);
}

/* ══════════════════════════════════════════════════
   COLISÃO — otimizada: for loops diretos, sem filter()
══════════════════════════════════════════════════ */
function checkCollisions() {
  // Encontra leader sem criar array novo
  let leader = null;
  for (let i = 0; i < G.zombies.length; i++) {
    if (!G.zombies[i].dead) { leader = G.zombies[i]; break; }
  }
  if (!leader) return;

  const gPx = groundPx(); // chama uma vez só

  // ── BURACOS ──────────────────────────────────────
  if (G.bonus !== 'balloon') {
    for (let hi = 0; hi < G.holes.length; hi++) {
      const h = G.holes[hi];
      for (let zi = 0; zi < G.zombies.length; zi++) {
        const z = G.zombies[zi];
        if (z.dead) continue;
        const inHole  = (z.x + 20) > (h.x + 5) && z.x < (h.x + h.w - 5);
        const atGround= z.y <= 2;
        if (inHole && atGround && !z._inHole) {
          z._inHole = true;
          setTimeout(() => {
            if (!z.dead) { removeZombie('hole'); z._inHole = false; }
          }, 200);
        }
        if (!inHole) z._inHole = false;
      }
    }
  }

  // ── OBJETOS DO MUNDO ─────────────────────────────
  const toRemove = [];
  for (let oi = 0; oi < G.worldObjs.length; oi++) {
    const obj = G.worldObjs[oi];
    if (obj._hit) continue;

    const overlapX = (leader.x + 18) > obj.x && leader.x < (obj.x + obj.w);
    if (!overlapX) continue;

    // Cache o bottom para não chamar parseFloat todo frame
    if (obj._cachedBottom === undefined) {
      obj._cachedBottom = parseFloat(obj.el.style.bottom) || gPx;
    }
    const objBottom = obj._cachedBottom;
    const objTop    = objBottom + (obj.type === 'coin' ? 18 : obj.type === 'brain' ? 22 : 50);
    const zBottom   = gPx + leader.y;
    const zTop      = zBottom + 52;
    const overlapY  = zTop > objBottom && zBottom < objTop;
    if (!overlapY) continue;

    obj._hit = true;

    switch (obj.type) {
      case 'human':
        eatHuman(obj);
        toRemove.push(obj);
        break;
      case 'vehicle_stop':
        hitVehicleStop(obj, toRemove);
        break;
      case 'vehicle_move':
        if (G.bonus === 'balloon' || G.bonus === 'ninja' || G.bonus === 'quarterback' || G.bonus === 'tsunami') {
          spawnFX(obj.x, gPx, 'coin-fx', 3);
          toRemove.push(obj);
        } else {
          spawnFX(obj.x, gPx + 20, 'blood', 4);
          removeZombie('vehicle');
          toRemove.push(obj);
        }
        break;
      case 'bomb':
        if (G.bonus === 'balloon' || G.bonus === 'ninja' || G.bonus === 'quarterback' || G.bonus === 'tsunami' || G.bonus === 'gold') {
          if (G.bonus === 'gold') save.coins += 2;
          spawnFX(obj.x, gPx + 10, 'star-fx', 4);
        } else {
          showExplode(obj.x, gPx);
          removeZombie('bomb');
        }
        toRemove.push(obj);
        break;
      case 'bomb_air':
        if (leader.y > 20) {
          if (G.bonus === 'ninja' || G.bonus === 'quarterback' || G.bonus === 'tsunami') {
            spawnFX(obj.x, gPx + 60, 'star-fx', 3);
          } else {
            showExplode(obj.x, gPx + 80);
            removeZombie('bomb');
          }
          toRemove.push(obj);
        }
        break;
      case 'mystery':
        collectMysteryBox(obj);
        toRemove.push(obj);
        break;
      case 'coin':
        save.coins++;
        G.coinsRun++;
        spawnFX(obj.x, objBottom, 'coin-fx', 2);
        toRemove.push(obj);
        if (G.coinsRun % 5 === 0) saveData();
        D.hCoins.textContent = save.coins;
        break;
      case 'brain':
        G.brains++;
        spawnFX(obj.x, objBottom, 'brain-fx', 1);
        toRemove.push(obj);
        D.hBrains.textContent = G.brains;
        break;
    }
  }

  // Remove sem splice dentro de loop (mais rápido)
  if (toRemove.length > 0) {
    for (let i = 0; i < toRemove.length; i++) {
      toRemove[i].el.remove();
    }
    G.worldObjs = G.worldObjs.filter(o => !o._hit || !o.el.parentNode === false);
    // Limpa _hit só dos que não foram removidos (vehicle_stop pode ter _hit=false)
    G.worldObjs = G.worldObjs.filter(o => !toRemove.includes(o));
  }
}

/* ── Comer humano ─────────────────────────────────── */
function eatHuman(obj) {
  spawnFX(obj.x, groundPx() + 10, 'blood', 3);
  G.eaten++;
  G.brains++;
  addZombie(1);
  showToast('+1 🧟 ZUMBI!', '#00ff88', 900);
  updateHUD();
}

/* ── Veículo parado ──────────────────────────────── */
function hitVehicleStop(obj, toRemove) {
  const alive = G.zombies.filter(z => !z.dead).length;
  const req   = obj.data.cfg.req;
  const gPx   = groundPx();

  // Bonus especial ignora requisito
  const ignores = G.bonus === 'giantz' || G.bonus === 'quarterback' || G.bonus === 'tsunami' || G.bonus === 'gold';

  if (alive >= req || ignores) {
    // Virar veículo → recompensa
    obj.el.style.transform = 'rotate(-15deg)';
    obj.el.style.transition = 'transform .3s';
    spawnFX(obj.x, gPx, 'coin-fx', 5);
    addZombie(obj.data.cfg.humans);
    save.coins += obj.data.cfg.humans;
    G.brains   += obj.data.cfg.humans;
    if (G.bonus === 'gold') { save.coins += req; }
    showToast(`+${obj.data.cfg.humans} 🧟 DESTRUÍDO!`, '#f5a623', 900);
    saveData();
    updateHUD();
    setTimeout(() => { obj.el.remove(); }, 350);
    toRemove.push(obj);
  } else {
    // Horda insuficiente → morre na parede
    removeZombie('vehicle');
    obj._hit = false; // permite nova colisão
    obj.x += 5; // empurra ligeiramente
  }
}

/* ── Mystery Box ─────────────────────────────────── */
function collectMysteryBox(obj) {
  // Cancela bonus ativo se houver
  if (G.bonusTimer) clearTimeout(G.bonusTimer);
  if (G.ufoCloneTimer) clearInterval(G.ufoCloneTimer);
  if (G.ufoEl) { G.ufoEl.remove(); G.ufoEl = null; }
  if (G.tsunamiEl) { G.tsunamiEl.remove(); G.tsunamiEl = null; }

  // Remove classe de bonus anterior de todos os zumbis
  G.zombies.forEach(z => {
    z.el.className = z.el.className.replace(/bonus-\w+/g, '').trim();
  });

  const bonusKey = C.BONUS_KEYS[randInt(0, C.BONUS_KEYS.length - 1)];
  activateBonus(bonusKey);
}

/* ══════════════════════════════════════════════════
   BONUS / POWER-UPS
══════════════════════════════════════════════════ */
function activateBonus(key) {
  G.bonus = key;
  const bCfg = C.BONUSES[key];
  const dur  = bCfg.duration + (save.upgrades.bonusDuration || 0) * 2000;

  // Visual HUD
  D.bonusInd.textContent = `${bCfg.icon} ${bCfg.label}`;
  D.bonusInd.style.color = bCfg.color;
  D.bonusInd.classList.remove('hidden');

  // Aplica classe visual nos zumbis
  G.zombies.filter(z => !z.dead).forEach(z => {
    z.el.classList.add(`bonus-${key}`);
  });

  showToast(`${bCfg.icon} ${bCfg.label}!`, bCfg.color, 1500);

  // Comportamentos especiais
  if (key === 'ufo') spawnUFO();
  if (key === 'tsunami') spawnTsunami();
  if (key === 'giantz') spawnGiantZ();

  G.bonusTimer = setTimeout(() => deactivateBonus(), dur);
}

function deactivateBonus() {
  G.bonus = null;
  D.bonusInd.classList.add('hidden');
  G.zombies.forEach(z => { z.el.className = z.el.className.replace(/bonus-\w+/g, '').trim(); });
  if (G.ufoCloneTimer) { clearInterval(G.ufoCloneTimer); G.ufoCloneTimer = null; }
  if (G.ufoEl)     { G.ufoEl.remove();     G.ufoEl     = null; }
  if (G.tsunamiEl) { G.tsunamiEl.remove(); G.tsunamiEl = null; }
  D.bonusLayer.innerHTML = '';
}

function spawnUFO() {
  const el = document.createElement('div');
  el.className = 'ufo-obj';
  el.textContent = '🛸';
  const beam = document.createElement('div');
  beam.className = 'ufo-beam';
  el.appendChild(beam);
  D.bonusLayer.appendChild(el);
  G.ufoEl = el;
  // Clona zumbi a cada 3s
  G.ufoCloneTimer = setInterval(() => {
    if (!G.running || G.paused || G.bonus !== 'ufo') return;
    beam.style.height = '120px';
    setTimeout(() => { beam.style.height = '0'; }, 600);
    addZombie(1);
    showToast('🛸 CLONE!', '#00ffff', 700);
  }, 3000);
}

function spawnTsunami() {
  const el = document.createElement('div');
  el.className = 'tsunami-wave';
  el.style.height = '30%';
  el.innerHTML = '<div class="tsunami-zombies">🧟🧟🧟🌊🌊🌊</div>';
  D.bonusLayer.appendChild(el);
  G.tsunamiEl = el;
  // Tsunami destrói tudo na frente
  G.worldObjs.forEach(o => {
    if (!['coin','brain','mystery'].includes(o.type)) {
      o._hit = true;
      o.el.remove();
    }
  });
  G.worldObjs = G.worldObjs.filter(o => !o._hit);
  G.holes.forEach(h => h.el.remove());
  G.holes = [];
}

function spawnGiantZ() {
  // Zumbi gigante: substitui todos os zumbis por um elemento grande
  const el = document.createElement('div');
  el.className = 'zombie-unit bonus-giantz';
  el.style.cssText = `left:${C.PLAYER_X_BASE - 20}px;bottom:${(C.GROUND_H * 100)}%`;
  el.innerHTML = '<div class="z-head" style="width:50px;height:50px;font-size:2rem;display:flex;align-items:center;justify-content:center">👾</div><div class="z-shadow"></div>';
  D.bonusLayer.appendChild(el);
  // Laser periódico
  G._giantLaser = setInterval(() => {
    if (!G.running || G.paused || G.bonus !== 'giantz') return;
    spawnFX(C.PLAYER_X_BASE + 60, groundPx() + 30, 'star-fx', 8);
    // Destrói primeiro obstáculo à frente
    const front = G.worldObjs.find(o => o.x > C.PLAYER_X_BASE + 30 && !['coin','brain'].includes(o.type));
    if (front) { front._hit = true; front.el.remove(); G.worldObjs.splice(G.worldObjs.indexOf(front), 1); }
    const hole = G.holes[0];
    if (hole) { hole.el.remove(); G.holes.shift(); }
  }, 1200);
  setTimeout(() => { clearInterval(G._giantLaser); D.bonusLayer.innerHTML = ''; }, C.BONUSES.giantz.duration);
}

/* ══════════════════════════════════════════════════
   PARALAX / CIDADE — cache de prédios para não
   chamar querySelectorAll() 60x por segundo
══════════════════════════════════════════════════ */
let _buildingCache = [];

function buildBuildings() {
  D.cityLayer.innerHTML = '';
  _buildingCache = [];
  const vw = window.innerWidth;
  const colors = ['#0e0e22','#111128','#0c0c1e','#141430','#0a0a18','#181830'];
  let x = -40;
  while (x < vw + 200) {
    const w = randInt(55,120);
    const h = randInt(80,260);
    const bld = document.createElement('div');
    bld.className = 'bld';
    bld.style.cssText = `left:${x}px;width:${w}px`;
    const body = document.createElement('div');
    body.className = 'bld-body';
    body.style.cssText = `height:${h}px;--bc:${colors[randInt(0,colors.length-1)]}`;
    if (Math.random() > 0.5) {
      const ant = document.createElement('div');
      ant.className = 'antenna';
      body.appendChild(ant);
    }
    const cols = Math.floor(w/18), rows = Math.floor(h/20);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const win = document.createElement('div');
      const t = Math.random() < 0.25 ? 'o' : Math.random() < 0.5 ? 'w' : 'c';
      win.className = `bld-win ${t}`;
      win.style.cssText = `width:8px;height:7px;left:${8+c*16}px;top:${10+r*18}px`;
      body.appendChild(win);
    }
    bld.appendChild(body);
    D.cityLayer.appendChild(bld);
    _buildingCache.push({ el: bld, w });
    x += w + randInt(8,25);
  }
}

function updateParallax() {
  const vw  = window.innerWidth;
  const spd = G.speed * 0.28;
  for (let i = 0; i < _buildingCache.length; i++) {
    const b = _buildingCache[i];
    const cur = parseFloat(b.el.style.left) || 0;
    const newX = cur - spd;
    b.el.style.left = newX + 'px';
    if (newX + b.w < -60) {
      b.el.style.left = (vw + randInt(10, 60)) + 'px';
    }
  }
}

/* ══════════════════════════════════════════════════
   FX / PARTÍCULAS
══════════════════════════════════════════════════ */
function spawnFX(x, y, type, count) {
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'fx ' + type;
    const tx = rand(-35, 15), ty = rand(-40, -5);
    p.style.cssText = `left:${x + rand(-8, 8)}px;bottom:${y}px;
      --tx:${tx}px;--ty:${ty}px;
      animation-duration:${rand(.3,.7).toFixed(2)}s;
      animation-delay:${(i * .04).toFixed(2)}s`;
    if (type === 'brain-fx') p.textContent = '🧠';
    D.fxLayer.appendChild(p);
    setTimeout(() => p.remove(), 800);
  }
}

function showExplode(x, y) {
  const p = document.createElement('div');
  p.className = 'explode';
  p.textContent = '💥';
  p.style.cssText = `left:${x}px;bottom:${y}px;position:absolute`;
  D.fxLayer.appendChild(p);
  setTimeout(() => p.remove(), 600);
}

/* ══════════════════════════════════════════════════
   SCORE — atualiza HUD só quando o valor muda
══════════════════════════════════════════════════ */
let _lastDisplayedScore = -1;

function updateScore() {
  G.score += C.SCORE_PER_FRAME * G.speed * 0.4;
  const displayed = Math.floor(G.score);
  if (displayed !== _lastDisplayedScore) {
    _lastDisplayedScore = displayed;
    D.hScore.textContent = displayed;
  }
}

/* ══════════════════════════════════════════════════
   LOOP PRINCIPAL
══════════════════════════════════════════════════ */
function gameLoop(ts) {
  if (!G.running || G.paused) return;
  const delta = Math.min(ts - G.lastTs, 50);
  G.lastTs = ts;

  G.speed = clamp(G.speed + C.SPEED_INC, C.SPEED_BASE, C.SPEED_MAX);

  updateHorde();
  updateWorldObjects();
  updateParallax();
  checkCollisions();
  updateScore();

  G.frameId = requestAnimationFrame(gameLoop);
}

/* ══════════════════════════════════════════════════
   CONTROLE
══════════════════════════════════════════════════ */
function startGame() {
  // Reset
  G.running   = false;
  G.paused    = false;
  G.score     = 0;
  G.brains    = 0;
  G.coinsRun  = 0;
  G.eaten     = 0;
  G.speed     = C.SPEED_BASE - (save.upgrades.speed || 0) * 0.3;
  G.bonus     = null;
  G.jumping   = false;
  G.isHolding = false;
  _lastDisplayedScore = -1;

  // Limpa DOM
  D.hordeLayer.innerHTML = '';
  D.worldLayer.innerHTML = '';
  D.holesLayer.innerHTML = '';
  D.fxLayer.innerHTML    = '';
  D.bonusLayer.innerHTML = '';
  D.bonusInd.classList.add('hidden');
  G.zombies    = [];
  G.worldObjs  = [];
  G.holes      = [];
  _buildingCache.length > 0 && buildBuildings(); // reconstrói cidade limpa
  clearTimeout(G.spawnTimer);
  clearTimeout(G.bonusTimer);
  clearInterval(G.ufoCloneTimer);
  clearInterval(G._giantLaser);

  // Cria horda inicial
  const startCount = 1 + (save.upgrades.startZombies || 0);
  addZombie(startCount);

  showScreen(null);
  G.running = true;
  G.lastTs  = performance.now();
  G.frameId = requestAnimationFrame(gameLoop);
  scheduleSpawn();
  updateHUD();
}

function pauseGame() {
  if (!G.running) return;
  G.paused = !G.paused;
  if (G.paused) {
    cancelAnimationFrame(G.frameId);
    clearTimeout(G.spawnTimer);
    showScreen(D.screenPause);
  } else {
    showScreen(null);
    G.lastTs = performance.now();
    G.frameId = requestAnimationFrame(gameLoop);
    scheduleSpawn();
  }
}

function triggerGameOver() {
  G.running = false;
  cancelAnimationFrame(G.frameId);
  clearTimeout(G.spawnTimer);
  clearTimeout(G.bonusTimer);
  clearInterval(G.ufoCloneTimer);
  clearInterval(G._giantLaser);

  const finalScore = Math.floor(G.score);
  const isNew      = finalScore > save.best;
  if (isNew) { save.best = finalScore; saveData(); }

  $('go-score').textContent  = finalScore;
  $('go-eaten').textContent  = G.eaten;
  $('go-brains').textContent = '🧠 ' + G.brains;
  $('go-coins').textContent  = '💰 ' + G.coinsRun;
  $('go-best').textContent   = save.best;
  $('go-new').classList.toggle('hidden', !isNew);

  setTimeout(() => showScreen(D.screenGameover), 500);
}

function goToMenu() {
  G.running = false;
  G.paused  = false;
  cancelAnimationFrame(G.frameId);
  clearTimeout(G.spawnTimer);
  clearTimeout(G.bonusTimer);
  clearInterval(G.ufoCloneTimer);
  clearInterval(G._giantLaser);
  D.hordeLayer.innerHTML = '';
  D.worldLayer.innerHTML = '';
  D.holesLayer.innerHTML = '';
  D.fxLayer.innerHTML    = '';
  D.bonusLayer.innerHTML = '';
  G.zombies = []; G.worldObjs = []; G.holes = [];
  $('start-best').textContent  = save.best;
  $('start-coins').textContent = save.coins;
  showScreen(D.screenStart);
}

/* ══════════════════════════════════════════════════
   SHOP
══════════════════════════════════════════════════ */
const SHOP_ITEMS = [
  {
    id:'startZombies', icon:'🧟', name:'Horda Inicial',
    desc:'Começa com mais zumbis na horda.',
    costs:[500,1200,2500], maxLevel:3,
    effect: lv => `Começa com ${lv+1} zumbi(s)`,
  },
  {
    id:'speed', icon:'🐢', name:'Velocidade',
    desc:'Reduz a velocidade inicial do jogo.',
    costs:[400,900], maxLevel:2,
    effect: lv => `Velocidade inicial -${lv*0.3}`,
  },
  {
    id:'bonusDuration', icon:'⏱', name:'Bonus+',
    desc:'Aumenta duração dos power-ups em +2s cada.',
    costs:[600,1400,3000], maxLevel:3,
    effect: lv => `+${lv*2}s nos power-ups`,
  },
];

function buildShop() {
  D.shopGrid.innerHTML = '';
  $('shop-coins').textContent = save.coins;

  SHOP_ITEMS.forEach(item => {
    const lvl   = save.upgrades[item.id] || 0;
    const maxed = lvl >= item.maxLevel;
    const cost  = maxed ? 0 : item.costs[lvl];
    const canAfford = save.coins >= cost;

    const el = document.createElement('div');
    el.className = `shop-item ${maxed ? 'owned' : !canAfford ? 'cant-afford' : ''}`;
    el.innerHTML = `
      <div class="si-icon">${item.icon}</div>
      <div class="si-name">${item.name}</div>
      <div class="si-desc">${item.desc}</div>
      <div class="si-level">${maxed ? '✅ MÁXIMO' : `Nível ${lvl}/${item.maxLevel}`}</div>
      <div class="si-price">${maxed ? '—' : `💰 ${cost} moedas`}</div>
    `;
    if (!maxed && canAfford) {
      el.addEventListener('click', () => {
        save.coins -= cost;
        save.upgrades[item.id] = lvl + 1;
        saveData();
        showToast(`${item.icon} ${item.name} aprimorado!`, '#f5a623', 1500);
        buildShop();
        updateHUD();
      });
    }
    D.shopGrid.appendChild(el);
  });
}

/* ══════════════════════════════════════════════════
   EVENTOS
══════════════════════════════════════════════════ */
let _holdInterval = null;

document.addEventListener('keydown', e => {
  if (e.repeat) return;
  switch (e.code) {
    case 'Space': case 'ArrowUp': case 'KeyW':
      e.preventDefault();
      initiateJump();
      break;
    case 'KeyP': case 'Escape':
      if (G.running) pauseGame();
      break;
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') releaseJump();
});

// Touch
let _touchStart = 0;
document.addEventListener('touchstart', e => {
  e.preventDefault();
  _touchStart = Date.now();
  initiateJump();
}, { passive: false });
document.addEventListener('touchend', e => {
  e.preventDefault();
  releaseJump();
}, { passive: false });

// Mouse hold
document.addEventListener('mousedown', e => {
  if (e.target.tagName === 'BUTTON') return;
  initiateJump();
});
document.addEventListener('mouseup', releaseJump);

// Botões
$('btn-start').addEventListener('click',        startGame);
$('btn-resume').addEventListener('click',       pauseGame);
$('btn-restart-pause').addEventListener('click',startGame);
$('btn-restart').addEventListener('click',      startGame);
$('btn-menu').addEventListener('click',         goToMenu);
$('btn-pause-hud').addEventListener('click',    pauseGame);

// Shop
function openShop() { buildShop(); showScreen(D.screenShop); }
$('btn-shop-pause').addEventListener('click', () => { G.paused = true; openShop(); });
$('btn-shop-go').addEventListener('click',    openShop);
$('btn-shop-close').addEventListener('click', () => {
  if (G.running && G.paused) {
    showScreen(D.screenPause);
  } else {
    showScreen(G.running ? null : D.screenStart);
  }
});

window.addEventListener('resize', () => {
  buildBuildings();
});

/* ══════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════ */
(function init() {
  buildScene();
  $('start-best').textContent  = save.best;
  $('start-coins').textContent = save.coins;
  $('h-coins').textContent     = save.coins;
  showScreen(D.screenStart);
})();
