import { clamp, lerp, norm } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { MAT, cargoForMaterial, info, isMagnetic } from '../world/materials.js';

const MATERIAL_GLOW = {
  [MAT.MOLTEN_ROCK]: '#ff8a3c',
  [MAT.MOLTEN_METAL]: '#ffd47a',
  [MAT.STEAM]: '#bceaff',
  [MAT.MAGNET_DUST]: '#d18cff',
  [MAT.EXOTIC_DUST]: '#8fffe0'
};

export class ParticleSystem {
  constructor(seed = 0x7a21) {
    this.rng = new Rng(seed);
    this.particles = [];
    this.max = 2400;
  }

  spawn(options) {
    if (this.particles.length >= this.max) this.particles.shift();
    const life = options.life ?? 1;
    this.particles.push({
      x: 0, y: 0, vx: 0, vy: 0,
      life, maxLife: life,
      size: options.size ?? 1.3,
      color: options.color ?? '#ffffff',
      type: options.type ?? 'spark',
      glow: options.glow ?? false,
      alpha: options.alpha ?? 1,
      drag: options.drag ?? 0,
      gravityScale: options.gravityScale ?? 0,
      trail: options.trail ?? 0,
      material: options.material ?? null,
      commodity: options.commodity ?? null,
      units: options.units ?? 0,
      magnetic: options.magnetic ?? false,
      scoopable: options.scoopable ?? false,
      radius: options.radius ?? 2,
      radiusEnd: options.radiusEnd ?? 10,
      width: options.width ?? 1.2,
      ...options
    });
  }

  materialColor(material) {
    return MATERIAL_GLOW[material] || info(material).color || '#9fb8c8';
  }

  emitThrust(event) {
    const count = event.boost ? 4 : 2;
    for (let k = 0; k < count; k++) {
      const spread = this.rng.range(-12, 12);
      this.spawn({
        type: 'thrust', x: event.x, y: event.y,
        vx: event.vx + spread + this.rng.range(-9, 9),
        vy: event.vy + spread + this.rng.range(-9, 9),
        life: this.rng.range(0.22, 0.58),
        size: this.rng.range(0.8, 2.2),
        color: event.boost ? '#ffd27a' : (this.rng.chance(0.35) ? '#ffffff' : '#75e5ff'),
        glow: true, trail: 0.035, drag: 0.4
      });
    }
  }

  emitTail(event) {
    this.spawn({
      type: 'tail', x: event.x, y: event.y,
      vx: event.vx + this.rng.range(-5, 5),
      vy: event.vy + this.rng.range(-5, 5),
      life: event.life ?? this.rng.range(2.1, 4.2),
      size: this.rng.range(1.2, 3.4),
      color: this.rng.chance(0.25) ? '#ffffff' : '#89dfff',
      glow: true, alpha: 0.62, drag: 0.035, gravityScale: 0.012,
      trail: 0.12
    });
  }

  emitJet(event) {
    for (let k = 0; k < 3; k++) {
      this.spawn({
        type: 'steam', x: event.x, y: event.y,
        vx: event.vx + this.rng.range(-14, 14),
        vy: event.vy + this.rng.range(-14, 14),
        life: this.rng.range(0.9, 2.4),
        size: this.rng.range(1.0, 2.8),
        color: this.rng.chance(0.3) ? '#e7fbff' : '#8fe9ff',
        glow: true, alpha: 0.75, drag: 0.08, gravityScale: 0.02,
        trail: 0.06
      });
    }
  }

  emitMaterialDebris(x, y, material, vx = 0, vy = 0, count = 1) {
    const cargo = cargoForMaterial(material);
    if (!cargo) return;
    const magnetic = isMagnetic(material);
    const color = this.materialColor(material);
    for (let k = 0; k < count; k++) {
      this.spawn({
        type: 'debris', x: x + this.rng.range(-1.5, 1.5), y: y + this.rng.range(-1.5, 1.5),
        vx: vx + this.rng.range(-26, 26),
        vy: vy + this.rng.range(-26, 26),
        life: this.rng.range(2.5, 6.5),
        size: this.rng.range(0.8, 2.1),
        color,
        glow: Boolean(MATERIAL_GLOW[material]),
        gravityScale: 0.18,
        drag: 0.012,
        material,
        commodity: cargo.commodity,
        units: cargo.units * 0.85,
        magnetic,
        scoopable: true,
        trail: magnetic ? 0.025 : 0
      });
    }
  }

  emitMining(hit, tool) {
    const color = tool === 'laser' ? '#ffb25d' : this.materialColor(hit.material);
    const count = tool === 'laser' ? 5 : 4;
    for (let k = 0; k < count; k++) {
      this.spawn({
        type: 'spark', x: hit.x, y: hit.y,
        vx: -hit.dirX * this.rng.range(18, 60) + this.rng.range(-25, 25),
        vy: -hit.dirY * this.rng.range(18, 60) + this.rng.range(-25, 25),
        life: this.rng.range(0.18, 0.62),
        size: this.rng.range(0.7, 1.8),
        color: tool === 'laser' && this.rng.chance(0.4) ? '#fff1b0' : color,
        glow: true, drag: 0.5, trail: 0.025
      });
    }
    if (tool === 'grinder' && hit.material) this.emitMaterialDebris(hit.x, hit.y, info(hit.material).grindTo ?? MAT.REGOLITH, -hit.dirX * 12, -hit.dirY * 12, 2);
  }

  emitMuzzle(x, y, vx, vy) {
    for (let k = 0; k < 6; k++) {
      this.spawn({
        type: 'spark', x, y,
        vx: vx * 0.12 + this.rng.range(-26, 26),
        vy: vy * 0.12 + this.rng.range(-26, 26),
        life: this.rng.range(0.1, 0.28),
        size: this.rng.range(0.8, 1.8),
        color: this.rng.chance(0.5) ? '#ffffff' : '#8ceaff',
        glow: true, drag: 0.8
      });
    }
  }

  emitShockwave(x, y, radius, color = '#ffd27a') {
    this.spawn({
      type: 'ring', x, y, life: 0.55,
      radius: Math.max(2, radius * 0.18),
      radiusEnd: radius * 1.2,
      width: 2.2,
      color, glow: true, alpha: 0.85
    });
  }

  emitExplosion(x, y, radius = 16, power = 1) {
    const count = Math.min(70, Math.round(18 + radius * 1.5));
    this.emitShockwave(x, y, radius, '#ffb15c');
    for (let k = 0; k < count; k++) {
      const a = this.rng.range(0, Math.PI * 2);
      const speed = this.rng.range(25, 100 + radius * 4) * clamp(power / 50, 0.5, 1.8);
      this.spawn({
        type: this.rng.chance(0.35) ? 'smoke' : 'spark',
        x, y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        life: this.rng.range(0.35, 1.25),
        size: this.rng.range(1.0, 3.1),
        color: this.rng.chance(0.42) ? '#ffd27a' : (this.rng.chance(0.5) ? '#ff7a45' : '#8fb2c8'),
        glow: true, drag: 0.65, trail: 0.035
      });
    }
  }

  emitImpact(event) {
    const power = event.power || 10;
    const count = Math.min(40, 8 + Math.round(power));
    for (let k = 0; k < count; k++) {
      const side = this.rng.range(-1, 1);
      this.spawn({
        type: this.rng.chance(0.4) ? 'dust' : 'spark',
        x: event.x, y: event.y,
        vx: event.normalX * this.rng.range(15, 55) - event.normalY * side * 45,
        vy: event.normalY * this.rng.range(15, 55) + event.normalX * side * 45,
        life: this.rng.range(0.35, 1.1),
        size: this.rng.range(0.8, 2.6),
        color: this.rng.chance(0.3) ? '#ffc66d' : '#a7a09a',
        glow: this.rng.chance(0.25), drag: 0.35, gravityScale: 0.08
      });
    }
    this.emitShockwave(event.x, event.y, 8 + power * 0.35, '#ffb26b');
  }

  emitTouchdown(event) {
    for (let k = 0; k < 18; k++) {
      const a = this.rng.range(0, Math.PI * 2);
      this.spawn({
        type: 'dust', x: event.x, y: event.y,
        vx: Math.cos(a) * this.rng.range(8, 32),
        vy: Math.sin(a) * this.rng.range(8, 32),
        life: this.rng.range(0.5, 1.4),
        size: this.rng.range(0.9, 2.4),
        color: '#a99b8e', alpha: 0.75, drag: 1.2, gravityScale: 0.06
      });
    }
  }

  emitCollect(x, y, commodity = 'ore') {
    for (let k = 0; k < 5; k++) {
      this.spawn({
        type: 'spark', x, y,
        vx: this.rng.range(-18, 18), vy: this.rng.range(-18, 18),
        life: this.rng.range(0.18, 0.42),
        size: this.rng.range(0.6, 1.4),
        color: commodity === 'magnetite' ? '#d58bff' : '#8affc1',
        glow: true, drag: 0.5
      });
    }
  }

  handleEvent(event) {
    switch (event.type) {
      case 'thrust':
        this.emitThrust(event);
        break;
      case 'tail':
        this.emitTail(event);
        break;
      case 'jet':
        this.emitJet(event);
        break;
      case 'grind':
      case 'collapse':
        this.emitMaterialDebris(event.x, event.y, event.mat, this.rng.range(-14, 14), this.rng.range(-14, 14), 1);
        break;
      case 'melt':
        for (let k = 0; k < 2; k++) {
          this.spawn({
            type: 'molten', x: event.x, y: event.y,
            vx: this.rng.range(-18, 18), vy: this.rng.range(-18, 18),
            life: this.rng.range(0.3, 0.8), size: this.rng.range(0.8, 1.8),
            color: this.materialColor(event.mat), glow: true, drag: 0.35
          });
        }
        break;
      case 'vapor':
        for (let k = 0; k < 2; k++) {
          this.spawn({
            type: 'steam', x: event.x, y: event.y,
            vx: this.rng.range(-20, 20), vy: this.rng.range(-20, 20),
            life: this.rng.range(0.7, 1.6), size: this.rng.range(1.2, 2.8),
            color: '#bceaff', glow: true, alpha: 0.7, drag: 0.18
          });
        }
        break;
      case 'cool':
        this.emitCollect(event.x, event.y, 'regolith');
        break;
      case 'blast':
        this.emitShockwave(event.x, event.y, (event.radius || 8) * 1.6, '#ff9e5a');
        break;
      case 'shockwave':
        this.emitExplosion(event.x, event.y, event.radius || 16, event.power || 60);
        break;
      case 'impact':
        this.emitImpact(event);
        break;
      case 'contactDust':
        for (let k = 0; k < 3; k++) {
          this.spawn({
            type: 'dust', x: event.x, y: event.y,
            vx: event.normalX * 12 + this.rng.range(-12, 12),
            vy: event.normalY * 12 + this.rng.range(-12, 12),
            life: this.rng.range(0.25, 0.65), size: this.rng.range(0.7, 1.5),
            color: '#b0a79d', alpha: 0.7, drag: 0.8
          });
        }
        break;
      case 'touchdown':
        this.emitTouchdown(event);
        break;
      case 'cannon':
        this.emitMuzzle(event.x, event.y, event.vx, event.vy);
        break;
      case 'anomaly':
        this.emitShockwave(event.x, event.y, event.radius || 42, '#8affc1');
        this.emitCollect(event.x, event.y, 'exotic');
        break;
      case 'collect':
        this.emitCollect(event.x, event.y, event.commodity);
        break;
      case 'shipDamage':
        for (let k = 0; k < 8; k++) {
          this.spawn({
            type: 'spark', x: event.x, y: event.y,
            vx: this.rng.range(-35, 35), vy: this.rng.range(-35, 35),
            life: this.rng.range(0.2, 0.6), size: this.rng.range(0.7, 1.7),
            color: '#ff6767', glow: true, drag: 0.4
          });
        }
        break;
      case 'enemyDestroyed':
        this.emitExplosion(event.x, event.y, event.radius || 22, 70);
        this.emitMaterialDebris(event.x, event.y, MAT.SCRAP, 0, 0, 8);
        break;
      case 'launch':
        this.emitTouchdown(event);
        break;
      case 'scanPulse':
        this.emitShockwave(event.x, event.y, Math.min(180, event.radius || 80), '#8ceaff');
        break;
      case 'scanResult':
        this.emitCollect(event.x, event.y, 'exotic');
        break;
      case 'clamp':
        for (let k = 0; k < 10; k++) {
          this.spawn({
            type: 'spark', x: event.x, y: event.y,
            vx: this.rng.range(-24, 24), vy: this.rng.range(-24, 24),
            life: this.rng.range(0.2, 0.55), size: this.rng.range(0.7, 1.6),
            color: '#8ceaff', glow: true, drag: 0.6
          });
        }
        break;
      case 'caveFind':
        this.emitShockwave(event.x, event.y, event.radius || 28, '#8affc1');
        this.emitCollect(event.x, event.y, 'exotic');
        break;
      case 'haulerDelivery':
        this.emitShockwave(event.x, event.y, event.radius || 44, '#ffc66d');
        break;
      case 'orbitHold':
        this.emitShockwave(event.x, event.y, 30, '#8ceaff');
        break;
      case 'evaStart':
      case 'evaEnd':
        this.emitCollect(event.x, event.y, 'alloy');
        break;
      default:
        break;
    }
  }

  update(dt, world, ship) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles[i] = this.particles[this.particles.length - 1];
        this.particles.pop();
        continue;
      }
      if (p.gravityScale) {
        const g = world.gravityAt(p.x, p.y);
        p.vx += g.x * p.gravityScale * dt;
        p.vy += g.y * p.gravityScale * dt;
      }
      if (p.drag) {
        const d = clamp(1 - p.drag * dt, 0, 1);
        p.vx *= d;
        p.vy *= d;
      }
      if (ship.scoop && ship.energy > 0 && p.scoopable && p.commodity) {
        const dx = ship.x - p.x;
        const dy = ship.y - p.y;
        const d = Math.hypot(dx, dy);
        const bonus = ship.scoopRangeBonus || 0;
        const reach = (p.magnetic ? 88 : 38) + bonus * (p.magnetic ? 1 : 0.4);
        if (d < reach && d > 0.01) {
          const pull = (p.magnetic ? 210 : 125) * (1 - d / reach);
          p.vx += dx / d * pull * dt;
          p.vy += dy / d * pull * dt;
        }
        if (d < 10 && ship.addCargo(p.commodity, p.units)) {
          world.pushEvent({ type: 'collect', x: p.x, y: p.y, commodity: p.commodity, units: p.units });
          this.particles[i] = this.particles[this.particles.length - 1];
          this.particles.pop();
          continue;
        }
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx, zoom) {
    if (!this.particles.length) return;
    const minSize = 1 / Math.max(0.05, zoom);
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.particles) {
      if (p.glow || p.type === 'ring') continue;
      const a = clamp(p.life / p.maxLife, 0, 1) * p.alpha;
      const s = Math.max(minSize, p.size * (0.65 + a * 0.35));
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles) {
      if (!p.glow && p.type !== 'ring') continue;
      const a = clamp(p.life / p.maxLife, 0, 1) * p.alpha;
      ctx.globalAlpha = a;
      ctx.strokeStyle = p.color;
      ctx.fillStyle = p.color;
      if (p.type === 'ring') {
        const t = 1 - a;
        const radius = lerp(p.radius, p.radiusEnd, t);
        ctx.lineWidth = Math.max(minSize * 0.8, p.width);
        ctx.beginPath();
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const s = Math.max(minSize, p.size * (0.7 + a * 0.5));
        if (p.trail) {
          ctx.lineWidth = Math.max(minSize * 0.6, s * 0.55);
          ctx.beginPath();
          ctx.moveTo(p.x - p.vx * p.trail, p.y - p.vy * p.trail);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        } else {
          ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }
    }
    ctx.restore();
  }
}
