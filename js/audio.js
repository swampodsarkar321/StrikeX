// ------------------------------------------------------------------
//  ZONE ROYALE - procedural audio (no external files)
// ------------------------------------------------------------------
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
    this.storm = null;
    this.stormGain = null;
    this.muted = false;
    this.volume = 0.55;
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
    }
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);

    // reusable noise buffer
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // storm ambience loop
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(lp).connect(g).connect(this.master);
    src.start();
    this.storm = src;
    this.stormGain = g;
    this.stormFilter = lp;
  }

  setStorm(level, proximity = 0) {
    if (!this.ctx || !this.stormGain) return;
    const target = this.muted ? 0 : Math.min(0.5, level * 0.22 + proximity * 0.12);
    this.stormGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.35);
    this.stormFilter.frequency.setTargetAtTime(240 + proximity * 500, this.ctx.currentTime, 0.4);
  }

  noise(dur, freq, q, gain, type = 'bandpass') {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  tone(freq, dur, gain, type = 'sine', delay = 0, endFreq = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  shot(type = 'rifle', volume = 1) {
    if (!this.ctx || this.muted) return;
    const v = volume;
    const t = this.ctx.currentTime;
    // layered gunshot: crack + thump + body
    if (type === 'pistol') {
      this.noise(0.08, 2200, 1.4, 0.55 * v);
      this.noise(0.12, 800, 0.8, 0.35 * v);
      this.tone(110, 0.09, 0.38 * v, 'square', 0, 60);
    } else if (type === 'smg') {
      this.noise(0.05, 2600, 1.6, 0.38 * v);
      this.noise(0.07, 1100, 1.0, 0.22 * v);
      this.tone(170, 0.06, 0.22 * v, 'square', 0, 75);
    } else if (type === 'shotgun') {
      this.noise(0.28, 700, 0.5, 0.85 * v, 'lowpass');
      this.noise(0.18, 1400, 0.7, 0.5 * v);
      this.tone(75, 0.22, 0.5 * v, 'sawtooth', 0, 40);
    } else if (type === 'sniper') {
      this.noise(0.35, 900, 0.4, 0.9 * v, 'lowpass');
      this.noise(0.12, 3200, 1.8, 0.6 * v);
      this.tone(55, 0.3, 0.55 * v, 'sawtooth', 0, 32);
    } else {
      // rifle / generic
      this.noise(0.09, 2100, 1.3, 0.6 * v);
      this.noise(0.14, 700, 0.7, 0.4 * v);
      this.tone(125, 0.11, 0.42 * v, 'square', 0, 58);
    }
  }

  wallImpact() {
    if (!this.ctx || this.muted) return;
    this.noise(0.06, 800, 1.2, 0.25, 'bandpass');
  }

  hit(headshot = false) {
    if (!this.ctx || this.muted) return;
    this.tone(headshot ? 1500 : 1050, 0.05, 0.16, 'square');
    if (headshot) this.tone(2100, 0.07, 0.12, 'sine', 0.03);
  }

  hurt() {
    if (!this.ctx || this.muted) return;
    this.noise(0.18, 380, 0.7, 0.35, 'lowpass');
    this.tone(90, 0.2, 0.2, 'sine', 0, 50);
  }

  reload() {
    if (!this.ctx || this.muted) return;
    this.noise(0.05, 2600, 2, 0.14);
    this.noise(0.06, 1500, 2, 0.12);
    this.tone(520, 0.04, 0.06, 'square', 0.35);
  }

  pickup() {
    if (!this.ctx || this.muted) return;
    this.tone(660, 0.08, 0.12, 'sine');
    this.tone(990, 0.1, 0.1, 'sine', 0.08);
  }

  kill() {
    if (!this.ctx || this.muted) return;
    this.tone(440, 0.1, 0.14, 'triangle');
    this.tone(660, 0.12, 0.12, 'triangle', 0.09);
    this.tone(880, 0.16, 0.1, 'triangle', 0.18);
  }

  zoneWarn() {
    if (!this.ctx || this.muted) return;
    this.tone(520, 0.18, 0.12, 'square');
    this.tone(390, 0.22, 0.1, 'square', 0.2);
  }

  death() {
    if (!this.ctx || this.muted) return;
    this.tone(420, 0.5, 0.18, 'sawtooth', 0, 60);
    this.noise(0.5, 500, 0.4, 0.25, 'lowpass');
  }

  win() {
    if (!this.ctx || this.muted) return;
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((n, i) => this.tone(n, 0.4, 0.14, 'triangle', i * 0.13));
  }

  click() {
    if (!this.ctx || this.muted) return;
    this.tone(720, 0.05, 0.08, 'square');
  }

  step() {
    if (!this.ctx || this.muted) return;
    this.noise(0.05, 500, 1.5, 0.05, 'lowpass');
  }
}
