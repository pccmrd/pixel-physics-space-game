import { clamp, TAU, wrap } from '../core/math.js';
import { Rng, hash2 } from '../core/rng.js';

function rgba(hex, alpha) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

export class Background {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.W = 0;
    this.H = 0;
    this.rng = new Rng(0x6e7e1a);
    this.stars = [];
  }

  resize(W, H) {
    this.W = W;
    this.H = H;
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    const rng = new Rng(0x51a2);
    this.stars = [];
    for (let layer = 0; layer < 3; layer++) {
      const count = Math.round(W * H / (layer === 0 ? 2600 : layer === 1 ? 5200 : 11000));
      for (let i = 0; i < count; i++) {
        this.stars.push({
          x: rng.range(0, W),
          y: rng.range(0, H),
          size: layer === 2 && rng.chance(0.2) ? 2 : 1,
          alpha: rng.range(0.18, layer === 0 ? 0.65 : 0.92),
          phase: rng.range(0, TAU),
          parallax: [0.004, 0.012, 0.028][layer],
          tint: rng.chance(0.18) ? '#ffd5a6' : rng.chance(0.35) ? '#9bdcff' : '#e7f7ff'
        });
      }
    }
    this.buildNebula();
  }

  buildNebula() {
    const ctx = this.ctx;
    const W = this.W;
    const H = this.H;
    const base = ctx.createLinearGradient(0, 0, W, H);
    base.addColorStop(0, '#030613');
    base.addColorStop(0.42, '#070b20');
    base.addColorStop(0.75, '#0a0d24');
    base.addColorStop(1, '#030511');
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    const clouds = [
      { x: 0.22, y: 0.25, r: 0.55, color: '#5d3c9c', a: 0.22 },
      { x: 0.72, y: 0.18, r: 0.46, color: '#1d7d9f', a: 0.17 },
      { x: 0.55, y: 0.78, r: 0.62, color: '#7b2864', a: 0.14 },
      { x: 0.08, y: 0.82, r: 0.38, color: '#1a5f80', a: 0.12 },
      { x: 0.88, y: 0.62, r: 0.44, color: '#39306f', a: 0.16 }
    ];
    ctx.globalCompositeOperation = 'screen';
    for (const c of clouds) {
      const cx = c.x * W;
      const cy = c.y * H;
      const r = c.r * Math.max(W, H);
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0, rgba(c.color, c.a));
      grad.addColorStop(0.42, rgba(c.color, c.a * 0.42));
      grad.addColorStop(1, rgba(c.color, 0));
      ctx.fillStyle = grad;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }

    // Ordered dither gives the gradients a coarse pixel-engine texture.
    ctx.globalCompositeOperation = 'source-over';
    for (let y = 0; y < H; y += 2) {
      for (let x = 0; x < W; x += 2) {
        const n = hash2(x >> 2, y >> 2, 0xb1a7);
        const wave = Math.sin((x + y) * 0.012) * 0.5 + 0.5;
        if (n + wave * 0.16 > 0.93) {
          ctx.fillStyle = `rgba(140, 210, 255, ${0.025 + n * 0.035})`;
          ctx.fillRect(x, y, 1, 1);
        } else if (n < 0.025) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }

    // A faint dust lane across the sector.
    ctx.save();
    ctx.translate(W * 0.5, H * 0.52);
    ctx.rotate(-0.22);
    const lane = ctx.createLinearGradient(-W * 0.65, 0, W * 0.65, 0);
    lane.addColorStop(0, 'rgba(30,20,60,0)');
    lane.addColorStop(0.5, 'rgba(20,15,45,0.23)');
    lane.addColorStop(1, 'rgba(30,20,60,0)');
    ctx.fillStyle = lane;
    ctx.fillRect(-W * 0.65, -H * 0.09, W * 1.3, H * 0.18);
    ctx.restore();
  }

  draw(ctx, camera, W, H, time, world) {
    ctx.imageSmoothingEnabled = false;
    const px = wrap(-camera.x * 0.008, 0, W);
    const py = wrap(-camera.y * 0.008, 0, H);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        ctx.drawImage(this.canvas, Math.floor(px + ox * W), Math.floor(py + oy * H));
      }
    }

    for (const star of this.stars) {
      const x = wrap(star.x - camera.x * star.parallax, 0, W) | 0;
      const y = wrap(star.y - camera.y * star.parallax, 0, H) | 0;
      const twinkle = 0.72 + 0.28 * Math.sin(time * 1.1 + star.phase);
      ctx.globalAlpha = clamp(star.alpha * twinkle, 0, 1);
      ctx.fillStyle = star.tint;
      ctx.fillRect(x, y, star.size, star.size);
      if (star.size > 1 && star.alpha > 0.75) {
        ctx.globalAlpha *= 0.45;
        ctx.fillRect(x - 2, y, 2, 1);
        ctx.fillRect(x + 2, y, 2, 1);
        ctx.fillRect(x, y - 2, 1, 2);
        ctx.fillRect(x, y + 2, 1, 2);
      }
    }
    ctx.globalAlpha = 1;

    const sx = W / 2 + (world.star.x - camera.x) * 0.06;
    const sy = H / 2 + (world.star.y - camera.y) * 0.06;
    if (sx > -180 && sx < W + 180 && sy > -180 && sy < H + 180) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, 155);
      glow.addColorStop(0, 'rgba(255, 225, 160, 0.32)');
      glow.addColorStop(0.08, 'rgba(255, 180, 95, 0.16)');
      glow.addColorStop(0.45, 'rgba(255, 110, 70, 0.045)');
      glow.addColorStop(1, 'rgba(255, 90, 50, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(sx - 155, sy - 155, 310, 310);
      ctx.fillStyle = '#ffe6ad';
      ctx.fillRect(sx - 3, sy - 3, 6, 6);
      ctx.globalAlpha = 0.25 + Math.sin(time * 0.7) * 0.06;
      ctx.fillStyle = '#ffb46b';
      ctx.fillRect(sx - 55, sy, 110, 1);
      ctx.fillRect(sx, sy - 35, 1, 70);
      ctx.restore();
    }
  }
}
