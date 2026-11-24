import { clamp, norm, packRGBA } from '../core/math.js';
import { Rng } from '../core/rng.js';
import {
  MAT,
  MATERIALS,
  PHASE,
  info,
  isSolid,
  isLoose,
  isGas,
  isCollidable,
  isMagnetic,
  isMagneticSource,
  blocksLight,
  densityOf,
  commodityFor,
  colorForCell
} from './materials.js';

const DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1],
  [-1, 0], [-1, -1], [0, -1], [1, -1]
];
const AMBIENT = 8;
const SUN = norm(-0.72, -0.68, -0.72, -0.68);
const STRUCTURAL_SOLIDS = [MAT.ROCK, MAT.METAL, MAT.CORE, MAT.ICE, MAT.ORE, MAT.MAGNETITE, MAT.GLASS, MAT.SLAG, MAT.LAMP, MAT.MAGNET_BLOCK, MAT.EXOTIC];

function makeSurface(w, h) {
  if (typeof document === 'undefined' && typeof OffscreenCanvas === 'undefined') return null;
  const canvas = typeof document !== 'undefined'
    ? document.createElement('canvas')
    : new OffscreenCanvas(w, h);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
  const image = ctx.createImageData(w, h);
  return {
    canvas,
    ctx,
    image,
    pixels: new Uint32Array(image.data.buffer)
  };
}

function sector(dx, dy) {
  const s = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return ((s % 8) + 8) % 8;
}

function rotate(x, y, cos, sin) {
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export class PixelBody {
  constructor(config) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.description = config.description || '';
    this.x = config.x;
    this.y = config.y;
    this.vx = config.vx || 0;
    this.vy = config.vy || 0;
    this.w = config.w;
    this.h = config.h;
    this.radius = config.radius;
    this.g0 = config.g0 || 8;
    this.mu = this.g0 * this.radius * this.radius * 1.08;
    this.seed = config.seed >>> 0;
    this.glow = config.glow || '#7fc7ff';
    this.market = Boolean(config.market);
    this.structural = config.structural !== false;
    this.dock = config.dock || null;
    this.rotation = config.rotation || 0;
    this.cos = Math.cos(this.rotation);
    this.sin = Math.sin(this.rotation);
    this.hue = config.hue || 0.55;

    this.size = this.w * this.h;
    this.mat = new Uint8Array(this.size);
    this.hp = new Uint8Array(this.size);
    this.heat = new Uint8Array(this.size);
    this.tint = new Uint8Array(this.size);
    this.light = new Uint8Array(this.size);
    this.dir = new Uint8Array(this.size);
    this.lastMove = new Uint32Array(this.size);
    this.activeSet = new Uint8Array(this.size);
    this.active = [];
    this.activeHead = 0;
    this.stepId = 1;
    this.dirty = new Set();
    this.rng = new Rng(this.seed);

    this.magnets = [];
    this.anchors = [];
    this.jetSources = [];
    this.dockLights = [];
    this.events = [];
    this.structureDirty = false;
    this.structureTimer = 0;
    this.simAccumulator = 0;
    this.solarAccumulator = 0;
    this.solidCount = 0;
    this.initialSolidCount = 1;
    this.discovered = false;
    this.visited = false;
    this.surface = makeSurface(this.w, this.h);
    this.pixels = this.surface ? this.surface.pixels : null;
  }

  rand() {
    return this.rng.next();
  }

  index(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return -1;
    return y * this.w + x;
  }

  cellAt(x, y) {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return MAT.VACUUM;
    return this.mat[yi * this.w + xi];
  }

  cellAtContinuous(x, y) {
    return this.cellAt(Math.floor(x), Math.floor(y));
  }

  worldToLocal(wx, wy) {
    const dx = wx - this.x;
    const dy = wy - this.y;
    const lx = dx * this.cos + dy * this.sin;
    const ly = -dx * this.sin + dy * this.cos;
    return { x: lx + this.w / 2, y: ly + this.h / 2 };
  }

  localToWorld(lx, ly) {
    const dx = lx - this.w / 2;
    const dy = ly - this.h / 2;
    const r = rotate(dx, dy, this.cos, this.sin);
    return { x: this.x + r.x, y: this.y + r.y };
  }

  sampleWorld(wx, wy) {
    const p = this.worldToLocal(wx, wy);
    return this.cellAtContinuous(p.x, p.y);
  }

  put(x, y, material, options = {}) {
    const i = this.index(x | 0, y | 0);
    if (i < 0 || material === MAT.VACUUM) return;
    this.mat[i] = material;
    const m = info(material);
    this.hp[i] = options.hp ?? m.hp ?? 0;
    this.heat[i] = options.heat ?? AMBIENT;
    this.tint[i] = options.tint ?? ((this.rng.next() * 256) | 0);
  }

  finishGeneration() {
    this.rebuildMagnets();
    this.computeDirections();
    this.solidCount = 0;
    for (let i = 0; i < this.size; i++) if (isSolid(this.mat[i])) this.solidCount++;
    this.initialSolidCount = Math.max(1, this.solidCount);
    this.rebuildSurface();

    this.active.length = 0;
    this.activeHead = 0;
    this.activeSet.fill(0);
    for (let i = 0; i < this.size; i++) {
      const m = this.mat[i];
      if (isLoose(m) || this.heat[i] > AMBIENT + 3) this.wake(i);
    }
    this.structureDirty = false;
  }

  rebuildMagnets() {
    this.magnets.length = 0;
    this.dockLights.length = 0;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const i = this.index(x, y);
        if (isMagneticSource(this.mat[i])) {
          this.magnets.push({ x: x + 0.5, y: y + 0.5, range: 30, phase: (x * 13 + y * 7) % 17 });
        } else if (this.mat[i] === MAT.LAMP) {
          this.dockLights.push({ x: x + 0.5, y: y + 0.5, phase: (x * 3 + y * 5) % 11 });
        }
      }
    }
  }

  computeDirections() {
    const cx = this.w / 2;
    const cy = this.h / 2;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        this.dir[this.index(x, y)] = sector(cx - (x + 0.5), cy - (y + 0.5));
      }
    }
  }

  computeLight(i) {
    const m = this.mat[i];
    if (m === MAT.VACUUM) return 0;
    const x = i % this.w;
    const y = (i / this.w) | 0;
    const opaque = (ox, oy) => (blocksLight(this.cellAt(x + ox, y + oy)) ? 1 : 0);
    const left = opaque(-1, 0) + opaque(-1, -1) + opaque(-1, 1);
    const right = opaque(1, 0) + opaque(1, -1) + opaque(1, 1);
    const up = opaque(0, -1) + opaque(-1, -1) + opaque(1, -1);
    const down = opaque(0, 1) + opaque(-1, 1) + opaque(1, 1);
    let exposure = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oy === 0) continue;
        if (!blocksLight(this.cellAt(x + ox, y + oy))) exposure++;
      }
    }
    const n = norm(left - right, up - down, 0, 0);
    const sunDot = n.l > 0 ? Math.max(0, n.x * SUN.x + n.y * SUN.y) : 0;
    let value = 34 + exposure * 12 + sunDot * 112;
    if (info(m).emissive) value = Math.max(value, 225);
    if (isGas(m)) value = Math.max(value, 185);
    return clamp(value, 28, 255) | 0;
  }

  writePixel(i) {
    if (!this.pixels) return;
    this.light[i] = this.computeLight(i);
    this.pixels[i] = colorForCell(this.mat[i], this.tint[i], this.light[i], this.heat[i]);
  }

  touch(i) {
    if (i < 0 || i >= this.size) return;
    const x = i % this.w;
    const y = (i / this.w) | 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const n = this.index(x + ox, y + oy);
        if (n >= 0) this.dirty.add(n);
      }
    }
  }

  rebuildSurface() {
    for (let i = 0; i < this.size; i++) this.light[i] = this.computeLight(i);
    if (!this.surface) {
      this.dirty.clear();
      return;
    }
    for (let i = 0; i < this.size; i++) {
      this.pixels[i] = colorForCell(this.mat[i], this.tint[i], this.light[i], this.heat[i]);
    }
    this.surface.ctx.putImageData(this.surface.image, 0, 0);
    this.dirty.clear();
  }

  flushSurface() {
    if (!this.surface || this.dirty.size === 0) return;
    for (const i of this.dirty) this.writePixel(i);
    this.surface.ctx.putImageData(this.surface.image, 0, 0);
    this.dirty.clear();
  }

  wake(i) {
    if (i < 0 || i >= this.size || this.activeSet[i]) return;
    this.activeSet[i] = 1;
    this.active.push(i);
  }

  wakeNeighbors(i) {
    const x = i % this.w;
    const y = (i / this.w) | 0;
    for (let k = 0; k < 8; k++) {
      const d = DIRS[k];
      this.wake(this.index(x + d[0], y + d[1]));
    }
  }

  clearCell(i, wake = true) {
    if (i < 0 || i >= this.size) return;
    const old = this.mat[i];
    if (isSolid(old)) {
      this.solidCount = Math.max(0, this.solidCount - 1);
      this.structureDirty = this.structural;
    }
    this.mat[i] = MAT.VACUUM;
    this.hp[i] = 0;
    this.heat[i] = AMBIENT;
    this.tint[i] = 0;
    this.touch(i);
    if (wake) {
      this.wake(i);
      this.wakeNeighbors(i);
    }
    if (old === MAT.MAGNET_BLOCK) this.rebuildMagnets();
  }

  setCell(i, material, options = {}) {
    if (i < 0 || i >= this.size) return;
    if (material === MAT.VACUUM) {
      this.clearCell(i, options.wake !== false);
      return;
    }
    const old = this.mat[i];
    const oldSolid = isSolid(old);
    const newSolid = isSolid(material);
    if (oldSolid !== newSolid) {
      if (oldSolid) this.solidCount = Math.max(0, this.solidCount - 1);
      if (newSolid) this.solidCount++;
      this.structureDirty = this.structural;
    }
    const needsMagnetRebuild = old === MAT.MAGNET_BLOCK || material === MAT.MAGNET_BLOCK;
    const m = info(material);
    this.mat[i] = material;
    this.hp[i] = options.hp ?? m.hp ?? 0;
    this.heat[i] = options.heat ?? this.heat[i] ?? AMBIENT;
    this.tint[i] = options.tint ?? ((this.rng.next() * 256) | 0);
    if (needsMagnetRebuild) this.rebuildMagnets();
    this.touch(i);
    if (options.wake !== false) {
      this.wake(i);
      this.wakeNeighbors(i);
    }
  }

  emit(type, i, extra = {}) {
    const safeI = i >= 0 ? i : 0;
    const x = safeI % this.w + 0.5;
    const y = ((safeI / this.w) | 0) + 0.5;
    const p = this.localToWorld(x, y);
    this.events.push({ type, body: this, x: p.x, y: p.y, localX: x, localY: y, ...extra });
    if (this.events.length > 256) this.events.splice(0, this.events.length - 256);
  }

  takeEvents() {
    if (!this.events.length) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  grindCell(i, reason = 'grind') {
    const m = this.mat[i];
    if (!isSolid(m)) return false;
    const target = info(m).grindTo ?? MAT.REGOLITH;
    const heat = Math.max(this.heat[i], reason === 'collapse' ? AMBIENT + 4 : 22);
    this.setCell(i, target, { heat });
    this.emit(reason, i, { mat: target, from: m });
    return true;
  }

  meltCell(i) {
    const m = this.mat[i];
    const im = info(m);
    if (!im.melt) return false;
    let target = im.meltTo;
    if (!target) target = (m === MAT.METAL || m === MAT.GLASS || m === MAT.MAGNETITE || m === MAT.EXOTIC) ? MAT.MOLTEN_METAL : MAT.MOLTEN_ROCK;
    this.setCell(i, target, { heat: Math.max(this.heat[i], im.melt + 24) });
    this.emit('melt', i, { mat: target, from: m });
    return true;
  }

  vaporizeCell(i) {
    const m = this.mat[i];
    if (m === MAT.VACUUM) return false;
    const target = info(m).gasTo || MAT.STEAM;
    this.setCell(i, target, { heat: Math.max(this.heat[i], 125) });
    this.emit('vapor', i, { mat: target, from: m });
    return true;
  }

  addHeat(i, amount) {
    if (i < 0 || i >= this.size || this.mat[i] === MAT.VACUUM) return;
    const next = clamp(this.heat[i] + amount, 0, 255) | 0;
    if (next !== this.heat[i]) {
      this.heat[i] = next;
      this.dirty.add(i);
      this.wake(i);
    }
  }

  damageCell(i, amount, heat = 0, source = 'impact') {
    const m = this.mat[i];
    if (m === MAT.VACUUM) return;
    if (heat) this.addHeat(i, heat);
    if (isSolid(m)) {
      const hp = this.hp[i] || info(m).hp || 1;
      this.hp[i] = Math.max(0, hp - amount);
      const im = info(m);
      if (im.melt && this.heat[i] >= im.melt) {
        this.meltCell(i);
      } else if (this.hp[i] <= 0) {
        this.grindCell(i, source);
      }
      this.dirty.add(i);
      this.wake(i);
    } else if (amount > 25 && this.rand() < 0.12) {
      this.clearCell(i);
    }
  }

  applyHeatArea(cx, cy, radius, heat, damage = 0, source = 'laser') {
    const r = Math.ceil(radius);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const i = this.index(x, y);
        if (i < 0 || this.mat[i] === MAT.VACUUM) continue;
        const falloff = 1 - Math.sqrt(d2) / radius;
        this.addHeat(i, heat * falloff);
        if (damage) this.damageCell(i, damage * falloff, 0, source);
      }
    }
  }

  grindArea(cx, cy, radius, power = 18) {
    const r = Math.ceil(radius);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius) continue;
        const i = this.index(x, y);
        const m = this.mat[i];
        if (i < 0 || m === MAT.VACUUM) continue;
        const falloff = 1 - Math.sqrt(d2) / radius;
        if (isSolid(m)) this.damageCell(i, power * falloff, 2 * falloff, 'grind');
        else this.addHeat(i, 5 * falloff);
      }
    }
  }

  explode(cx, cy, radius, power = 90) {
    const r = Math.ceil(radius);
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        const i = this.index(x, y);
        if (i < 0 || this.mat[i] === MAT.VACUUM) continue;
        const falloff = 1 - dist / radius;
        const m = this.mat[i];
        if (dist < radius * 0.22 && this.rand() < 0.7 * falloff) {
          this.clearCell(i);
          continue;
        }
        this.addHeat(i, 205 * falloff);
        this.damageCell(i, power * falloff, 0, 'blast');
        if (isLoose(m) && this.rand() < 0.2 * falloff) this.clearCell(i);
      }
    }
    const center = this.index(Math.floor(cx), Math.floor(cy));
    this.emit('blast', center >= 0 ? center : 0, { radius, power });
  }

  canDisplace(fromMat, toMat) {
    if (toMat === MAT.VACUUM) return true;
    if (!isLoose(toMat)) return false;
    return densityOf(toMat) < densityOf(fromMat);
  }

  neighbor(i, dir, distance = 1) {
    const x = i % this.w;
    const y = (i / this.w) | 0;
    const d = DIRS[dir & 7];
    return this.index(x + d[0] * distance, y + d[1] * distance);
  }

  moveCell(from, to) {
    if (from < 0 || to < 0 || from === to || this.lastMove[from] === this.stepId) return false;
    const source = this.mat[from];
    let target = this.mat[to];
    if (!source || !this.canDisplace(source, target)) return false;

    // Hot melt flashing water into steam rather than swapping it behind.
    if ((source === MAT.MOLTEN_ROCK || source === MAT.MOLTEN_METAL) && target === MAT.WATER) {
      this.setCell(to, MAT.STEAM, { heat: 150, wake: false });
      target = this.mat[to];
    }

    if (target === MAT.VACUUM) {
      this.mat[to] = source;
      this.hp[to] = this.hp[from];
      this.heat[to] = this.heat[from];
      this.tint[to] = this.tint[from];
      this.clearCell(from, false);
    } else {
      const tm = this.mat[to];
      const th = this.hp[to];
      const theat = this.heat[to];
      const tt = this.tint[to];
      this.mat[to] = source;
      this.hp[to] = this.hp[from];
      this.heat[to] = this.heat[from];
      this.tint[to] = this.tint[from];
      this.mat[from] = tm;
      this.hp[from] = th;
      this.heat[from] = theat;
      this.tint[from] = tt;
      this.touch(from);
      this.wake(from);
    }
    this.touch(to);
    this.lastMove[to] = this.stepId;
    this.wake(to);
    this.wakeNeighbors(from);
    return true;
  }

  attemptDirection(i, dir, fromMat = this.mat[i]) {
    const to = this.neighbor(i, dir);
    return to >= 0 && this.moveCell(i, to) && this.mat[to] === fromMat;
  }

  flowSideways(i, dir, fromMat) {
    const sides = this.rand() < 0.5 ? [(dir + 2) & 7, (dir + 6) & 7] : [(dir + 6) & 7, (dir + 2) & 7];
    for (const side of sides) {
      let candidate = -1;
      for (let step = 1; step <= 5; step++) {
        const along = this.neighbor(i, side, step);
        if (along < 0 || !this.canDisplace(fromMat, this.mat[along])) break;
        candidate = along;
        const below = this.neighbor(along, dir);
        if (below >= 0 && this.canDisplace(fromMat, this.mat[below])) {
          candidate = below;
          break;
        }
      }
      if (candidate >= 0 && this.moveCell(i, candidate)) return true;
    }
    return false;
  }

  magneticTarget(x, y, material, context) {
    let bestD2 = Infinity;
    let bestDir = null;
    let collect = false;
    const magnetic = isMagnetic(material);
    const loose = isLoose(material);

    if (magnetic) {
      for (const mag of this.magnets) {
        const pulse = 0.72 + 0.28 * Math.sin((context.time || 0) * 2.4 + mag.phase);
        const range = mag.range * pulse;
        const dx = mag.x - x;
        const dy = mag.y - y;
        const d2 = dx * dx + dy * dy;
        if (d2 < range * range && d2 < bestD2) {
          bestD2 = d2;
          bestDir = sector(dx, dy);
        }
      }
    }

    const ship = context.shipLocal;
    if (context.scoop && ship && loose) {
      const dx = ship.x - x;
      const dy = ship.y - y;
      const d2 = dx * dx + dy * dy;
      const magneticReach = context.scoopRange ?? 62;
      const bonus = Math.max(0, magneticReach - 62);
      const reach = magnetic ? magneticReach : (isGas(material) ? 14 : 29 + bonus * 0.35);
      if (d2 < reach * reach && (magnetic || d2 < bestD2 || bestDir === null)) {
        bestDir = sector(dx, dy);
        bestD2 = d2;
        if (d2 < 8 * 8 && typeof context.collect === 'function') collect = true;
      }
    }
    return { dir: bestDir, collect, d2: bestD2 };
  }

  processCell(i, context, gravityChance) {
    const m = this.mat[i];
    if (m === MAT.VACUUM) return;
    const im = info(m);

    if (this.heat[i] > AMBIENT) {
      const cool = im.emissive ? 0.7 : 1.5;
      this.heat[i] = Math.max(AMBIENT, this.heat[i] - cool);
      this.dirty.add(i);
      if (this.heat[i] > 70 && this.rand() < 0.22) {
        const dirs = [0, 2, 4, 6];
        const n = this.neighbor(i, dirs[(this.rand() * 4) | 0]);
        if (n >= 0 && this.mat[n] !== MAT.VACUUM && this.heat[n] + 5 < this.heat[i]) {
          this.addHeat(n, 2);
          this.heat[i] = Math.max(AMBIENT, this.heat[i] - 1);
          this.wake(n);
        }
      }
      if (this.heat[i] > AMBIENT + 4) this.wake(i);
    }

    if (im.phase === PHASE.SOLID) {
      if (im.melt && this.heat[i] >= im.melt) {
        this.meltCell(i);
        return;
      }
      if (this.hp[i] <= 0) {
        this.grindCell(i, 'collapse');
        return;
      }
      return;
    }

    if (im.vapor && this.heat[i] >= im.vapor) {
      this.vaporizeCell(i);
      return;
    }
    if ((m === MAT.MOLTEN_ROCK || m === MAT.MOLTEN_METAL) && this.heat[i] <= im.cool) {
      this.setCell(i, im.coolTo || MAT.ROCK, { heat: AMBIENT });
      this.emit('cool', i, { mat: im.coolTo || MAT.ROCK });
      return;
    }
    if (m === MAT.STEAM) {
      if (this.heat[i] < 34 && this.rand() < 0.018) {
        if (this.rand() < 0.42) this.setCell(i, MAT.WATER, { heat: AMBIENT });
        else this.clearCell(i);
        return;
      }
      if (this.rand() < 0.0025) {
        this.clearCell(i);
        return;
      }
    }

    const x = i % this.w;
    const y = (i / this.w) | 0;
    const mag = this.magneticTarget(x + 0.5, y + 0.5, m, context);
    if (mag.collect) {
      if (context.collect(i, m)) {
        this.clearCell(i);
        return;
      }
    }

    const baseDir = this.dir[i];
    let dir = mag.dir ?? baseDir;
    const magneticDominant = mag.dir !== null && (isMagnetic(m) || (context.scoop && mag.d2 < 900));
    const moveChance = magneticDominant ? Math.max(0.72, gravityChance) : gravityChance;
    if (this.rand() > moveChance) return;

    if (im.phase === PHASE.GAS) {
      const outward = (baseDir + 4) & 7;
      const jitter = this.rand() < 0.5 ? 7 : 1;
      const candidates = [outward, (outward + jitter) & 7, (outward + 8 - jitter) & 7];
      for (const d of candidates) if (this.attemptDirection(i, d, m)) return;
      return;
    }

    const a = (dir + 7) & 7;
    const b = (dir + 1) & 7;
    const diagonals = this.rand() < 0.5 ? [a, b] : [b, a];
    if (im.phase === PHASE.GRANULAR) {
      for (const d of [dir, ...diagonals]) if (this.attemptDirection(i, d, m)) return;
      return;
    }

    if (im.phase === PHASE.LIQUID) {
      for (const d of [dir, ...diagonals]) if (this.attemptDirection(i, d, m)) return;
      this.flowSideways(i, dir, m);
    }
  }

  caStep(context, budget = 12000) {
    this.stepId = (this.stepId + 1) >>> 0;
    if (this.stepId === 0) {
      this.lastMove.fill(0);
      this.stepId = 1;
    }
    const start = this.activeHead;
    const end = Math.min(this.active.length, start + budget);
    const gravityChance = clamp(0.3 + this.g0 * 0.017, 0.3, 0.94);
    for (let k = start; k < end; k++) {
      const i = this.active[k];
      this.activeSet[i] = 0;
      if (this.lastMove[i] === this.stepId) continue;
      this.processCell(i, context, gravityChance);
    }
    this.activeHead = end;
    if (this.activeHead > 16000) {
      this.active = this.active.slice(this.activeHead);
      this.activeHead = 0;
    }
  }

  solveStructure(maxCrumble = 420) {
    if (!this.structural) {
      this.structureDirty = false;
      return;
    }
    const visited = new Uint8Array(this.size);
    const queue = new Int32Array(this.size);
    let head = 0;
    let tail = 0;

    const seed = (i) => {
      if (i < 0 || visited[i] || !isSolid(this.mat[i])) return;
      visited[i] = 1;
      queue[tail++] = i;
    };
    for (const a of this.anchors) seed(a);
    if (tail === 0) {
      const cx = this.w / 2;
      const cy = this.h / 2;
      for (let y = Math.floor(cy - 8); y <= cy + 8; y++) {
        for (let x = Math.floor(cx - 8); x <= cx + 8; x++) seed(this.index(x, y));
      }
    }

    while (head < tail) {
      const i = queue[head++];
      for (let k = 0; k < 8; k++) {
        const n = this.neighbor(i, k);
        if (n >= 0 && !visited[n] && isSolid(this.mat[n])) {
          visited[n] = 1;
          queue[tail++] = n;
        }
      }
    }

    let crumbled = 0;
    let unsupported = 0;
    for (let i = 0; i < this.size; i++) {
      const m = this.mat[i];
      if (!isSolid(m) || visited[i] || !STRUCTURAL_SOLIDS.includes(m)) continue;
      unsupported++;
      if (crumbled < maxCrumble && this.rand() < 0.22) {
        this.grindCell(i, 'collapse');
        crumbled++;
      }
    }
    this.structureDirty = unsupported > crumbled;
    this.structureTimer = 0.18;
  }

  solarUpdate(dt, context) {
    if (this.type !== 'comet' || context.far || !this.jetSources.length) return;
    this.solarAccumulator += dt;
    if (this.solarAccumulator < 0.085) return;
    this.solarAccumulator = 0;
    const tail = context.tailDirection || { x: 0.9, y: 0.35 };
    for (const jet of this.jetSources) {
      const i = this.index(Math.floor(jet.x), Math.floor(jet.y));
      if (i >= 0) this.addHeat(i, 5.5 + this.rand() * 5);
      if (i >= 0 && this.rand() < 0.48) {
        this.emit('jet', i, {
          vx: tail.x * (34 + this.rand() * 45) + (this.rand() - 0.5) * 16,
          vy: tail.y * (34 + this.rand() * 45) + (this.rand() - 0.5) * 16,
          mat: MAT.STEAM
        });
      }
    }
  }

  step(dt, context = {}, budget = 12000, rateScale = 1) {
    this.simAccumulator += dt * (7.5 + this.g0 * 0.5) * rateScale;
    let steps = 0;
    while (this.simAccumulator >= 1 && steps < 3) {
      this.simAccumulator -= 1;
      this.caStep(context, budget);
      steps++;
    }
    if (this.simAccumulator > 3) this.simAccumulator = 3;

    this.solarUpdate(dt, context);
    if (this.structureDirty && !context.far) {
      this.structureTimer -= dt;
      if (this.structureTimer <= 0) this.solveStructure();
    }
    this.flushSurface();
  }

  raycastLocal(sx, sy, dx, dy, maxDist, skipGas = true) {
    for (let t = 0.5; t <= maxDist; t += 0.5) {
      const x = Math.floor(sx + dx * t);
      const y = Math.floor(sy + dy * t);
      const i = this.index(x, y);
      if (i < 0) continue;
      const m = this.mat[i];
      if (m === MAT.VACUUM || (skipGas && isGas(m))) continue;
      return { i, t, x, y, mat: m, localX: sx + dx * t, localY: sy + dy * t };
    }
    return null;
  }

  normalAtLocal(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const dense = (ox, oy) => (isCollidable(this.cellAt(ix + ox, iy + oy)) ? 1 : 0);
    const left = dense(-1, 0) + dense(-2, 0) + dense(-1, -1) + dense(-1, 1);
    const right = dense(1, 0) + dense(2, 0) + dense(1, -1) + dense(1, 1);
    const up = dense(0, -1) + dense(0, -2) + dense(-1, -1) + dense(1, -1);
    const down = dense(0, 1) + dense(0, 2) + dense(-1, 1) + dense(1, 1);
    let n = norm(left - right, up - down, 0, 0);
    if (n.l < 0.01) n = norm(ix - this.w / 2, iy - this.h / 2, 0, -1);
    return n;
  }

  normalAtWorld(wx, wy) {
    const p = this.worldToLocal(wx, wy);
    const n = this.normalAtLocal(p.x, p.y);
    const r = rotate(n.x, n.y, this.cos, this.sin);
    return norm(r.x, r.y, 0, -1);
  }

  collectLocal(cx, cy, callback) {
    const radius = 10;
    const r = Math.ceil(radius);
    let collected = 0;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > radius * radius) continue;
        const i = this.index(x, y);
        if (i < 0) continue;
        const m = this.mat[i];
        if (!commodityFor(m) || !isLoose(m)) continue;
        if (callback(i, m)) {
          this.clearCell(i);
          collected++;
        }
      }
    }
    return collected;
  }

  integrity() {
    return clamp(this.solidCount / this.initialSolidCount, 0, 1);
  }

  worldPointForCell(i) {
    const x = i % this.w + 0.5;
    const y = ((i / this.w) | 0) + 0.5;
    return this.localToWorld(x, y);
  }
}
