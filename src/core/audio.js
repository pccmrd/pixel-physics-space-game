export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.noiseBuffer = null;
    this.thrustGain = null;
    this.thrustFilter = null;
    this.laserGain = null;
    this.laserOsc = null;
    this.laserFilter = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.22;
    this.master.connect(ctx.destination);

    const length = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;

    const thrustSource = ctx.createBufferSource();
    thrustSource.buffer = buffer;
    thrustSource.loop = true;
    this.thrustFilter = ctx.createBiquadFilter();
    this.thrustFilter.type = 'lowpass';
    this.thrustFilter.frequency.value = 520;
    this.thrustGain = ctx.createGain();
    this.thrustGain.gain.value = 0;
    thrustSource.connect(this.thrustFilter).connect(this.thrustGain).connect(this.master);
    thrustSource.start();

    this.laserOsc = ctx.createOscillator();
    this.laserOsc.type = 'sawtooth';
    this.laserOsc.frequency.value = 168;
    this.laserFilter = ctx.createBiquadFilter();
    this.laserFilter.type = 'bandpass';
    this.laserFilter.frequency.value = 720;
    this.laserFilter.Q.value = 4.5;
    this.laserGain = ctx.createGain();
    this.laserGain.gain.value = 0;
    this.laserOsc.connect(this.laserFilter).connect(this.laserGain).connect(this.master);
    this.laserOsc.start();

    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.22, this.ctx.currentTime, 0.03);
    }
    return this.muted;
  }

  setThrust(level, boost = false) {
    if (!this.ctx || !this.thrustGain || this.muted) return;
    const t = this.ctx.currentTime;
    this.thrustGain.gain.setTargetAtTime(Math.min(0.13, level * (boost ? 0.16 : 0.105)), t, 0.045);
    this.thrustFilter.frequency.setTargetAtTime(boost ? 920 : 520 + level * 260, t, 0.08);
  }

  setLaser(on) {
    if (!this.ctx || !this.laserGain || this.muted) return;
    const t = this.ctx.currentTime;
    this.laserGain.gain.setTargetAtTime(on ? 0.035 : 0, t, 0.025);
    this.laserFilter.frequency.setTargetAtTime(on ? 880 + Math.random() * 180 : 720, t, 0.08);
  }

  tone(freq, duration, type = 'sine', gain = 0.05, slide = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slide), t + duration);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(amp).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noiseBurst(duration = 0.15, frequency = 800, gain = 0.08, type = 'lowpass') {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, frequency * 0.35), t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(gain, t);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    source.connect(filter).connect(amp).connect(this.master);
    const offset = Math.random() * Math.max(0, 1 - duration - 0.01);
    source.start(t, offset, duration);
    source.stop(t + duration + 0.02);
  }

  play(kind, intensity = 1) {
    if (!this.ctx || this.muted) return;
    switch (kind) {
      case 'cannon':
        this.tone(150, 0.11, 'square', 0.055, 58);
        this.noiseBurst(0.08, 1100, 0.045 * intensity);
        break;
      case 'laserStart':
        this.tone(420, 0.05, 'square', 0.02, 620);
        break;
      case 'impact':
        this.tone(72, 0.24, 'sine', 0.11 * intensity, 34);
        this.noiseBurst(0.18, 460, 0.1 * intensity);
        break;
      case 'explosion':
        this.tone(56, 0.34, 'sine', 0.09 * intensity, 26);
        this.noiseBurst(0.42, 520, 0.15 * intensity);
        break;
      case 'touchdown':
        this.tone(440, 0.09, 'sine', 0.055, 660);
        this.tone(660, 0.12, 'sine', 0.04, 880, 0.09);
        break;
      case 'collect':
        this.tone(880, 0.045, 'sine', 0.022, 1320);
        break;
      case 'trade':
        this.tone(520, 0.07, 'square', 0.028, 780);
        this.tone(780, 0.08, 'square', 0.022, 1040, 0.07);
        break;
      case 'alarm':
        this.tone(230, 0.16, 'sawtooth', 0.035, 170);
        break;
      case 'ui':
        this.tone(620, 0.035, 'square', 0.018, 720);
        break;
      default:
        break;
    }
  }
}
