// ------------------------------------------------------------------
//  ZONE ROYALE - characters & fighters
// ------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { CHARACTERS, TARGET_HEIGHT, WEAPONS } from './config.js';
import { terrainHeight } from './world.js';

const cache = new Map();
let loadPromise = null;
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(0, 0, 1);
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

// ------------------------------------------------------------ loading
function skinnedBounds(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    o.skeleton.update();
    const pos = o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      o.getVertexPosition(i, v);
      v.applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  if (box.isEmpty()) box.setFromObject(root);
  return box;
}

export function loadAllCharacters(onProgress) {
  if (loadPromise) return loadPromise;
  const loader = new GLTFLoader();
  let done = 0;

  loadPromise = Promise.all(CHARACTERS.map(async (cfg) => {
    const gltf = await loader.loadAsync(
      './assets/characters/' + encodeURIComponent(cfg.file)
    );
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const box = skinnedBounds(scene);
    let height = box.max.y - box.min.y;
    if (!isFinite(height) || height < 0.2) {
      const head = scene.getObjectByName('Head');
      const foot = scene.getObjectByName('Foot.L') || scene.getObjectByName('PT.L');
      if (head && foot) {
        head.getWorldPosition(tmpV);
        const hy = tmpV.y;
        foot.getWorldPosition(tmpV);
        height = Math.max(0.2, (hy - tmpV.y) * 1.22);
      } else {
        height = 1.8;
      }
      box.setFromObject(scene);
    }
    const scale = TARGET_HEIGHT / height;
    const data = { ...cfg, gltf, scene, box, scale, clips: gltf.animations };
    cache.set(cfg.id, data);
    done++;
    if (onProgress) onProgress(done / CHARACTERS.length, cfg);
    return data;
  }));

  return loadPromise;
}

export function getCharacterData(id) {
  return cache.get(id);
}

// -------------------------------------------------------- model build
export function createCharacterModel(charId) {
  const data = cache.get(charId);
  if (!data) throw new Error('character not loaded: ' + charId);

  const model = skeletonClone(data.scene);
  model.scale.setScalar(data.scale);
  model.position.y = -data.box.min.y * data.scale;

  const mats = [];
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
      o.frustumCulled = false;
      if (o.material) {
        o.material = o.material.clone();
        o.material.userData.baseEmissive = o.material.emissive
          ? o.material.emissive.clone()
          : new THREE.Color(0, 0, 0);
        mats.push(o.material);
      }
    }
  });

  const root = new THREE.Group();
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of data.clips) {
    const short = clip.name.includes('|') ? clip.name.split('|')[1] : clip.name;
    actions[short] = mixer.clipAction(clip);
  }

  let current = null;
  let currentName = '';

  function play(name, fade = 0.18, once = false) {
    const next = actions[name];
    if (!next || next === current) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    if (current) next.crossFadeFrom(current, fade, false);
    next.play();
    current = next;
    currentName = name;
  }

  return {
    root, model, mixer, actions, play, mats,
    get currentName() { return currentName; },
    height: TARGET_HEIGHT,
  };
}

// ------------------------------------------------------------ weapons
const gunMatBody = new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.45, metalness: 0.55 });
const gunMatMetal = new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.35, metalness: 0.8 });

// ------------------------------------------------------------ gun models
const gunCache = new Map();
let gunLoadPromise = null;

function gunTargetLength(weaponId) {
  if (weaponId === 'sniper' || weaponId.startsWith('sniper')) return 0.55;
  if (weaponId === 'shotgun' || weaponId.startsWith('shotgun')) return 0.42;
  if (weaponId === 'rifle' || weaponId.startsWith('assault') || weaponId === 'bullpup') return 0.4;
  if (weaponId === 'smg' || weaponId.startsWith('smg')) return 0.29;
  if (weaponId.startsWith('revolver')) return 0.23;
  return 0.19;
}

export function loadGunModel() {
  if (gunLoadPromise) return gunLoadPromise;
  const loader = new GLTFLoader();
  const ids = Object.keys(WEAPONS).filter((id) => WEAPONS[id] && WEAPONS[id].glb);
  gunLoadPromise = Promise.all(ids.map(async (id) => {
    try {
      const gltf = await loader.loadAsync(WEAPONS[id].glb);
      gunCache.set(id, gltf.scene);
    } catch (e) { console.error('gun load failed', WEAPONS[id].glb, e); }
  }));
  return gunLoadPromise;
}

function buildGunFromCache(weaponId) {
  const def = WEAPONS[weaponId];
  const src = gunCache.get(weaponId);
  if (!def || !src) return null;
  // Each fighter/loot item needs its own geometry: setWeapon() disposes
  // the old gun and source geometry must never be shared/disposed.
  const clone = src.clone(true);
  clone.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      if (o.geometry) o.geometry = o.geometry.clone();
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else if (o.material) o.material = o.material.clone();
    }
  });

  // Anchor the gun by its GRIP (about a third of the way from the
  // buttstock, i.e. the rear end) instead of the bounding-box centre, so it
  // sits in the hand like a held weapon. All of these GLBs are authored
  // along +X with the muzzle at +X.
  const box = new THREE.Box3().setFromObject(clone);
  const min = box.min, max = box.max;
  const size = box.getSize(new THREE.Vector3());
  const dims = [size.x, size.y, size.z];
  const longest = dims.indexOf(Math.max(...dims));
  const target = gunTargetLength(weaponId);
  const s = target / (Math.max(...dims) || 1);

  const gripX = min.x + 0.32 * size.x;
  const gripY = min.y + 0.30 * size.y;
  const midZ = (min.z + max.z) / 2;
  clone.position.set(-gripX, -gripY, -midZ);

  const inner = new THREE.Group();
  inner.add(clone);
  inner.scale.setScalar(s);
  // Map the gun's longest axis onto +Z so it points the same way as the
  // fighter's aimDir.
  if (longest === 0) inner.rotation.y = -Math.PI / 2;
  else if (longest === 1) inner.rotation.x = -Math.PI / 2;
  inner.position.y = -0.02;

  const wrapper = new THREE.Group();
  wrapper.add(inner);
  wrapper.userData.weaponId = weaponId;
  wrapper.userData.length = target;
  return wrapper;
}

export function createGun(weaponId) {
  const def = WEAPONS[weaponId] || WEAPONS.pistol;
  const built = buildGunFromCache(weaponId);
  if (built) return built;
  const group = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({
    color: def.color, emissive: def.color, emissiveIntensity: 0.35, roughness: 0.5, metalness: 0.3,
  });

  const long = weaponId === 'sniper' ? 0.82 : weaponId === 'rifle' ? 0.62
    : weaponId === 'shotgun' ? 0.58 : weaponId === 'smg' ? 0.42 : 0.3;

  const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.12, long * 0.55), gunMatBody);
  receiver.position.z = long * 0.22;
  group.add(receiver);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, long * 0.55, 8), gunMatMetal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.018, long * 0.55);
  group.add(barrel);

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.16, 0.09), gunMatBody);
  grip.position.set(0, -0.11, 0.03);
  grip.rotation.x = -0.25;
  group.add(grip);

  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, 0.09), accent);
  mag.position.set(0, -0.1, long * 0.26);
  mag.rotation.x = 0.12;
  group.add(mag);

  if (weaponId === 'sniper') {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8), gunMatMetal);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.1, 0.16);
    group.add(scope);
  } else {
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.05, 0.1), accent);
    sight.position.set(0, 0.09, long * 0.16);
    group.add(sight);
  }

  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

// ------------------------------------------------------------ fighter
export class Fighter {
  constructor({ charId, name, scene, isPlayer = false, charColor = '#ff5a5a' }) {
    this.charId = charId;
    this.name = name;
    this.isPlayer = isPlayer;

    this.visual = createCharacterModel(charId);
    this.root = this.visual.root;
    this.model = this.visual.model;
    this.mixer = this.visual.mixer;
    this.play = this.visual.play;
    this.mats = this.visual.mats;
    // three.js sanitizes glTF node names ("Wrist.R" -> "WristR")
    this.wrist = this.model.getObjectByName('WristR')
      || this.model.getObjectByName('Wrist.R')
      || null;
    this.gunKick = 0;

    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.aimDir = new THREE.Vector3(0, 0, 1);
    this.height = TARGET_HEIGHT;
    this.radius = 0.32;

    this.health = 100;
    this.maxHealth = 100;
    this.shield = 0;
    this.maxShield = 100;
    this.alive = true;
    this.kills = 0;
    this.deathTimer = 0;
    this.hitFlash = 0;
    this.yOffset = 0;
    this.moveSpeed = 0;
    this.combatT = 0;
    this.aimPose = false;
    this.animState = 'Idle_Gun';

    this.weapon = 'pistol';
    this.gun = createGun(this.weapon);
    this.gun.visible = false;
    scene.add(this.gun);

    // emote state
    this.emoteT = 0;
    this.emoteId = null;
    this.emoteSprite = null;

    // hit volumes
    this.hitboxes = [];
    const hbMat = new THREE.MeshBasicMaterial({ visible: false });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.58, 4, 8), hbMat);
    body.position.y = 0.66;
    body.userData.fighter = this;
    body.userData.headshot = false;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), hbMat);
    head.position.y = 1.18;
    head.userData.fighter = this;
    head.userData.headshot = true;
    this.root.add(body, head);
    this.hitboxes.push(body, head);

    // floating name tag (bots)
    if (!isPlayer) {
      this.tag = makeNameTag(name, charColor);
      this.tag.position.y = 1.72;
      this.root.add(this.tag);
    }

    this.root.position.copy(this.pos);
    this.visual.play('Idle_Gun', 0);
  }

  place(x, z) {
    this.pos.set(x, terrainHeight(x, z), z);
    this.root.position.copy(this.pos);
  }

  setWeapon(id) {
    if (this.weapon === id) return;
    this.weapon = id;
    const scene = this.gun.parent;
    scene.remove(this.gun);
    this.gun.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); }
    });
    this.gun = createGun(id);
    this.gun.visible = this.alive;
    scene.add(this.gun);
  }

  markShot() {
    this.combatT = 0.38;
    this.gunKick = 1;
  }

  updateLocomotion(dt) {
    if (!this.alive) return;
    this.combatT = Math.max(0, this.combatT - dt);
    this.gunKick = Math.max(0, this.gunKick - dt * 9);

    const s = this.moveSpeed;
    let name;
    if (s > 4.1) name = 'Run';
    else if (s > 0.55) name = 'Walk';
    else if (this.aimPose) name = 'Idle_Gun_Pointing';
    else name = 'Idle_Gun';

    // while firing, use the dedicated run & gun pose
    if (this.combatT > 0 && s > 0.55) name = 'Run_Shoot';

    if (name !== this.animState) {
      this.animState = name;
      this.play(name, 0.16);
    }
    if (name === 'Run' || name === 'Walk' || name === 'Run_Shoot') {
      const act = this.visual.actions[name];
      if (act) act.setEffectiveTimeScale(Math.max(0.7, Math.min(1.5, s / 4.6)));
    }
  }

  update(dt) {
    this.updateLocomotion(dt);
    this.mixer.update(dt);
    this.updateEmote(dt);
    const groundY = terrainHeight(this.pos.x, this.pos.z) + (this.yOffset || 0);
    this.root.position.set(this.pos.x, groundY, this.pos.z);
    this.pos.y = groundY;
    this.root.rotation.y = this.yaw;

    // hit flash decay
    if (this.hitFlash > 0) {
      this.hitFlash = Math.max(0, this.hitFlash - dt * 5);
      const k = this.hitFlash;
      for (const m of this.mats) {
        if (!m.emissive) continue;
        m.emissive.copy(m.userData.baseEmissive).lerp(new THREE.Color(0xff2a2a), k * 0.9);
      }
    }

    // weapon follows the right hand
    if (this.alive && this.wrist) {
      this.root.updateMatrixWorld(true);
      this.wrist.getWorldPosition(tmpV);
      this.gun.position.copy(tmpV)
        .addScaledVector(this.aimDir, 0.07 - this.gunKick * 0.07)
        .addScaledVector(UP, 0.015);
      tmpQ.setFromUnitVectors(FORWARD, this.aimDir);
      this.gun.quaternion.copy(tmpQ);
      this.gun.visible = true;
    } else {
      this.gun.visible = false;
    }

    if (this.tag) this.tag.material.opacity = this.alive ? 0.9 : 0;
  }

  faceYaw(yaw, speed = 14, dt = 0.016) {
    let d = yaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += d * Math.min(1, speed * dt);
  }

  applyDamage(amount) {
    if (!this.alive) return { died: false, absorbed: 0 };
    let dmg = amount;
    let absorbed = 0;
    if (this.shield > 0) {
      absorbed = Math.min(this.shield, dmg * 0.65);
      this.shield = Math.max(0, this.shield - absorbed);
      dmg -= absorbed;
    }
    this.health -= dmg;
    this.hitFlash = 1;
    if (this.health <= 0) {
      this.health = 0;
      return { died: true, absorbed };
    }
    return { died: false, absorbed };
  }

  die() {
    this.alive = false;
    this.gun.visible = false;
    this.hitboxes.forEach((h) => { h.visible = false; });
    this.play('Death', 0.12, true);
    this.deathTimer = 0;
    if (this.tag) this.tag.material.opacity = 0;
  }

  heal(amount) { this.health = Math.min(this.maxHealth, this.health + amount); }
  addShield(amount) { this.shield = Math.min(this.maxShield, this.shield + amount); }

  // ------------------------------------------------------------ emotes
  playEmote(id) {
    if (!this.alive || this.emoteT > 0) return;
    const EMOTE_ANIM = {
      wave: 'Wave',
      dance: 'Kick_Right',
      taunt: 'Punch_Right',
      salute: 'Interact',
      laugh: 'Idle_Neutral',
      point: 'Kick_Left',
      clap: 'Wave',
      hype: 'Run',
    };
    this.emoteId = id || 'wave';
    this.emoteT = 2.2; // seconds
    const animName = EMOTE_ANIM[this.emoteId] || 'Wave';
    this.play(animName, 0.14, true);
    // create floating text sprite
    if (this.emoteSprite) { this.root.remove(this.emoteSprite); this.emoteSprite = null; }
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.font = 'bold 42px Bahnschrift, Trebuchet MS, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 6;
    g.fillStyle = '#ffb648';
    g.fillText((this.emoteId || 'EMOTE').toUpperCase(), 128, 32);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    this.emoteSprite = new THREE.Sprite(mat);
    this.emoteSprite.scale.set(2.2, 0.55, 1);
    this.emoteSprite.position.y = 2.2;
    this.root.add(this.emoteSprite);
  }

  updateEmote(dt) {
    if (this.emoteT <= 0) return;
    this.emoteT -= dt;
    // bob and pulse while emote is active
    const bob = Math.sin((2.2 - this.emoteT) * 8) * 0.15;
    this.root.position.y = terrainHeight(this.pos.x, this.pos.z) + (this.yOffset || 0) + bob;
    if (this.emoteSprite) {
      this.emoteSprite.position.y = 2.2 + Math.sin((2.2 - this.emoteT) * 4) * 0.2;
    }
    if (this.emoteT <= 0) {
      this.emoteT = 0;
      this.emoteId = null;
      this.play('Idle_Gun', 0.18);
      if (this.emoteSprite) { this.root.remove(this.emoteSprite); this.emoteSprite = null; }
    }
  }
}

function makeNameTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 30px Bahnschrift, Trebuchet MS, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.85)';
  g.shadowBlur = 8;
  g.fillStyle = color;
  g.fillText(name, 128, 30);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(1.7, 0.42, 1);
  return sprite;
}
