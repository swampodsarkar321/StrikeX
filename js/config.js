// ------------------------------------------------------------------
//  ZONE ROYALE - configuration
// ------------------------------------------------------------------

export const ARENA_R = 560;
// The full map is playable. MAP_SPAN keeps the imported map at its
// original authored size (independent of ARENA_R) so buildings stay large
// and characters stay small.
export const MAP_SPAN = 1188;
// The Old Peak map is authored at a much bigger "real world" size than the
// arena. It is scaled up by this factor so buildings, trees etc. look
// correctly sized next to a 1.85 m tall character. The playable arena
// (ARENA_R) is unchanged - the rest of the island is scenery.
// Bigger value = buildings look bigger / character looks smaller.
export const MAP_SCALE = 5.5;
export const TARGET_HEIGHT = 1.35;
export const MAX_PLAYERS = 20;
export const CHARACTERS = [
  { id: 'swat',        name: 'SWAT',         file: 'Swat.glb',            color: '#3ea8ff', role: 'TACTICAL'  },
  { id: 'adventurer',  name: 'ADVENTURER',   file: 'Adventurer.glb',      color: '#f0b03c', role: 'SCOUT'     },
  { id: 'astronaut',   name: 'ASTRONAUT',    file: 'Astronaut.glb',       color: '#c9d6ff', role: 'EXPLORER'  },
  { id: 'beach',       name: 'BEACH',        file: 'Beach Character.glb', color: '#ff8f5e', role: 'DRIFTER'   },
  { id: 'business',    name: 'BUSINESS MAN', file: 'Business Man.glb',    color: '#8f9bb0', role: 'EXECUTIVE' },
  { id: 'casual',      name: 'CASUAL',       file: 'Casual Character.glb',color: '#7ad3a1', role: 'ROOKIE'    },
  { id: 'farmer',      name: 'FARMER',       file: 'Farmer.glb',          color: '#b7d36b', role: 'SURVIVOR'  },
  { id: 'hoodie',      name: 'HOODIE',       file: 'Hoodie Character.glb',color: '#9b8cff', role: 'GHOST'     },
  { id: 'king',        name: 'KING',         file: 'King.glb',            color: '#ffcf57', role: 'ROYAL'     },
  { id: 'punk',        name: 'PUNK',         file: 'Punk.glb',            color: '#ff5c8a', role: 'BRAWLER'   },
{ id: 'worker',      name: 'WORKER',       file: 'Worker.glb',          color: '#e0a35a', role: 'BUILDER'  },
];

export const BOT_NAMES = [
  'VIPER', 'GHOST', 'ROGUE', 'TITAN', 'NOVA',
  'BLAZE', 'ECHO', 'FROST', 'HAVOC', 'SLY',
  'REX', 'ZARA', 'ONYX', 'BOLT', 'WRAITH',
  'SABLE', 'JINX', 'KILO', 'MACE', 'NYX',
];

// ------------------------------------------------------------------
//  weapons
// ------------------------------------------------------------------
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'PISTOL', dmg: 26, rpm: 330, mag: 14, reserve: Infinity,
    spread: 0.010, pellets: 1, auto: false, reload: 1.05, range: 110,
    recoil: 0.010, adsFov: 58, color: 0x9aa3ad, sound: 'pistol',
    glb: './gun/Pistol.glb',
  },
  smg: {
    id: 'smg', name: 'MP5', dmg: 15, rpm: 900, mag: 30, reserve: 180,
    spread: 0.027, pellets: 1, auto: true, reload: 1.55, range: 72,
    recoil: 0.006, adsFov: 55, color: 0x4db8ff, sound: 'smg',
    glb: './gun/Submachine Gun.glb',
  },
  rifle: {
    id: 'rifle', name: 'SCAR', dmg: 23, rpm: 600, mag: 30, reserve: 150,
    spread: 0.016, pellets: 1, auto: true, reload: 1.75, range: 190,
    recoil: 0.009, adsFov: 52, color: 0xffb648, sound: 'rifle',
    glb: './gun/Assault Rifle.glb',
  },
  shotgun: {
    id: 'shotgun', name: 'SHOTGUN', dmg: 12, rpm: 78, mag: 7, reserve: 30,
    spread: 0.055, pellets: 8, auto: false, reload: 2.1, range: 45,
    recoil: 0.032, adsFov: 62, color: 0xff7a3c, sound: 'shotgun',
    glb: './gun/Shotgun.glb',
  },
  sniper: {
    id: 'sniper', name: 'AWM', dmg: 95, rpm: 42, mag: 5, reserve: 20,
    spread: 0.0012, pellets: 1, auto: false, reload: 2.5, range: 340,
    recoil: 0.05, adsFov: 24, color: 0xff5c8a, sound: 'sniper',
    glb: './gun/Sniper Rifle.glb',
  },
  assault2: {
    id: 'assault2', name: 'AR-QUAKE', dmg: 23, rpm: 640, mag: 30, reserve: 150,
    spread: 0.015, pellets: 1, auto: true, reload: 1.7, range: 190,
    recoil: 0.009, adsFov: 52, color: 0xffb648, sound: 'rifle',
    glb: './gun/Assault Rifle-Bgvuu4CUMV.glb',
  },
  assault3: {
    id: 'assault3', name: 'AR-RETRO', dmg: 24, rpm: 590, mag: 30, reserve: 150,
    spread: 0.017, pellets: 1, auto: true, reload: 1.8, range: 185,
    recoil: 0.010, adsFov: 52, color: 0xffa040, sound: 'rifle',
    glb: './gun/Assault Rifle-fpLucho45C.glb',
  },
  bullpup: {
    id: 'bullpup', name: 'BULLPUP', dmg: 21, rpm: 700, mag: 40, reserve: 160,
    spread: 0.014, pellets: 1, auto: true, reload: 1.6, range: 180,
    recoil: 0.008, adsFov: 50, color: 0x9fd0ff, sound: 'rifle',
    glb: './gun/Bullpup.glb',
  },
  smg3: {
    id: 'smg3', name: 'SMG-BLACK', dmg: 14, rpm: 920, mag: 28, reserve: 180,
    spread: 0.030, pellets: 1, auto: true, reload: 1.5, range: 70,
    recoil: 0.006, adsFov: 55, color: 0x4db8ff, sound: 'smg',
    glb: './gun/Submachine Gun-nsP3JukU73.glb',
  },
  pistol3: {
    id: 'pistol3', name: 'PISTOL-SILENT', dmg: 22, rpm: 380, mag: 12, reserve: Infinity,
    spread: 0.009, pellets: 1, auto: false, reload: 1.0, range: 100,
    recoil: 0.009, adsFov: 58, color: 0x9aa3ad, sound: 'pistol',
    glb: './gun/Pistol-52kQzphmeF.glb',
  },
  pistol4: {
    id: 'pistol4', name: 'PISTOL-LIGHT', dmg: 20, rpm: 400, mag: 12, reserve: Infinity,
    spread: 0.010, pellets: 1, auto: false, reload: 0.95, range: 95,
    recoil: 0.009, adsFov: 58, color: 0x9aa3ad, sound: 'pistol',
    glb: './gun/Pistol-J3i9KDQ3kt.glb',
  },
  pistol5: {
    id: 'pistol5', name: 'PISTOL-WOOD', dmg: 27, rpm: 320, mag: 13, reserve: Infinity,
    spread: 0.011, pellets: 1, auto: false, reload: 1.1, range: 110,
    recoil: 0.011, adsFov: 58, color: 0x9aa3ad, sound: 'pistol',
    glb: './gun/Pistol-Z7aOjJu583.glb',
  },
  revolver: {
    id: 'revolver', name: 'REVOLVER', dmg: 46, rpm: 170, mag: 6, reserve: 48,
    spread: 0.007, pellets: 1, auto: false, reload: 1.7, range: 95,
    recoil: 0.028, adsFov: 52, color: 0xc9a86a, sound: 'pistol',
    glb: './gun/Revolver.glb',
  },
  revolver2: {
    id: 'revolver2', name: 'REVOLVER-GREY', dmg: 48, rpm: 165, mag: 6, reserve: 42,
    spread: 0.007, pellets: 1, auto: false, reload: 1.8, range: 95,
    recoil: 0.030, adsFov: 52, color: 0xc9a86a, sound: 'pistol',
    glb: './gun/Revolver-9C26wSpMS0.glb',
  },
  revolver3: {
    id: 'revolver3', name: 'REVOLVER-STEEL', dmg: 42, rpm: 175, mag: 6, reserve: 48,
    spread: 0.006, pellets: 1, auto: false, reload: 1.7, range: 90,
    recoil: 0.027, adsFov: 52, color: 0xc9a86a, sound: 'pistol',
    glb: './gun/Revolver-XrnLUz6kQj.glb',
  },
  shotgun2: {
    id: 'shotgun2', name: 'SAWED-OFF', dmg: 13, rpm: 120, mag: 2, reserve: 20,
    spread: 0.070, pellets: 8, auto: false, reload: 1.6, range: 32,
    recoil: 0.040, adsFov: 62, color: 0xff7a3c, sound: 'shotgun',
    glb: './gun/Shotgun Sawed Off.glb',
  },
  shotgun3: {
    id: 'shotgun3', name: 'SHOTGUN-COMPACT', dmg: 12, rpm: 82, mag: 6, reserve: 30,
    spread: 0.058, pellets: 8, auto: false, reload: 1.9, range: 42,
    recoil: 0.034, adsFov: 62, color: 0xff7a3c, sound: 'shotgun',
    glb: './gun/Shotgun Short Stock.glb',
  },
  shotgun4: {
    id: 'shotgun4', name: 'SHOTGUN-3', dmg: 12, rpm: 78, mag: 7, reserve: 30,
    spread: 0.056, pellets: 8, auto: false, reload: 2.1, range: 45,
    recoil: 0.032, adsFov: 62, color: 0xff7a3c, sound: 'shotgun',
    glb: './gun/Shotgun-ZmPTnh7njL.glb',
  },
  sniper2: {
    id: 'sniper2', name: 'AWM-BLACK', dmg: 95, rpm: 42, mag: 5, reserve: 20,
    spread: 0.0012, pellets: 1, auto: false, reload: 2.5, range: 340,
    recoil: 0.05, adsFov: 24, color: 0xff5c8a, sound: 'sniper',
    glb: './gun/Sniper Rifle-ASOMZIErq3.glb',
  },
  sniper3: {
    id: 'sniper3', name: 'AWM-LIGHT', dmg: 90, rpm: 44, mag: 5, reserve: 20,
    spread: 0.0013, pellets: 1, auto: false, reload: 2.4, range: 335,
    recoil: 0.048, adsFov: 24, color: 0xff5c8a, sound: 'sniper',
    glb: './gun/Sniper Rifle-i65hEldsw6.glb',
  },
  sniper4: {
    id: 'sniper4', name: 'AWM-GREEN', dmg: 88, rpm: 44, mag: 5, reserve: 20,
    spread: 0.0013, pellets: 1, auto: false, reload: 2.4, range: 330,
    recoil: 0.046, adsFov: 24, color: 0xff5c8a, sound: 'sniper',
    glb: './gun/Sniper Rifle-TKaBjAEofL.glb',
  },
};

export const LOOT_WEAPONS = [
  'smg', 'rifle', 'shotgun', 'sniper',
  'assault2', 'assault3', 'bullpup',
  'smg3',
  'pistol3', 'pistol4', 'pistol5',
  'revolver', 'revolver2', 'revolver3',
  'shotgun2', 'shotgun3', 'shotgun4',
  'sniper2', 'sniper3', 'sniper4',
];

// ------------------------------------------------------------------
//  character abilities (Free Fire style, F key)
// ------------------------------------------------------------------
export const CHAR_ABILITIES = {
  swat:       { name: 'COLD BLOOD',      desc: 'Takes 45% less damage for 4s.',        cd: 22, dur: 4 },
  adventurer: { name: 'RUNNER',          desc: '+25% move speed for 5s.',              cd: 20, dur: 5 },
  astronaut:  { name: 'ZERO-G RELOAD',   desc: 'Reloads 60% faster for 5s.',           cd: 21, dur: 5 },
  beach:      { name: 'BEACH PARTY',     desc: '+25 HP and +40 EP instantly.',         cd: 24, dur: 0 },
  business:   { name: 'CUT-BOSS',        desc: 'Restores 15 HP on every elimination.', cd: 0,  dur: 0, passive: true },
  casual:     { name: 'LUCKY SHOT',      desc: 'Next 3 bullets deal double damage.',   cd: 24, dur: 0 },
  farmer:     { name: 'FIELD MEDIC',     desc: 'Restores 60 HP instantly.',            cd: 26, dur: 0 },
  hoodie:     { name: 'GHOST WALK',      desc: 'Invisible to enemies for 4.5s.',       cd: 26, dur: 4.5 },
  king:       { name: 'ROYAL DECREE',    desc: '+50% damage for 4s.',                  cd: 24, dur: 4 },
  punk:       { name: 'BRAWL MODE',      desc: '+25% speed & fire rate for 4s.',       cd: 22, dur: 4 },
  worker:     { name: 'HARD HAT',        desc: 'Gains 75 shield instantly.',           cd: 22, dur: 0 },
};

export const EP_MAX = 200;
export const GLOO_START = 3;
export const GLOO_HP = 600;
export const GLOO_TTL = 25;

// ------------------------------------------------------------------
//  emotes
// ------------------------------------------------------------------
export const EMOTES = [
  { id: 'wave',    name: 'WAVE',      price: 300, anim: 'wave' },
  { id: 'dance',   name: 'DANCE',     price: 500, anim: 'dance' },
  { id: 'taunt',   name: 'TAUNT',     price: 400, anim: 'taunt' },
  { id: 'salute',  name: 'SALUTE',    price: 350, anim: 'salute' },
  { id: 'laugh',   name: 'LAUGH',     price: 450, anim: 'laugh' },
  { id: 'point',   name: 'POINT',     price: 250, anim: 'point' },
  { id: 'clap',    name: 'CLAP',      price: 300, anim: 'clap' },
  { id: 'hype',    name: 'HYPE',      price: 600, anim: 'hype' },
];

export const COIN_REWARD_BASE = 500;
export const COIN_PLACEMENT = { 1: 1000, 2: 800, 3: 800 };  // #1: 1000, #2-3: 800, others: 500 base
export const AIRDROP_LOOT = ['sniper2', 'sniper3', 'sniper4', 'assault2', 'bullpup', 'shotgun2'];
export const AIRDROP_TIMES = [25, 75, 125];     // match seconds at which crates drop

export const ZONE_PHASES = [
  { wait: 60, shrink: 20, r: 360, dps: 3 },
  { wait: 30, shrink: 15, r: 220, dps: 6 },
  { wait: 20, shrink: 12, r: 100, dps: 10 },
  { wait: 10, shrink: 10, r: 0,   dps: 16 },
];

export const LOOT_DEFS = {
  health: { color: 0x4dff88, label: 'MEDKIT' },
  shield: { color: 0x4da6ff, label: 'SHIELD' },
  ammo:   { color: 0xffd24d, label: 'AMMO' },
  ep:     { color: 0xff5a5a, label: 'EP MUSHROOM' },
  gloo:   { color: 0xbfe4ff, label: 'GLOO WALL' },
  airdrop:{ color: 0xffb648, label: 'AIRDROP' },
};
