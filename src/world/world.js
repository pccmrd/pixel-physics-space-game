import { TAU, clamp, dot, norm, wrap } from '../core/math.js';
import { Rng } from '../core/rng.js';
import { MAT, COMMODITIES, cargoForMaterial, isCollidable, isGas } from './materials.js';
import { generateBody } from './generation.js';

export const WORLD_YEAR = 2035;
export const BELT_POPULATION = 320;
export const CATALOGUED_POPULATION = Math.round(BELT_POPULATION * 0.05);
export const BELT_RADIUS = 5200;
export const BELT_WIDTH = 2200;

const FEATURED_CONFIGS = [
  {
    id: 'selene', name: 'SELENE GATE', designation: 'LUNA-ORBIT STATION 01', type: 'station',
    angle: -Math.PI / 2, orbitRadius: BELT_RADIUS, radius: 155, w: 390, h: 320,
    density: 0.16, seed: 0x5e1e, glow: '#9bd8ff', market: true, structural: false,
    variant: 'ring', hue: 0.57, discovered: true, scanned: true,
    description: 'Lunar-orbit exchange. Electromagnetic pad clamps, foundry rails and a continuous traffic lane.'
  },
  {
    id: 'kestrel', name: 'KESTREL SHARD', designation: 'CATALOG A-001', type: 'asteroid',
    angle: -Math.PI / 2 + 0.43, orbitRadius: 5850, radius: 255, w: 570, h: 570,
    density: 0.72, seed: 0x8a57, glow: '#ffb36b', structural: true, hue: 0.08,
    biome: true, derelict: true, discovered: true,
    description: 'A hauled iron asteroid with cave biomes, magnetic geode seams and a crashed scout.'
  },
  {
    id: 'goliath', name: 'GOLIATH', designation: 'CATALOG A-002', type: 'asteroid',
    angle: 3.12, orbitRadius: 6900, radius: 355, w: 780, h: 780,
    density: 0.94, seed: 0x901a, glow: '#d3a0ff', structural: true, hue: 0.74,
    biome: true, derelict: true, discovered: true,
    description: 'A giant uncatalogued-class rubble world, big enough to hold a slow orbit and deep cave systems.'
  },
  {
    id: 'vela', name: 'VELA', designation: 'CATALOG C-014', type: 'comet',
    angle: -0.18, orbitRadius: 6250, radius: 225, w: 510, h: 510,
    density: 0.38, seed: 0x7e1a, glow: '#8beaff', structural: true, hue: 0.52,
    biome: true, discovered: true,
    description: 'A captured comet core full of volatiles, cryo caves and a slow sunward jet.'
  },
  {
    id: 'halcyon', name: 'HALCYON RING', designation: 'LUNA-ORBIT STATION 02', type: 'station',
    angle: 1.25, orbitRadius: 5000, radius: 160, w: 400, h: 330,
    density: 0.15, seed: 0x1ac0, glow: '#8ef7ff', market: true, structural: false,
    variant: 'ring', hue: 0.5, discovered: true, scanned: true,
    description: 'A destructible trading ring with electromagnetic material rails and a clamped exchange pad.'
  },
  {
    id: 'cinder', name: 'CINDER', designation: 'CATALOG A-023', type: 'cinder',
    angle: 2.65, orbitRadius: 5900, radius: 240, w: 540, h: 540,
    density: 0.64, seed: 0xc1de, glow: '#ff8055', structural: true, hue: 0.03,
    biome: true, derelict: true, discovered: true,
    description: 'A hot carbonaceous asteroid with molten pockets, dense ores and a salvage wreck.'
  },
  {
    id: 'vesper', name: 'VESPER FOUNDRY', designation: 'LUNA-ORBIT STATION 03', type: 'station',
    angle: -2.45, orbitRadius: 5500, radius: 145, w: 370, h: 310,
    density: 0.17, seed: 0xfe5a, glow: '#ffb86b', market: true, structural: false,
    variant: 'foundry', hue: 0.1, discovered: true, scanned: true,
    description: 'An automated foundry whose flowing alloy rails are serviced by robotic haulers.'
  }
];

const NAME_PREFIXES = ['ERIS', 'NIX', 'ORCUS', 'HEDRA', 'MOROS', 'KORE', 'ATLAS', 'TETHYS', 'CHARON', 'BOREAS'];
const MINERALS = ['nickel-iron', 'magnetite', 'hydrated silicates', 'platinum grains', 'cryo volatiles', 'exotic crystals'];
const SUBSTANCES = ['water ice', 'molten pockets', 'magnetic dust', 'rare isotopes', 'carbon sludge', 'fuel gels'];

export class World {
  constructor(seed = 0x51a7) {
    this.seed = seed >>> 0;
    this.rng = new Rng(this.seed);
    this.year = WORLD_YEAR;
    this.time = 0;
    this.orbitTime = 0;
    this.events = [];
    this.star = { x: -2900, y: -2200, name: 'HELIOSTAR', color: '#ffd38a' };
    this.sunDirection = norm(-this.star.x, -this.star.y, 0.8, 0.6);
    this.moon = {
      x: 0, y: 0, radius: 2600, exclusionRadius: 3500,
      name: 'LUNA / NO-LANDING EXCLUSION', color: '#b9c6d8'
    };
    this.belt = {
      radius: BELT_RADIUS, width: BELT_WIDTH,
      initialPopulation: BELT_POPULATION, year: WORLD_YEAR,
      description: 'Hundreds of hauled rocks and comet cores orbit the Moon; 95% were uncatalogued on arrival.'
    };
    this.bounds = { minX: -9200, maxX: 9200, minY: -9200, maxY: 9200 };
    this.tailAccumulator = 0;
    this.deliveryCounter = 0;
    this.tracked = [];
    this.recordsById = new Map();
    this.bodyById = new Map();
    this.bodies = [];

    for (const config of FEATURED_CONFIGS) {
      const record = this.makeRecord(config, {
        catalogued: true,
        discovered: Boolean(config.discovered),
        scanned: Boolean(config.scanned),
        alwaysActive: true,
        featured: true
      });
      this.addRecord(record);
      this.materialize(record);
    }

    const proxyCount = BELT_POPULATION - FEATURED_CONFIGS.length;
    const proxyCatalogued = CATALOGUED_POPULATION - FEATURED_CONFIGS.length;
    for (let i = 0; i < proxyCount; i++) {
      const rng = new Rng((this.seed ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0);
      const angle = rng.range(0, TAU);
      const lane = rng.range(-BELT_WIDTH / 2, BELT_WIDTH / 2);
      const orbitRadius = BELT_RADIUS + lane;
      const huge = rng.chance(0.035);
      const radius = huge ? rng.range(230, 350) : rng.chance(0.18) ? rng.range(90, 190) : rng.range(24, 88);
      const type = rng.chance(0.17) ? 'comet' : rng.chance(0.13) ? 'cinder' : 'asteroid';
      const catalogued = i < proxyCatalogued;
      const designation = `${type === 'comet' ? 'C' : 'A'}-${String(1000 + i).padStart(4, '0')}`;
      const record = this.makeRecord({
        id: `belt-${i}`,
        name: catalogued ? designation : 'UNCATALOGUED MASS',
        designation,
        type,
        angle,
        orbitRadius,
        radius,
        w: Math.min(820, Math.ceil(radius * 2.16) + 18),
        h: Math.min(820, Math.ceil(radius * 2.16) + 18),
        density: clamp(0.10 + Math.sqrt(radius) * 0.034, 0.12, 0.92),
        seed: (this.seed ^ Math.imul(i + 17, 0x85ebca6b)) >>> 0,
        glow: type === 'comet' ? '#8beaff' : type === 'cinder' ? '#ff8a62' : '#c7a48d',
        hue: rng.range(0.02, 0.78),
        structural: true,
        market: false,
        biome: false,
        derelict: false,
        orbitRate: rng.range(0.000012, 0.000027) * (rng.chance(0.12) ? -1 : 1),
        radialAmplitude: rng.range(20, 190),
        radialRate: rng.range(0.0006, 0.0022),
        phase: rng.range(0, TAU),
        description: 'A continuous pixel-material body; scan at close range to reveal its composition.'
      }, { catalogued, discovered: false, scanned: false, alwaysActive: false, featured: false });
      this.addRecord(record);
    }

    this.initialUncatalogued = this.tracked.filter((r) => !r.catalogued).length;
    this.haulers = Array.from({ length: 7 }, (_, i) => {
      const rng = this.rng.fork(900 + i);
      const angle = rng.range(0, TAU);
      const orbitRadius = BELT_RADIUS + rng.range(-BELT_WIDTH * 0.42, BELT_WIDTH * 0.42);
      const rate = rng.range(0.000018, 0.000034) * (rng.chance(0.2) ? -1 : 1);
      const x = Math.cos(angle) * orbitRadius;
      const y = Math.sin(angle) * orbitRadius;
      return {
        id: `hauler-${i}`,
        name: `AUTO HAULER ${String(i + 1).padStart(2, '0')}`,
        angle, orbitRadius, rate,
        radialAmplitude: rng.range(60, 220),
        radialRate: rng.range(0.0008, 0.0026),
        phase: rng.range(0, TAU),
        x, y, vx: 0, vy: 0,
        towId: this.tracked[80 + i * 29]?.id || null,
        deliveryTimer: rng.range(65, 150),
        cargo: rng.pick(['MAIN BELT', 'NEAR EARTH', 'JOVIAN', 'Kuiper transfer', 'Mars-crossing'])
      };
    });

    const kestrel = this.recordsById.get('kestrel');
    const vela = this.recordsById.get('vela');
    const goliath = this.recordsById.get('goliath');
    this.anomalies = [
      {
        id: 'echo', name: 'ECHO CACHE', x: kestrel.x + 310, y: kestrel.y - 220,
        found: false, reward: 350, loot: { commodity: 'exotic', units: 2 }
      },
      {
        id: 'derelict', name: 'CRASHED DERELICT', x: goliath.x - 380, y: goliath.y + 240,
        found: false, reward: 420, loot: { commodity: 'alloy', units: 7 }
      },
      {
        id: 'cryo', name: 'CRYO VAULT', x: vela.x + 260, y: vela.y - 185,
        found: false, reward: 500, loot: { commodity: 'volatiles', units: 8 }
      }
    ];
  }

  addRecord(record) {
    this.tracked.push(record);
    this.recordsById.set(record.id, record);
    return record;
  }

  makeRecord(config, flags = {}) {
    const angle = config.angle ?? Math.atan2(config.y || 0, config.x || 0);
    const orbitRadius = config.orbitRadius ?? Math.hypot(config.x || 0, config.y || 0) ?? BELT_RADIUS;
    const x = config.x ?? Math.cos(angle) * orbitRadius;
    const y = config.y ?? Math.sin(angle) * orbitRadius;
    const radius = config.radius;
    const density = config.density ?? 0.2;
    const phase = config.phase ?? ((config.seed || 1) % 1000) * 0.0063;
    const record = {
      id: config.id,
      name: config.name || config.id.toUpperCase(),
      designation: config.designation || config.name || config.id.toUpperCase(),
      type: config.type,
      x, y,
      vx: config.vx || 0,
      vy: config.vy || 0,
      w: config.w,
      h: config.h,
      radius,
      density,
      mu: density * radius * radius * 1.08,
      seed: config.seed >>> 0,
      glow: config.glow || '#8ceaff',
      hue: config.hue ?? 0.55,
      description: config.description || '',
      market: Boolean(config.market),
      structural: config.structural !== false,
      variant: config.variant || null,
      biome: Boolean(config.biome),
      derelict: Boolean(config.derelict),
      rotation: config.rotation || 0,
      orbit: {
        angle,
        radius: orbitRadius,
        lane: orbitRadius - BELT_RADIUS,
        rate: config.orbitRate ?? 0.000017,
        radialAmplitude: config.radialAmplitude ?? 0,
        radialRate: config.radialRate ?? 0.001,
        phase
      },
      catalogued: Boolean(flags.catalogued),
      scanned: Boolean(flags.scanned),
      discovered: Boolean(flags.discovered),
      visited: false,
      proximityAnnounced: false,
      explored: false,
      alwaysActive: Boolean(flags.alwaysActive),
      featured: Boolean(flags.featured),
      active: false,
      body: null,
      survey: null,
      scanTime: null,
      hauledAt: null
    };
    record.survey = this.makeSurvey(record, config);
    return record;
  }

  makeSurvey(record, config = {}) {
    const rng = new Rng((record.seed ^ 0x5ca9) >>> 0);
    const caveBiome = Boolean(config.biome || rng.chance(0.34));
    const derelict = Boolean(config.derelict || rng.chance(0.18));
    const mineral = rng.pick(MINERALS);
    const substance = rng.pick(SUBSTANCES);
    const findings = [mineral, substance];
    if (caveBiome) findings.push('cave biome');
    if (derelict) findings.push('crashed derelict');
    record.biome = record.biome || caveBiome;
    record.derelict = record.derelict || derelict;
    return {
      composition: record.type === 'comet' ? 'volatile ice / dust matrix' : record.type === 'station' ? 'fabricated alloy' : 'rubble-pile silicate',
      mineral,
      substance,
      caveBiome,
      derelict,
      findings
    };
  }

  surveyText(record) {
    const survey = record?.survey;
    if (!survey) return 'NO SURVEY DATA';
    return `${record.designation} · ${survey.composition} · ${survey.findings.join(' / ')}`;
  }

  materialize(record) {
    if (record.body) {
      this.activate(record);
      return record.body;
    }
    const body = generateBody({
      id: record.id,
      name: record.name,
      type: record.type,
      x: record.x,
      y: record.y,
      vx: record.vx,
      vy: record.vy,
      w: record.w,
      h: record.h,
      radius: record.radius,
      density: record.density,
      seed: record.seed,
      glow: record.glow,
      hue: record.hue,
      market: record.market,
      structural: record.structural,
      variant: record.variant,
      biome: record.biome,
      derelict: record.derelict,
      description: record.description,
      rotation: record.rotation,
      tailDirection: this.tailDirectionFor(record)
    });
    body.record = record;
    body.survey = record.survey;
    body.catalogued = record.catalogued;
    body.scanned = record.scanned;
    body.discovered = record.discovered;
    body.visited = record.visited;
    record.body = body;
    this.bodyById.set(record.id, body);
    this.activate(record);
    return body;
  }

  activate(record) {
    if (record.active || !record.body) return;
    record.active = true;
    this.bodies.push(record.body);
    this.bodyById.set(record.id, record.body);
    this.syncBodyTransform(record);
  }

  deactivate(record) {
    if (!record.active || record.alwaysActive) return;
    record.active = false;
    this.bodies = this.bodies.filter((body) => body !== record.body);
  }

  syncBodyTransform(record) {
    const body = record.body;
    if (!body) return;
    body.x = record.x;
    body.y = record.y;
    body.vx = record.vx;
    body.vy = record.vy;
    body.name = record.name;
    body.description = record.description;
    body.catalogued = record.catalogued;
    body.scanned = record.scanned;
    body.discovered = record.discovered;
    body.visited = record.visited;
    body.survey = record.survey;
  }

  recordFor(id) {
    return this.recordsById?.get(id) || this.tracked.find((r) => r.id === id) || null;
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
    for (const record of this.tracked) {
      const dx = record.x - x;
      const dy = record.y - y;
      const r2 = dx * dx + dy * dy;
      const eps2 = (record.radius * 0.22) ** 2;
      const denom = Math.pow(r2 + eps2, 1.5);
      const f = record.mu / denom;
      const gx = dx * f;
      const gy = dy * f;
      ax += gx;
      ay += gy;
      const mag = Math.hypot(gx, gy);
      if (mag > dominantMag) {
        dominantMag = mag;
        dominant = record;
      }
    }

    // A distant photogravitational star gives the sector a barely perceptible drift.
    const sdx = this.star.x - x;
    const sdy = this.star.y - y;
    const sr2 = sdx * sdx + sdy * sdy + 900000;
    const sf = 2.2e4 / Math.pow(sr2, 1.5);
    ax += sdx * sf;
    ay += sdy * sf;

    // The Moon is scenery and an exclusion zone, not a landing destination. A soft
    // outward gradient keeps operations in the hauled-asteroid belt without a scene cut.
    const moonR = Math.hypot(x - this.moon.x, y - this.moon.y);
    if (moonR > 1 && moonR < this.moon.exclusionRadius) {
      const push = (1 - moonR / this.moon.exclusionRadius) * 1.35;
      ax += ((x - this.moon.x) / moonR) * push;
      ay += ((y - this.moon.y) / moonR) * push;
    }

    const mag = Math.hypot(ax, ay);
    const cap = 5;
    if (mag > cap) {
      const s = cap / mag;
      ax *= s;
      ay *= s;
    }
    return { x: ax, y: ay, magnitude: Math.hypot(ax, ay), dominant, dominantMagnitude: dominantMag };
  }

  nearestBody(x, y) {
    let best = null;
    for (const record of this.tracked) {
      const dx = record.x - x;
      const dy = record.y - y;
      const distance = Math.hypot(dx, dy);
      const altitude = distance - record.radius;
      if (!best || altitude < best.altitude) best = { record, distance, altitude, dx, dy };
    }
    const g = this.gravityAt(x, y);
    const away = best ? norm(-best.dx, -best.dy, 0, -1) : norm(0, -1, 0, -1);
    return {
      body: best?.record || null,
      detail: best?.record?.active ? best.record.body : null,
      distance: best?.distance ?? Infinity,
      altitude: best?.altitude ?? Infinity,
      dx: best?.dx ?? 0,
      dy: best?.dy ?? 0,
      gravity: g,
      away
    };
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

  dockPoint(body) {
    return body?.dockClampPoint?.() || null;
  }

  findDock(ship) {
    if (ship.padClamp?.body) {
      const body = ship.padClamp.body;
      const point = this.dockPoint(body);
      if (point) return { body, point, distance: 0, speed: 0, ready: true, clamped: true };
    }

    let best = null;
    for (const body of this.bodies) {
      if (!body.dock || !body.market || body.integrity() < 0.28) continue;
      const point = this.dockPoint(body);
      if (!point) continue;
      const distance = Math.hypot(ship.x - point.x, ship.y - point.y);
      const speed = Math.hypot(ship.vx - (body.vx || 0), ship.vy - (body.vy || 0));
      const wasReady = Boolean(ship.docked?.ready && ship.docked.body === body);
      const near = wasReady ? 66 : 54;
      const quiet = wasReady ? 7 : 4.5;
      const ready = distance < near && speed < quiet && Boolean(ship.gear);
      if (!best || distance < best.distance) best = { body, point, distance, speed, ready, clamped: false };
    }
    const envelope = ship.docked?.ready ? 102 : 90;
    return best && best.distance < envelope ? best : null;
  }

  clampToPad(ship, body, landing = {}) {
    if (!body?.dock || !body.market || body.integrity() < 0.28) return false;
    const clamp = body.dock.clamp || { x: body.dock.x, y: body.dock.y - 2, width: body.dock.width * 0.9, normalX: 0, normalY: -1 };
    const local = body.worldToLocal(ship.x, ship.y);
    const normal = body.dockClampNormal?.() || norm(0, -1, 0, -1);
    const up = ship.upVector?.() || norm(0, -1, 0, -1);
    const align = dot(up.x, up.y, normal.x, normal.y);
    const withinX = Math.abs(local.x - clamp.x) <= clamp.width * 0.5;
    const withinY = Math.abs(local.y - clamp.y) <= 18;
    const impactSpeed = landing.impactSpeed ?? 0;
    const horizontal = landing.horizontal ?? 0;
    if (!ship.gear || !withinX || !withinY || align < 0.82 ||
        impactSpeed >= 2.6 || horizontal >= 2.1 || Math.abs(ship.omega || 0) >= 0.42) return false;

    const target = body.localToWorld(clamp.x, clamp.y);
    const supportX = target.x - normal.x * 12;
    const supportY = target.y - normal.y * 12;
    if (!isCollidable(body.sampleWorld(supportX, supportY))) return false;

    ship.x = target.x;
    ship.y = target.y;
    ship.prevX = target.x;
    ship.prevY = target.y;
    ship.angle = wrap(body.rotation || 0, 0, TAU);
    ship.omega = 0;
    ship.vx = body.vx || 0;
    ship.vy = body.vy || 0;
    ship.landed = true;
    ship.landedBody = body;
    ship.clamped = true;
    ship.padClamp = {
      body,
      localX: clamp.x,
      localY: clamp.y,
      angle: ship.angle,
      normal,
      engagedAt: this.time
    };
    ship.requestingLaunch = false;
    ship.contact = true;
    ship.contactBody = body;
    ship.contactNormal = normal;
    this.pushEvent({
      type: 'clamp',
      text: `ELECTROMAGNETIC PAD CLAMPS ENGAGED · ${body.name}`,
      tone: 'good',
      x: ship.x, y: ship.y, body
    });
    return true;
  }

  priceFor(body, commodity) {
    const base = COMMODITIES[commodity]?.price ?? 1;
    const scarcity = 0.86 + (1 - body.integrity()) * 0.34;
    const local = body.type === 'station' ? 1 : 0.92;
    return Math.max(1, Math.round(base * scarcity * local));
  }

  catalogStats() {
    let catalogued = 0;
    let scanned = 0;
    let discovered = 0;
    for (const record of this.tracked) {
      if (record.catalogued) catalogued++;
      if (record.scanned) scanned++;
      if (record.discovered) discovered++;
    }
    const total = this.tracked.length;
    return {
      total,
      catalogued,
      scanned,
      discovered,
      uncatalogued: total - catalogued,
      initialUncatalogued: this.initialUncatalogued,
      initialRatio: this.initialUncatalogued / BELT_POPULATION,
      year: this.year
    };
  }

  scanPulse(ship, range = 1250, maxResults = 10) {
    const candidates = [];
    for (const record of this.tracked) {
      if (record.scanned) continue;
      const distance = Math.hypot(ship.x - record.x, ship.y - record.y) - record.radius;
      if (distance < range) candidates.push({ record, distance });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    const results = candidates.slice(0, maxResults);
    for (const { record } of results) {
      record.scanned = true;
      record.catalogued = true;
      record.discovered = true;
      record.name = record.featured ? record.name : record.designation;
      record.scanTime = this.time;
      this.syncBodyTransform(record);
      this.pushEvent({
        type: 'scanResult',
        text: `SURVEY LOCK: ${this.surveyText(record)}`,
        tone: 'good',
        x: record.x, y: record.y,
        body: record.active ? record.body : record
      });
    }
    this.pushEvent({ type: 'scanPulse', x: ship.x, y: ship.y, radius: range });
    return results.map(({ record, distance }) => ({ record, distance, text: this.surveyText(record) }));
  }

  updateDiscovery(ship) {
    for (const record of this.tracked) {
      const d = Math.hypot(ship.x - record.x, ship.y - record.y);
      if (!record.discovered && d < record.radius * 3.2) {
        record.discovered = true;
        if (record.body) record.body.discovered = true;
        if (record.catalogued || !record.proximityAnnounced) {
          record.proximityAnnounced = true;
          const label = record.catalogued ? record.name : 'UNCATALOGUED GRAVITY ECHO';
          this.pushEvent({
            type: 'discover',
            text: `PROXIMITY ECHO: ${label} · N TO SCAN`,
            tone: '',
            x: ship.x, y: ship.y
          });
        }
      }
      if (!record.visited && d < record.radius + 55) {
        record.visited = true;
        if (record.body) record.body.visited = true;
        if (record.catalogued) {
          this.pushEvent({
            type: 'visit',
            text: `ENTERED ${record.name} MATERIAL FIELD`,
            tone: '',
            body: record.active ? record.body : record,
            x: ship.x, y: ship.y
          });
        }
      }
    }
    for (const anomaly of this.anomalies) {
      if (anomaly.found) continue;
      const d = Math.hypot(ship.x - anomaly.x, ship.y - anomaly.y);
      if (d < 72) {
        anomaly.found = true;
        ship.credits += anomaly.reward;
        if (anomaly.loot) ship.addCargo(anomaly.loot.commodity, anomaly.loot.units);
        this.pushEvent({
          type: 'anomaly',
          text: `${anomaly.name} RECOVERED  +${anomaly.reward} CR`,
          tone: 'good', x: anomaly.x, y: anomaly.y, radius: 42
        });
      }
    }
  }

  advanceOrbits(dt, ship = null) {
    if (dt <= 0) return;
    this.orbitTime += dt;
    for (const record of this.tracked) {
      const orbit = record.orbit;
      if (!orbit) continue;
      const oldX = record.x;
      const oldY = record.y;
      orbit.angle += orbit.rate * dt;
      const wave = this.orbitTime * orbit.radialRate + orbit.phase;
      const radial = orbit.radius + Math.sin(wave) * orbit.radialAmplitude;
      const radialVelocity = Math.cos(wave) * orbit.radialAmplitude * orbit.radialRate;
      const c = Math.cos(orbit.angle);
      const s = Math.sin(orbit.angle);
      record.x = c * radial;
      record.y = s * radial;
      record.vx = -s * radial * orbit.rate + c * radialVelocity;
      record.vy = c * radial * orbit.rate + s * radialVelocity;
      const dx = record.x - oldX;
      const dy = record.y - oldY;
      this.syncBodyTransform(record);
      if (!ship) continue;
      const lockedBody = ship.padClamp?.body === record.body || ship.landedBody === record.body;
      const orbiting = ship.orbitHold?.recordId === record.id;
      if (lockedBody || orbiting) {
        ship.x += dx;
        ship.y += dy;
        if (lockedBody) {
          ship.vx = record.vx;
          ship.vy = record.vy;
        }
        if (ship.eva?.active) {
          ship.eva.x += dx;
          ship.eva.y += dy;
        }
      }
    }

    for (const hauler of this.haulers) {
      const oldX = hauler.x;
      const oldY = hauler.y;
      hauler.angle += hauler.rate * dt;
      const wave = this.orbitTime * hauler.radialRate + hauler.phase;
      const radial = hauler.orbitRadius + Math.sin(wave) * hauler.radialAmplitude;
      hauler.x = Math.cos(hauler.angle) * radial;
      hauler.y = Math.sin(hauler.angle) * radial;
      hauler.vx = (hauler.x - oldX) / dt;
      hauler.vy = (hauler.y - oldY) / dt;
    }
  }

  updateStreaming(ship, maxMaterialize = 1) {
    if (!ship) return;
    const candidates = [];
    for (const record of this.tracked) {
      const d = Math.hypot(ship.x - record.x, ship.y - record.y) - record.radius;
      const materializeDistance = Math.max(620, record.radius * 2.1 + 360);
      const unloadDistance = Math.max(2600, record.radius * 4 + 1500);
      if (!record.active && d < materializeDistance) {
        if (record.body) this.activate(record);
        else candidates.push({ record, distance: d });
      } else if (record.active && !record.alwaysActive && d > unloadDistance) {
        const locked = ship.padClamp?.body === record.body || ship.landedBody === record.body ||
          ship.orbitHold?.recordId === record.id || ship.eva?.recordId === record.id;
        if (!locked) this.deactivate(record);
      }
    }
    candidates.sort((a, b) => a.distance - b.distance);
    for (const { record } of candidates.slice(0, maxMaterialize)) this.materialize(record);
  }

  preUpdate(dt, ship = null) {
    this.advanceOrbits(dt, ship);
    this.updateStreaming(ship, 1);
  }

  deliverHauledBody(hauler) {
    this.deliveryCounter++;
    const rng = new Rng((this.seed ^ Math.imul(this.deliveryCounter + 991, 0x27d4eb2d)) >>> 0);
    const angle = hauler.angle + rng.range(-0.035, 0.035);
    const orbitRadius = hauler.orbitRadius + rng.range(60, 260);
    const radius = rng.range(55, rng.chance(0.23) ? 310 : 150);
    const type = rng.chance(0.22) ? 'comet' : 'asteroid';
    const designation = `HL-${String(2000 + this.deliveryCounter).padStart(4, '0')}`;
    const record = this.makeRecord({
      id: `delivery-${this.deliveryCounter}`,
      name: 'UNCATALOGUED MASS',
      designation,
      type,
      angle,
      orbitRadius,
      radius,
      w: Math.min(820, Math.ceil(radius * 2.16) + 18),
      h: Math.min(820, Math.ceil(radius * 2.16) + 18),
      density: clamp(0.10 + Math.sqrt(radius) * 0.034, 0.12, 0.92),
      seed: (this.seed ^ Math.imul(this.deliveryCounter + 3001, 0x165667b1)) >>> 0,
      glow: type === 'comet' ? '#8beaff' : '#c7a48d',
      hue: rng.range(0.02, 0.78),
      structural: true,
      market: false,
      orbitRate: hauler.rate,
      radialAmplitude: rng.range(20, 160),
      radialRate: rng.range(0.0006, 0.002),
      phase: rng.range(0, TAU),
      description: `Fresh haul from ${hauler.cargo}; not yet entered into the 2035 lunar-orbit catalogue.`
    }, { catalogued: false, discovered: false, scanned: false, alwaysActive: false, featured: false });
    record.hauledAt = this.time;
    this.addRecord(record);
    hauler.towId = record.id;
    hauler.deliveryTimer = rng.range(90, 210);
    this.pushEvent({
      type: 'haulerDelivery',
      text: `${hauler.name} DELIVERED ${designation} FROM ${hauler.cargo.toUpperCase()}`,
      tone: 'good',
      x: record.x, y: record.y,
      radius: 44
    });
    return record;
  }

  updateHaulerDeliveries(dt) {
    for (const hauler of this.haulers) {
      hauler.deliveryTimer -= dt;
      if (hauler.deliveryTimer <= 0) this.deliverHauledBody(hauler);
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
    if (!options.preUpdated) this.preUpdate(dt, ship);
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
    this.updateHaulerDeliveries(dt);
    this.tailAccumulator += dt;
    while (this.tailAccumulator >= 0.045) {
      this.tailAccumulator -= 0.045;
      this.emitAmbientTails();
    }
    if (options.collect !== false) this.collectAtShip(ship);
  }

  discoveryCount() {
    const catalog = this.catalogStats();
    const anomalies = this.anomalies.reduce((n, a) => n + (a.found ? 1 : 0), 0);
    return {
      bodies: catalog.catalogued,
      anomalies,
      total: catalog.catalogued + anomalies,
      max: catalog.total + this.anomalies.length
    };
  }
}
