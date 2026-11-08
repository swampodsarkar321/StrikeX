// ------------------------------------------------------------------
//  ZONE ROYALE - visual effects (tracers, muzzle flash, impacts, numbers)
// ------------------------------------------------------------------
import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

function radialTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, inner);
  grad.addColorStop(0.45, outer);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32);
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  for (let i = 0; i < 6; i++) {
    g.rotate(Math.PI / 3);
    g.beginPath();
    g.moveTo(0, 2);
    g.lineTo(0, 16 + Math.random() * 12);
    g.stroke();
  }
  const grad = g.createRadialGradient(0, 0, 0, 0, 0, 14);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.flashTex = radialTexture('rgba(255,255,235,1)', 'rgba(255,170,60,0.85)');
    this.sparkTex = sparkTexture();
    this.tracers = [];
    this.flashes = [];
    this.impacts = [];
    this.numbers = [];
    this.container = document.getElementById('dmgNumbers');
    this.light = new THREE.PointLight(0xffc477, 0, 14, 2);
    scene.add(this.light);
    this.lightLife = 0;

    const tracerGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 5, 1, true);
    tracerGeo.translate(0, 0.5, 0);
    for (let i = 0; i < 26; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffe0a0, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, max: 0.09 });
    }

    for (let i = 0; i < 18; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.flashTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      scene.add(sp);
      this.flashes.push({ sprite: sp, life: 0, max: 0.07 });
    }

    for (let i = 0; i < 26; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.sparkTex, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      scene.add(sp);
      this.impacts.push({ sprite: sp, life: 0, max: 0.2 });
    }
  }

  tracer(from, to, color = 0xffe0a0) {
    const t = this.tracers.find((x) => x.life <= 0) || this.tracers[0];
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    t.mesh.position.copy(from);
    t.mesh.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
    t.mesh.scale.set(1, len, 1);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 0.9;
    t.mesh.visible = true;
    t.life = t.max;
  }

  flash(pos, color = 0xffc477, size = 1) {
    const f = this.flashes.find((x) => x.life <= 0) || this.flashes[0];
    f.sprite.position.copy(pos);
    f.sprite.material.color.setHex(color);
    f.sprite.material.opacity = 0.95;
    f.sprite.scale.setScalar(rand(1.1, 1.9) * size);
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = f.max;
    this.light.position.copy(pos);
    this.light.intensity = 24 * size;
    this.lightLife = 0.06;
  }

  impact(pos, color = 0xffc477) {
    const s = this.impacts.find((x) => x.life <= 0) || this.impacts[0];
    s.sprite.position.copy(pos);
    s.sprite.material.color.setHex(color);
    s.sprite.material.opacity = 1;
    s.sprite.scale.setScalar(0.55);
    s.sprite.visible = true;
    s.life = s.max;
  }

  damageNumber(pos, value, headshot = false, kill = false) {
    const el = document.createElement('div');
    el.className = 'dmg-num' + (headshot ? ' head' : '') + (kill ? ' kill' : '');
    el.textContent = (kill ? '✕ ' : '') + value;
    this.container.appendChild(el);
    this.numbers.push({ el, pos: pos.clone(), life: 0.9, max: 0.9, drift: rand(-0.3, 0.3) });
  }

  update(dt, camera) {
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const k = Math.max(0, t.life / t.max);
      t.mesh.material.opacity = k * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const k = Math.max(0, f.life / f.max);
      f.sprite.material.opacity = k;
      f.sprite.scale.multiplyScalar(1 + dt * 2.5);
      if (f.life <= 0) f.sprite.visible = false;
    }
    for (const s of this.impacts) {
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.max);
      s.sprite.material.opacity = k;
      s.sprite.scale.setScalar(0.55 + (1 - k) * 1.5);
      if (s.life <= 0) s.sprite.visible = false;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) this.light.intensity = 0;
    }

    // floating damage numbers
    for (let i = this.numbers.length - 1; i >= 0; i--) {
      const n = this.numbers[i];
      n.life -= dt;
      n.pos.y += dt * 1.1;
      n.pos.x += n.drift * dt;
      if (n.life <= 0) {
        n.el.remove();
        this.numbers.splice(i, 1);
        continue;
      }
      const v = n.pos.clone().project(camera);
      if (v.z > 1) { n.el.style.opacity = '0'; continue; }
      const x = (v.x * 0.5 + 0.5) * window.innerWidth;
      const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
      n.el.style.transform = `translate(-50%,-50%) translate(${x}px,${y}px) scale(${1 + (1 - n.life / n.max) * 0.35})`;
      n.el.style.opacity = String(Math.min(1, n.life / n.max * 1.6));
    }
  }

  clear() {
    for (const n of this.numbers) n.el.remove();
    this.numbers.length = 0;
    for (const t of this.tracers) { t.life = 0; t.mesh.visible = false; }
    for (const f of this.flashes) { f.life = 0; f.sprite.visible = false; }
    for (const s of this.impacts) { s.life = 0; s.sprite.visible = false; }
    this.light.intensity = 0;
  }
}

function rand(a, b) { return a + Math.random() * (b - a); }
