// ------------------------------------------------------------------
//  ZONE ROYALE - HUD
// ------------------------------------------------------------------
import { ARENA_R, ZONE_PHASES, WEAPONS, EP_MAX, CHAR_ABILITIES } from './config.js';
import * as THREE from 'three';

const $ = (s) => document.querySelector(s);
const TAU = Math.PI * 2;

export class HUD {
  constructor() {
    this.el = {
      alive: $('#aliveNum'),
      kills: $('#killNum'),
      timer: $('#timerVal'),
      hpFill: $('#hpFill'),
      hpVal: $('#hpVal'),
      shFill: $('#shFill'),
      zoneStatus: $('#zoneStatus'),
      zoneTime: $('#zoneTime'),
      weapon: $('#weaponName'),
      ammoMag: $('#ammoMag'),
      ammoRes: $('#ammoRes'),
      slots: $('#slotList'),
      feed: $('#feed'),
      toast: $('#toast'),
      prompt: $('#prompt'),
      hitmarker: $('#hitmarker'),
      hurt: $('#hurtVignette'),
      storm: $('#stormVignette'),
      reload: $('#reloadBar'),
      reloadWrap: $('#reloadWrap'),
      crosshair: $('#crosshair'),
      dirs: $('#damageDirs'),
      end: $('#endScreen'),
      endTitle: $('#endTitle'),
      endSub: $('#endSub'),
      endStats: $('#endStats'),
      epFill: $('#epFill'),
      abilityChip: $('#abilityChip'),
      abilityName: $('#abilityName'),
      abilityCd: $('#abilityCd'),
      glooCount: $('#glooCount'),
      announce: $('#announce'),
      announceText: $('#announceText'),
      announceSub: $('#announceSub'),
    };
    this.map = $('#minimap');
    this.map.width = 380;
    this.map.height = 380;
    this.mapCtx = this.map.getContext('2d');

    this.hitTimer = 0;
    this.hurtTimer = 0;
    this.stormTimer = 0;
    this.mapTimer = 0;
    this.toastTimer = 0;
    this.announceTimer = 0;
    this.lastSlots = '';
    this.dirPool = [];
    for (let i = 0; i < 4; i++) {
      const d = document.createElement('div');
      d.className = 'dmg-dir';
      d.style.opacity = '0';
      this.el.dirs.appendChild(d);
      this.dirPool.push({ el: d, life: 0 });
    }
    this.dirIndex = 0;
  }

  reset() {
    this.el.feed.innerHTML = '';
    if (this.el.end) this.el.end.classList.add('hidden');
    this.el.hurt.style.opacity = '0';
    this.el.storm.style.opacity = '0';
    this.el.toast.style.opacity = '0';
    this.el.prompt.style.opacity = '0';
    if (this.el.announce) { this.el.announce.classList.add('hidden'); this.el.announce.classList.remove('show'); }
    this.announceTimer = 0;
    this.hitTimer = 0;
    this.hurtTimer = 0;
    this.stormTimer = 0;
    this.lastSlots = '';
    this.dirPool.forEach((d) => { d.life = 0; d.el.style.opacity = '0'; });
  }

  toast(text, tone = '') {
    const t = this.el.toast;
    t.textContent = text;
    t.className = 'toast show ' + tone;
    this.toastTimer = 2.2;
  }

  announce(text, sub = '') {
    if (!this.el.announce) return;
    this.el.announceText.textContent = text;
    this.el.announceSub.textContent = sub;
    this.el.announce.classList.remove('hidden', 'show');
    void this.el.announce.offsetWidth;
    this.el.announce.classList.add('show');
    this.announceTimer = 2.4;
  }

  setPrompt(text) {
    const p = this.el.prompt;
    if (!text) { p.style.opacity = '0'; return; }
    p.style.opacity = '1';
    if (p.dataset.text !== text) {
      p.innerHTML = `<b>E</b> ${text}`;
      p.dataset.text = text;
    }
  }

  feed(killer, victim, playerKill = false) {
    const row = document.createElement('div');
    row.className = 'feed-row' + (playerKill ? ' mine' : '');
    row.innerHTML = `<b>${killer}</b><i>eliminated</i><b class="victim">${victim}</b>`;
    this.el.feed.prepend(row);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => {
      row.classList.add('fade');
      setTimeout(() => row.remove(), 700);
    }, 5200);
  }

  hitmarker(headshot = false) {
    this.hitTimer = 0.18;
    this.el.hitmarker.className = 'hitmarker show' + (headshot ? ' head' : '');
  }

  hurtBy(worldPos, cameraYaw) {
    this.hurtTimer = 0.35;
    const p = this.player;
    if (!p) return;
    const bearing = Math.atan2(worldPos.x - p.pos.x, worldPos.z - p.pos.z);
    let rel = bearing - (cameraYaw + Math.PI);
    while (rel > Math.PI) rel -= TAU;
    while (rel < -Math.PI) rel += TAU;
    const d = this.dirPool[this.dirIndex % this.dirPool.length];
    this.dirIndex++;
    d.life = 1.1;
    d.el.style.transform = `rotate(${rel * 180 / Math.PI}deg)`;
    d.el.style.opacity = '1';
  }

  update(dt, M, extras) {
    this.player = M.player;
    const p = M.player;

    // vitals
    this.el.hpFill.style.width = `${(p.health / p.maxHealth) * 100}%`;
    this.el.hpVal.textContent = Math.ceil(p.health);
    this.el.shFill.style.width = `${(p.shield / p.maxShield) * 100}%`;
    if (this.el.epFill) this.el.epFill.style.width = `${((p.ep || 0) / EP_MAX) * 100}%`;
    this.el.hpFill.classList.toggle('low', p.health <= 30);

    // match stats
    this.el.alive.textContent = M.alive;
    this.el.kills.textContent = p.kills;
    const t = Math.max(0, (performance.now() - M.startedAt) / 1000);
    this.el.timer.textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

    // zone
    const z = M.zone;
    if (z.state === 'wait') {
      this.el.zoneStatus.textContent = 'SAFE ZONE APPEARS IN';
      this.el.zoneStatus.classList.remove('closing');
    } else if (z.state === 'shrink') {
      this.el.zoneStatus.textContent = 'SAFE ZONE SHRINKING';
      this.el.zoneStatus.classList.add('closing');
    } else {
      this.el.zoneStatus.textContent = 'FINAL ZONE';
      this.el.zoneStatus.classList.remove('closing');
    }
    this.el.zoneTime.textContent = z.state === 'final' ? '--:--' : `${String(Math.floor(z.timer / 60)).padStart(2, '0')}:${String(Math.ceil(z.timer % 60)).padStart(2, '0')}`;

    // weapon
    const slot = p.slots[p.slotIndex];
    const def = WEAPONS[slot.id];
    this.el.weapon.textContent = def.name;
    this.el.ammoMag.textContent = slot.mag;
    this.el.ammoRes.textContent = isFinite(slot.reserve) ? slot.reserve : '∞';
    this.el.ammoMag.classList.toggle('empty', slot.mag === 0);

    const slotKey = p.slots.map((s, i) => `${i}:${s ? s.id : '-'}:${i === p.slotIndex}`).join('|');
    if (slotKey !== this.lastSlots) {
      this.lastSlots = slotKey;
      this.el.slots.innerHTML = p.slots.map((s, i) => (
        s ? `<div class="slot ${i === p.slotIndex ? 'active' : ''}"><span>${i + 1}</span>${WEAPONS[s.id].name}</div>` : ''
      )).join('');
    }

    // reload
    if (p.reloading > 0) {
      this.el.reloadWrap.classList.add('show');
      this.el.reload.style.width = `${(1 - p.reloading / def.reload) * 100}%`;
    } else {
      this.el.reloadWrap.classList.remove('show');
    }

    // crosshair bloom
    const speed = Math.hypot(p.vel.x, p.vel.z);
    let gap = 6 + (extras.aiming ? -2 : 0) + (speed > 1.5 ? 7 : 0) + (p.grounded ? 0 : 9);
    if (p.weapon === 'shotgun') gap += 3;
    this.el.crosshair.style.setProperty('--gap', `${Math.max(2, gap)}px`);
    this.el.crosshair.classList.toggle('ads', extras.aiming);

    // teammate / enemy markers? (kept minimal)

    // hitmarker timer
    if (this.hitTimer > 0) {
      this.hitTimer -= dt;
      if (this.hitTimer <= 0) this.el.hitmarker.className = 'hitmarker';
    }

    // hurt / storm vignettes
    if (this.hurtTimer > 0) {
      this.hurtTimer -= dt;
      this.el.hurt.style.opacity = String(Math.min(1, this.hurtTimer / 0.35) * 0.9);
    } else {
      this.el.hurt.style.opacity = '0';
    }

    const distC = Math.hypot(p.pos.x - z.center.x, p.pos.z - z.center.z);
    const outside = Math.max(0, distC - z.r);
    const stormLevel = z.r < 2 ? 1 : Math.min(1, outside / 12);
    this.el.storm.style.opacity = String(stormLevel * 0.85);
    this.stormTimer = stormLevel;

    // damage directions
    for (const d of this.dirPool) {
      if (d.life <= 0) continue;
      d.life -= dt;
      d.el.style.opacity = String(Math.max(0, Math.min(1, d.life)));
    }

    // toast timeout
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.el.toast.classList.remove('show');
    }

    // ability chip
    const ab = CHAR_ABILITIES[p.charId];
    if (ab && this.el.abilityChip) {
      this.el.abilityName.textContent = ab.name;
      const cd = M.abilityCd || 0, act = M.abilityActive || 0;
      this.el.abilityChip.classList.toggle('cooling', cd > 0 && act <= 0);
      this.el.abilityCd.textContent = act > 0 ? 'ACTIVE' : cd > 0 ? `${Math.ceil(cd)}s` : 'READY';
    }
    if (this.el.glooCount) this.el.glooCount.textContent = `${M.glooCount ?? 0} LEFT`;

    // announce hide
    if (this.announceTimer > 0) {
      this.announceTimer -= dt;
      if (this.announceTimer <= 0 && this.el.announce) this.el.announce.classList.add('hidden');
    }

    // minimap throttled
    this.mapTimer -= dt;
    if (this.mapTimer <= 0) {
      this.mapTimer = 1 / 15;
      this.drawMinimap(M);
    }
  }

  drawMinimap(M) {
    const g = this.mapCtx;
    const S = this.map.width;
    const c = S / 2;
    const scale = (S / 2 - 10) / ARENA_R;
    const p = M.player;
    const z = M.zone;
    const toX = (x) => c + x * scale;
    const toY = (y) => c + y * scale;

    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath();
    if (g.roundRect) g.roundRect(0, 0, S, S, 26);
    else g.rect(0, 0, S, S);
    g.clip();

    g.fillStyle = 'rgba(12,24,26,0.82)';
    g.fillRect(0, 0, S, S);

    // land tint
    g.fillStyle = 'rgba(72,110,70,0.55)';
    g.beginPath();
    g.arc(c, c, (ARENA_R + 4) * scale, 0, TAU);
    g.fill();

    // grid
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let i = -100; i <= 100; i += 25) {
      g.beginPath(); g.moveTo(toX(i), 0); g.lineTo(toX(i), S); g.stroke();
      g.beginPath(); g.moveTo(0, toY(i)); g.lineTo(S, toY(i)); g.stroke();
    }

    // storm area (everything outside safe circle)
    const zx = toX(z.center.x), zy = toY(z.center.z), zr = z.r * scale;
    g.beginPath();
    g.rect(0, 0, S, S);
    g.arc(zx, zy, zr, 0, TAU, true);
    g.fillStyle = 'rgba(255,64,64,0.20)';
    g.fill('evenodd');

    // safe zone outline
    g.beginPath();
    g.arc(zx, zy, Math.max(1, zr), 0, TAU);
    g.strokeStyle = 'rgba(255,120,90,0.95)';
    g.lineWidth = 4;
    g.stroke();

    // next circle while shrinking
    if (z.state === 'shrink') {
      g.beginPath();
      g.arc(toX(z.toC.x), toY(z.toC.z), Math.max(1, z.toR * scale), 0, TAU);
      g.setLineDash([9, 9]);
      g.strokeStyle = 'rgba(255,255,255,0.65)';
      g.lineWidth = 2;
      g.stroke();
      g.setLineDash([]);
    }

    // loot nearby
    for (const l of M.loot) {
      if (l.taken) continue;
      const dx = l.group.position.x - p.pos.x, dz = l.group.position.z - p.pos.z;
      if (dx * dx + dz * dz > 45 * 45) continue;
      g.fillStyle = l.type === 'weapon' ? 'rgba(255,180,70,0.95)'
        : l.type === 'health' ? 'rgba(90,255,150,0.9)'
        : l.type === 'shield' ? 'rgba(90,170,255,0.9)'
        : 'rgba(255,220,120,0.85)';
      g.beginPath();
      g.arc(toX(l.group.position.x), toY(l.group.position.z), 3, 0, TAU);
      g.fill();
    }

    // airdrop crates
    if (M.airdrops && M.airdrops.length) {
      for (const a of M.airdrops) {
        if (a.taken) continue;
        const ax = toX(a.group.position.x), ay = toY(a.group.position.z);
        g.save();
        g.translate(ax, ay);
        g.rotate(Math.PI / 4);
        g.fillStyle = '#ffb648';
        g.strokeStyle = '#1a1200';
        g.lineWidth = 2.5;
        g.beginPath();
        g.rect(-6, -6, 12, 12);
        g.fill();
        g.stroke();
        g.restore();
      }
    }

    // enemies
    for (const f of M.fighters) {
      if (f === p || !f.alive) continue;
      const dx = f.pos.x - p.pos.x, dz = f.pos.z - p.pos.z;
      if (dx * dx + dz * dz > 65 * 65) continue;
      g.fillStyle = 'rgba(255,80,80,0.95)';
      g.beginPath();
      g.arc(toX(f.pos.x), toY(f.pos.z), 4, 0, TAU);
      g.fill();
    }

    // player arrow
    const px = toX(p.pos.x), py = toY(p.pos.z);
    const dir = p.aimDir;
    const ang = Math.atan2(dir.x, dir.z);
    g.save();
    g.translate(px, py);
    g.rotate(-ang + Math.PI);
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -11);
    g.lineTo(7, 8);
    g.lineTo(0, 4);
    g.lineTo(-7, 8);
    g.closePath();
    g.fill();
    g.restore();
  }

  showEnd(win, stats) {
    if (this.el.end) this.el.end.classList.remove('hidden');
    this.el.endTitle.textContent = win ? 'VICTORY ROYALE' : 'ELIMINATED';
    this.el.endTitle.className = win ? 'win' : 'lose';
    this.el.endSub.textContent = win
      ? 'LAST OPERATIVE STANDING'
      : `PLACED #${stats.placement} OF ${stats.total || 20}`;
    this.el.endStats.innerHTML = `
      <div><span>ELIMINATIONS</span><b>${stats.kills}</b></div>
      <div><span>DAMAGE</span><b>${Math.round(stats.damage)}</b></div>
      <div><span>HEADSHOTS</span><b>${stats.headshots || 0}</b></div>
      <div><span>SURVIVED</span><b>${stats.time}</b></div>
      <div><span>OPERATIVE</span><b>${stats.charName}</b></div>
      ${stats.rp !== undefined ? `<div><span>RANK POINTS</span><b>${stats.rp >= 0 ? '+' : ''}${stats.rp} RP</b></div>` : ''}
      ${stats.rank ? `<div><span>RANK</span><b>${stats.rank}</b></div>` : ''}
      ${stats.xpGain !== undefined ? `<div><span>XP GAINED</span><b>+${stats.xpGain} XP</b></div>` : ''}
      ${stats.level ? `<div><span>LEVEL</span><b>LV. ${stats.level}</b></div>` : ''}
      ${stats.coins !== undefined ? `<div><span>COINS EARNED</span><b>+${stats.coins}</b></div>` : ''}
    `;
  }
}
