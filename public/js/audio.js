// Tiny synthesized sound effects, no audio files needed.
export class Sound {
  constructor(volume) {
    this.volume = volume;
    this.ctx = null;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  ready() {
    return this.ctx && this.ctx.state === 'running' && this.volume > 0;
  }

  env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  tone(type, f0, f1, peak, decay, delay = 0) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + decay);
    this.env(g, t, peak, 0.005, decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  hiss(freq, q, peak, decay, delay = 0, sweepTo = null) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = q;
    const g = this.ctx.createGain();
    this.env(g, t, peak, 0.005, decay);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
  }

  kick(power) {
    if (!this.ready()) return;
    this.tone('sine', 180, 55, 0.5 + power * 0.4, 0.14);
    this.hiss(1800, 1.2, 0.15 + power * 0.25, 0.05);
  }

  bounce(s) {
    if (!this.ready()) return;
    this.tone('sine', 140, 70, 0.15 + s * 0.3, 0.08);
  }

  wall(s) {
    if (!this.ready()) return;
    this.hiss(500, 0.8, 0.1 + s * 0.3, 0.08);
    this.tone('triangle', 110, 70, 0.1 + s * 0.2, 0.08);
  }

  post(s) {
    if (!this.ready()) return;
    this.tone('triangle', 880, 860, 0.15 + s * 0.2, 0.5);
    this.tone('sine', 1320, 1300, 0.08 + s * 0.1, 0.4);
  }

  whistle(long = false) {
    if (!this.ready()) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const lfo = this.ctx.createOscillator();
    const lfoGain = this.ctx.createGain();
    const g = this.ctx.createGain();
    o.frequency.value = 2600;
    lfo.frequency.value = 28;
    lfoGain.gain.value = 120;
    lfo.connect(lfoGain).connect(o.frequency);
    const dur = long ? 0.9 : 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
    g.gain.setValueAtTime(0.18, t + dur - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  goal() {
    if (!this.ready()) return;
    this.hiss(700, 0.6, 0.35, 1.8, 0, 1100);
    this.hiss(1500, 0.7, 0.2, 1.4, 0.1);
    this.whistle();
  }

  pickup() {
    if (!this.ready()) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone('square', f, f, 0.06, 0.09, i * 0.05));
  }

  tackle() {
    if (!this.ready()) return;
    this.tone('sine', 120, 40, 0.5, 0.2);
    this.hiss(300, 0.7, 0.3, 0.15);
  }

  whoosh() {
    if (!this.ready()) return;
    this.hiss(400, 1.5, 0.15, 0.2, 0, 2000);
  }
}
