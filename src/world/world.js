import { clamp, norm } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { MAT, COMMODITIES, cargoForMaterial, isCollidable, isGas } from './materials.js';
import { generateBody } from './generation.js';

const BODY_CONFIGS = [
  {
    id: 'selene', name: 'SELENE', type: 'moon', x: 0, y: 0,
    w: 340, h: 340, radius: 150, g0: 32, seed: 0x5e1e, glow: '#9bd8ff',
    market: true, structural: true, hue: 0.57,
    description: 'Airless regolith, lava tubes, ice shadow traps and a surface exchange.'
  },
  {
    id: 'kestrel', name: 'KESTREL SHARD', type: 'asteroid', x: -920, y: -560,
    w: 240, h: 240, radius: 100, g0: 9, seed: 0x8a57, glow: '#ffb36b',
    structural: true, hue: 0.08,
    description: 'A fractured ore body with a crystalline geode and low gravity caves.'
  },
  {
    id: 'vela', name: 'VELA', type: 'comet', x: 980, y: -720,
    w: 210, h: 210, radius: 78, g0: 4, seed: 0x7e1a, glow: '#8beaff',
    structural: true, hue: 0.52,
    description: 'Volatile ice, cryo vaults and an active sunward jet.'
  },
  {
    id: 'halcyon', name: 'HALCYON RING', type: 'station', x: 850, y: 620,
    w: 340, h: 280, radius: 125, g0: 7, seed: 0x1ac0, glow: '#8ef7ff',
    market: true, structural: false, variant: 'ring', hue: 0.5,
    description: 'A destructible trading ring with electromagnetic material rails.'
  },
  {
    id: 'cinder', name: 'CINDER', type: 'cinder', x: 1450, y: 180,
    w: 200, h: 200, radius: 76, g0: 6, seed: 0xc1de, glow: '#ff8055',
    structural: true, hue: 0.03,
    description: 'A hot carbonaceous asteroid with molten pockets and dense ores.'
  },
  {
    id: 'vesper', name: 'VESPER FOUNDRY', type: 'station', x: -1450, y: 500,
    w: 300, h: 250, radius: 100, g0: 6, seed: 0xfe5a, glow: '#ffb86b',
    market: true, structural: false, variant: 'foundry', hue: 0.1,
    description: 'An automated foundry that still contains flowing molten alloy.'
  }
];

export class World {
  constructor(seed = 0x51a7) {
    this.seed = seed;
    this.rng = new Rng(seed);
    this.time = 0;
    this.events = [];
    this.star = { x: -2900, y: -2200, name: 'HELIOS', color: '#ffd38a' };
    this.sunDirection = norm(-this.star.x, -this.star.y, 0.8, 0.6);
    this.bounds = { minX: -1800, maxX: 1800, minY: -1200, maxY: 1200 };
    this.tailAccumulator = 0;
    this.bodies = BODY_CONFIGS.map((config) => {
      const tailDirection = norm(config.x - this.star.x, config.y - this.star.y, 0.9, 0.35);
      return generateBody({ ...config, tailDirection });
    });
    this.bodyById = new Map(this.bodies.map((b) => [b.id, b]));
    this.anomalies = [
      { id: 'echo', name: 'ECHO CACHE', x: 1260, y: -960, found: false, reward: 350, loot: { commodity: 'exotic', units: 2 } },
      { id: 'derelict', name: 'DERELICT POD', x: -1190, y: -850, found: false, reward: 220, loot: { commodity: 'alloy', units: 5 } },
      { id: 'cryo', name: 'CRYO VAULT', x: 1160, y: -510, found: false, reward: 500, loot: { commodity: 'volatiles', units: 8 } }
    ];
  }

  pushEvent(event) {
    this.events.push(event);
    if (this.events.length > 512) this.events.splice(0, this.events.length - 512);
  }

  takeEvents() {
    if (!this.events.length) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  tailDirectionFor(body) {
    return norm(body.x - this.star.x, body.y - this.star.y, 0.9, 0.35);
  }

  gravityAt(x, y) {
    let ax = 0;
    let ay = 0;
    let dominant = null;
    let dominantMag = 0;
    for (const body of this.bodies) {
      const dx = body.x - x;
      const dy = body.y - y;
      const r2 = dx * dx + dy * dy;
      const eps2 = (body.radius * 0.22) ** 2;
      const denom = Math.pow(r2 + eps2, 1.5);
      const f = body.mu / denom;
      const gx = dx * f;
      const gy = dy * f;
      ax += gx;
      ay += gy;
      const mag = Math.hypot(gx, gy);
      if (mag > dominantMag) {
        dominantMag = mag;
        dominant = body;
      }
    }
    // A distant photogravitational star gives the whole sector a faint drift.
    const sdx = this.star.x - x;
    const sdy = this.star.y - y;
    const sr2 = sdx * sdx + sdy * sdy + 900000;
    const sf = 2.7e6 / Math.pow(sr2, 1.5);
    ax += sdx * sf;
    ay += sdy * sf;

    const mag = Math.hypot(ax, ay);
    if (mag > 180) {
      const s = 180 / mag;
      ax *= s;
      ay *= s;
    }
    return { x: ax, y: ay, magnitude: Math.hypot(ax, ay), dominant, dominantMagnitude: dominantMag };
  }

  nearestBody(x, y) {
    let best = null;
    for (const body of this.bodies) {
      const dx = body.x - x;
      const dy = body.y - y;
      const distance = Math.hypot(dx, dy);
      const altitude = distance - body.radius;
      if (!best || altitude < best.altitude) best = { body, distance, altitude, dx, dy };
    }
    const g = this.gravityAt(x, y);
    const away = best ? norm(-best.dx, -best.dy, 0, -1) : norm(0, -1, 0, -1);
    return { ...best, gravity: g, away };
  }

  sampleMaterial(wx, wy, skipGas = true) {
    for (const body of this.bodies) {
      const p = body.worldToLocal(wx, wy);
      if (p.x < 0 || p.y < 0 || p.x >= body.w || p.y >= body.h) continue;
      const material = body.cellAtContinuous(p.x, p.y);
      if (material === MAT.VACUUM) continue;
      if (skipGas && isGas(material)) continue;
      if (!skipGas || isCollidable(material)) {
        return { body, material, localX: p.x, localY: p.y, normal: body.normalAtWorld(wx, wy) };
      }
    }
    return null;
  }

  raycast(x, y, dirX, dirY, maxDist) {
    let best = null;
    for (const body of this.bodies) {
      const centerDist = Math.hypot(body.x - x, body.y - y);
      const bound = Math.hypot(body.w, body.h) / 2;
      if (centerDist > maxDist + bound) continue;
      const start = body.worldToLocal(x, y);
      const localDirX = dirX * body.cos + dirY * body.sin;
      const localDirY = -dirX * body.sin + dirY * body.cos;
      const hit = body.raycastLocal(start.x, start.y, localDirX, localDirY, maxDist, true);
      if (!hit || (best && hit.t >= best.distance)) continue;
      const point = body.localToWorld(hit.localX, hit.localY);
      best = {
        body,
        i: hit.i,
        distance: hit.t,
        x: point.x,
        y: point.y,
        localX: hit.localX,
        localY: hit.localY,
        material: hit.mat,
        dirX,
        dirY
      };
    }
    return best;
  }

  grindHit(hit, radius = 2.2, power = 18) {
    if (!hit) return 0;
    hit.body.grindArea(hit.localX, hit.localY, radius, power);
    return 1;
  }

  heatHit(hit, radius = 2.6, heat = 28, damage = 5) {
    if (!hit) return 0;
    hit.body.applyHeatArea(hit.localX, hit.localY, radius, heat, damage, 'laser');
    return 1;
  }

  explode(wx, wy, radius, power = 95) {
    let touched = 0;
    for (const body of this.bodies) {
      const p = body.worldToLocal(wx, wy);
      if (p.x < -radius || p.y < -radius || p.x > body.w + radius || p.y > body.h + radius) continue;
      body.explode(p.x, p.y, radius, power);
      touched++;
    }
    this.pushEvent({ type: 'shockwave', x: wx, y: wy, radius, power });
    return touched;
  }

  collectAtShip(ship) {
    if (!ship.scoop || ship.energy <= 0) return 0;
    let total = 0;
    for (const body of this.bodies) {
      const p = body.worldToLocal(ship.x, ship.y);
      if (p.x < -12 || p.y < -12 || p.x > body.w + 12 || p.y > body.h + 12) continue;
      total += body.collectLocal(p.x, p.y, (i, material) => {
        const ok = ship.addMaterial(material);
        if (ok && i >= 0 && this.rng.chance(0.16)) {
          const cargo = cargoForMaterial(material);
          const point = body.worldPointForCell(i);
          this.pushEvent({ type: 'collect', x: point.x, y: point.y, commodity: cargo?.commodity || 'ore' });
        }
        return ok;
      });
    }
    return total;
  }

  findDock(ship) {
    let best = null;
    const speed = Math.hypot(ship.vx - (ship.landedBody?.vx || 0), ship.vy - (ship.landedBody?.vy || 0));
    for (const body of this.bodies) {
      if (!body.dock || !body.market || body.integrity() < 0.28) continue;
      const p = body.localToWorld(body.dock.x, body.dock.y);
      const distance = Math.hypot(ship.x - p.x, ship.y - p.y);
      if (!best || distance < best.distance) {
        best = { body, point: p, distance, speed, ready: distance < 48 && speed < 4.5 && ship.gear };
      }
    }
    return best && best.distance < 85 ? best : null;
  }

  priceFor(body, commodity) {
    const base = COMMODITIES[commodity]?.price ?? 1;
    const scarcity = 0.86 + (1 - body.integrity()) * 0.34;
    const local = body.type === 'station' ? 1 : 0.92;
    return Math.max(1, Math.round(base * scarcity * local));
  }

  updateDiscovery(ship) {
    for (const body of this.bodies) {
      const d = Math.hypot(ship.x - body.x, ship.y - body.y);
      if (!body.discovered && d < body.radius * 4.2) {
        body.discovered = true;
        this.pushEvent({ type: 'discover', text: `SURVEY LOCK: ${body.name}`, tone: 'good', x: ship.x, y: ship.y });
      }
      if (!body.visited && d < body.radius + 45) {
        body.visited = true;
        this.pushEvent({ type: 'visit', text: `ENTERED ${body.name} GRAVITY WELL`, tone: '', body, x: ship.x, y: ship.y });
      }
    }
    for (const anomaly of this.anomalies) {
      if (anomaly.found) continue;
      const d = Math.hypot(ship.x - anomaly.x, ship.y - anomaly.y);
      if (d < 72) {
        anomaly.found = true;
        ship.credits += anomaly.reward;
        if (anomaly.loot) ship.addCargo(anomaly.loot.commodity, anomaly.loot.units);
        this.pushEvent({ type: 'anomaly', text: `${anomaly.name} RECOVERED  +${anomaly.reward} CR`, tone: 'good', x: anomaly.x, y: anomaly.y, radius: 42 });
      }
    }
  }

  emitAmbientTails() {
    for (const body of this.bodies) {
      if (body.type !== 'comet') continue;
      const tail = this.tailDirectionFor(body);
      const perp = { x: -tail.y, y: tail.x };
      for (let k = 0; k < 2; k++) {
        const offset = this.rng.range(-body.radius * 0.55, body.radius * 0.55);
        const along = -body.radius * this.rng.range(0.72, 0.98);
        const x = body.x + tail.x * along + perp.x * offset;
        const y = body.y + tail.y * along + perp.y * offset;
        this.pushEvent({
          type: 'tail', x, y,
          vx: tail.x * this.rng.range(38, 88) + perp.x * this.rng.range(-7, 7),
          vy: tail.y * this.rng.range(38, 88) + perp.y * this.rng.range(-7, 7),
          material: MAT.STEAM,
          life: this.rng.range(1.8, 4.4)
        });
      }
    }
  }

  update(dt, ship, options = {}) {
    this.time += dt;
    for (const body of this.bodies) {
      const d = Math.hypot(ship.x - body.x, ship.y - body.y);
      const near = d < body.radius + 540;
      const shipLocal = near ? body.worldToLocal(ship.x, ship.y) : null;
      const context = {
        time: this.time,
        far: !near,
        shipLocal,
        scoop: near && ship.scoop && ship.energy > 1,
        scoopRange: 62 + (ship.scoopRangeBonus || 0),
        collect: (i, material) => {
          const ok = ship.addMaterial(material);
          if (ok && i >= 0 && this.rng.chance(0.10)) {
            const cargo = cargoForMaterial(material);
            const point = body.worldPointForCell(i);
            this.pushEvent({ type: 'collect', x: point.x, y: point.y, commodity: cargo?.commodity || 'ore' });
          }
          return ok;
        },
        tailDirection: this.tailDirectionFor(body)
      };
      body.step(dt, context, near ? 12000 : 1500, near ? 1 : 0.12);
      for (const event of body.takeEvents()) this.pushEvent(event);
    }

    this.updateDiscovery(ship);
    this.tailAccumulator += dt;
    while (this.tailAccumulator >= 0.045) {
      this.tailAccumulator -= 0.045;
      this.emitAmbientTails();
    }
    if (options.collect !== false) this.collectAtShip(ship);
  }

  discoveryCount() {
    const bodies = this.bodies.reduce((n, b) => n + (b.discovered ? 1 : 0), 0);
    const anomalies = this.anomalies.reduce((n, a) => n + (a.found ? 1 : 0), 0);
    return { bodies, anomalies, total: bodies + anomalies, max: this.bodies.length + this.anomalies.length };
  }
}
