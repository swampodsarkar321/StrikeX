// ------------------------------------------------------------------
//  ZONE ROYALE - boot, menu, camera, input, loop
// ------------------------------------------------------------------
import * as THREE from 'three';
import { CHARACTERS, WEAPONS, MAP_SCALE } from './config.js';
import { createWorld, terrainHeight, loadMap } from './world.js';
import { loadAllCharacters, createCharacterModel, createGun, Fighter, loadGunModel } from './fighter.js?v=4';
import { Effects } from './effects.js';
import { HUD } from './hud.js';
import { Match } from './match.js';
import { AudioSys } from './audio.js?v=2';
import { initAuth, getProfile } from './auth.js?v=1';
import { getSavedProfile, loginWithUsername, loadPlayerData, savePlayerData, lookupPlayerByUsername, loadLeaderboard, loadPlayerMail, claimMail, loadEvents } from './firebase.js?v=1';

const $ = (s) => document.querySelector(s);
const clamp = THREE.MathUtils.clamp;
const rand = (a, b) => a + Math.random() * (b - a);

// ------------------------------------------------------------- renderer
const canvas = $('#game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 1600);
camera.rotation.order = 'YXZ';
camera.position.set(0, 40 * MAP_SCALE, 120 * MAP_SCALE);

let world = null;
const effects = new Effects(scene);
const hud = new HUD();
const audio = new AudioSys();

const touchMode = window.matchMedia('(pointer: coarse)').matches;
if (touchMode) document.body.classList.add('touch');

// ---------------------------------------------------------------- state
let mode = 'menu';
let match = null;
let selected = CHARACTERS[0].id;
let loaded = false;
let yaw = 0;
let pitch = 0;
let aiming = false;
let pointerLocked = false;
let paused = false;

// auto-return-to-lobby timer after a match ends
let endReturnTimer = null;

// --------------------------------------------------------- ranked mode
const RANK_KEY = 'strikey-rank-v1';
const TIERS = [
  [0, 'BRONZE V'], [100, 'BRONZE IV'], [200, 'BRONZE III'], [300, 'BRONZE II'], [375, 'BRONZE I'],
  [450, 'SILVER III'], [575, 'SILVER II'], [700, 'SILVER I'],
  [850, 'GOLD III'], [1000, 'GOLD II'], [1150, 'GOLD I'],
  [1300, 'PLATINUM IV'], [1450, 'PLATINUM III'], [1600, 'PLATINUM II'], [1800, 'PLATINUM I'],
  [2000, 'DIAMOND IV'], [2200, 'DIAMOND III'], [2400, 'DIAMOND II'], [2600, 'DIAMOND I'],
  [2800, 'HEROIC'],
];
function rankFor(rp) {
  let name = TIERS[0][1];
  for (const [t, n] of TIERS) { if (rp >= t) name = n; }
  return name;
}
function tierIndex(name) { return TIERS.findIndex((t) => t[1] === name); }

let rankState = { rp: 0, games: 0, wins: 0, kills: 0 };
try {
  const saved = localStorage.getItem(RANK_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object') rankState = { ...rankState, ...parsed };
  }
} catch (e) { /* storage unavailable */ }

async function syncRankFromCloud() {
  const profile = getSavedProfile();
  if (!profile || !profile.cloud) return;
  const data = await loadPlayerData();
  if (data && data.rank && typeof data.rank === 'object') {
    rankState = { ...rankState, ...data.rank };
    try { localStorage.setItem(RANK_KEY, JSON.stringify(rankState)); } catch (e) {}
    refreshRankUI();
  }
}

let rankedMode = false;

function refreshRankUI() {
  const el = $('#rankChip');
  if (el) el.textContent = rankFor(rankState.rp);
}
function refreshModeTabs() {
  const c = $('#tabClassic'), r = $('#tabRanked');
  if (c) c.classList.toggle('active', !rankedMode);
  if (r) r.classList.toggle('active', rankedMode);
  const sub = $('#startModeSub');
  if (sub) sub.textContent = (rankedMode ? 'RANKED' : 'CLASSIC') + ' · BERMUDA';
}

// --------------------------------------------------------- leveling system
const PROFILE_KEY = 'strikey-profile-v2';
function tierName(level) {
  if (level >= 50) return 'LEGEND';
  if (level >= 30) return 'HEROIC';
  if (level >= 20) return 'ELITE';
  if (level >= 10) return 'VETERAN';
  return 'ROOKIE';
}
function xpToNext(level) { return 50 * Math.max(1, level); }
function levelFromXp(xp) {
  let level = 1;
  let need = xpToNext(level);
  while (xp >= need) { xp -= need; level++; need = xpToNext(level); }
  return { level, xp };
}

let profileState = { level: 1, xp: 0 };
try {
  const saved = localStorage.getItem(PROFILE_KEY);
  if (saved) {
    const parsed = JSON.parse(saved);
    if (parsed && typeof parsed === 'object') {
      profileState.level = parsed.level || 1;
      profileState.xp = parsed.xp || 0;
    }
  }
} catch (e) { /* storage unavailable */ }

function refreshProfileUI() {
  document.querySelectorAll('[data-profile-level]').forEach((el) => {
    el.textContent = `LV. ${profileState.level} · ${tierName(profileState.level)}`;
  });
  const lv = $('#levelVal');
  if (lv) lv.textContent = profileState.level;
}

function saveProfileState() {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profileState)); } catch (e) { /* storage unavailable */ }
  savePlayerData({ level: profileState.level, xp: profileState.xp }).catch(() => { /* offline cache */ });
}

async function syncProfileFromCloud() {
  const profile = getSavedProfile();
  if (!profile || !profile.cloud) return;
  const data = await loadPlayerData();
  if (data && (data.level || data.xp !== undefined)) {
    profileState.level = data.level || 1;
    profileState.xp = data.xp || 0;
    saveProfileState();
    refreshProfileUI();
  }
}

// Colyseus multiplayer server URL.
// Local dev: ws://localhost:2569  (run: node server/index.js)
// Production: Render server URL
const SERVER_URL = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'ws://localhost:2569'
  : 'wss://server-dhrz.onrender.com';
let gameRoom = null;
let colyseusClient = null;
let remoteFighters = new Map();
let remoteSyncEnabled = false;
let mmActive = false;

const keys = new Set();
const controls = {
  yaw: 0, pitch: 0, keys,
  firing: false, aiming: false, pendingShot: false,
  aimDir: new THREE.Vector3(0, 0, -1),
  move: { x: 0, y: 0 }, sprint: false, jump: false, crouch: false,
};

// ------------------------------------------------------------- settings
const SETTINGS_KEY = 'zone-royale-settings-v1';
const QUALITY_IDS = ['smooth', 'standard', 'hd', 'ultra'];
const DEFAULT_SETTINGS = {
  sens: { general: 50, redDot: 80, scope2x: 65, scope4x: 55, sniper: 45, freeLook: 50 },
  controls: {
    aimPrecision: 'Precise on Scope',
    leftFire: 'Always',
    quickWeapon: 'On',
    quickReload: 'On',
    quickSwap: 'On',
    vehicleControls: 'Default Position',
    autoParachute: 'On',
    tips: 'On',
    damageIndicator: 'On',
    autoSwitch: 'On',
  },
  pickup: {
    autoPickup: 'On',
    ammo: 'On',
    meds: 'On',
    armor: 'On',
    attachments: 'On',
    doors: 'On',
  },
  display: { quality: 'hd' },
  audio: { music: 50, sfx: 60, voice: 50 },
};

function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch {
    saved = {};
  }
  const merged = {};
  for (const group of Object.keys(DEFAULT_SETTINGS)) {
    const groupSaved = saved[group] && typeof saved[group] === 'object' && !Array.isArray(saved[group])
      ? saved[group]
      : {};
    merged[group] = { ...DEFAULT_SETTINGS[group], ...groupSaved };
  }
  for (const key of ['general', 'redDot', 'scope2x', 'scope4x', 'sniper', 'freeLook']) {
    merged.sens[key] = clamp(Number(merged.sens[key]) || 0, 0, 100);
  }
  for (const key of ['music', 'sfx', 'voice']) {
    merged.audio[key] = clamp(Number(merged.audio[key]) || 0, 0, 100);
  }
  if (!QUALITY_IDS.includes(merged.display.quality)) merged.display.quality = 'hd';
  return merged;
}

const settings = loadSettings();

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable */
  }
}

let activeSettingsTab = 'sensitivity';


// -------------------------------------------------------------- menu UI
const playBtn = $('#playBtn');
const loadingEl = $('#loading');
const loadingBar = $('#loadingBar');
const loadingText = $('#loadingText');
const loadingPct = $('#loadPct');

// ------------------------------------------------------------- title UI
const titleScreen = $('#titleScreen');
const titleMount = $('#titleMount');
const titleStart = $('#titleStart');
const titleStartLabel = $('#titleStartLabel');
const titleStartSub = $('#titleStartSub');
const titleLoadingBar = $('#titleLoadingBar');
const titleLoadPct = $('#titleLoadPct');
const titleLoadingText = $('#titleLoadingText');
let titleDismissed = false;
let loadFailed = false;

function setLoadProgress(pct, text) {
  const v = Math.round(clamp(pct, 0, 100));
  loadingBar.style.width = `${v}%`;
  loadingPct.textContent = `${v}%`;
  loadingText.textContent = text;
  titleLoadingBar.style.width = `${v}%`;
  titleLoadPct.textContent = `${v}%`;
  titleLoadingText.textContent = text;
}

function selectCharacter(id) {
  selected = id;
  const cfg = CHARACTERS.find((c) => c.id === id);
  $('#previewName').textContent = cfg.name;
  $('#previewRole').textContent = cfg.role;
  document.documentElement.style.setProperty('--accent', cfg.color);
  setPreview(id);
}

// ------------------------------------------------------------- preview
const pCanvas = $('#preview');
const pRenderer = new THREE.WebGLRenderer({ canvas: pCanvas, antialias: true, alpha: true });
pRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
pRenderer.outputColorSpace = THREE.SRGBColorSpace;
pRenderer.toneMapping = THREE.ACESFilmicToneMapping;
pRenderer.toneMappingExposure = 1.1;

const pScene = new THREE.Scene();
const pCamera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
pCamera.position.set(0, 1.18, 4.3);
pCamera.lookAt(0, 0.92, 0);

pScene.add(new THREE.HemisphereLight(0xd8ecff, 0x2a2a24, 1.6));
const pKey = new THREE.DirectionalLight(0xfff1d6, 3.2);
pKey.position.set(3.4, 5.2, 4.2);
pScene.add(pKey);
const pRim = new THREE.DirectionalLight(0x63b6ff, 2.6);
pRim.position.set(-4, 3.2, -3.5);
pScene.add(pRim);
const pFill = new THREE.PointLight(0xff9a4d, 12, 8, 2);
pFill.position.set(-1.6, 1.4, 2.4);
pScene.add(pFill);

const pedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.12, 1.28, 0.16, 56),
  new THREE.MeshStandardMaterial({ color: 0x141d26, roughness: 0.55, metalness: 0.55 })
);
pedestal.position.y = -0.09;
pScene.add(pedestal);

const glowRing = new THREE.Mesh(
  new THREE.RingGeometry(1.06, 1.22, 72),
  new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.65, side: THREE.DoubleSide })
);
glowRing.rotation.x = -Math.PI / 2;
glowRing.position.y = 0.005;
pScene.add(glowRing);

const pRoot = new THREE.Group();
pScene.add(pRoot);
let pMixer = null;
let pModel = null;
let pCurrent = '';

function setPreview(charId) {
  if (!loaded || charId === pCurrent) return;
  pCurrent = charId;
  if (pModel) {
    pRoot.remove(pModel.root);
    pModel = null;
    pMixer = null;
  }
  const cfg = CHARACTERS.find((c) => c.id === charId);
  pModel = createCharacterModel(charId);
  pModel.root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      if (o.material) o.material.emissiveIntensity = 0.05;
    }
  });
  pModel.play('Idle_Neutral', 0);
  pRoot.add(pModel.root);
  pMixer = pModel.mixer;
  glowRing.material.color.set(cfg.color);
  pFill.color.set(cfg.color);
  pRoot.rotation.y = 0;
}

function resizePreview() {
  const w = pCanvas.clientWidth || 320;
  const h = pCanvas.clientHeight || 480;
  pRenderer.setSize(w, h, false);
  pCamera.aspect = w / h;
  pCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resizePreview);

// the splash screen owns the operative preview until the player taps in
titleMount.appendChild(pCanvas);
pCanvas.style.display = 'none';
requestAnimationFrame(resizePreview);

function enterLobby() {
  if (loadFailed) { window.location.reload(); return; }
  if (!loaded || titleDismissed) return;
  titleDismissed = true;
  audio.init();
  applyAudioSettings();
  audio.click();
  syncArmoryFromCloud();
  syncRankFromCloud();
  syncProfileFromCloud();
  // hide the live character preview with the title screen, then move it
  // into the lobby once the title has faded out
  titleScreen.classList.add('closing');
  setTimeout(() => {
    titleScreen.classList.add('hidden');
    lobbyStage.insertBefore(pCanvas, stageCard);
    pCanvas.style.display = '';
    resizePreview();
  }, 520);
}
titleScreen.addEventListener('click', enterLobby);

// ------------------------------------------------------------- loading
Promise.all([
  loadAllCharacters((p, cfg) => setLoadProgress(p * 50, `LOADING OPERATIVES · ${cfg.name}`)),
  loadMap((p) => setLoadProgress(50 + p * 50, `LOADING MAP · ${Math.round(p * 100)}%`)),
  loadGunModel(),
]).then(([chars, mapRoot]) => {
  world = createWorld(scene, mapRoot);
  loaded = true;
  setLoadProgress(100, 'DEPLOYMENT READY');
  playBtn.disabled = false;
  titleStart.disabled = false;
  titleStart.classList.add('ready');
  titleStartLabel.textContent = 'TAP TO ENTER';
  titleStartSub.textContent = 'ENTER THE LOBBY';
  setTimeout(() => loadingEl.classList.add('hidden'), 350);
  selectCharacter(selected);
  applyDisplayQuality();
  resizePreview();
}).catch((err) => {
  console.error(err);
  loadingText.innerHTML = 'FAILED TO LOAD<br><small>Run PLAY.bat (or <code>python serve.py</code>) and open http://localhost:8000</small>';
  loadingBar.style.background = '#ff4d5e';
  titleLoadingText.textContent = 'ASSET LOAD FAILED';
  titleLoadPct.textContent = '!';
  titleLoadingBar.style.background = '#ff4d5e';
  titleStart.disabled = false;
  titleStartLabel.textContent = 'RELOAD';
  titleStartSub.textContent = 'TAP TO RELOAD';
  loadFailed = true;
});

// -------------------------------------------------- character screen
const charModal = $('#charModal');
const charGrid = $('#charGrid');
const charEquip = $('#charEquip');
const charClose = $('#charClose');
const charSelName = $('#charSelName');
const charSelRole = $('#charSelRole');
const charStatus = $('#charStatus');
const charClass = $('#charClass');
const charInfoStatus = $('#charInfoStatus');
const charDesc = $('#charDesc');
const charFootName = $('#charFootName');
const previewMount = $('#csPreviewMount');
const navCharacter = $('#navCharacter');
const lobbyStage = document.querySelector('.lobby-stage');
const stageCard = document.querySelector('.stage-card');
let pendingChar = CHARACTERS[0].id;

const ROLE_DESC = {
  TACTICAL: 'Trained for high-risk operations. Stays calm under fire and never breaks formation.',
  SCOUT: 'Fast on their feet. Reads the terrain and spots danger before anyone else.',
  EXPLORER: 'Ventured beyond the safe zone and came back with stories — and better gear.',
  DRIFTER: 'Goes wherever the tide takes them. At home in the chaos of the drop.',
  EXECUTIVE: 'Runs the squad like a business: cold, calculated, and always on schedule.',
  ROOKIE: 'Hungry to prove themselves. Every match is a chance to rise.',
  SURVIVOR: 'Knows every trick the island has to offer. Outlasts the storm itself.',
  GHOST: 'Moves without a sound. By the time you see them, the fight is already over.',
  ROYAL: 'Born for the crown. Expects the lobby to bow and the final circle to obey.',
  BRAWLER: 'Prefers the loud way in. Close quarters is where they shine.',
  BUILDER: 'Turns scrap into shelter. If it can be fortified, they have already done it.',
};

CHARACTERS.forEach((c) => {
  const btn = document.createElement('button');
  btn.className = 'cs-card';
  btn.dataset.id = c.id;
  btn.style.setProperty('--ch', c.color);
  btn.innerHTML = `
    <span class="cs-portrait" aria-hidden="true">
      <svg viewBox="0 0 100 100">
        <circle cx="50" cy="30" r="16"></circle>
        <path d="M20 93c0-17 13-28 30-28s30 11 30 28z"></path>
      </svg>
    </span>
    <span class="cs-card-name">${c.name}</span>
    <span class="cs-card-role">${c.role}</span>
    <span class="cs-card-badge">IN USE</span>
    <span class="cs-card-check">&#10003;</span>`;
  btn.addEventListener('click', () => {
    audio.init();
    audio.click();
    pendingChar = c.id;
    refreshCharModal();
  });
  charGrid.appendChild(btn);
});

function refreshCharModal() {
  charGrid.querySelectorAll('.cs-card').forEach((el) => {
    el.classList.toggle('picked', el.dataset.id === pendingChar);
    el.classList.toggle('equipped', el.dataset.id === selected);
  });
  const cfg = CHARACTERS.find((c) => c.id === pendingChar) || CHARACTERS[0];
  const inUse = pendingChar === selected;
  charSelName.textContent = cfg.name;
  charSelRole.textContent = cfg.role;
  charStatus.textContent = inUse ? 'IN USE' : 'PREVIEW';
  charStatus.classList.toggle('ready', !inUse);
  charClass.textContent = cfg.role;
  charInfoStatus.textContent = inUse ? 'IN USE' : 'READY';
  charDesc.textContent = ROLE_DESC[cfg.role] || ROLE_DESC.TACTICAL;
  charFootName.textContent = cfg.name;
  charEquip.disabled = inUse;
  charEquip.textContent = inUse ? 'EQUIPPED' : 'EQUIP';
  setPreview(pendingChar);
}

function mountPreview() {
  if (pCanvas.parentElement !== previewMount) previewMount.appendChild(pCanvas);
  requestAnimationFrame(() => resizePreview());
}

function unmountPreview() {
  if (pCanvas.parentElement !== lobbyStage) lobbyStage.insertBefore(pCanvas, stageCard);
  requestAnimationFrame(() => resizePreview());
}

function openCharModal(id) {
  pendingChar = id || selected;
  charModal.classList.remove('hidden');
  mountPreview();
  refreshCharModal();
}

function closeCharModal() {
  charModal.classList.add('hidden');
  if (pendingChar !== selected) setPreview(selected);
  unmountPreview();
}

charEquip.addEventListener('click', () => {
  if (charEquip.disabled) return;
  audio.init();
  audio.click();
  selectCharacter(pendingChar);
  closeCharModal();
});
charClose.addEventListener('click', closeCharModal);
navCharacter.addEventListener('click', () => {
  if (!loaded) return;
  audio.init();
  audio.click();
  openCharModal(selected);
});
document.querySelector('.lobby-stage').addEventListener('click', () => {
  if (!loaded) return;
  audio.init();
  audio.click();
  openCharModal(selected);
});

// --------------------------------------------------------- weapon armory
const ARMORY_KEY = 'strikey-armory-v1';
let selectedWeapon = 'pistol';
try {
  const saved = localStorage.getItem(ARMORY_KEY);
  if (saved && WEAPONS[saved]) selectedWeapon = saved;
} catch (e) { /* storage unavailable */ }

// sync armory selection with Firebase Realtime DB (preferred source of truth)
async function syncArmoryFromCloud() {
  const profile = getSavedProfile();
  if (!profile || !profile.cloud) return;
  const data = await loadPlayerData();
  if (data && data.armory && WEAPONS[data.armory]) {
    selectedWeapon = data.armory;
    try { localStorage.setItem(ARMORY_KEY, selectedWeapon); } catch (e) {}
    if (typeof refreshWpnModal === 'function' && !wpnModal.classList.contains('hidden')) refreshWpnModal();
  }
}

const wpnModal = $('#wpnModal');
const wpnGrid = $('#wpnGrid');
const wpnEquip = $('#wpnEquip');
const wpnClose = $('#wpnClose');
const wpnPreviewMount = $('#wpnPreviewMount');
const navWeapons = $('#navWeapons');
const wpnSelType = $('#wpnSelType');
const wpnSelName = $('#wpnSelName');
const wpnStatus = $('#wpnStatus');
const wpnClassEl = $('#wpnClass');
const wpnTypeEl = $('#wpnType');
const wpnDmgEl = $('#wpnDmg');
const wpnRpmEl = $('#wpnRpm');
const wpnMagEl = $('#wpnMag');
const wpnRangeEl = $('#wpnRange');
const wpnReloadEl = $('#wpnReload');
const wpnLenEl = $('#wpnLen');
const wpnDpsEl = $('#wpnDps');
const wpnPowFill = $('#wpnPowFill');
const wpnDescEl = $('#wpnDesc');
const wpnFootName = $('#wpnFootName');
let pendingWeapon = selectedWeapon;

const WPN_ABILITY = {
  pistol: 'Lightweight sidearm with infinite reserve ammo. Always ready.',
  smg: 'Close-range shredder with a blazing 900 RPM.',
  rifle: 'Balanced workhorse. Shines at any range.',
  shotgun: 'Eight-pellet spread that deletes close threats.',
  sniper: 'One-shot powerhouse. Devastating headshots at 340m.',
  assault2: 'High-output AR tuned for sustained automatic fire.',
  assault3: 'Retro battle rifle. Hard-hitting, slower cadence.',
  bullpup: 'Compact bullpup. Extreme stability, high fire rate.',
  smg3: 'Stealth-profile SMG. Fast and deadly close in.',
  pistol3: 'Suppressed sidearm. Smooth and accurate.',
  pistol4: 'Ultra-light pistol. Fast to draw, quick reload.',
  pistol5: 'Wooden-grip classic. Extra damage per shot.',
  revolver: 'Heavy-hitter revolver. Massive damage, slow fire.',
  revolver2: "Officer's revolver. Refined control and punch.",
  revolver3: 'Steel-frame revolver. Tight grouping, big payoff.',
  shotgun2: 'Sawed-off scattergun. Brutal at point blank.',
  shotgun3: 'Short-stocked shotgun. Faster follow-up shots.',
  shotgun4: 'Workhorse shotgun. Reliable and deadly.',
  sniper2: 'Modern precision rifle with match-grade accuracy.',
  sniper3: 'Lightweight sniper. Faster handling, same lethality.',
  sniper4: 'Signature green-coat AWM. Full power, no compromise.',
};

function wpnClassOf(id) {
  if (id === 'bullpup') return 'BULLPUP';
  if (id.startsWith('sniper')) return 'SNIPER';
  if (id.startsWith('assault') || id === 'rifle') return 'ASSAULT';
  if (id.startsWith('smg')) return 'SMG';
  if (id.startsWith('shotgun')) return 'SHOTGUN';
  if (id.startsWith('revolver')) return 'REVOLVER';
  return 'PISTOL';
}

function wpnLenOf(id) {
  if (id.startsWith('sniper')) return 55;
  if (id.startsWith('shotgun')) return 42;
  if (id.startsWith('assault') || id === 'rifle' || id === 'bullpup') return 40;
  if (id.startsWith('smg')) return 29;
  if (id.startsWith('revolver')) return 23;
  return 19;
}

function wpnDpsOf(def) {
  return Math.round(def.dmg * def.pellets * def.rpm / 60);
}

const maxDps = Math.max(...Object.values(WEAPONS).map(wpnDpsOf));

const ICON_PISTOL = '<svg viewBox="0 0 100 100"><g><rect x="10" y="34" width="46" height="10" rx="2"/><rect x="56" y="36.5" width="24" height="5" rx="1"/><path d="M24 44l4 17h9l-2-15z"/><rect x="33" y="44" width="14" height="5"/></g></svg>';
const ICON_SMG = '<svg viewBox="0 0 100 100"><g><rect x="12" y="35" width="44" height="9" rx="2"/><rect x="56" y="37.5" width="24" height="4"/><rect x="18" y="30" width="18" height="5"/><path d="M36 44l2 14h6l-1-12z"/><rect x="44" y="44" width="5" height="8"/></g></svg>';
const ICON_LONG = '<svg viewBox="0 0 100 100"><g><rect x="6" y="36" width="46" height="9" rx="2"/><rect x="52" y="38.5" width="38" height="3.5"/><rect x="60" y="41" width="30" height="4"/><path d="M6 36l-4 3v9l4 3z"/><rect x="24" y="45" width="6" height="9"/><path d="M38 45l2 12h6l-1-11z"/></g></svg>';

function wpnIcon(id) {
  if (id.startsWith('pistol') || id.startsWith('revolver')) return ICON_PISTOL;
  if (id.startsWith('smg')) return ICON_SMG;
  return ICON_LONG;
}

Object.values(WEAPONS).forEach((w) => {
  const id = w.id;
  const cls = wpnClassOf(id);
  const btn = document.createElement('button');
  btn.className = 'cs-card';
  btn.dataset.id = id;
  btn.style.setProperty('--ch', '#' + w.color.toString(16).padStart(6, '0'));
  btn.innerHTML = `
    <span class="cs-portrait" aria-hidden="true">${wpnIcon(id)}</span>
    <span class="cs-card-name">${w.name}</span>
    <span class="cs-card-role">${cls}</span>
    <span class="cs-card-badge">IN USE</span>
    <span class="cs-card-check">&#10003;</span>`;
  btn.addEventListener('click', () => {
    audio.init();
    audio.click();
    pendingWeapon = id;
    refreshWpnModal();
  });
  wpnGrid.appendChild(btn);
});
$('#wpnCount').textContent = Object.keys(WEAPONS).length + ' WEAPONS';

// -------------------------------------------------- weapon preview
const wCanvas = document.createElement('canvas');
wCanvas.style.width = '100%';
wCanvas.style.height = '100%';
wCanvas.style.display = 'block';
wpnPreviewMount.appendChild(wCanvas);

const wRenderer = new THREE.WebGLRenderer({ canvas: wCanvas, antialias: true, alpha: true });
wRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
wRenderer.outputColorSpace = THREE.SRGBColorSpace;
wRenderer.toneMapping = THREE.ACESFilmicToneMapping;
wRenderer.toneMappingExposure = 1.15;

const wScene = new THREE.Scene();
const wCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 50);
wCamera.position.set(0, 1.15, 4.8);
wCamera.lookAt(0, 0, 0);

wScene.add(new THREE.HemisphereLight(0xd8ecff, 0x2a2a24, 1.5));
const wKey = new THREE.DirectionalLight(0xfff1d6, 2.6);
wKey.position.set(3, 4.5, 4);
wScene.add(wKey);
const wRim = new THREE.DirectionalLight(0x63b6ff, 1.8);
wRim.position.set(-3.5, 2.5, -3.5);
wScene.add(wRim);

const wPedestal = new THREE.Mesh(
  new THREE.CylinderGeometry(1.35, 1.5, 0.14, 48),
  new THREE.MeshStandardMaterial({ color: 0x141d26, roughness: 0.55, metalness: 0.55 })
);
wPedestal.position.y = -1.15;
wScene.add(wPedestal);
const wRing = new THREE.Mesh(
  new THREE.RingGeometry(1.24, 1.42, 64),
  new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.8, side: THREE.DoubleSide })
);
wRing.rotation.x = -Math.PI / 2;
wRing.position.y = -1.07;
wScene.add(wRing);

const wRoot = new THREE.Group();
wScene.add(wRoot);
let wModel = null;

function disposeGunModel(model) {
  model.traverse((o) => {
    if (o.isMesh) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    }
  });
}

function showWpnPreview(id) {
  if (wModel) {
    wRoot.remove(wModel);
    disposeGunModel(wModel);
    wModel = null;
  }
  const def = WEAPONS[id] || WEAPONS.pistol;
  const w = createGun(id);
  const s = 2.15 / (w.userData.length || 0.4);
  w.scale.setScalar(s);
  w.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(w);
  const c = box.getCenter(new THREE.Vector3());
  w.position.set(-c.x, -c.y, -c.z);
  wRoot.add(w);
  wRoot.position.y = -0.02;
  wRoot.rotation.y = 0;
  wModel = w;
  wRing.material.color.set(def.color);
}

function resizeWpnPreview() {
  const w = wpnPreviewMount.clientWidth || 320;
  const h = wpnPreviewMount.clientHeight || 420;
  wRenderer.setSize(w, h, false);
  wCamera.aspect = w / h;
  wCamera.updateProjectionMatrix();
}
window.addEventListener('resize', resizeWpnPreview);

function refreshWpnModal() {
  wpnGrid.querySelectorAll('.cs-card').forEach((el) => {
    el.classList.toggle('picked', el.dataset.id === pendingWeapon);
    el.classList.toggle('equipped', el.dataset.id === selectedWeapon);
  });
  const def = WEAPONS[pendingWeapon] || WEAPONS.pistol;
  const id = def.id;
  const cls = wpnClassOf(id);
  const dps = wpnDpsOf(def);
  const inUse = id === selectedWeapon;

  wpnSelType.textContent = cls;
  wpnSelName.textContent = def.name;
  wpnStatus.textContent = inUse ? 'IN USE' : 'READY';
  wpnStatus.classList.toggle('ready', !inUse);
  wpnClassEl.textContent = cls;
  wpnTypeEl.textContent = def.pellets > 1 ? 'SPREAD FIRE' : (def.auto ? 'FULL AUTO' : 'SEMI AUTO');
  wpnDmgEl.textContent = def.pellets > 1 ? `${def.dmg} × ${def.pellets}` : `${def.dmg}`;
  wpnRpmEl.textContent = `${def.rpm} RPM`;
  wpnMagEl.textContent = `${def.mag}`;
  wpnRangeEl.textContent = `${def.range}m`;
  wpnReloadEl.textContent = `${def.reload}s`;
  wpnLenEl.textContent = `${wpnLenOf(id)}cm`;
  wpnDpsEl.textContent = `${dps} DPS`;
  wpnPowFill.style.width = `${Math.round((dps / maxDps) * 100)}%`;
  wpnDescEl.textContent = WPN_ABILITY[id] || 'Combat-tested battlefield hardware.';
  wpnFootName.textContent = def.name;
  wpnEquip.disabled = inUse;
  wpnEquip.textContent = inUse ? 'EQUIPPED' : 'EQUIP';
  showWpnPreview(id);
  requestAnimationFrame(resizeWpnPreview);
}

function openWpnModal() {
  pendingWeapon = selectedWeapon;
  wpnModal.classList.remove('hidden');
  refreshWpnModal();
  requestAnimationFrame(resizeWpnPreview);
}

function closeWpnModal() {
  wpnModal.classList.add('hidden');
  pendingWeapon = selectedWeapon;
}

wpnEquip.addEventListener('click', () => {
  if (wpnEquip.disabled) return;
  audio.init();
  audio.click();
  selectedWeapon = pendingWeapon;
  try { localStorage.setItem(ARMORY_KEY, selectedWeapon); } catch (e) { /* storage unavailable */ }
  savePlayerData({ armory: selectedWeapon }).catch(() => { /* offline: kept in localStorage */ });
  refreshWpnModal();
});
wpnClose.addEventListener('click', closeWpnModal);
navWeapons.addEventListener('click', () => {
  if (!loaded) return;
  audio.init();
  audio.click();
  openWpnModal();
});

// ---------------------------------------------------------- panel modals
const PANELS = [
  { id: 'stats', nav: null, title: 'STATS' },
  { id: 'mail', nav: null },
  { id: 'friends', nav: null },
  { id: 'shop', nav: null },
  { id: 'events', nav: null },
  { id: 'clan', nav: null },
  { id: 'vault', nav: null },
  { id: 'collection', nav: null },
  { id: 'rank', nav: null },
  { id: 'luck', nav: null },
  { id: 'invite', nav: null },
];

// helper: open/close any panel modal by id
function openPanel(id) {
  const modal = document.getElementById(id + 'Modal');
  if (!modal || !loaded) return;
  audio.init(); audio.click();
  // close any other open panel
  document.querySelectorAll('.panel-modal').forEach((m) => m.classList.add('hidden'));
  modal.classList.remove('hidden');
  // populate
  const fn = panelPopulate[id];
  if (fn) fn();
}
function closePanel(id) {
  const modal = document.getElementById(id + 'Modal');
  if (modal) modal.classList.add('hidden');
}

// wire close buttons
['stats','mail','friends','shop','events','clan','vault','collection','rank','luck','invite'].forEach((id) => {
  const btn = document.getElementById(id + 'Close');
  if (btn) btn.addEventListener('click', () => closePanel(id));
});

// wire nav items + rail/tools
const navStore = $('#navStore');
const navLuck = $('#navLuck');
const navVault = $('#navVault');
const navCollection = $('#navCollection');
if (navStore) navStore.addEventListener('click', () => openPanel('shop'));
if (navLuck) navLuck.addEventListener('click', () => openPanel('luck'));
if (navVault) navVault.addEventListener('click', () => openPanel('vault'));
if (navCollection) navCollection.addEventListener('click', () => openPanel('collection'));

// top bar tools: stats, events, shop, clan, rank
const toolBtns = document.querySelectorAll('.lobby-tools .tool, .lobby-rail .rail-btn');
// map by title attribute
toolBtns.forEach((btn) => {
  const t = (btn.getAttribute('title') || '').toLowerCase();
  if (t === 'stats') btn.addEventListener('click', () => openPanel('stats'));
  else if (t === 'events') btn.addEventListener('click', () => openPanel('events'));
  else if (t === 'shop') btn.addEventListener('click', () => openPanel('shop'));
  else if (t === 'clan') btn.addEventListener('click', () => openPanel('clan'));
  else if (t === 'rank') btn.addEventListener('click', () => openPanel('rank'));
});
// friends/mail tools
const friendsTool = document.querySelector('.lobby-tools .tool[title="Friends"]');
const mailTool = document.querySelector('.lobby-tools .tool[title="Mail"]');
if (friendsTool) friendsTool.addEventListener('click', () => openPanel('friends'));
if (mailTool) mailTool.addEventListener('click', () => openPanel('mail'));

// invite button
const inviteBtn = document.querySelector('.invite-btn');
if (inviteBtn) inviteBtn.addEventListener('click', () => openPanel('invite'));

// keyboard: Escape closes any open panel
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Escape') return;
  const open = document.querySelector('.panel-modal:not(.hidden)');
  if (open) { open.classList.add('hidden'); audio.click(); }
});

// ============================================================
//  DATA + POPULATE FUNCTIONS
// ============================================================
const PANEL_DATA_KEY = 'strikey-panel-v1';
let panelData = {
  coins: 103,
  gems: 0,
  tickets: 0,
  stats: { matches: 0, wins: 0, kills: 0, damage: 0, headshots: 0, surviveSec: 0, bestPlacement: 99 },
  history: [],
  mail: [
    { id: 'm1', title: 'WELCOME REWARD', desc: 'Thanks for joining StrikeX!', reward: '50 COINS', claimed: false },
    { id: 'm2', title: 'DAILY LOGIN', desc: 'Day 1 reward — keep coming back.', reward: '100 COINS', claimed: false },
    { id: 'm3', title: 'LEVEL UP BONUS', desc: 'Reach level 5 for a special reward.', reward: '200 COINS', claimed: false },
  ],
  friends: [],
  clan: null,
  vault: [],
  collection: [
    { name: 'FIRST BLOOD', desc: 'Get your first elimination.', done: false },
    { name: 'SURVIVOR', desc: 'Survive 5 minutes in a match.', done: false },
    { name: 'SHARPSHOOTER', desc: 'Get 5 headshots in one match.', done: false },
    { name: 'WINNER', desc: 'Win a battle royale match.', done: false },
    { name: 'VETERAN', desc: 'Play 10 matches.', done: false },
    { name: 'COLLECTOR', desc: 'Own 5 weapons in your vault.', done: false },
  ],
  pets: [
    { id: 'none', name: 'NONE', ability: 'No bonus.' },
    { id: 'falcon', name: 'FALCON', ability: '+5% movement speed.' },
    { id: 'panther', name: 'PANTHER', ability: '+8% damage to knocked enemies.' },
    { id: 'dragon', name: 'DRAGON', ability: '+10% EP regen.' },
    { id: 'robot', name: 'ROBOT', ability: '+5 shield on kill.' },
  ],
  pets: [
    { id: 'none', name: 'NONE', ability: 'No bonus.' },
    { id: 'falcon', name: 'FALCON', ability: '+5% movement speed.' },
    { id: 'panther', name: 'PANTHER', ability: '+8% damage to knocked enemies.' },
    { id: 'dragon', name: 'DRAGON', ability: '+10% EP regen.' },
    { id: 'robot', name: 'ROBOT', ability: '+5 shield on kill.' },
  ],
  shopItems: [
    { id: 'skin_arctic', name: 'ARCTIC SKIN', price: 500, type: 'skin', owned: false },
    { id: 'skin_neon', name: 'NEON BLADE', price: 800, type: 'skin', owned: false },
    { id: 'skin_gold', name: 'GOLDEN AR', price: 1200, type: 'skin', owned: false },
    { id: 'emote_wave', name: 'WAVE EMOTE', price: 0, type: 'emote', anim: 'wave', owned: false },
    { id: 'emote_dance', name: 'DANCE EMOTE', price: 0, type: 'emote', anim: 'dance', owned: false },
    { id: 'emote_taunt', name: 'TAUNT EMOTE', price: 0, type: 'emote', anim: 'taunt', owned: false },
    { id: 'emote_salute', name: 'SALUTE EMOTE', price: 0, type: 'emote', anim: 'salute', owned: false },
    { id: 'emote_laugh', name: 'LAUGH EMOTE', price: 0, type: 'emote', anim: 'laugh', owned: false },
    { id: 'emote_point', name: 'POINT EMOTE', price: 0, type: 'emote', anim: 'point', owned: false },
    { id: 'emote_clap', name: 'CLAP EMOTE', price: 0, type: 'emote', anim: 'clap', owned: false },
    { id: 'emote_hype', name: 'HYPE EMOTE', price: 0, type: 'emote', anim: 'hype', owned: false },
    { id: 'banner_fire', name: 'FIRE BANNER', price: 400, type: 'banner', owned: false },
  ],
  events: [
    { id: 'e1', name: 'DOUBLE XP WEEKEND', desc: '2x XP for all matches this weekend.', reward: '2x XP', claimed: false, active: true },
    { id: 'e2', name: 'FIRST WIN BONUS', desc: 'Win your first match of the day.', reward: '100 COINS', claimed: false, active: true },
    { id: 'e3', name: 'KILL STREAK CHALLENGE', desc: 'Get a 5-kill streak.', reward: '500 COINS', claimed: false, active: true },
    { id: 'e4', name: 'SURVIVOR', desc: 'Survive 10 minutes in a single match.', reward: '300 COINS', claimed: false, active: true },
  ],
  equippedEmote: null,
  luckResult: 'SPIN TO WIN!',
};

function loadPanelData() {
  try {
    const saved = localStorage.getItem(PANEL_DATA_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        panelData = { ...panelData, ...parsed };
        if (!Array.isArray(panelData.friends)) panelData.friends = [];
        if (!Array.isArray(panelData.vault)) panelData.vault = [];
        if (!Array.isArray(panelData.mail)) panelData.mail = [];
      }
    }
  } catch (e) { /* storage unavailable */ }
}
function savePanelData() {
  try { localStorage.setItem(PANEL_DATA_KEY, JSON.stringify(panelData)); } catch (e) { /* storage unavailable */ }
  // sync to Firebase
  savePlayerData({ panel: panelData }).catch(() => {});
}
loadPanelData();

// update coin display
function refreshCoins() {
  document.querySelectorAll('#shopCoins, #shopCoinsFoot, #luckCoins, #luckCoinsFoot').forEach((el) => {
    if (el) el.textContent = panelData.coins;
  });
}

// ---- STATS ----
function populateStats() {
  const s = panelData.stats;
  const kd = s.matches > 0 ? (s.kills / Math.max(1, s.matches)).toFixed(2) : '0.00';
  const h = Math.floor(s.surviveSec / 3600);
  const m = Math.floor((s.surviveSec % 3600) / 60);
  document.getElementById('stMatches').textContent = s.matches;
  document.getElementById('stWins').textContent = s.wins;
  document.getElementById('stKills').textContent = s.kills;
  document.getElementById('stKD').textContent = kd;
  document.getElementById('stDamage').textContent = Math.round(s.damage);
  document.getElementById('stHS').textContent = s.headshots;
  document.getElementById('stSurvive').textContent = `${h}h ${m}m`;
  document.getElementById('stBest').textContent = s.bestPlacement === 99 ? '-' : `#${s.bestPlacement}`;
  document.getElementById('stLevel').textContent = profileState.level;
  document.getElementById('stRank').textContent = rankFor(rankState.rp);
  document.getElementById('stName').textContent = getProfile().username || 'PLAYER';

  // history
  const histEl = document.getElementById('stHistory');
  if (histEl) {
    const list = (panelData.history || []).map(m => {
      const d = new Date(m.date);
      const dateStr = `${d.getMonth()+1}/${d.getDate()}`;
      const place = m.placement === 1 ? '<b class="win">WIN</b>' : `#${m.placement}`;
      return `<div><span>${dateStr}</span> · <b>${m.kills}</b> kills · ${place} · ${m.damage} dmg</div>`;
    });
    histEl.innerHTML = list.length ? list.join('') : '<div>NO MATCHES YET</div>';
  }
}

// ---- MAIL ----
function generateMailRewards() {
  const s = panelData.stats;
  const mails = panelData.mail;
  const has = (title) => mails.some((m) => m.title === title);
  if (s.matches === 1 && !has('FIRST MATCH')) {
    mails.unshift({ id: 'm_first', title: 'FIRST MATCH', desc: 'You completed your first battle.', reward: '50 COINS', claimed: false });
  }
  if (s.wins >= 1 && !has('FIRST WIN')) {
    mails.unshift({ id: 'm_win', title: 'FIRST WIN', desc: 'You won your first battle royale!', reward: '200 COINS', claimed: false });
  }
  if (s.kills >= 10 && !has('10 KILLS')) {
    mails.unshift({ id: 'm_10k', title: '10 KILLS', desc: 'You reached 10 total eliminations.', reward: '100 COINS', claimed: false });
  }
  if (s.headshots >= 5 && !has('SHARPSHOOTER')) {
    mails.unshift({ id: 'm_hs', title: 'SHARPSHOOTER', desc: '5 headshots achieved.', reward: '150 COINS', claimed: false });
  }
  if (profileState.level >= 5 && !has('LEVEL 5')) {
    mails.unshift({ id: 'm_lvl5', title: 'LEVEL 5', desc: 'Reached level 5. Keep going!', reward: '300 COINS', claimed: false });
  }
  savePanelData();
}
async function populateMail() {
  const list = document.getElementById('mailList');
  list.innerHTML = '<div class="panel-note" style="margin-top:20px;">Loading mail...</div>';
  const profile = getSavedProfile();
  let mails = [];
  if (profile && profile.uid) {
    mails = await loadPlayerMail(profile.uid);
  }
  // merge with local panelData.mail (dedupe by id/_key)
  const seen = new Set();
  const merged = [];
  for (const m of mails) { const k = m._key || m.id; if (seen.has(k)) continue; seen.add(k); merged.push(m); }
  for (const m of panelData.mail) { const k = m._key || m.id; if (seen.has(k)) continue; seen.add(k); merged.push(m); }
  panelData.mail = merged;

  list.innerHTML = '';
  if (merged.length === 0) {
    list.innerHTML = '<div class="panel-note" style="margin-top:20px;">No mail. Check back later.</div>';
  }
  merged.forEach((m, idx) => {
    const row = document.createElement('div');
    row.className = 'mail-item';
    row.innerHTML = `<div style="flex:1"><div class="mail-title">${m.title}</div><div class="mail-desc">${m.desc}</div></div><div class="mail-reward">${m.reward}</div><button class="btn ghost" style="min-width:70px;padding:6px 10px;font-size:9px;" ${m.claimed ? 'disabled' : ''}>${m.claimed ? 'CLAIMED' : 'CLAIM'}</button>`;
    const btn = row.querySelector('button');
    if (!m.claimed) {
      btn.addEventListener('click', async () => {
        m.claimed = true;
        const rewardCoins = m.rewardCoins || parseInt((m.reward || '0').replace(/[^0-9]/g, ''), 10) || 50;
        panelData.coins += rewardCoins;
        if (profile && profile.uid && m._key) await claimMail(profile.uid, m._key);
        savePanelData();
        refreshCoins();
        populateMail();
        audio.click();
        hud.toast('REWARD CLAIMED', 'good');
      });
    }
    list.appendChild(row);
  });
  document.getElementById('mailCount').textContent = merged.filter((m) => !m.claimed).length + ' UNREAD';
}

// ---- FRIENDS ----
function populateFriends() {
  const list = document.getElementById('friendsList');
  list.innerHTML = '';
  if (panelData.friends.length === 0) {
    list.innerHTML = '<div class="panel-note" style="margin-top:20px;">No friends yet. Add by username.</div>';
    document.getElementById('friendsCount').textContent = '0 FRIENDS';
    return;
  }
  // lookup online status for each friend
  Promise.all(panelData.friends.map((f) => lookupPlayerByUsername(f))).then((results) => {
    list.innerHTML = '';
    panelData.friends.forEach((f, i) => {
      const info = results[i];
      const online = info ? info.online : false;
      const level = info ? info.level : '?';
      const row = document.createElement('div');
      row.className = 'friend-item';
      row.innerHTML = `<div style="flex:1"><div class="mail-title">${f}</div><div class="mail-desc">${online ? 'ONLINE' : 'OFFLINE'} · LV. ${level}</div></div><button class="btn ghost" style="min-width:60px;padding:6px 10px;font-size:9px;">INVITE</button><button class="btn ghost" style="min-width:60px;padding:6px 10px;font-size:9px;">REMOVE</button>`;
      const btns = row.querySelectorAll('button');
      btns[0].addEventListener('click', () => { audio.click(); hud.toast('INVITE SENT TO ' + f, 'good'); });
      btns[1].addEventListener('click', () => { panelData.friends.splice(i, 1); savePanelData(); populateFriends(); audio.click(); });
      list.appendChild(row);
    });
    document.getElementById('friendsCount').textContent = panelData.friends.length + ' FRIENDS';
  });
}

// ---- SHOP ----
function populateShop() {
  const grid = document.getElementById('shopGrid');
  grid.innerHTML = '';
  panelData.shopItems.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'shop-item';
    const owned = item.owned || panelData.vault.includes(item.id);
    card.innerHTML = `<div style="width:48px;height:48px;background:linear-gradient(135deg,#ffb648,#ff5c8a);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);"></div><div class="shop-name">${item.name}</div><div class="shop-price">${owned ? 'OWNED' : (item.price === 0 ? 'FREE' : item.price + ' COINS')}</div><button class="btn ${owned ? 'ghost' : 'primary'}" style="min-width:70px;padding:6px 12px;font-size:9px;margin-top:8px;" ${owned ? 'disabled' : ''}>${owned ? 'OWNED' : 'GET'}</button>`;
    const btn = card.querySelector('button');
    if (!owned) {
      btn.addEventListener('click', () => {
        if (item.price > 0 && panelData.coins < item.price) { hud.toast('NOT ENOUGH COINS', 'warn'); return; }
        panelData.coins -= item.price;
        item.owned = true;
        if (item.type === 'emote') {
          panelData.equippedEmote = item.anim || item.id;
          hud.toast('EQUIPPED: ' + item.name, 'good');
        } else {
          panelData.vault.push(item.id);
          hud.toast(item.name + ' PURCHASED', 'good');
        }
        savePanelData();
        refreshCoins();
        populateShop();
        audio.click();
        hud.toast(item.name + ' PURCHASED', 'good');
      });
    }
    grid.appendChild(card);
  });
  refreshCoins();
}

// ---- EVENTS ----
async function populateEvents() {
  const list = document.getElementById('eventsList');
  list.innerHTML = '<div class="panel-note" style="margin-top:20px;">Loading events...</div>';
  const fbEvents = await loadEvents();
  if (fbEvents.length > 0) {
    // merge: keep claimed state from panelData
    const claimed = new Set(panelData.events.filter((e) => e.claimed).map((e) => e.id));
    panelData.events = fbEvents.map((e) => ({ ...e, claimed: claimed.has(e.id) }));
  }
  list.innerHTML = '';
  const s = panelData.stats;
  panelData.events.forEach((ev) => {
    let progress = '';
    let claimable = false;
    if (ev.condition === 'always' || ev.id === 'e1') { progress = 'ACTIVE NOW'; claimable = true; }
    else if (ev.condition === 'win' || ev.id === 'e2') { progress = s.wins >= 1 ? 'COMPLETE' : 'WIN A MATCH'; claimable = s.wins >= 1; }
    else if (ev.condition === 'kills5' || ev.id === 'e3') { progress = (s.bestKills || 0) + ' / 5 KILLS'; claimable = (s.bestKills || 0) >= 5; }
    else if (ev.condition === 'survive10' || ev.id === 'e4') { progress = Math.floor(s.surviveSec / 60) + ' / 10 MIN'; claimable = s.surviveSec >= 600; }
    else if (ev.condition === 'matches10') { progress = s.matches + ' / 10 MATCHES'; claimable = s.matches >= 10; }
    else { progress = 'ACTIVE'; claimable = true; }
    const row = document.createElement('div');
    row.className = 'event-item';
    row.innerHTML = `<div style="flex:1"><div class="event-title">${ev.name}</div><div class="event-desc">${ev.desc}</div><div style="font-size:8px;color:#7ee08a;margin-top:3px;">${progress}</div></div><div class="mail-reward">${ev.reward}</div><button class="btn ${ev.claimed ? 'ghost' : (claimable ? 'primary' : 'ghost')}" style="min-width:70px;padding:6px 10px;font-size:9px;" ${ev.claimed || !claimable ? 'disabled' : ''}>${ev.claimed ? 'CLAIMED' : (claimable ? 'CLAIM' : 'LOCKED')}</button>`;
    const btn = row.querySelector('button');
    if (!ev.claimed && claimable) {
      btn.addEventListener('click', () => {
        ev.claimed = true;
        panelData.coins += 100;
        savePanelData();
        refreshCoins();
        populateEvents();
        audio.click();
        hud.toast('EVENT REWARD CLAIMED', 'good');
      });
    }
    list.appendChild(row);
  });
  if (panelData.events.length === 0) {
    list.innerHTML = '<div class="panel-note" style="margin-top:20px;">No active events.</div>';
  }
  document.getElementById('eventsCount').textContent = panelData.events.filter((e) => e.active !== false).length + ' ACTIVE';
}

// ---- CLAN ----
function populateClan() {
  const body = document.getElementById('clanBody');
  body.innerHTML = '';
  if (!panelData.clan) {
    body.innerHTML = `
      <div class="clan-info"><b>NO CLAN</b><span>Create or join a clan to play together.</span></div>
      <div class="clan-row">
        <input id="clanNameInput" class="login-input" placeholder="CLAN NAME" maxlength="16" />
        <button id="clanCreateBtn" class="btn primary" style="min-width:90px;padding:10px 16px;">CREATE</button>
      </div>
      <div class="clan-row">
        <input id="clanJoinInput" class="login-input" placeholder="CLAN CODE" maxlength="8" />
        <button id="clanJoinBtn" class="btn ghost" style="min-width:90px;padding:10px 16px;">JOIN</button>
      </div>
    `;
    const createBtn = document.getElementById('clanCreateBtn');
    const joinBtn = document.getElementById('clanJoinBtn');
    if (createBtn) createBtn.addEventListener('click', () => {
      const name = document.getElementById('clanNameInput').value.trim();
      if (!name) { hud.toast('ENTER A CLAN NAME', 'warn'); return; }
      panelData.clan = { name, code: Math.random().toString(36).slice(2, 8).toUpperCase(), members: 1, level: 1 };
      savePanelData();
      populateClan();
      audio.click();
      hud.toast('CLAN CREATED: ' + name, 'good');
    });
    if (joinBtn) joinBtn.addEventListener('click', () => {
      const code = document.getElementById('clanJoinInput').value.trim();
      if (!code) { hud.toast('ENTER A CLAN CODE', 'warn'); return; }
      panelData.clan = { name: 'CLAN ' + code, code, members: Math.floor(Math.random() * 20) + 5, level: Math.floor(Math.random() * 5) + 1 };
      savePanelData();
      populateClan();
      audio.click();
      hud.toast('JOINED CLAN', 'good');
    });
    document.getElementById('clanName').textContent = 'NO CLAN';
    document.getElementById('clanMembers').textContent = '0 MEMBERS';
  } else {
    const c = panelData.clan;
    body.innerHTML = `
      <div class="clan-info"><b>${c.name}</b><span>Code: ${c.code} · Level ${c.level}</span><span>${c.members} members</span></div>
      <button id="clanLeaveBtn" class="btn ghost" style="min-width:120px;padding:10px 16px;">LEAVE CLAN</button>
    `;
    const leaveBtn = document.getElementById('clanLeaveBtn');
    if (leaveBtn) leaveBtn.addEventListener('click', () => {
      panelData.clan = null;
      savePanelData();
      populateClan();
      audio.click();
      hud.toast('LEFT CLAN', 'warn');
    });
    document.getElementById('clanName').textContent = c.name;
    document.getElementById('clanMembers').textContent = c.members + ' MEMBERS';
  }
}

// ---- VAULT ----
function populateVault() {
  const grid = document.getElementById('vaultGrid');
  grid.innerHTML = '';
  if (panelData.vault.length === 0) {
    grid.innerHTML = '<div class="panel-note" style="margin-top:20px;">Vault is empty. Buy items from the Shop.</div>';
  }
  panelData.vault.forEach((id) => {
    const item = panelData.shopItems.find((s) => s.id === id);
    const name = item ? item.name : id.toUpperCase();
    const card = document.createElement('div');
    card.className = 'vault-item';
    card.innerHTML = `<div style="width:36px;height:36px;background:linear-gradient(135deg,#ffb648,#ff5c8a);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%);"></div><div class="vault-name">${name}</div>`;
    grid.appendChild(card);
  });
  document.getElementById('vaultCount').textContent = panelData.vault.length + ' ITEMS';
}

// ---- COLLECTION ----
function checkAchievements() {
  const s = panelData.stats;
  const c = panelData.collection;
  if (c[0]) c[0].done = s.kills >= 1;
  if (c[1]) c[1].done = s.surviveSec >= 300;
  if (c[2]) c[2].done = s.headshots >= 5;
  if (c[3]) c[3].done = s.wins >= 1;
  if (c[4]) c[4].done = s.matches >= 10;
  if (c[5]) c[5].done = panelData.vault.length >= 5;
  savePanelData();
}
function populateCollection() {
  checkAchievements();
  const list = document.getElementById('collectionList');
  list.innerHTML = '';
  panelData.collection.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'collection-item';
    row.style.opacity = c.done ? '1' : '0.45';
    row.innerHTML = `<div style="flex:1"><div class="coll-name">${c.name}</div><div class="coll-desc">${c.desc}</div></div><div style="font-size:14px;">${c.done ? '✓' : '○'}</div>`;
    list.appendChild(row);
  });
  document.getElementById('collectionCount').textContent = panelData.collection.filter((c) => c.done).length + ' / ' + panelData.collection.length + ' DONE';
}

// ---- RANK LEADERBOARD ----
function populateRank() {
  const list = document.getElementById('rankList');
  list.innerHTML = '<div class="panel-note" style="margin-top:20px;">Loading leaderboard...</div>';
  loadLeaderboard(10).then((players) => {
    list.innerHTML = '';
    if (players.length === 0) {
      // fallback to simulated
      players.push({ name: getProfile().username || 'PLAYER', rp: rankState.rp, level: profileState.level });
    }
    // ensure current player is in list
    const me = getProfile().username || 'PLAYER';
    if (!players.some((p) => p.name === me)) {
      players.push({ name: me, rp: rankState.rp, level: profileState.level });
      players.sort((a, b) => b.rp - a.rp);
    }
    players.slice(0, 10).forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'rank-item';
      row.innerHTML = `<div class="rank-pos">#${i + 1}</div><div class="rank-player">${p.name} (LV.${p.level})</div><div class="rank-rp">${p.rp} RP</div>`;
      list.appendChild(row);
    });
    document.getElementById('rankCount').textContent = players.length + ' PLAYERS';
    document.getElementById('rankPlayer').textContent = 'YOUR RANK: ' + rankFor(rankState.rp) + ' (' + rankState.rp + ' RP)';
  });
}

// ---- LUCK ROYALE ----
function populateLuck() {
  document.getElementById('luckCoins').textContent = panelData.coins;
  document.getElementById('luckCoinsFoot').textContent = panelData.coins;
  document.getElementById('luckPrize').textContent = panelData.luckResult || 'SPIN TO WIN!';
}
const luckSpinBtn = document.getElementById('luckSpin');
if (luckSpinBtn) {
  luckSpinBtn.addEventListener('click', () => {
    if (panelData.coins < 100) { hud.toast('NOT ENOUGH COINS', 'warn'); return; }
    panelData.coins -= 100;
    const prizes = ['100 COINS', '50 COINS', 'WEAPON SKIN', '200 COINS', 'EMOTE', 'JACKPOT 1000 COINS', 'TRY AGAIN'];
    const prize = prizes[Math.floor(Math.random() * prizes.length)];
    if (prize === 'JACKPOT 1000 COINS') panelData.coins += 1000;
    else if (prize === '200 COINS') panelData.coins += 200;
    else if (prize === '100 COINS') panelData.coins += 100;
    else if (prize === '50 COINS') panelData.coins += 50;
    panelData.luckResult = prize;
    savePanelData();
    refreshCoins();
    document.getElementById('luckPrize').textContent = prize;
    document.getElementById('luckCoins').textContent = panelData.coins;
    document.getElementById('luckCoinsFoot').textContent = panelData.coins;
    audio.click();
    hud.toast('SPIN RESULT: ' + prize, 'good');
  });
}

// ---- panel populate registry ----
const panelPopulate = {
  stats: populateStats,
  mail: populateMail,
  friends: populateFriends,
  shop: populateShop,
  events: populateEvents,
  clan: populateClan,
  vault: populateVault,
  collection: populateCollection,
  rank: populateRank,
  luck: populateLuck,
  invite: () => {},
};

// ---- wire friends add ----
const friendAddBtn = document.getElementById('friendAddBtn');
if (friendAddBtn) {
  friendAddBtn.addEventListener('click', async () => {
    const input = document.getElementById('friendInput');
    const name = (input.value || '').trim();
    if (!name) { hud.toast('ENTER A USERNAME', 'warn'); return; }
    if (panelData.friends.includes(name)) { hud.toast('ALREADY A FRIEND', 'warn'); return; }
    // verify the player exists on Firebase
    const found = await lookupPlayerByUsername(name);
    if (found === null) {
      // offline or not found — allow adding anyway (offline fallback)
      hud.toast('PLAYER NOT FOUND ONLINE — ADDED LOCALLY', 'warn');
    } else {
      hud.toast('PLAYER FOUND: ' + found.username + (found.online ? ' (ONLINE)' : ''), 'good');
    }
    panelData.friends.push(name);
    savePanelData();
    populateFriends();
    input.value = '';
    audio.click();
  });
}

// ---- wire mail claim all ----
const mailClaimAll = document.getElementById('mailClaimAll');
if (mailClaimAll) {
  mailClaimAll.addEventListener('click', () => {
    let claimed = 0;
    panelData.mail.forEach((m) => { if (!m.claimed) { m.claimed = true; panelData.coins += 50; claimed++; } });
    if (claimed > 0) { savePanelData(); refreshCoins(); populateMail(); audio.click(); hud.toast('CLAIMED ' + claimed + ' REWARDS', 'good'); }
    else hud.toast('NO UNCLAIMED MAIL', 'warn');
  });
}

// ---- update stats on match end ----
const _origEnd = Match ? null : null;

// hook into match end via main.js onEnd (already wired) — add stats update
const _origOnEndHandler = null;

// ---- lobby chat (simple) ----
const lobbyChat = document.querySelector('.lobby-chat .chat-txt');
if (lobbyChat) {
  const chatMessages = ['[World] MCXD | ABLOX: Team it', '[World] NOVA | anyone squad?', '[World] GHOST | drop at peak', '[World] TITAN | glhf'];
  let chatIdx = 0;
  setInterval(() => {
    chatIdx = (chatIdx + 1) % chatMessages.length;
    lobbyChat.textContent = chatMessages[chatIdx];
  }, 8000);
}

// ---- update stats after match (hook) ----
// We'll patch startMatch's onEnd to also update panel stats
const _startMatchOrig = startMatch;
// (startMatch is a function declaration, hoisted — reassign not possible; instead hook via global)
window.__updateStatsAfterMatch = (stats) => {
  const s = panelData.stats;
  s.matches += 1;
  if (stats.kills) s.kills += stats.kills;
  if (stats.headshots) s.headshots += stats.headshots;
  if (stats.damage) s.damage += stats.damage;
  if (stats.kills > (s.bestKills || 0)) s.bestKills = stats.kills;
  if (stats.placement && (s.bestPlacement === 99 || stats.placement < s.bestPlacement)) s.bestPlacement = stats.placement;
  if (stats.placement === 1) s.wins += 1;
  // --- match history: keep last 12 matches ------------------------------
  const histEntry = {
    date: Date.now(),
    kills: stats.kills || 0,
    placement: stats.placement || 99,
    win: (stats.placement === 1),
    damage: Math.round(stats.damage || 0),
    charId: selected || 'swat',
  };
  panelData.history = panelData.history || [];
  panelData.history.unshift(histEntry);
  if (panelData.history.length > 12) panelData.history.length = 12;

  if (stats.time) {
    const parts = stats.time.split(':');
    s.surviveSec += (parseInt(parts[0] || '0', 10) * 60) + parseInt(parts[1] || '0', 10);
  }
  savePanelData();
  checkAchievements();
  generateMailRewards();
};

// ---------------------------------------------------------- settings screen
const settingsScreen = $('#settingsScreen');
const settingsBtn = $('#settingsBtn');
const settingsContent = settingsScreen.querySelector('.set-content');
const settingsTabs = [...settingsScreen.querySelectorAll('.set-tab')];
const settingsPanels = [...settingsScreen.querySelectorAll('.set-panel')];
const qualityCards = [...settingsScreen.querySelectorAll('.quality-card')];

const QUALITY_FACTORS = { smooth: 0.6, standard: 0.8, hd: 1, ultra: 1.25 };

function applyDisplayQuality() {
  const factor = QUALITY_FACTORS[settings.display.quality] || 1;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const ratio = Math.min(2, dpr * factor);
  renderer.setPixelRatio(ratio);
  pRenderer.setPixelRatio(ratio);
  resizePreview();
}

function applyAudioSettings() {
  audio.setVolume((settings.audio.sfx / 100) * 0.9);
}

function updateRangeUI(el) {
  const value = Number(el.value);
  const min = Number(el.min) || 0;
  const max = Number(el.max) || 100;
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--fill', `${pct}%`);
  const num = el.closest('.set-row')?.querySelector('.set-num');
  if (num) num.textContent = value;
}

function syncQualityUI() {
  qualityCards.forEach((card) => {
    const active = card.dataset.quality === settings.display.quality;
    card.classList.toggle('selected', active);
    card.setAttribute('aria-pressed', String(active));
  });
}

function syncSettingsUI() {
  settingsScreen.querySelectorAll('input[type="range"][data-set]').forEach((el) => {
    const [group, key] = el.dataset.set.split('.');
    const value = Number(settings[group]?.[key]);
    el.value = clamp(Number.isFinite(value) ? value : 0, Number(el.min), Number(el.max));
    updateRangeUI(el);
  });
  settingsScreen.querySelectorAll('select[data-set]').forEach((el) => {
    const [group, key] = el.dataset.set.split('.');
    const value = String(settings[group]?.[key]);
    if ([...el.options].some((o) => o.value === value)) el.value = value;
  });
  syncQualityUI();
}

function setSetting(path, value) {
  const [group, key] = path.split('.');
  if (!settings[group]) return;
  settings[group][key] = value;
  saveSettings();
}

function showSettingsTab(name) {
  if (!settingsPanels.some((p) => p.dataset.panel === name)) return;
  activeSettingsTab = name;
  settingsTabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
  settingsPanels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
  settingsContent.scrollTop = 0;
}

function openSettings() {
  if (!loaded) return;
  audio.init();
  applyAudioSettings();
  audio.click();
  settingsScreen.classList.remove('hidden');
  syncSettingsUI();
  showSettingsTab(activeSettingsTab);
}

function closeSettings() {
  settingsScreen.classList.add('hidden');
}

settingsBtn.addEventListener('click', openSettings);
$('#setClose').addEventListener('click', closeSettings);
$('#setExit').addEventListener('click', closeSettings);

settingsTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    audio.init();
    audio.click();
    showSettingsTab(tab.dataset.tab);
  });
});

settingsScreen.querySelectorAll('input[type="range"][data-set]').forEach((el) => {
  el.addEventListener('input', () => {
    setSetting(el.dataset.set, Number(el.value));
    updateRangeUI(el);
    if (el.dataset.set.startsWith('audio.')) applyAudioSettings();
  });
});

settingsScreen.querySelectorAll('select[data-set]').forEach((el) => {
  el.addEventListener('change', () => {
    setSetting(el.dataset.set, el.value);
    audio.init();
    audio.click();
  });
});

qualityCards.forEach((card) => {
  card.addEventListener('click', () => {
    audio.init();
    audio.click();
    settings.display.quality = card.dataset.quality;
    saveSettings();
    syncQualityUI();
    applyDisplayQuality();
  });
});

$('#setReset').addEventListener('click', () => {
  audio.init();
  audio.click();
  for (const group of Object.keys(DEFAULT_SETTINGS)) {
    settings[group] = { ...DEFAULT_SETTINGS[group] };
  }
  saveSettings();
  syncSettingsUI();
  applyDisplayQuality();
  applyAudioSettings();
});

syncSettingsUI();

const tabClassic = $('#tabClassic');
const tabRanked = $('#tabRanked');
if (tabClassic) tabClassic.addEventListener('click', () => {
  if (!loaded) return;
  audio.init(); audio.click();
  rankedMode = false;
  refreshModeTabs();
});
if (tabRanked) tabRanked.addEventListener('click', () => {
  if (!loaded) return;
  audio.init(); audio.click();
  rankedMode = true;
  refreshModeTabs();
});
refreshModeTabs();
refreshRankUI();

// --------------------------------------------------------------- input
window.addEventListener('keydown', (e) => {
  const uiOpen =
    !titleScreen.classList.contains('hidden') ||
    !settingsScreen.classList.contains('hidden') ||
    !charModal.classList.contains('hidden') ||
    !wpnModal.classList.contains('hidden');

  if (!uiOpen && ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();

  if (!titleScreen.classList.contains('hidden')) {
    if (e.code === 'Enter' || e.code === 'Space') enterLobby();
    return;
  }

  if (!uiOpen) keys.add(e.code);

  if (!settingsScreen.classList.contains('hidden')) {
    if (e.code === 'Escape') { closeSettings(); return; }
    if (e.code === 'Enter' || e.code === 'Space') return;
  }

  if (!wpnModal.classList.contains('hidden')) {
    if (e.code === 'Escape') { closeWpnModal(); return; }
    if (e.code === 'Enter') { wpnEquip.click(); return; }
  }

  if (!charModal.classList.contains('hidden')) {
    if (e.code === 'Escape') { closeCharModal(); return; }
    if (e.code === 'Enter') { charEquip.click(); return; }
  }
  if (mode === 'menu' && e.code === 'Enter' && loaded) startMatchmaking();
  if (mode !== 'playing' || !match) return;

  if (e.code === 'Digit1') match.equip(0);
  if (e.code === 'Digit2') match.equip(1);
  if (e.code === 'KeyR') match.startReload();
  if (e.code === 'KeyE') match.pickup();
  if (e.code === 'KeyF') match.useAbility();
  if (e.code === 'KeyG') match.placeGloo(controls);
  if (e.code === 'KeyV') match.useEmote(match.equippedEmote);
  if (e.code === 'KeyC') controls.crouch = !controls.crouch;
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => {
  keys.clear();
  controls.firing = false;
});

document.addEventListener('mousedown', (e) => {
  if (mode !== 'playing' || !match || match.over) return;
  if (!pointerLocked && !touchMode) return;
  if (e.button === 0) {
    controls.firing = true;
    controls.pendingShot = true;
  }
  if (e.button === 2) { aiming = true; controls.aiming = true; }
});
document.addEventListener('mouseup', (e) => {
  if (e.button === 0) controls.firing = false;
  if (e.button === 2) { aiming = false; controls.aiming = false; }
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

let mouseSens = 0.0022;
function lookSensitivity() {
  const general = 0.4 + (settings.sens.general / 100) * 1.2;
  let ads = 1;
  if (aiming) {
    let scope = settings.sens.scope4x;
    const slot = match?.player ? match.player.slots[match.player.slotIndex] : null;
    const weapon = slot ? slot.id : 'pistol';
    if (weapon === 'sniper') scope = settings.sens.sniper;
    else if (weapon === 'rifle') scope = settings.sens.scope4x;
    else if (weapon === 'smg') scope = settings.sens.scope2x;
    else scope = settings.sens.redDot;
    ads = 0.25 + (scope / 100) * 0.6;
  }
  return mouseSens * general * ads;
}
document.addEventListener('mousemove', (e) => {
  if (!pointerLocked || mode !== 'playing') return;
  const s = lookSensitivity();
  yaw -= e.movementX * s;
  pitch = clamp(pitch - e.movementY * s, -1.15, 1.15);
});

canvas.addEventListener('click', () => {
  if (mode === 'playing' && !touchMode && !match?.over) requestLock();
});

function requestLock() {
  if (touchMode) return;
  try {
    const p = canvas.requestPointerLock();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (err) { /* ignore */ }
}

document.addEventListener('pointerlockchange', () => {
  const nowLocked = document.pointerLockElement === canvas;
  if (nowLocked) {
    pointerLocked = true;
    paused = false;
    $('#pause').classList.add('hidden');
  } else if (pointerLocked) {
    pointerLocked = false;
    if (mode === 'playing' && match && !match.over && !touchMode) {
      paused = true;
      $('#pause').classList.remove('hidden');
    }
  }
});

$('#pause').addEventListener('click', () => requestLock());

// -------------------------------------------------------------- touch UI
const stickBase = $('#stickBase');
const stickKnob = $('#stickKnob');
let moveTouchId = null;
let moveOrigin = { x: 0, y: 0 };
let lookTouchId = null;
let lookLast = { x: 0, y: 0 };

canvas.addEventListener('pointerdown', (e) => {
  if (!touchMode || mode !== 'playing' || !match || match.over) return;
  if (e.pointerType === 'mouse') return;
  if (e.clientX < window.innerWidth * 0.46) {
    moveTouchId = e.pointerId;
    moveOrigin = { x: e.clientX, y: e.clientY };
    if (stickBase) {
      stickBase.style.left = `${e.clientX}px`;
      stickBase.style.top = `${e.clientY}px`;
      stickBase.style.opacity = '1';
    }
  } else {
    lookTouchId = e.pointerId;
    lookLast = { x: e.clientX, y: e.clientY };
  }
});

window.addEventListener('pointermove', (e) => {
  if (e.pointerId === moveTouchId) {
    const dx = clamp((e.clientX - moveOrigin.x) / 58, -1, 1);
    const dy = clamp((e.clientY - moveOrigin.y) / 58, -1, 1);
    controls.move.x = dx;
    controls.move.y = -dy;
    controls.sprint = Math.hypot(dx, dy) > 0.92;
    if (stickKnob) stickKnob.style.transform = `translate(${dx * 34}px, ${dy * 34}px)`;
  }
  if (e.pointerId === lookTouchId) {
    const dx = e.clientX - lookLast.x;
    const dy = e.clientY - lookLast.y;
    lookLast = { x: e.clientX, y: e.clientY };
    const touchLook = 0.0042 * (0.4 + (settings.sens.general / 100) * 1.2);
    yaw -= dx * touchLook;
    pitch = clamp(pitch - dy * touchLook, -1.15, 1.15);
  }
});

function endTouch(e) {
  if (e.pointerId === moveTouchId) {
    moveTouchId = null;
    controls.move.x = 0;
    controls.move.y = 0;
    controls.sprint = false;
    if (stickBase) stickBase.style.opacity = '0.35';
    if (stickKnob) stickKnob.style.transform = 'translate(0px,0px)';
  }
  if (e.pointerId === lookTouchId) lookTouchId = null;
}
window.addEventListener('pointerup', endTouch);
window.addEventListener('pointercancel', endTouch);

document.querySelectorAll('.tbtn').forEach((btn) => {
  const action = btn.dataset.action;
  const down = (e) => {
    e.preventDefault();
    if (mode !== 'playing' || !match || match.over) return;
    btn.classList.add('active');
    if (action === 'fire') { controls.firing = true; controls.pendingShot = true; }
    if (action === 'aim') {
      aiming = !aiming;
      controls.aiming = aiming;
      btn.classList.toggle('active', aiming);
    }
    if (action === 'reload') match.startReload();
    if (action === 'pickup') match.pickup();
    if (action === 'jump') controls.jump = true;
    if (action === 'ability') match.useAbility();
    if (action === 'gloo') match.placeGloo(controls);
    if (action === 'emote') match.useEmote(match.equippedEmote);
  };
  const up = (e) => {
    e.preventDefault();
    btn.classList.remove('active');
    if (action === 'fire') controls.firing = false;
    if (action === 'jump') controls.jump = false;
  };
  btn.addEventListener('pointerdown', down);
  btn.addEventListener('pointerup', up);
  btn.addEventListener('pointercancel', up);
  btn.addEventListener('pointerleave', up);
});

// ---------------------------------------------------------- menu camera
function updateMenuCamera(t) {
  const a = t * 0.055 + 1.2;
  const r = 118 * MAP_SCALE;
  camera.position.set(
    Math.cos(a) * r,
    (34 + Math.sin(t * 0.2) * 4) * MAP_SCALE,
    Math.sin(a) * r
  );
  camera.lookAt(0, 3 * MAP_SCALE, 0);
}

// ---------------------------------------------------------- start match
playBtn.addEventListener('click', () => {
  if (loaded) startMatchmaking();
});

// ------------------------------------------------- end-of-match cleanup
function cleanupMatch() {
  if (endReturnTimer) { clearInterval(endReturnTimer); endReturnTimer = null; }
  if (document.pointerLockElement) document.exitPointerLock();
  paused = false;
  aiming = false;
  controls.aiming = false;
  controls.firing = false;
  controls.pendingShot = false;
  controls.move.x = 0;
  controls.move.y = 0;
  controls.sprint = false;
  controls.jump = false;
  $('#pause').classList.add('hidden');

  // remove remote (colyseus) combatants from the scene
  for (const [, entry] of remoteFighters) {
    if (entry.fighter && entry.fighter.root) scene.remove(entry.fighter.root);
    if (entry.fighter && entry.fighter.gun) scene.remove(entry.fighter.gun);
  }
  remoteFighters.clear();
  if (gameRoom) { try { gameRoom.leave(); } catch (e) { /* already left */ } gameRoom = null; }

  // tear down the whole simulated match (fighters, loot, airdrops, walls)
  if (match) {
    try { match.dispose(); } catch (e) { console.error('match cleanup failed', e); }
    match = null;
  }

  mode = 'menu';
  document.body.classList.remove('in-match', 'over', 'scoped');
  $('#hud').classList.add('hidden');
  $('#endScreen').classList.add('hidden');
  hud.reset();
}

function returnToMenu() {
  audio.init();
  audio.click();
  cleanupMatch();
  $('#menu').classList.remove('hidden');
}

// restartBtn removed — only MAIN MENU returns to the lobby now

$('#menuBtn').addEventListener('click', returnToMenu);

async function startMatchmaking() {
  if (mmActive) return;
  mmActive = true;
  mode = 'matchmaking';
  $('#matchmaking').classList.remove('hidden');
  $('#mmStatus').textContent = 'CONNECTING...';
  $('#mmTimer').textContent = '20';
  $('#mmPlayers').innerHTML = '';

  try {
    if (!colyseusClient) colyseusClient = new window.Colyseus.Client(SERVER_URL);
    const profile = getProfile();
    gameRoom = await colyseusClient.joinOrCreate('game', { name: profile.username || 'PLAYER' });
  } catch (err) {
    console.error('matchmaking connect failed', err);
    $('#mmStatus').textContent = 'CONNECTION FAILED — PLAYING OFFLINE';
    setTimeout(() => {
      $('#matchmaking').classList.add('hidden');
      mmActive = false;
      mode = 'menu';
      startMatch();
    }, 1500);
    return;
  }

  $('#mmStatus').textContent = 'SEARCHING FOR PLAYERS...';

  gameRoom.onMessage('damage', (msg) => {
    if (!match) return;
    if (msg.targetId === gameRoom.sessionId) {
      const res = match.player.applyDamage(msg.amount || 0);
      match.player.hitFlash = 1;
      if (res.died && match.player.alive) match.killFighter(match.player, null);
    } else {
      const entry = remoteFighters.get(msg.targetId);
      if (entry && entry.fighter.alive) {
        const res = entry.fighter.applyDamage(msg.amount || 0);
        if (res.died) {
          // find killer fighter by session id for kill feed
          let killerFighter = null;
          const killerId = msg.killer;
          if (killerId === gameRoom.sessionId) killerFighter = match.player;
          else {
            const kEntry = remoteFighters.get(killerId);
            if (kEntry) killerFighter = kEntry.fighter;
          }
          match.killFighter(entry.fighter, killerFighter);
        }
      }
    }
  });

  gameRoom.onStateChange((state) => {
    // update player list during matchmaking
    if (mode === 'matchmaking') {
      const names = [];
      state.players.forEach((p, id) => { names.push(p.name + (p.isBot ? ' (BOT)' : '')); });
      const pl = $('#mmPlayers');
      if (pl) pl.innerHTML = names.map(n => '<div>' + n + '</div>').join('');
      const tm = $('#mmTimer');
      if (tm) tm.textContent = state.timeLeft > 0 ? state.timeLeft : (state.phase === 'playing' ? 'GO' : state.timeLeft);
    }
    if (state.phase === 'playing' && !startedFromMm) {
      startedFromMm = true;
      beginMultiplayerMatch();
    }
    if (mode === 'playing' && match) syncRemotePlayers(state);
  });

  gameRoom.onMessage('shot', () => { /* remote tracer handled server-side */ });
  gameRoom.onMessage('emote', (msg) => {
    if (!msg || !match) return;
    const id = msg.id || 'wave';
    const shooterId = msg.shooter;
    if (!shooterId) return;
    // local Fighter
    if (shooterId === gameRoom.sessionId) { match.player.playEmote(id); return; }
    const entry = remoteFighters.get(shooterId);
    if (entry && entry.fighter) entry.fighter.playEmote(id);
  });
  gameRoom.onMessage('matchStart', (msg) => {
    if (!startedFromMm) { startedFromMm = true; beginMultiplayerMatch(); }
  });

  $('#mmCancel').onclick = () => {
    if (gameRoom) { gameRoom.leave(); gameRoom = null; }
    $('#matchmaking').classList.add('hidden');
    mmActive = false;
    mode = 'menu';
  };
}

let startedFromMm = false;

function beginMultiplayerMatch() {
  $('#matchmaking').classList.add('hidden');
  mmActive = false;
  startedFromMm = false;
  startMatch();
  // keep room reference for sync
}

function syncRemotePlayers(state) {
  if (!state || !match || !gameRoom) return;
  const seen = new Set();
  const myId = gameRoom && gameRoom.sessionId ? gameRoom.sessionId : null;
  state.players.forEach((p, id) => {
    if (id === myId || p.isBot) return;
    seen.add(id);
    let entry = remoteFighters.get(id);
    if (!entry) {
      const f = new Fighter({
        charId: p.charId || selected,
        name: p.name || 'REMOTE',
        scene,
        charColor: '#ff5a5a',
      });
      f.isRemote = true;
      f.sessionId = id;
      f.place(p.x || 0, p.z || 0);
      f.yaw = p.yaw || 0;
      f.health = p.health ?? 100;
      f.alive = p.alive !== false;
      if (!f.alive) f.die();
      scene.add(f.root);
      match.fighters.push(f);
      if (f.alive) match.alive += 1;
      entry = { fighter: f, lastX: p.x || 0, lastZ: p.z || 0, lastT: performance.now() };
      remoteFighters.set(id, entry);
    } else {
      const f = entry.fighter;
      const now = performance.now();
      const dt = Math.max(0.001, (now - entry.lastT) / 1000);
      f.moveSpeed = Math.hypot((p.x || 0) - entry.lastX, (p.z || 0) - entry.lastZ) / dt;
      f.pos.x = p.x || f.pos.x;
      f.pos.z = p.z || f.pos.z;
      f.yaw = (typeof p.yaw === 'number') ? p.yaw : f.yaw;
      if (typeof p.health === 'number') f.health = p.health;
      if (p.alive === false && f.alive) match.killFighter(f, null);
      else if (p.alive === true && !f.alive) { f.alive = true; f.health = p.health ?? 100; }
      entry.lastX = p.x || entry.lastX;
      entry.lastZ = p.z || entry.lastZ;
      entry.lastT = now;
    }
  });
  // remove players that left
  for (const [id, entry] of remoteFighters) {
    if (seen.has(id)) continue;
    scene.remove(entry.fighter.root);
    if (entry.fighter.alive) match.alive = Math.max(1, match.alive - 1);
    const idx = match.fighters.indexOf(entry.fighter);
    if (idx >= 0) match.fighters.splice(idx, 1);
    remoteFighters.delete(id);
  }
}

function startMatch() {
  if (!loaded || mode === 'playing') return;
  audio.init();
  audio.click();

  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  document.body.classList.add('in-match');
  document.body.classList.remove('over');
  hud.reset();
  $('#levelVal').textContent = profileState.level;
  hud.el.end.classList.add('hidden');
  $('#pause').classList.add('hidden');

  yaw = Math.random() * Math.PI * 2;
  pitch = -0.04;
  aiming = false;
  controls.aiming = false;
  controls.firing = false;
  controls.pendingShot = false;

  effects.clear();
  const humanCount = gameRoom && gameRoom.state && gameRoom.state.players
    ? Array.from(gameRoom.state.players.values()).filter((p) => !p.isBot).length
    : 1;
  match = new Match({
    scene, world, audio, effects, hud, camera,
    charId: selected,
    startWeapon: selectedWeapon,
    equippedEmote: panelData.equippedEmote || null,
    ranked: rankedMode,
    rankName: rankFor(rankState.rp),
    net: gameRoom,
    humanCount: Math.max(1, humanCount),
    onEnd: (win, stats = {}) => {
      mode = 'over';
      document.body.classList.add('over');
      paused = false;
      $('#pause').classList.add('hidden');
      if (document.pointerLockElement) document.exitPointerLock();
      if (rankedMode) {
        const beforeTier = rankFor(rankState.rp);
        rankState.rp += stats.rp || 0;
        rankState.games += 1;
        if (win) rankState.wins += 1;
        rankState.kills += stats.kills || 0;
        try { localStorage.setItem(RANK_KEY, JSON.stringify(rankState)); } catch (e) { /* storage unavailable */ }
        savePlayerData({ rank: rankState }).catch(() => { /* offline: kept in localStorage */ });
        const afterTier = rankFor(rankState.rp);
        refreshRankUI();
        if (tierIndex(afterTier) > tierIndex(beforeTier)) {
          setTimeout(() => hud.announce('RANK UP!', afterTier), 1400);
        }
      }

      // ---- update lobby stats (matches, kills, damage, etc.) ----
      if (window.__updateStatsAfterMatch) window.__updateStatsAfterMatch(stats);

      // ---- award coins for match completion ----
      if (stats.coins) {
        panelData.coins += stats.coins;
        savePanelData();
        refreshCoins();
      }
      const doubleXp = panelData.events && panelData.events.some((e) => e.id === 'e1' && e.active !== false);
      const xpGain = (stats.xpGain || 0) * (doubleXp ? 2 : 1);
      const oldLevel = profileState.level;
      profileState.xp += xpGain;
      while (profileState.xp >= xpToNext(profileState.level)) {
        profileState.xp -= xpToNext(profileState.level);
        profileState.level++;
      }
      stats.xpGain = xpGain;
      stats.level = profileState.level;
      if (profileState.level > oldLevel) stats.levelUp = true;
      saveProfileState();
      refreshProfileUI();
      if (profileState.level > oldLevel) {
        setTimeout(() => hud.announce('LEVEL UP!', `LV. ${profileState.level}`), 1600);
      }
      hud.showEnd(win, stats);

      // auto-return to lobby countdown (so the player is never stuck in the match)
      let secs = 6;
      const cdEl = document.getElementById('endCountdown');
      if (cdEl) cdEl.textContent = `Returning to lobby in ${secs}…`;
      if (endReturnTimer) clearInterval(endReturnTimer);
      endReturnTimer = setInterval(() => {
        secs -= 1;
        if (cdEl) cdEl.textContent = secs > 0 ? `Returning to lobby in ${secs}…` : 'Returning to lobby…';
        if (secs <= 0) {
          clearInterval(endReturnTimer);
          endReturnTimer = null;
          returnToMenu();
        }
      }, 1000);
    },
  });
  mode = 'playing';
  hud.toast('DROP IN — LAST ONE STANDING WINS', 'good');
  setTimeout(() => hud.toast('THE STORM CLOSES IN 60 SECONDS', 'warn'), 2400);

  requestLock();
  updateCamera(0.016);
  renderer.render(scene, camera);
}

// -------------------------------------------------------------- camera
const camTarget = new THREE.Vector3();
const camBack = new THREE.Vector3();
const camDir = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camRay = new THREE.Raycaster();

function updateCamera(dt) {
  if (!match) return;
  const p = match.player;
  const slot = p.slots[p.slotIndex];
  const def = WEAPONS[slot.id];

  const wantFov = aiming ? def.adsFov : 74;
  camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 12);
  camera.updateProjectionMatrix();

  pitch = clamp(pitch + match.pitchKick, -1.15, 1.15);
  match.pitchKick = 0;

  camera.rotation.set(pitch, yaw, 0);
  camDir.set(0, 0, -1).applyEuler(camera.rotation).normalize();

  const crouchY = (controls && controls.crouch && p.grounded) ? 0.35 : 0;
  camTarget.set(p.pos.x, p.pos.y + (p.grounded ? 1.18 - crouchY : 1.2), p.pos.z);
  camRight.set(Math.cos(yaw), 0, -Math.sin(yaw));
  camTarget.addScaledVector(camRight, aiming ? 0.5 : 0.62);

  camBack.copy(camDir).negate();
  let dist = aiming ? 2.0 : 3.6;

  camRay.set(camTarget, camBack);
  camRay.far = dist;
  const hits = camRay.intersectObjects(world.raycastTargets, false);
  if (hits.length) dist = Math.max(0.55, hits[0].distance - 0.32);

  for (let i = 1; i <= 8; i++) {
    const t = (dist * i) / 8;
    const qx = camTarget.x + camBack.x * t;
    const qy = camTarget.y + camBack.y * t;
    const qz = camTarget.z + camBack.z * t;
    if (qy < terrainHeight(qx, qz) + 0.4) {
      dist = (dist * (i - 1)) / 8;
      break;
    }
  }

  camera.position.copy(camTarget).addScaledVector(camBack, Math.max(0.5, dist));
  const floor = terrainHeight(camera.position.x, camera.position.z) + 0.35;
  if (camera.position.y < floor) camera.position.y = floor;

  if (match.shake > 0.01) {
    const s = match.shake * 0.075;
    camera.position.x += rand(-s, s);
    camera.position.y += rand(-s, s);
    camera.position.z += rand(-s, s);
  }

  camera.updateMatrixWorld(true);
  controls.aimDir.copy(camDir);
  controls.yaw = yaw;
  controls.pitch = pitch;
  match.cameraYaw = yaw;
  document.body.classList.toggle('scoped', aiming && slot.id === 'sniper');
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let previewTime = 0;

function animate(now) {
  window.__frame = (window.__frame || 0) + 1;
  requestAnimationFrame(animate);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (mode === 'menu') {
    if (pMixer) pMixer.update(dt);
    if (pModel) {
      previewTime += dt;
      pRoot.position.y = Math.sin(previewTime * 1.6) * 0.008;
    }
    glowRing.material.opacity = 0.45 + Math.sin(now / 480) * 0.2;
    if (pCurrent) pRenderer.render(pScene, pCamera);
    if (!wpnModal.classList.contains('hidden')) {
      if (wModel) wRoot.rotation.y += dt * 0.7;
      wRenderer.render(wScene, wCamera);
    }
    return;
  }

  if (mode === 'playing' && !paused && match && !match.over) {
    match.update(dt, controls);
    updateCamera(dt);
    world.update(dt, match.player.pos);
    hud.update(dt, match, { aiming });
    effects.update(dt, camera);
    if (gameRoom && match.player) {
      gameRoom.send('input', { x: match.player.pos.x, y: match.player.pos.y, z: match.player.pos.z, yaw: match.player.yaw, pitch });
      window.DEBUG.inputSent = (window.DEBUG.inputSent || 0) + 1;
    }
  } else if (mode === 'over' && match) {
    effects.update(dt, camera);
    renderer.setClearColor(0x05080c, 1);
    renderer.clear();
  }

  renderer.render(scene, camera);
}

// -------------------------------------------------------------- resize
window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  resizePreview();
});

// ---------------------------------------------------------------- boot
initAuth();
syncArmoryFromCloud();
syncRankFromCloud();
syncProfileFromCloud();
refreshProfileUI();
applyDisplayQuality();
applyAudioSettings();
selectCharacter(selected);
resizePreview();
requestAnimationFrame(animate);

// debug / test hooks
window.DEBUG = {
  start(charId) {
    if (charId) { selected = charId; selectCharacter(charId); }
    startMatch();
  },
  get match() { return match; },
  get mode() { return mode; },
  get gameRoom() { return gameRoom; },
  get paused() { return paused; },
  set paused(v) { paused = !!v; },
  get settings() { return settings; },
  camera, scene, renderer, effects, hud, controls, audio,
  get world() { return world; },
  createCharacterModel, createGun,
  look(y, p) { yaw = y; pitch = p; },
  teleport(x, z) {
    if (!match) return;
    match.player.place(x, z);
  },
  load: () => loadAllCharacters(),
  openPanel,
  closePanel,
};
