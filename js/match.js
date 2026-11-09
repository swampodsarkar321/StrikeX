// ------------------------------------------------------------------
//  ZONE ROYALE - match simulation (player, bots, storm, loot)
// ------------------------------------------------------------------
import * as THREE from 'three';
import {
  ARENA_R, CHARACTERS, WEAPONS, LOOT_WEAPONS, ZONE_PHASES,
  BOT_NAMES, LOOT_DEFS, MAP_SCALE, MAX_PLAYERS,
  CHAR_ABILITIES, EP_MAX, GLOO_START, GLOO_HP, GLOO_TTL,
  AIRDROP_LOOT, AIRDROP_TIMES,
  EMOTES, COIN_REWARD_BASE, COIN_PLACEMENT,
} from './config.js';
import { Fighter, createGun } from './fighter.js?v=4';
import {
  terrainHeight, resolveCollision, randomOpenPoint, rayTerrain,
  getSpawnPoints, getSpawnCorners,
} from './world.js';

const TAU = Math.PI * 2;
const UP = new THREE.Vector3(0, 1, 0);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = THREE.MathUtils.clamp;
const damp = THREE.MathUtils.damp;

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function disposeObjectResources(root, keepGeometry = false) {
  if (!root) return;
  root.traverse((o) => {
    if (o.isSprite) {
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      return;
    }
    if (!o.isMesh) return;
    if (o.geometry && !keepGeometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m.map) m.map.dispose();
        m.dispose();
      }
    }
  });
}

export class Match {
  constructor({ scene, world, audio, effects, hud, camera, charId, onEnd, net = null, humanCount = 1, startWeapon = 'pistol', ranked = false, rankName = 'BRONZE V', equippedEmote = null, duoMode = false }) {
    this.scene = scene;
    this.world = world;
    this.audio = audio;
    this.effects = effects;
    this.hud = hud;
    this.camera = camera;
    this.charId = charId;
    this.onEnd = onEnd;
    this.net = net;
    this.humanCount = Math.max(1, humanCount | 0);
    this.startWeapon = WEAPONS[startWeapon] ? startWeapon : 'pistol';
    this.ranked = !!ranked;
    this.rankName = rankName;
    this.duoMode = !!duoMode;
    this.equippedEmote = equippedEmote || null;

    this.fighters = [];
    this.bots = [];
    this.loot = [];
    this.airdrops = [];
    this.falling = [];
    this.airdropT = 0;
    this.airdropIndex = 0;
    this.glooWalls = [];
    this.glooCount = GLOO_START;
    this.abilityCd = 0;
    this.abilityActive = 0;
    this.emoteCd = 0;
    this.emoteId = null;
    this.luckyShots = 0;
    this.firstBloodDone = false;
    this.streak = 0;
    this.killWindow = [];
    this.lastHurtAt = -10;
    this.alive = 1;
    this.over = false;
    this.damage = 0;
    this.time = 0;
    this.headshots = 0;
    this.placement = 10;
    this.startedAt = performance.now();
    this.shake = 0;
    this.stormHurt = 0;
    this.pitchKick = 0;
    this.cameraYaw = 0;
    this.raycaster = new THREE.Raycaster();
    this.interactTarget = null;

    this.phase = 'playing';
    this.createZoneWall();
    this.createZone();
    this.spawnPlayer();
    this.spawnBots();
    this.spawnInitialLoot();
    this.alive = this.fighters.length;
  }

  get charName() {
    const c = CHARACTERS.find((x) => x.id === this.charId);
    return c ? c.name : 'OPERATIVE';
  }

  // ------------------------------------------------------------- setup
  spawnPlayer() {
    const cfg = CHARACTERS.find((c) => c.id === this.charId) || CHARACTERS[0];
    const p = new Fighter({
      charId: cfg.id, name: 'YOU', scene: this.scene, isPlayer: true,
    });
    let pts = getSpawnPoints(MAX_PLAYERS);
    if (!pts || pts.length < 1) {
      pts = [{ x: 0, z: 0 }];
    }
    this.spawnPoints = pts;
    const c0 = pts[0];
    p.place(c0.x, c0.z);
    p.yaw = Math.random() * TAU;
    p.vel = new THREE.Vector3();
    p.vy = 0;
    p.airY = 0;
    p.grounded = true;
    p.yOffset = 0;
    p.stepT = 0;
    p.fireCd = 0;
    p.reloading = 0;
    p.ep = 0;
    p.healing = null;
    const sw = WEAPONS[this.startWeapon] || WEAPONS.pistol;
    p.slots = [
      { id: sw.id, mag: sw.mag, reserve: sw.reserve },
      null,
    ];
    p.slotIndex = 0;
    if (sw.id !== 'pistol') p.setWeapon(sw.id);
    p.gun.visible = true;

    this.scene.add(p.root);
    this.player = p;
    this.fighters.push(p);
  }

  spawnBots() {
    const maxBots = Math.max(0, MAX_PLAYERS - this.humanCount);
    if (this.duoMode && this.humanCount === 1) {
      // spawn AI partner at player's location
      const pool = shuffle(CHARACTERS.filter((c) => c.id !== this.charId).slice());
      const cfg = pool[0];
      const b = new Fighter({
        charId: cfg.id,
        name: 'PARTNER',
        scene: this.scene,
        charColor: '#3ea8ff',
        isPartner: true,
      });
      b.place(this.player.pos.x + 2, this.player.pos.z + 2);
      b.yaw = Math.random() * TAU;
      b.vel = new THREE.Vector3();
      b.yOffset = 0;
      b.weapon = 'rifle';
      b.setWeapon(b.weapon);
      b.skill = 0.9;
      b.thinkT = Math.random() * 0.5;
      b.fireCd = rand(0.6, 2.2);
      b.aimTime = rand(0.3, 0.9);
      b.strafeDir = Math.random() < 0.5 ? -1 : 1;
      b.strafeT = rand(0.8, 2.2);
      b.target = null;
      b.wander = null;
      b.urgent = false;
      b.isPartner = true;
      this.scene.add(b.root);
      this.fighters.push(b);
      this.bots.push(b);
      this.partner = b;
    }
    const botCount = this.duoMode ? maxBots - 1 : maxBots;
    const pool = shuffle(CHARACTERS.filter((c) => c.id !== this.charId).slice());
    const usedNames = shuffle(BOT_NAMES.slice());
    for (let i = 0; i < botCount; i++) {
      const cfg = pool[i % pool.length];
      const b = new Fighter({
        charId: cfg.id,
        name: usedNames[i % usedNames.length] || ('BOT-' + (i + 1)),
        scene: this.scene,
        charColor: cfg.color,
      });
      const pts = this.spawnPoints || getSpawnPoints(MAX_PLAYERS) || [];
      const slot = pts[(i + 1 + (this.duoMode && this.partner ? 1 : 0)) % (pts.length || 1)] || { x: (i % 4 - 1.5) * 30, z: (Math.floor(i / 4) - 2) * 30 };
      const ox = (Math.random() - 0.5) * 6;
      const oz = (Math.random() - 0.5) * 6;
      b.place(slot.x + ox, slot.z + oz);
      b.yaw = Math.random() * TAU;
      b.vel = new THREE.Vector3();
      b.yOffset = 0;
      b.weapon = ['smg', 'rifle', 'rifle', 'shotgun'][(Math.random() * 4) | 0];
      b.setWeapon(b.weapon);
      b.skill = rand(0.75, 1.25);
      b.thinkT = Math.random() * 0.5;
      b.fireCd = rand(0.6, 2.2);
      b.aimTime = rand(0.3, 0.9);
      b.strafeDir = Math.random() < 0.5 ? -1 : 1;
      b.strafeT = rand(0.8, 2.2);
      b.target = null;
      b.wander = null;
      b.urgent = false;
      this.scene.add(b.root);
      this.fighters.push(b);
      this.bots.push(b);
    }
  }

  // -------------------------------------------------------------- zone
  createZoneWall() {
    const wallH = 55 * MAP_SCALE;
    const geo = new THREE.CylinderGeometry(1, 1, wallH, 96, 1, true);
    geo.translate(0, wallH / 2, 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: new THREE.Color(0xff4a32) },
      },
      vertexShader: /* glsl */`
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime;
        uniform vec3 uColor;
        varying vec2 vUv;
        void main(){
          float stripes = sin(vUv.y * 46.0 - uTime * 3.2);
          float s = smoothstep(0.2, 1.0, stripes);
          float fade = smoothstep(0.0, 0.06, vUv.y) * smoothstep(1.0, 0.28, vUv.y);
          float a = (0.055 + s * 0.11) * fade;
          gl_FragColor = vec4(uColor * (0.9 + s * 0.9), a);
        }
      `,
    });
    this.zoneMat = mat;
    this.wall = new THREE.Mesh(geo, mat);
    this.wall.frustumCulled = false;
    this.scene.add(this.wall);
  }

  createZone() {
    this.zone = {
      center: new THREE.Vector3(0, 0, 0),
      r: ARENA_R,
      phase: 0,
      state: 'wait',
      timer: ZONE_PHASES[0].wait,
      dps: ZONE_PHASES[0].dps,
      fromR: ARENA_R,
      toR: ZONE_PHASES[0].r,
      fromC: new THREE.Vector3(),
      toC: new THREE.Vector3(),
    };
    this.updateWall(0);
  }

  updateZone(dt) {
    const z = this.zone;
    if (z.state !== 'final') z.timer -= dt;

    if (z.state === 'wait') {
      if (z.timer <= 0) this.beginShrink();
    } else if (z.state === 'shrink') {
      if (z.timer <= 0) this.endShrink();
      else {
        const ph = ZONE_PHASES[z.phase];
        const t = clamp(1 - z.timer / ph.shrink, 0, 1);
        const e = t * t * (3 - 2 * t);
        z.r = THREE.MathUtils.lerp(z.fromR, z.toR, e);
        z.center.lerpVectors(z.fromC, z.toC, e);
      }
    }

    this.updateWall(dt);
    this.applyStorm(dt);
  }

  beginShrink() {
    const z = this.zone;
    const ph = ZONE_PHASES[z.phase];
    z.state = 'shrink';
    z.timer = ph.shrink;
    z.fromR = z.r;
    z.toR = ph.r;
    z.fromC.copy(z.center);

    // new center stays inside the old circle
    const maxShift = Math.max(0, (z.r - ph.r) * 0.62);
    const a = Math.random() * TAU;
    const off = Math.random() * maxShift;
    z.toC.set(z.center.x + Math.cos(a) * off, 0, z.center.z + Math.sin(a) * off);
    const len = Math.hypot(z.toC.x, z.toC.z);
    const maxLen = Math.max(0, ARENA_R - ph.r - 4);
    if (len > maxLen && len > 0.001) {
      z.toC.x *= maxLen / len;
      z.toC.z *= maxLen / len;
    }
    z.dps = ph.dps;

    this.hud.toast('THE STORM IS CLOSING IN', 'warn');
    this.audio.zoneWarn();
  }

  endShrink() {
    const z = this.zone;
    z.r = z.toR;
    z.center.copy(z.toC);
    z.phase++;
    if (z.phase >= ZONE_PHASES.length) {
      z.state = 'final';
      z.r = 0.4;
      z.dps = ZONE_PHASES[ZONE_PHASES.length - 1].dps + 8;
      z.timer = 0;
    } else {
      z.state = 'wait';
      z.timer = ZONE_PHASES[z.phase].wait;
      z.dps = ZONE_PHASES[z.phase].dps;
    }
  }

  updateWall(dt) {
    this.zoneMat.uniforms.uTime.value += dt;
    const z = this.zone;
    this.wall.scale.set(Math.max(0.05, z.r), 1, Math.max(0.05, z.r));
    this.wall.position.set(z.center.x, 0, z.center.z);
    this.wall.visible = z.r < ARENA_R - 2;
  }

  applyStorm(dt) {
    const z = this.zone;
    if (z.phase === 0 && z.state === 'wait') {
      this.audio.setStorm(0, 0);
      return;
    }
    for (const f of this.fighters) {
      if (!f.alive) continue;
      const d = Math.hypot(f.pos.x - z.center.x, f.pos.z - z.center.z);
      if (d > z.r) {
        f.health -= z.dps * dt;
        if (f === this.player) this.stormHurt = 1;
        if (f.health <= 0) {
          f.health = 0;
          this.killFighter(f, null);
        }
      }
    }
    if (this.player.alive) {
      const d = Math.hypot(this.player.pos.x - z.center.x, this.player.pos.z - z.center.z);
      const prox = clamp(1 - Math.abs(d - z.r) / 26, 0, 1);
      this.audio.setStorm(z.state === 'shrink' ? 1 : 0.35, prox);
    }
  }

  // -------------------------------------------------------------- loot
  spawnInitialLoot() {
    // Guarantee the three GLB weapons are always somewhere on the map.
    for (const id of ['smg', 'rifle', 'sniper']) this.spawnLootItem('weapon', id);
    for (let i = 0; i < 5; i++) this.spawnLootItem('weapon', LOOT_WEAPONS[(Math.random() * LOOT_WEAPONS.length) | 0]);
    for (let i = 0; i < 10; i++) this.spawnLootItem('health');
    for (let i = 0; i < 9; i++) this.spawnLootItem('shield');
    for (let i = 0; i < 10; i++) this.spawnLootItem('ammo');
    for (let i = 0; i < 6; i++) this.spawnLootItem('ep');
    for (let i = 0; i < 3; i++) this.spawnLootItem('gloo');
  }

  spawnLootItem(type, weaponId = null, pos = null) {
    const spot = pos ? pos.clone() : randomOpenPoint(() => Math.random(), 6, ARENA_R - 10);
    const y = terrainHeight(spot.x, spot.z);
    const group = new THREE.Group();
    group.position.set(spot.x, y + 0.55, spot.z);

    const def = type === 'weapon' ? WEAPONS[weaponId] : null;
    const color = type === 'weapon' ? (def ? def.color : 0xffb648) : (LOOT_DEFS[type] ? LOOT_DEFS[type].color : 0xffffff);

    if (type === 'weapon') {
      const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3038, roughness: 0.5, metalness: 0.5 });
      const accentMat = new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.3,
      });
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.46), bodyMat);
      crate.castShadow = true;
      group.add(crate);
      const top = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.08, 0.48), accentMat);
      top.position.y = 0.19;
      group.add(top);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.36, 0.48), accentMat);
      stripe.position.x = 0.12;
      group.add(stripe);
    } else if (type === 'health') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.34, 0.42), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
      group.add(m);
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xff4d5e, emissive: 0xff2a3a, emissiveIntensity: 0.5, roughness: 0.5 });
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.09, 0.44), crossMat);
      a.position.z = 0.001;
      group.add(a);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.32, 0.44), crossMat);
      group.add(b);
    } else if (type === 'shield') {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.27, 0), new THREE.MeshStandardMaterial({
        color: 0x3f9bff, emissive: 0x1e6cff, emissiveIntensity: 0.9, metalness: 0.6, roughness: 0.2,
      }));
      group.add(m);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.025, 6, 20), new THREE.MeshBasicMaterial({ color: 0x8ec8ff, transparent: true, opacity: 0.8 }));
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
    } else if (type === 'ep') {
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, 0.22, 8), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
      stem.position.y = -0.06;
      group.add(stem);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 10), new THREE.MeshStandardMaterial({
        color: 0xff4040, emissive: 0xff2020, emissiveIntensity: 0.5, roughness: 0.5,
      }));
      cap.position.y = 0.12;
      group.add(cap);
    } else if (type === 'airdrop') {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 1.0), new THREE.MeshStandardMaterial({
        color: 0xe8622a, emissive: 0xb33c10, emissiveIntensity: 0.5, roughness: 0.55, metalness: 0.25,
      }));
      group.add(crate);
      const strap = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.2, 1.03), new THREE.MeshStandardMaterial({
        color: 0xffd24d, emissive: 0xa87800, emissiveIntensity: 0.6, roughness: 0.4,
      }));
      group.add(strap);
    } else if (type === 'gloo') {
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.3, 6), new THREE.MeshStandardMaterial({
        color: 0xbfe4ff, emissive: 0x7fc4ff, emissiveIntensity: 0.7, transparent: true, opacity: 0.85, roughness: 0.2,
      }));
      group.add(wall);
    } else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.26, 0.28), new THREE.MeshStandardMaterial({ color: 0xffd24d, emissive: 0x8a6400, emissiveIntensity: 0.35, roughness: 0.6 }));
      group.add(m);
      const band = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.07, 0.3), new THREE.MeshStandardMaterial({ color: 0x3a3a3a }));
      group.add(band);
    }

    if (type === 'weapon') {
      const preview = createGun(weaponId);
      // Rest the actual GLB gun on top of the crate instead of floating.
      preview.position.y = 0.34;
      preview.scale.setScalar(1.12);
      group.add(preview);
    }

    group.traverse((o) => { if (o.isMesh) o.castShadow = true; });

    const beamMat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.22, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.16, 2.8, 8, 1, true), beamMat);
    beam.position.y = 1.0;
    group.add(beam);

    this.scene.add(group);
    this.loot.push({ type, weaponId, group, baseY: y + 0.55, t: Math.random() * 6, taken: false });
  }

  lootLabel(item) {
    if (item.type === 'weapon') return `${WEAPONS[item.weaponId].name}  ·  PICK UP`;
    if (item.type === 'health') return 'MEDKIT  ·  OVER TIME';
    if (item.type === 'shield') return 'SHIELD  ·  +50';
    if (item.type === 'ep') return 'EP MUSHROOM  ·  +60 EP';
    if (item.type === 'gloo') return 'GLOO WALL  ·  +1';
    if (item.type === 'airdrop') return `AIRDROP  ·  ${WEAPONS[item.weaponId].name}  ·  TAKE`;
    return 'AMMO  ·  RESUPPLY';
  }

  updateLoot(dt) {
    const p = this.player;
    let best = null;
    let bestD = 3.1;
    for (const item of this.loot) {
      if (item.taken) continue;
      item.t += dt;
      item.group.rotation.y += dt * 1.1;
      item.group.position.y = item.baseY + Math.sin(item.t * 2.2) * 0.12;
      if (!p.alive) continue;
      const d = Math.hypot(item.group.position.x - p.pos.x, item.group.position.z - p.pos.z);
      if (d < bestD) { bestD = d; best = item; }
    }
    this.interactTarget = best;
    this.hud.setPrompt(best ? this.lootLabel(best) : '');
  }

  pickup() {
    const p = this.player;
    const item = this.interactTarget;
    if (!p.alive || !item || item.taken) return;

    if (item.type === 'weapon') {
      const def = WEAPONS[item.weaponId];
      p.slots[1] = { id: item.weaponId, mag: def.mag, reserve: def.reserve };
      this.equip(1);
      this.hud.toast(`${def.name} ACQUIRED`, 'good');
    } else if (item.type === 'health') {
      if (p.health >= p.maxHealth) { this.hud.toast('HEALTH ALREADY FULL', 'warn'); return; }
      if (p.healing) { this.hud.toast('ALREADY HEALING', 'warn'); return; }
      p.healing = { left: Math.min(35, p.maxHealth - p.health) };
      this.hud.toast('HEALING...', 'good');
    } else if (item.type === 'shield') {
      if (p.shield >= p.maxShield) { this.hud.toast('SHIELD ALREADY FULL', 'warn'); return; }
      p.addShield(50);
      this.hud.toast('+50 SHIELD', 'good');
    } else if (item.type === 'ep') {
      p.ep = Math.min(EP_MAX, (p.ep || 0) + 60);
      this.hud.toast('+60 EP', 'good');
    } else if (item.type === 'gloo') {
      this.glooCount++;
      this.hud.toast('GLOO WALL +1', 'good');
    } else if (item.type === 'airdrop') {
      const def = WEAPONS[item.weaponId];
      p.slots[1] = { id: item.weaponId, mag: def.mag, reserve: isFinite(def.reserve) ? def.reserve + 60 : def.reserve + 60 };
      this.equip(1);
      p.addShield(50);
      p.ep = Math.min(EP_MAX, (p.ep || 0) + 60);
      this.glooCount += 2;
      this.hud.toast(`AIRDROP: ${def.name} +50 SHIELD +60 EP +2 GLOO`, 'good');
      const ad = this.airdrops.find((a) => a.group === item.group);
      if (ad) ad.taken = true;
    } else {
      const slotId = p.slots[p.slotIndex] ? p.slots[p.slotIndex].id : 'pistol';
      const def = WEAPONS[slotId];
      const slot = p.slots[p.slotIndex];
      if (slot && isFinite(slot.reserve)) slot.reserve += def.mag * 2;
      if (p.slots[0] && slotId !== p.slots[0].id) p.slots[0].reserve = Infinity;
      this.hud.toast('AMMO RESUPPLIED', 'good');
    }

    item.taken = true;
    item.group.visible = false;
    this.scene.remove(item.group);
    this.interactTarget = null;
    this.hud.setPrompt('');
    this.audio.pickup();
  }

  equip(idx) {
    const p = this.player;
    const slot = p.slots[idx];
    if (!slot) return;
    p.slotIndex = idx;
    p.reloading = 0;
    p.fireCd = 0.18;
    p.setWeapon(slot.id);
    this.audio.click();
  }

  startReload() {
    const p = this.player;
    const slot = p.slots[p.slotIndex];
    if (!slot) return;
    const def = WEAPONS[slot.id];
    if (p.reloading > 0 || slot.mag >= def.mag || slot.reserve <= 0) return;
    p.reloading = def.reload;
    this.audio.reload();
  }

  // ------------------------------------------------------------- input
  update(dt, c) {
    if (this.over) return;
    this.time += dt;
    this.controls = c;
    this.updatePlayer(dt, c);
    this.updateBots(dt);
    this.updateZone(dt);
    this.updateLoot(dt);
    this.updateAbility(dt);
    this.updateEpAndHealing(dt);
    this.updateAirdrops(dt);
    this.updateGlooWalls(dt);
    for (const f of this.fighters) f.update(dt);
    this.shake = Math.max(0, this.shake - dt * 2.4);
    this.stormHurt = Math.max(0, this.stormHurt - dt * 0.6);
  }

  // ----------------------------------------------------------- abilities
  updateAbility(dt) {
    this.abilityCd = Math.max(0, this.abilityCd - dt);
    this.emoteCd = Math.max(0, this.emoteCd - dt);
    if (this.abilityActive > 0) {
      this.abilityActive -= dt;
      if (this.abilityActive <= 0) {
        this.abilityActive = 0;
        if (this.charId === 'hoodie') this.setGhostMats(false);
      }
    }
  }

  setGhostMats(on) {
    const p = this.player;
    if (!p || !p.mats) return;
    for (const m of p.mats) {
      if (!m.userData.baseOpacity) m.userData.baseOpacity = m.opacity;
      m.transparent = on ? true : (m.userData.baseOpacity < 1);
      m.opacity = on ? 0.35 : m.userData.baseOpacity;
    }
  }

  useEmote(id) {
    const p = this.player;
    if (!p.alive || this.over) return;
    if (this.emoteCd > 0) { this.hud.toast('EMOTE ON COOLDOWN', 'warn'); return; }
    this.emoteCd = 1.3;
    const emoteId = id || this.equippedEmote || 'wave';
    p.playEmote(emoteId);
    if (this.net) this.net.send('emote', { id: emoteId });
  }

  useAbility() {
    const p = this.player;
    if (!p.alive || this.over) return;
    const a = CHAR_ABILITIES[this.charId];
    if (!a) return;
    if (a.passive) { this.hud.toast(`${a.name} (PASSIVE): ${a.desc}`, 'good'); return; }
    if (this.abilityCd > 0) { this.hud.toast('SKILL ON COOLDOWN', 'warn'); return; }

    const id = this.charId;
    if (id === 'beach') { p.heal(25); p.ep = Math.min(EP_MAX, (p.ep || 0) + 40); }
    else if (id === 'casual') { this.luckyShots = 3; }
    else if (id === 'farmer') { p.heal(60); }
    else if (id === 'worker') { p.addShield(75); }
    else { this.abilityActive = a.dur; if (id === 'hoodie') this.setGhostMats(true); }

    this.abilityCd = a.cd;
    this.audio.pickup();
    this.hud.announce(a.name, 'ABILITY ACTIVATED');
  }

  // --------------------------------------------------- ep / healing flow
  updateEpAndHealing(dt) {
    const p = this.player;
    if (p.ep > 0 && p.health < p.maxHealth && this.time - (this.lastHurtAt || -10) > 3) {
      const amt = Math.min(9 * dt, p.ep, p.maxHealth - p.health);
      p.health += amt;
      p.ep -= amt;
    }
    if (p.healing) {
      const amt = Math.min(9 * dt, p.healing.left, p.maxHealth - p.health);
      p.health += amt;
      p.healing.left -= amt;
      if (p.healing.left <= 0.01 || p.health >= p.maxHealth) p.healing = null;
    }
  }

  // ------------------------------------------------------------- airdrop
  spawnAirdrop() {
    const spot = randomOpenPoint(() => Math.random(), 40, ARENA_R - 40);
    const group = new THREE.Group();
    group.position.set(spot.x, 120, spot.z);

    const crate = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.85, 1.0), new THREE.MeshStandardMaterial({
      color: 0xe8622a, emissive: 0xb33c10, emissiveIntensity: 0.5, roughness: 0.55, metalness: 0.25,
    }));
    crate.castShadow = true;
    group.add(crate);
    const strap = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.2, 1.03), new THREE.MeshStandardMaterial({
      color: 0xffd24d, emissive: 0xa87800, emissiveIntensity: 0.6, roughness: 0.4,
    }));
    group.add(strap);

    const chute = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.25, 12, 1, true), new THREE.MeshStandardMaterial({
      color: 0xf2f2f2, transparent: true, opacity: 0.85, side: THREE.DoubleSide, emissive: 0x888888, emissiveIntensity: 0.2,
    }));
    chute.position.y = 1.6;
    chute.rotation.x = Math.PI;
    group.add(chute);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.9, 34, 10, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb648, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
    );
    beam.position.y = 17;
    group.add(beam);

    const light = new THREE.PointLight(0xff9940, 18, 9, 2);
    light.position.y = 1;
    group.add(light);

    this.scene.add(group);
    const weaponId = AIRDROP_LOOT[(Math.random() * AIRDROP_LOOT.length) | 0];
    this.falling.push({ group, chute, beam, vy: 0, weaponId, seed: Math.random() * 10 });
  }

  updateAirdrops(dt) {
    this.airdropT += dt;
    if (this.airdropIndex < AIRDROP_TIMES.length && this.airdropT >= AIRDROP_TIMES[this.airdropIndex]) {
      this.airdropIndex++;
      this.spawnAirdrop();
      this.hud.announce('AIRDROP INBOUND', 'HIGH-TIER LOOT INCOMING');
      this.audio.zoneWarn();
    }

    for (let i = this.falling.length - 1; i >= 0; i--) {
      const crate = this.falling[i];
      crate.vy = Math.min(13, crate.vy + 20 * dt);
      crate.group.position.y -= crate.vy * dt;
      crate.group.position.x += Math.sin(this.time * 1.6 + crate.seed) * 1.4 * dt;
      crate.group.position.z += Math.cos(this.time * 1.3 + crate.seed) * 1.1 * dt;
      crate.group.rotation.y += dt * 0.55;
      const gy = terrainHeight(crate.group.position.x, crate.group.position.z) + 0.66;
      if (crate.group.position.y <= gy) {
        crate.group.position.y = gy;
        crate.group.remove(crate.chute);
        crate.beam.position.y = 2.4;
        crate.beam.scale.y = 0.16;
        this.loot.push({ type: 'airdrop', weaponId: crate.weaponId, group: crate.group, baseY: gy, t: 0, taken: false });
        this.airdrops.push({ group: crate.group, taken: false });
        this.hud.announce('AIRDROP ARRIVED', WEAPONS[crate.weaponId].name);
        this.audio.zoneWarn();
        this.falling.splice(i, 1);
      }
    }
  }

  // ---------------------------------------------------------- gloo walls
  createGlooWallMesh() {
    const g = new THREE.Group();
    const arc = new THREE.Mesh(
      new THREE.CylinderGeometry(2.4, 2.4, 2.05, 30, 1, true, -1.05, 2.1),
      new THREE.MeshStandardMaterial({
        color: 0xdff1ff, emissive: 0x8fd4ff, emissiveIntensity: 0.4,
        transparent: true, opacity: 0.88, roughness: 0.12, metalness: 0.05,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    g.add(arc);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.42, 2.42, 0.1, 30, 1, true, -1.05, 2.1),
      new THREE.MeshBasicMaterial({ color: 0x9fe0ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false })
    );
    base.position.y = -0.98;
    g.add(base);
    return g;
  }

  placeGloo(c) {
    if (this.over) return;
    const p = this.player;
    if (!p.alive) return;
    if (this.glooCount <= 0) { this.hud.toast('NO GLOO WALLS LEFT', 'warn'); return; }
    const dir = new THREE.Vector3(-Math.sin(this.cameraYaw), 0, -Math.cos(this.cameraYaw));
    const pos = p.pos.clone().addScaledVector(dir, 3.1);
    const gy = terrainHeight(pos.x, pos.z);
    pos.y = gy;

    const mesh = this.createGlooWallMesh();
    mesh.position.set(pos.x, gy + 1.02, pos.z);
    mesh.rotation.y = Math.atan2(dir.x, dir.z);
    this.scene.add(mesh);

    const box = new THREE.Mesh(new THREE.BoxGeometry(4.8, 2.05, 0.4), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.copy(mesh.position);
    box.rotation.y = mesh.rotation.y;
    this.scene.add(box);

    const wall = { mesh, box, hp: GLOO_HP, ttl: GLOO_TTL };
    box.userData.glooWall = wall;
    this.glooWalls.push(wall);
    this.glooCount -= 1;
    this.audio.click();
    this.hud.toast('GLOO WALL DEPLOYED', 'good');
  }

  updateGlooWalls(dt) {
    for (let i = this.glooWalls.length - 1; i >= 0; i--) {
      const w = this.glooWalls[i];
      w.ttl -= dt;
      if (w.ttl <= 0 || w.hp <= 0) {
        this.scene.remove(w.mesh);
        this.scene.remove(w.box);
        w.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
        w.box.geometry.dispose();
        this.glooWalls.splice(i, 1);
      }
    }
  }

  removeGlooWall(wall) {
    const i = this.glooWalls.indexOf(wall);
    if (i >= 0) this.glooWalls.splice(i, 1);
    this.scene.remove(wall.mesh);
    this.scene.remove(wall.box);
    wall.mesh.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    wall.box.geometry.dispose();
  }

  updatePlayer(dt, c) {
    const p = this.player;
    if (!p.alive) {
      p.vel.multiplyScalar(0.85);
      return;
    }
    const fwd = new THREE.Vector3(-Math.sin(c.yaw), 0, -Math.cos(c.yaw));
    const right = new THREE.Vector3(Math.cos(c.yaw), 0, -Math.sin(c.yaw));

    let iz = 0, ix = 0;
    if (c.keys.has('KeyW') || c.keys.has('ArrowUp')) iz += 1;
    if (c.keys.has('KeyS') || c.keys.has('ArrowDown')) iz -= 1;
    if (c.keys.has('KeyD') || c.keys.has('ArrowRight')) ix += 1;
    if (c.keys.has('KeyA') || c.keys.has('ArrowLeft')) ix -= 1;
    if (c.move) { ix += c.move.x; iz += c.move.y; }
    const il = Math.hypot(ix, iz);
    if (il > 1) { ix /= il; iz /= il; }

    const sprint = (c.keys.has('ShiftLeft') || c.sprint) && iz > 0.15 && !c.aiming && !c.firing;
    let speed = sprint ? 7.0 : 4.55;
    if (c.aiming) speed = 2.7;
    if (c.crouch) speed = 2.2;

    const wish = new THREE.Vector3()
      .addScaledVector(fwd, iz)
      .addScaledVector(right, ix);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(speed);

    const accel = p.grounded ? 26 : 12;
    p.vel.x = damp(p.vel.x, wish.x, accel, dt);
    p.vel.z = damp(p.vel.z, wish.z, accel, dt);
    p.pos.x += p.vel.x * dt;
    p.pos.z += p.vel.z * dt;
    resolveCollision(p.pos, p.radius);

    // no walking through bots
    for (const b of this.bots) {
      if (!b.alive) continue;
      const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.85 && d > 0.001) {
        const k = (0.85 - d) / d * 0.5;
        p.pos.x += dx * k; p.pos.z += dz * k;
      }
    }

    // jump / gravity
    if ((c.keys.has('Space') || c.jump) && p.grounded) {
      p.vy = 5.9;
      p.grounded = false;
      this.audio.step();
    }
    if (!p.grounded) {
      p.vy -= 18 * dt;
      p.airY += p.vy * dt;
      if (p.airY <= 0) { p.airY = 0; p.vy = 0; p.grounded = true; }
    }
    p.yOffset = p.airY;

    // facing follows the camera
    p.aimDir.copy(c.aimDir);
    p.aimPose = !!c.aiming;
    p.faceYaw(Math.atan2(p.aimDir.x, p.aimDir.z), 20, dt);

    // animation speed follows actual movement
    p.moveSpeed = Math.hypot(p.vel.x, p.vel.z);

    // footsteps
    const hs = Math.hypot(p.vel.x, p.vel.z);
    p.stepT -= dt;
    if (p.grounded && hs > 1.6 && p.stepT <= 0) {
      this.audio.step();
      p.stepT = sprint ? 0.27 : 0.42;
    }

    this.updateCombat(dt, c);
  }

  updateCombat(dt, c) {
    const p = this.player;
    if (p.healing) {
      // locked in place while medkit is restoring health
      p.fireCd = Math.max(0, p.fireCd - dt);
      return;
    }
    const slot = p.slots[p.slotIndex];
    if (!slot) return;
    const def = WEAPONS[slot.id];

    if (p.reloading > 0) {
      const reloadMul = (this.abilityActive > 0 && this.charId === 'astronaut') ? 1.6 : 1;
      p.reloading -= dt * reloadMul;
      if (p.reloading <= 0) {
        p.reloading = 0;
        const need = def.mag - slot.mag;
        if (isFinite(slot.reserve)) {
          const take = Math.min(need, slot.reserve);
          slot.mag += take;
          slot.reserve -= take;
        } else {
          slot.mag = def.mag;
        }
        this.audio.reload();
      }
    }

    p.fireCd = Math.max(0, p.fireCd - dt);
    const want = def.auto ? c.firing : c.pendingShot;
    if (!want || p.reloading > 0 || p.fireCd > 0) return;

    if (slot.mag <= 0) {
      c.pendingShot = false;
      if (slot.reserve > 0) this.startReload();
      else if (p.slots[0] && p.slotIndex !== 0) {
        this.equip(0);
        this.hud.toast('OUT OF AMMO — SWITCHED TO PISTOL', 'warn');
      } else {
        this.hud.toast('OUT OF AMMO — FIND AMMO', 'warn');
      }
      return;
    }

    this.firePlayerShot(def, slot, c);
    if (!def.auto) c.pendingShot = false;
  }

  firePlayerShot(def, slot, c) {
    const p = this.player;
    slot.mag--;
    let cd = 60 / def.rpm;
    if (this.abilityActive > 0 && this.charId === 'punk') cd *= 0.75;
    p.fireCd = cd;
    p.markShot();

    // damage multipliers from abilities
    let dmgMul = 1;
    if (this.abilityActive > 0 && this.charId === 'king') dmgMul *= 1.5;
    if (this.luckyShots > 0) { dmgMul *= 2; this.luckyShots -= 1; }
    const shotDef = dmgMul === 1 ? def : { ...def, dmg: def.dmg * dmgMul };

    const speed = Math.hypot(p.vel.x, p.vel.z);
    let spreadMul = (c.aiming ? 0.38 : 1) * (speed > 1.6 ? 1.55 : 1);
    if (!p.grounded) spreadMul *= 1.7;
    const spread = def.spread * spreadMul;

    const gunLen = p.gun && p.gun.userData && p.gun.userData.length ? p.gun.userData.length : 0.4;
    const muzzle = p.gun.visible
      ? p.gun.position.clone().addScaledVector(p.aimDir, gunLen * 0.75 + 0.05)
      : p.pos.clone().add(new THREE.Vector3(0, 1.3, 0)).addScaledVector(p.aimDir, 0.5);

    for (let i = 0; i < def.pellets; i++) {
      const dir = this.spreadDir(c.aimDir, spread);
      this.hitscan(this.camera.position.clone(), dir, shotDef, muzzle, p);
    }

    this.audio.shot(def.sound, 1);
    this.effects.flash(muzzle, def.color, def.id === 'shotgun' ? 1.35 : 1);
    this.pitchKick += def.recoil * (c.aiming ? 0.55 : 1) * rand(0.8, 1.25);
    this.shake = Math.min(0.7, this.shake + def.recoil * 1.2);
  }

  spreadDir(dir, s) {
    const d = dir.clone();
    d.x += (Math.random() - 0.5) * 2 * s;
    d.y += (Math.random() - 0.5) * 2 * s;
    d.z += (Math.random() - 0.5) * 2 * s * 0.25;
    return d.normalize();
  }

  hitscan(origin, dir, def, muzzle, shooter) {
    const targets = [];
    for (const f of this.fighters) {
      if (!f.alive || f === shooter) continue;
      targets.push(f.hitboxes[0], f.hitboxes[1]);
    }
    for (const w of this.glooWalls) targets.push(w.box);
    targets.push(...this.world.raycastTargets);

    this.raycaster.set(origin, dir);
    this.raycaster.far = def.range;
    let hits = this.raycaster.intersectObjects(targets, false);

    let point = null;
    let target = null;
    let headshot = false;
    let dist = def.range;
    let penetrated = false; // ceiling removed for sniper wall penetration

    if (hits.length) {
      const h = hits[0];
      dist = h.distance;
      point = h.point.clone();
      const wall = h.object.userData.glooWall;
      if (wall) {
        wall.hp -= def.dmg;
        wall.mesh.traverse((o) => { if (o.isMesh && o.material && o.material.emissive) { o.material.emissive.setHex(0xffffff); o.material.emissiveIntensity = 0.7; setTimeout(() => { o.material.emissive.setHex(0x8fd4ff); o.material.emissiveIntensity = 0.4; }, 90); } });
        if (wall.hp <= 0) this.removeGlooWall(wall);
      } else if (h.object.userData.fighter) {
        target = h.object.userData.fighter;
        headshot = !!h.object.userData.headshot;
      } else if (def.pen && def.penWall && !penetrated) {
        // sniper round punches through one thin wall
        penetrated = true;
        const after = hits.slice(1);
        if (after.length) {
          const h2 = after[0];
          dist = h2.distance;
          point = h2.point.clone();
          const wall2 = h2.object.userData.glooWall;
          if (wall2) {
            wall2.hp -= def.dmg * 0.7;
            if (wall2.hp <= 0) this.removeGlooWall(wall2);
          } else if (h2.object.userData.fighter) {
            target = h2.object.userData.fighter;
            headshot = !!h2.object.userData.headshot;
          }
        }
      }
    }

    const gt = rayTerrain(origin, dir, dist);
    if (gt !== null && gt < dist) {
      dist = gt;
      point = origin.clone().addScaledVector(dir, gt);
      target = null;
      headshot = false;
    }

    const end = point || origin.clone().addScaledVector(dir, def.range);
    this.effects.tracer(muzzle, end, shooter.isPlayer ? 0xffe9b0 : 0xffb9a0);

    if (target) {
      const falloff = def.id === 'shotgun' ? Math.max(0.25, 1 - (dist / def.range) * 0.95) : 1;
      const dmg = def.dmg * falloff * (headshot ? 2 : 1) * (penetrated ? 0.7 : 1);
      this.damageFighter(target, dmg, shooter, headshot, point);
      this.effects.impact(point, 0xff5a5a);
      this.audio.hit(headshot);
    } else if (point) {
      this.effects.impact(point, 0xd9c9a3);
      this.audio.wallImpact();
    } else {
      // missed entirely — dirt/sand puff if terrain was hit via rayTerrain
      if (point) this.effects.impact(point, 0xc9b98a);
    }
  }

  // ------------------------------------------------------------- combat
  damageFighter(target, dmg, attacker, headshot, point) {
    if (!target.alive || this.over) return;
    // SWAT ability: damage taken reduced while active
    if (target === this.player && this.abilityActive > 0 && this.charId === 'swat') {
      dmg *= 0.55;
    }
    if (target.isRemote && this.net) {
      this.net.send('damage', { targetId: target.sessionId, amount: dmg });
      if (attacker === this.player) {
        this.damage += dmg;
        if (headshot) this.headshots += 1;
        this.effects.damageNumber(
          point ? point.clone() : target.pos.clone().add(new THREE.Vector3(0, 1.4, 0)),
          Math.round(dmg), headshot
        );
        this.hud.hitmarker(headshot);
        this.audio.hit(headshot);
      }
      return;
    }
    const res = target.applyDamage(dmg);

    if (attacker === this.player) {
      this.damage += dmg;
      if (headshot) this.headshots += 1;
      this.effects.damageNumber(
        point ? point.clone() : target.pos.clone().add(new THREE.Vector3(0, 1.4, 0)),
        Math.round(dmg), headshot
      );
      this.hud.hitmarker(headshot);
      this.audio.hit(headshot);
    }

    if (target === this.player) {
      this.lastHurtAt = this.time;
      this.player.healing = null;
      this.hud.hurtBy(attacker ? attacker.pos : target.pos, this.cameraYaw);
      this.audio.hurt();
      this.shake = Math.min(1, this.shake + 0.3);
    }

    if (res.died) this.killFighter(target, attacker);
  }

  killFighter(f, killer) {
    if (!f.alive) return;
    if (f === this.player) this.placement = this.alive;
    f.die();
    this.alive = Math.max(0, this.alive - 1);

    if (killer && killer !== f) killer.kills++;

    this.hud.feed(killer ? killer.name : 'THE STORM', f.name, killer === this.player);

    if (killer === this.player) {
      this.audio.kill();
      this.hud.toast(`ELIMINATED ${f.name}`, 'good');

      // kill streak & FF-style announcements
      this.streak += 1;
      const now = this.time;
      this.killWindow.push(now);
      this.killWindow = this.killWindow.filter((t) => now - t <= 4.5);
      const burst = this.killWindow.length;
      if (!this.firstBloodDone) {
        this.firstBloodDone = true;
        this.hud.announce('FIRST BLOOD', `${f.name} ELIMINATED`);
      } else if (burst === 2) {
        this.hud.announce('DOUBLE KILL', f.name);
      } else if (burst === 3) {
        this.hud.announce('TRIPLE KILL', f.name);
      } else if (burst === 4) {
        this.hud.announce('QUAD KILL', f.name);
      } else if (burst >= 5) {
        this.hud.announce('RAMPAGE', f.name);
      }
      if (this.streak === 3) this.hud.announce('KILLING SPREE', '3 ELIMINATIONS');
      else if (this.streak === 5) this.hud.announce('GODLIKE', '5 ELIMINATIONS');

      // Business passive: restore HP on elimination
      if (this.charId === 'business') this.player.heal(15);
    }

    this.dropLoot(f.pos, f);

    if (f === this.player) {
      this.endMatch(false);
      return;
    }
    const winThreshold = this.duoMode ? 2 : 1;
    if (this.alive <= winThreshold && this.player.alive) {
      this.endMatch(true);
    }
  }

  // --------------------------------------------------------- cleanup / dispose
  dispose() {
    // fighters & their guns
    for (const f of this.fighters) {
      if (f.root) this.scene.remove(f.root);
      // character geometry is shared with the loaded GLB template cache, so
      // only dispose the per-fighter cloned materials, never the geometry
      if (f.root) disposeObjectResources(f.root, true);
      if (f.gun) { this.scene.remove(f.gun); disposeObjectResources(f.gun, false); }
    }
    // loot (weapons, medkits, airdrops, ep, gloo)
    for (const l of this.loot) {
      if (l.group) { this.scene.remove(l.group); disposeObjectResources(l.group); }
    }
    // airdrop crates still falling
    for (const crate of this.falling) {
      if (crate.group) { this.scene.remove(crate.group); disposeObjectResources(crate.group); }
    }
    // landed airdrop entries share loot groups (already removed above)
    this.airdrops.length = 0;
    this.falling.length = 0;
    // gloo walls
    for (const w of this.glooWalls) this.removeGlooWall(w);
    this.glooWalls.length = 0;
    // zone wall
    if (this.wall) { this.scene.remove(this.wall); disposeObjectResources(this.wall); }
    // effects (tracks, tracers, flashes)
    if (this.effects) this.effects.clear();
    this.bots.length = 0;
    this.fighters.length = 0;
    this.loot.length = 0;
  }

  dropLoot(pos, f) {
    const r = Math.random();
    if (f.weapon !== 'pistol' && Math.random() < 0.5) {
      this.spawnLootItem('weapon', f.weapon, pos);
    }
    if (r < 0.45) this.spawnLootItem('health', null, pos);
    else if (r < 0.78) this.spawnLootItem('shield', null, pos);
    else this.spawnLootItem('ammo', null, pos);
  }

  endMatch(win) {
    if (this.over) return;
    this.over = true;
    const kills = this.player.kills;
    const placement = win ? 1 : this.placement;
    const tSec = (performance.now() - this.startedAt) / 1000;
    const timeStr = `${String(Math.floor(tSec / 60)).padStart(2, '0')}:${String(Math.floor(tSec % 60)).padStart(2, '0')}`;
    const xpGain = 20 + kills * 25 + Math.floor(this.damage / 5) + Math.floor(tSec / 30)
      + (win ? 100 : 0) + (placement <= 3 ? 40 : placement <= 10 ? 15 : 0);
    const stats = {
      kills,
      damage: this.damage,
      time: timeStr,
      placement,
      total: MAX_PLAYERS,
      charName: this.charName,
      headshots: this.headshots,
      xpGain,
    };
    if (this.ranked) {
      let rp = (win ? 60 : 0) + kills * 10;
      if (placement <= 3) rp += 30;
      else if (placement <= 10) rp += 10;
      stats.rp = rp;
      stats.rank = this.rankName;
    }
    // coin reward: base + placement bonus + rank bonus
    let coins = COIN_REWARD_BASE;
    if (placement === 1) coins = 1000;
    else if (placement <= 3) coins = 800;
    else if (placement <= 5) coins = 650;
    // rank tier bonus (from rankName)
    const tier = this.rankName || 'BRONZE V';
    if (/DIAMOND|HEROIC|PLATINUM/.test(tier)) coins += 400;
    else if (/GOLD/.test(tier)) coins += 200;
    else if (/SILVER/.test(tier)) coins += 100;
    stats.coins = coins;
    this.hud.showEnd(win, stats);
    if (win) this.audio.win();
    else this.audio.death();
    this.audio.setStorm(0, 0);
    if (this.onEnd) this.onEnd(win, stats);
  }

  // ---------------------------------------------------------------- AI
  updateBots(dt) {
    for (const b of this.bots) {
      if (!b.alive) continue;
      b.thinkT -= dt;
      b.fireCd -= dt;
      b.strafeT -= dt;
      b.aimTime -= dt;

      if (b.thinkT <= 0) {
        b.thinkT = rand(0.28, 0.5);
        if (b.isPartner) this.partnerThink(b);
        else this.botThink(b);
      }
      if (b.strafeT <= 0) {
        b.strafeT = rand(1.3, 2.8);
        b.strafeDir *= -1;
      }
      this.botMove(b, dt);
      this.botCombat(b, dt);
    }
  }

  partnerThink(b) {
    const z = this.zone;
    const dc = Math.hypot(b.pos.x - this.player.pos.x, b.pos.z - this.player.pos.z);
    b.urgent = dc > 25 || z.state === 'final';

    const prev = b.target;
    b.target = this.findTargetWide(b);
    if (b.target && b.target !== prev) b.aimTime = rand(0.4, 0.9);

    if (!b.target) {
      // stay near player
      const pdx = this.player.pos.x - b.pos.x, pdz = this.player.pos.z - b.pos.z;
      const pd = Math.hypot(pdx, pdz);
      if (pd > 8) b.wander = new THREE.Vector3(this.player.pos.x, 0, this.player.pos.z);
      else b.wander = null;
    } else {
      b.wander = null;
    }
  }

  findTargetWide(b) {
    let best = null, bestScore = Infinity;
    for (const f of this.fighters) {
      if (f === b || !f.alive) continue;
      if (f.isPlayer) continue;
      const d = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
      if (d > 65) continue;
      // prefer enemies near the player (protect player)
      const dToPlayer = Math.hypot(f.pos.x - this.player.pos.x, f.pos.z - this.player.pos.z);
      const score = d * 0.5 + dToPlayer * 0.5 + Math.random() * 3;
      if (score < bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  botThink(b) {
    const z = this.zone;
    const dc = Math.hypot(b.pos.x - z.center.x, b.pos.z - z.center.z);
    b.urgent = dc > z.r - 7 || z.state === 'final';

    const prev = b.target;
    b.target = this.findTarget(b);
    if (b.target && b.target !== prev) b.aimTime = rand(0.45, 0.95);

    if (!b.target) {
      if (!b.wander || b.wander.distanceTo(b.pos) < 4) b.wander = this.randomZonePoint();
    } else {
      b.wander = null;
    }

    // pick up nearby loot sometimes
    if (!b.target && Math.random() < 0.25) {
      for (const item of this.loot) {
        if (item.taken) continue;
        const d = Math.hypot(item.group.position.x - b.pos.x, item.group.position.z - b.pos.z);
        if (d < 3.4 && item.type !== 'weapon') {
          if (item.type === 'health' && b.health < 90) { b.heal(30); item.taken = true; this.scene.remove(item.group); }
          else if (item.type === 'shield' && b.shield < 40) { b.addShield(40); item.taken = true; this.scene.remove(item.group); }
          break;
        }
      }
    }
  }

  findTarget(b) {
    let best = null;
    let bestScore = Infinity;
    for (const f of this.fighters) {
      if (f === b || !f.alive) continue;
      if (f.isPlayer && this.phase === 'aircraft') continue;
      if (f.isPlayer && this.abilityActive > 0 && this.charId === 'hoodie') continue;
      const d = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z);
      if (d > 50) continue;
      if (!this.hasLOS(b, f)) continue;
      let score = d + (f.isPlayer ? -7 : 0) + Math.random() * 6;
      if (score < bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  randomZonePoint() {
    const z = this.zone;
    const r = Math.max(3, z.r * 0.8);
    const a = Math.random() * TAU;
    const d = Math.sqrt(Math.random()) * r;
    return new THREE.Vector3(z.center.x + Math.cos(a) * d, 0, z.center.z + Math.sin(a) * d);
  }

  botMove(b, dt) {
    const z = this.zone;
    let mx = 0, mz = 0, speed = 4.1;

    if (b.urgent) {
      const dx = z.center.x - b.pos.x, dz = z.center.z - b.pos.z;
      const len = Math.hypot(dx, dz) || 1;
      mx = dx / len; mz = dz / len;
      speed = 6.4;
      b.faceYaw(Math.atan2(mx, mz), 9, dt);
    } else if (b.target && b.target.alive) {
      const t = b.target;
      const dx = t.pos.x - b.pos.x, dz = t.pos.z - b.pos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const rx = dx / dist, rz = dz / dist;
      const sx = -rz * b.strafeDir, sz = rx * b.strafeDir;
      if (dist > 24) { mx = rx; mz = rz; speed = 5.1; }
      else if (dist < 8) { mx = -rx; mz = -rz; speed = 3.9; }
      else { mx = sx * 0.92 + rx * 0.08; mz = sz * 0.92 + rz * 0.08; speed = 3.5; }
      b.faceYaw(Math.atan2(rx, rz), 9, dt);
    } else if (b.wander) {
      const dx = b.wander.x - b.pos.x, dz = b.wander.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 3) {
        b.wander = this.randomZonePoint();
      } else {
        mx = dx / d; mz = dz / d;
        speed = 4.3;
        b.faceYaw(Math.atan2(mx, mz), 6, dt);
      }
    }

    // separation from others
    for (const o of this.fighters) {
      if (o === b || !o.alive) continue;
      const dx = b.pos.x - o.pos.x, dz = b.pos.z - o.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < 2.0 && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        mx += (dx / d) * 0.6;
        mz += (dz / d) * 0.6;
      }
    }

    b.pos.x += mx * speed * dt;
    b.pos.z += mz * speed * dt;
    b.moveSpeed = Math.hypot(mx, mz) * speed;
    resolveCollision(b.pos, b.radius);
  }

  botCombat(b, dt) {
    const t = b.target;
    if (t && t.alive) {
      const from = new THREE.Vector3(b.pos.x, b.pos.y + 1.08, b.pos.z);
      const aimPoint = new THREE.Vector3(t.pos.x, t.pos.y + 0.95, t.pos.z);
      b.aimDir.copy(aimPoint).sub(from).normalize();

      if (b.aimTime <= 0 && b.fireCd <= 0) {
        if (this.hasLOS(b, t)) this.botShoot(b, t, from);
        else b.aimTime = 0.25;
      }
    } else {
      b.aimDir.set(Math.sin(b.yaw), 0, Math.cos(b.yaw));
    }
  }

  botShoot(b, t, from) {
    const def = WEAPONS[b.weapon] || WEAPONS.rifle;
    const to = new THREE.Vector3(t.pos.x, t.pos.y + 0.95, t.pos.z);
    const dist = from.distanceTo(to);

    b.fireCd = (b.weapon === 'shotgun' ? 1.5 : b.weapon === 'smg' ? 0.8 : 1.05) + Math.random() * 0.7;
    b.aimTime = rand(0.15, 0.4);
    b.markShot();

    const moving = t === this.player ? Math.hypot(t.vel.x, t.vel.z) > 2 : false;
    let chance = clamp(0.52 - dist * 0.006, 0.05, 0.58) * b.skill;
    if (moving) chance *= 0.8;
    if (b.urgent) chance *= 0.7;
    const hit = Math.random() < chance;

    if (!hit) {
      to.x += rand(-2.4, 2.4);
      to.y += rand(-1.2, 1.6);
      to.z += rand(-2.4, 2.4);
    }

    const bLen = b.gun && b.gun.userData && b.gun.userData.length ? b.gun.userData.length : 0.4;
    const muzzle = from.clone().addScaledVector(b.aimDir, bLen * 0.75 + 0.05);
    this.effects.tracer(muzzle, to, 0xffb9a0);
    this.effects.flash(muzzle, def.color, 0.85);
    this.audio.shot(def.sound, clamp(1 - dist / 85, 0.06, 1) * 0.55);

    if (hit) {
      const dmg = def.dmg * (b.weapon === 'shotgun' ? 0.34 : 0.4);
      this.damageFighter(t, dmg, b, false, to);
      this.effects.impact(to, 0xff5a5a);
    }
  }

  hasLOS(a, b) {
    const from = new THREE.Vector3(a.pos.x, a.pos.y + 1.1, a.pos.z);
    const to = new THREE.Vector3(b.pos.x, b.pos.y + 0.95, b.pos.z);
    const dir = to.clone().sub(from);
    const dist = dir.length();
    if (dist < 0.5) return true;
    dir.normalize();

    this.raycaster.set(from, dir);
    this.raycaster.far = dist - 0.3;
    const losTargets = this.world.raycastTargets.concat(this.glooWalls.map((w) => w.box));
    const hits = this.raycaster.intersectObjects(losTargets, false);
    if (hits.length) return false;

    const gt = rayTerrain(from, dir, dist - 0.4);
    if (gt !== null) return false;
    return true;
  }
}
