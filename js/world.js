// ------------------------------------------------------------------
//  ZONE ROYALE - world (terrain, props, sky, lighting)
// ------------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_R, MAP_SCALE, MAP_SPAN } from './config.js';

// ---------------------------------------------------------------- rng
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------- terrain
// A heightfield is sampled from the imported map mesh so that
// terrainHeight() follows the real surface of the map (slopes, hills)
// instead of a flat plane at y = 0.
let groundY = 0;
let heightGrid = null;   // Float32Array (res * res)
let heightRes = 0;
let heightMinX = 0;
let heightMinZ = 0;
let heightStep = 1;
let hasGroundGrid = null;
let mapSpawnCorners = null;

export function getSpawnCorners() {
  return mapSpawnCorners && mapSpawnCorners.length >= 4 ? mapSpawnCorners : null;
}

export function terrainHeight(x, z) {
  if (!heightGrid) return groundY;
  const res = heightRes;
  let gx = (x - heightMinX) / heightStep;
  let gz = (z - heightMinZ) / heightStep;
  if (gx < 0) gx = 0; else if (gx > res - 1) gx = res - 1;
  if (gz < 0) gz = 0; else if (gz > res - 1) gz = res - 1;
  if (gx > res - 1.0001) gx = res - 1.0001;
  if (gz > res - 1.0001) gz = res - 1.0001;
  const x0 = gx | 0, z0 = gz | 0;
  const tx = gx - x0, tz = gz - z0;
  const x1 = x0 + 1, z1 = z0 + 1;
  const g = heightGrid;
  const h00 = g[z0 * res + x0], h10 = g[z0 * res + x1];
  const h01 = g[z1 * res + x0], h11 = g[z1 * res + x1];
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz)
       + (h01 * (1 - tx) + h11 * tx) * tz;
}

// ------------------------------------------------- heightfield builder
// Rasterises every upward-facing triangle of the map onto a square grid,
// then flood-fills gaps and blurs slightly for smooth walking.
const hfA = new THREE.Vector3();
const hfB = new THREE.Vector3();
const hfC = new THREE.Vector3();
const hfE1 = new THREE.Vector3();
const hfE2 = new THREE.Vector3();
const hfN = new THREE.Vector3();

function buildHeightfield(mapRoot, bounds) {
  heightGrid = null;
  // keep ~1.1 m resolution even though the map is scaled up by MAP_SCALE
  const res = Math.max(255, Math.min(1024, Math.round(255 * MAP_SCALE)));
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeZ = bounds.max.z - bounds.min.z;
  const step = Math.max(sizeX, sizeZ) / (res - 1);
  if (!isFinite(step) || step <= 0) return;
  const minX = (bounds.min.x + bounds.max.x) / 2 - step * (res - 1) / 2;
  const minZ = (bounds.min.z + bounds.max.z) / 2 - step * (res - 1) / 2;
  const data = new Float32Array(res * res).fill(Infinity);
  const invStep = 1 / step;

  function rasterizeTri(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const gax = (ax - minX) * invStep, gaz = (az - minZ) * invStep;
    const gbx = (bx - minX) * invStep, gbz = (bz - minZ) * invStep;
    const gcx = (cx - minX) * invStep, gcz = (cz - minZ) * invStep;
    const e1x = gbx - gax, e1z = gbz - gaz;
    const e2x = gcx - gax, e2z = gcz - gaz;
    const denom = e1x * e2z - e1z * e2x;
    if (!isFinite(denom) || Math.abs(denom) < 1e-7) return;
    const invD = 1 / denom;
    const dby = by - ay, dcy = cy - ay;

    let c0 = Math.floor(Math.min(gax, gbx, gcx));
    let c1 = Math.ceil(Math.max(gax, gbx, gcx));
    let r0 = Math.floor(Math.min(gaz, gbz, gcz));
    let r1 = Math.ceil(Math.max(gaz, gbz, gcz));
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 > res - 1) c1 = res - 1;
    if (r1 > res - 1) r1 = res - 1;
    if (c0 > c1 || r0 > r1) return;

    for (let r = r0; r <= r1; r++) {
      const wz = r - gaz;
      const row = r * res;
      for (let col = c0; col <= c1; col++) {
        const wx = col - gax;
        // solve  e1*u + e2*v = w
        const u = (wx * e2z - wz * e2x) * invD;
        const v = (e1x * wz - e1z * wx) * invD;
        if (u < -0.02 || v < -0.02 || u + v > 1.02) continue;
        const h = ay + dby * u + dcy * v;
        const i = row + col;
        if (h < data[i]) data[i] = h;
      }
    }
  }

  mapRoot.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry;
    if (!geo || !geo.attributes.position) return;
    o.updateWorldMatrix(true, false);
    const M = o.matrixWorld;
    const pos = geo.attributes.position;
    const idx = geo.index;
    const triCount = (idx ? idx.count : pos.count) / 3 | 0;
    for (let f = 0; f < triCount; f++) {
      let i0 = f * 3, i1 = i0 + 1, i2 = i0 + 2;
      if (idx) {
        i0 = idx.getX(f * 3); i1 = idx.getX(f * 3 + 1); i2 = idx.getX(f * 3 + 2);
      }
      hfA.fromBufferAttribute(pos, i0).applyMatrix4(M);
      hfB.fromBufferAttribute(pos, i1).applyMatrix4(M);
      hfC.fromBufferAttribute(pos, i2).applyMatrix4(M);
      hfE1.subVectors(hfB, hfA);
      hfE2.subVectors(hfC, hfA);
      hfN.crossVectors(hfE1, hfE2);
      const nl = hfN.length();
      if (nl < 1e-8) continue;
      // keep only floor-like faces (ignore vertical walls / steep cliffs)
      if (Math.abs(hfN.y) / nl < 0.55) continue;
      rasterizeTri(hfA.x, hfA.y, hfA.z, hfB.x, hfB.y, hfB.z, hfC.x, hfC.y, hfC.z);
    }
  });

  // capture which cells actually contain real ground (not flood-filled gaps)
  hasGroundGrid = new Uint8Array(res * res);
  for (let i = 0; i < res * res; i++) {
    if (data[i] !== Infinity) hasGroundGrid[i] = 1;
  }

  // flood-fill empty cells from their neighbours
  for (let pass = 0; pass < 240; pass++) {
    let empty = false;
    for (let r = 0; r < res; r++) {
      const row = r * res;
      for (let col = 0; col < res; col++) {
        const i = row + col;
        if (data[i] !== Infinity) continue;
        let best = Infinity;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr > res - 1) continue;
          const rrow = rr * res;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = col + dc;
            if (cc < 0 || cc > res - 1) continue;
            const v = data[rrow + cc];
            if (v < best) best = v;
          }
        }
        if (best < Infinity) data[i] = best;
        else empty = true;
      }
    }
    if (!empty) break;
  }
  for (let i = 0; i < data.length; i++) {
    if (data[i] === Infinity) data[i] = 0;
  }

  // 2 light blur passes to remove raster stepping
  const blur = Float32Array.from(data);
  for (let p = 0; p < 2; p++) {
    for (let r = 0; r < res; r++) {
      for (let col = 0; col < res; col++) {
        let sum = 0, cnt = 0;
        for (let dr = -1; dr <= 1; dr++) {
          const rr = r + dr;
          if (rr < 0 || rr > res - 1) continue;
          const rrow = rr * res;
          for (let dc = -1; dc <= 1; dc++) {
            const cc = col + dc;
            if (cc < 0 || cc > res - 1) continue;
            sum += blur[rrow + cc]; cnt++;
          }
        }
        data[r * res + col] = sum / cnt;
      }
    }
    if (p === 0) blur.set(data);
  }

  heightGrid = data;
  heightRes = res;
  heightMinX = minX;
  heightMinZ = minZ;
  heightStep = step;
}

// ------------------------------------------------------------ colliders
const obstacles = [];

// collision grid state
let collisionGrid = null;
let collisionCell = 1.0;
let collisionMinX = 0, collisionMinZ = 0;
let collisionCols = 0, collisionRows = 0;

function buildCollisionGrid(mapRoot, bounds) {
  collisionGrid = null;
  if (!mapRoot) return;
  const sizeX = bounds.max.x - bounds.min.x;
  const sizeZ = bounds.max.z - bounds.min.z;
  const span = Math.max(sizeX, sizeZ);
  collisionCell = 1.0;
  collisionCols = Math.ceil(span / collisionCell) + 4;
  collisionRows = Math.ceil(span / collisionCell) + 4;
  collisionMinX = (bounds.min.x + bounds.max.x) / 2 - (collisionCols * collisionCell) / 2;
  collisionMinZ = (bounds.min.z + bounds.max.z) / 2 - (collisionRows * collisionCell) / 2;
  collisionGrid = new Uint8Array(collisionCols * collisionRows);

  const invCell = 1 / collisionCell;
  const nameRe = /wall|building|house|trunk|tree|rock|fence|barrier|crate/i;

  mapRoot.updateMatrixWorld(true);
  mapRoot.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (!nameRe.test(o.name || '') && !nameRe.test(o.parent?.name || '')) return;

    const box = new THREE.Box3().setFromObject(o);
    if (box.isEmpty()) return;

    // Combined scenery meshes (e.g. the giant cliff bridge) can have a
    // bounding box hundreds of metres wide. Marking the whole box would make
    // a huge, invisible wall across the map; skip oversized props and let the
    // heightfield handle walking over their surface.
    const spanX = box.max.x - box.min.x;
    const spanZ = box.max.z - box.min.z;
    if (Math.max(spanX, spanZ) > 60 || spanX * spanZ > 2600) return;

    const c0 = Math.max(0, Math.floor((box.min.x - collisionMinX) / collisionCell));
    const c1 = Math.min(collisionCols - 1, Math.floor((box.max.x - collisionMinX) / collisionCell));
    const r0 = Math.max(0, Math.floor((box.min.z - collisionMinZ) / collisionCell));
    const r1 = Math.min(collisionRows - 1, Math.floor((box.max.z - collisionMinZ) / collisionCell));

    for (let rr = r0; rr <= r1; rr++) {
      for (let cc = c0; cc <= c1; cc++) {
        collisionGrid[rr * collisionCols + cc] = 1;
      }
    }
  });
}

function pointInTriangleXZ(px, pz, a, b, c) {
  const d1 = (px - b.x) * (a.z - b.z) + (pz - b.z) * (b.x - a.x);
  const d2 = (px - c.x) * (b.z - c.z) + (pz - c.z) * (c.x - b.x);
  const d3 = (px - a.x) * (c.z - a.z) + (pz - a.z) * (a.x - c.x);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

export function resolveCollision(pos, radius) {
  const d = Math.hypot(pos.x, pos.z);
  if (d > ARENA_R - 1.5) {
    const k = (ARENA_R - 1.5) / d;
    pos.x *= k; pos.z *= k;
  }

  if (!collisionGrid) return;

  const cellR = Math.ceil((radius + collisionCell) / collisionCell);
  const gc = Math.floor((pos.x - collisionMinX) / collisionCell);
  const gr = Math.floor((pos.z - collisionMinZ) / collisionCell);

  for (let dr = -cellR; dr <= cellR; dr++) {
    for (let dc = -cellR; dc <= cellR; dc++) {
      const r = gr + dr, c = gc + dc;
      if (r < 0 || c < 0 || r >= collisionRows || c >= collisionCols) continue;
      if (!collisionGrid[r * collisionCols + c]) continue;
      const cellX = collisionMinX + (c + 0.5) * collisionCell;
      const cellZ = collisionMinZ + (r + 0.5) * collisionCell;
      const dx = pos.x - cellX, dz = pos.z - cellZ;
      const dist = Math.hypot(dx, dz);
      const minDist = radius + collisionCell * 0.5;
      if (dist < minDist && dist > 0.0001) {
        const push = (minDist - dist) / dist;
        pos.x += dx * push;
        pos.z += dz * push;
      } else if (dist <= 0.0001) {
        pos.x += collisionCell;
      }
    }
  }
}

export function randomOpenPoint(rng, minR = 0, maxR = ARENA_R - 8) {
  for (let i = 0; i < 80; i++) {
    const a = rng() * Math.PI * 2;
    const r = minR + Math.sqrt(rng()) * (maxR - minR);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    let blocked = false;
    if (collisionGrid) {
      const c = Math.floor((x - collisionMinX) / collisionCell);
      const rr = Math.floor((z - collisionMinZ) / collisionCell);
      if (c >= 0 && rr >= 0 && c < collisionCols && rr < collisionRows) {
        if (collisionGrid[rr * collisionCols + c]) blocked = true;
      }
    }
    for (const o of obstacles) {
      if (o.type === 'circle') {
        if ((x - o.x) ** 2 + (z - o.z) ** 2 < (o.r + 1.1) ** 2) { blocked = true; break; }
      } else if (Math.abs(x - o.x) < o.hw + 1.0 && Math.abs(z - o.z) < o.hd + 1.0) {
        blocked = true; break;
      }
    }
    if (!blocked) return new THREE.Vector3(x, terrainHeight(x, z), z);
  }
  return new THREE.Vector3(0, terrainHeight(0, 0), 0);
}

// ------------------------------------------------ ray vs. heightfield
export function getSpawnPoints(count = 20) {
  if (!hasGroundGrid || !heightGrid) return null;
  const res = heightRes;
  const step = heightStep;
  const minX = heightMinX, minZ = heightMinZ;

  // gather candidate cells that contain real ground and are inside the arena
  const candidates = [];
  for (let r = 0; r < res; r++) {
    for (let c = 0; c < res; c++) {
      if (!hasGroundGrid[r * res + c]) continue;
      const x = minX + c * step;
      const z = minZ + r * step;
      if (Math.hypot(x, z) > ARENA_R - 12) continue;
      // avoid building collisions
      if (collisionGrid) {
        const gc = Math.floor((x - collisionMinX) / collisionCell);
        const gr = Math.floor((z - collisionMinZ) / collisionCell);
        if (gc >= 0 && gr >= 0 && gc < collisionCols && gr < collisionRows) {
          if (collisionGrid[gr * collisionCols + gc]) continue;
        }
      }
      candidates.push({ x, z });
    }
  }
  if (candidates.length < count) return null;

  // farthest-point sampling: spread the points as far apart as possible
  const chosen = [candidates[Math.floor(Math.random() * candidates.length)]];
  while (chosen.length < count) {
    let best = null, bestDist = -1;
    for (const cand of candidates) {
      let minD = Infinity;
      for (const p of chosen) {
        const d = Math.hypot(cand.x - p.x, cand.z - p.z);
        if (d < minD) minD = d;
      }
      if (minD > bestDist) { bestDist = minD; best = cand; }
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

export function rayTerrain(origin, dir, maxDist) {
  if (Math.abs(dir.y) < 0.0001) return null;
  const steps = 56;
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (maxDist * i) / steps;
    const x = origin.x + dir.x * t;
    const y = origin.y + dir.y * t;
    const z = origin.z + dir.z * t;
    if (y < terrainHeight(x, z)) {
      let lo = prevT, hi = t;
      for (let k = 0; k < 7; k++) {
        const m = (lo + hi) * 0.5;
        const my = origin.y + dir.y * m;
        if (my < terrainHeight(origin.x + dir.x * m, origin.z + dir.z * m)) hi = m;
        else lo = m;
      }
      return hi;
    }
    prevT = t;
  }
  return null;
}

// ------------------------------------------------------------ textures
function grassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9d9d9';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const v = 150 + Math.random() * 105;
    g.fillStyle = `rgba(${v},${v},${v},${0.35 + Math.random() * 0.5})`;
    const x = Math.random() * 256, y = Math.random() * 256;
    const w = 1 + Math.random() * 3, h = 1 + Math.random() * 5;
    g.fillRect(x, y, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(42, 42);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---------------------------------------------------------------- props
function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.9, metalness: 0.02,
    flatShading: true, ...opts,
  });
}

function markShadow(obj) {
  obj.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
}

// ------------------------------------------------------------ map loader
const MAP_URL = './free_fire_old_peak_3d_model.glb';
export function loadMap(onProgress) {
  const loader = new GLTFLoader();
  return new Promise((resolve, reject) => {
    loader.load(
      MAP_URL,
      (gltf) => resolve(gltf.scene),
      (e) => { if (onProgress && e.total) onProgress(e.loaded / e.total); },
      (err) => reject(err)
    );
  });
}

// ------------------------------------------------------------ world (map)
export function createWorld(scene, mapRoot = null) {
  obstacles.length = 0;
  const raycastTargets = [];
  const group = new THREE.Group();
  scene.add(group);

  // ------------------------------------------------------------- sky
  scene.fog = new THREE.FogExp2(0xc7dce8, 0.0036 / MAP_SCALE);
  const skyGeo = new THREE.SphereGeometry(700, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      top:    { value: new THREE.Color(0x2f6bb0) },
      mid:    { value: new THREE.Color(0x8fc0e0) },
      bottom: { value: new THREE.Color(0xe8dcc4) },
      sunDir: { value: new THREE.Vector3(0.55, 0.55, 0.35).normalize() },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
    `,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 top, mid, bottom, sunDir;
      void main(){
        float h = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 col = mix(bottom, mid, smoothstep(0.42, 0.57, h));
        col = mix(col, top, smoothstep(0.55, 1.0, h));
        float sun = pow(max(dot(vDir, normalize(sunDir)), 0.0), 220.0);
        float halo = pow(max(dot(vDir, normalize(sunDir)), 0.0), 14.0) * 0.22;
        col += vec3(1.0, 0.86, 0.62) * (sun * 1.6 + halo);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.frustumCulled = false;
  scene.add(sky);

  // ---------------------------------------------------------- lights
  scene.add(new THREE.HemisphereLight(0xbfe0ff, 0x4a5535, 1.15));
  const sun = new THREE.DirectionalLight(0xfff0d2, 2.35);
  sun.position.set(55, 80, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 230;
  sun.shadow.camera.left = -34;
  sun.shadow.camera.right = 34;
  sun.shadow.camera.top = 34;
  sun.shadow.camera.bottom = -34;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun);
  scene.add(sun.target);

  // ---------------------------------------------------- imported map
  const ground = null;
  if (mapRoot) {
    // fit to arena
    const box = new THREE.Box3().setFromObject(mapRoot);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.z) || 1;
    const scale = MAP_SPAN / maxDim;
    mapRoot.scale.setScalar(scale);
    mapRoot.updateMatrixWorld(true);
    const box2 = new THREE.Box3().setFromObject(mapRoot);
    const c2 = box2.getCenter(new THREE.Vector3());
    mapRoot.position.x -= c2.x;
    mapRoot.position.z -= c2.z;
    mapRoot.position.y -= box2.min.y;
    mapRoot.updateMatrixWorld(true);

    mapRoot.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        raycastTargets.push(o);
      }
    });
    group.add(mapRoot);
    // sample real terrain heights from the map so characters follow the surface
    buildHeightfield(mapRoot, box2);
    // build a low-resolution collision grid from wall meshes so players
    // cannot walk through buildings / trees (doors stay passable)
    buildCollisionGrid(mapRoot, box2);
    // Spread spawns across the four extreme diagonal directions of the map
    // model (the literal model corners lie outside the arena / off-model).
    // Each direction is pushed to the edge of the playable arena so the 20
    // fighters start far apart instead of bunching up in the centre.
    const halfX = (box2.max.x - box2.min.x) / 2;
    const halfZ = (box2.max.z - box2.min.z) / 2;
    const diagLen = Math.hypot(halfX, halfZ) || 1;
    const ux = halfX / diagLen, uz = halfZ / diagLen;
    const spawnR = ARENA_R - 8;
    mapSpawnCorners = [
      { x: ux * spawnR, z: uz * spawnR },
      { x: -ux * spawnR, z: uz * spawnR },
      { x: ux * spawnR, z: -uz * spawnR },
      { x: -ux * spawnR, z: -uz * spawnR },
    ];
  }

  // ------------------------------------------------------------- api
  const tmpSunTarget = new THREE.Vector3();
  function update(dt, focus) {
    if (!focus) return;
    sun.target.position.set(focus.x, 0, focus.z);
    sun.position.set(focus.x + 55, 80, focus.z + 35);
    sun.target.updateMatrixWorld();
    tmpSunTarget.copy(focus);
  }

  return { group, raycastTargets, obstacles, ground, sun, update };
}
