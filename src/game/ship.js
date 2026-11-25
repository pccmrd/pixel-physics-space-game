import { TAU, clamp, dot, lerp, norm, wrap } from '../core/math.js';
import { MAT, cargoForMaterial } from '../world/materials.js';
import { resolveTerrainCollision } from './physics.js';

const held = (input, ...codes) => Boolean(
  (input.anyDown && input.anyDown(...codes)) ||
  (input.isDown && codes.some((code) => input.isDown(code)))
);

export class Ship {
  constructor(world) {
    this.world = world;
    this.name = 'PEREGRINE';
    const home = world?.recordsById?.get?.('selene') || null;
    const dock = home?.body?.dockClampPoint?.() || { x: 0, y: -5360 };
    this.x = dock.x;
    this.y = dock.y - 120;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = home?.vx || 0;
    this.vy = home?.vy || 0;
    this.angle = 0;
    this.omega = 0;
    this.radius = 15;

    this.hull = 100;
    this.fuel = 100;
    this.energy = 100;
    this.heat = 0;
    this.credits = 850;
    this.capacity = 100;
    this.magnetLevel = 0;
    this.scoopRangeBonus = 0;
    this.cargo = Object.create(null);

    this.gear = true;
    this.scoop = false;
    this.tool = 'grinder';
    this.landed = false;
    this.landedBody = null;
    this.requestingLaunch = false;
    this.contact = false;
    this.contactBody = null;
    this.contactNormal = null;
    this.docked = null;
    this.padClamp = null;
    this.clamped = false;
    this.clampReleaseRequested = false;
    this.orbitHold = null;
    this.laneDrive = 0;
    this.eva = {
      active: false, x: 0, y: 0, vx: 0, vy: 0,
      recordId: null, oxygen: 100, tether: 270,
      caveTime: 0, samples: 0, salvaged: false
    };
    this.invulnerable = 1.6;
    this.touchdownCooldown = 0;
    this.cargoWarnCooldown = 0;
    this.weaponCooldown = 0;
    this.thrustLevel = 0;
    this.thrustVector = { x: 0, y: 0 };
    this.boosting = false;
    this.metrics = null;
    this.lastLanding = null;
    this.notifications = [];
  }

  notify(text, tone = '', meta = {}) {
    this.notifications.push({ text, tone, ...meta });
    if (this.notifications.length > 32) this.notifications.splice(0, this.notifications.length - 32);
  }

  takeNotifications() {
    if (!this.notifications.length) return [];
    const out = this.notifications;
    this.notifications = [];
    return out;
  }

  forwardVector() {
    return { x: Math.cos(this.angle), y: Math.sin(this.angle) };
  }

  rightVector() {
    return { x: -Math.sin(this.angle), y: Math.cos(this.angle) };
  }

  upVector() {
    return { x: Math.sin(this.angle), y: -Math.cos(this.angle) };
  }

  cargoUsed() {
    let total = 0;
    for (const value of Object.values(this.cargo)) total += value;
    return total;
  }

  addCargo(commodity, units) {
    if (!commodity || units <= 0) return false;
    const remaining = this.capacity - this.cargoUsed();
    if (remaining <= 0.001) {
      if (this.cargoWarnCooldown <= 0) {
        this.notify('CARGO HOLD FULL — SELL OR JETTISON', 'warn', { type: 'cargoFull' });
        this.cargoWarnCooldown = 2.2;
      }
      return false;
    }
    const accepted = Math.min(units, remaining);
    this.cargo[commodity] = (this.cargo[commodity] || 0) + accepted;
    return true;
  }

  addMaterial(material) {
    const cargo = cargoForMaterial(material);
    if (!cargo) return false;
    return this.addCargo(cargo.commodity, cargo.units);
  }

  sellCargo(commodity, price) {
    const units = this.cargo[commodity] || 0;
    if (units <= 0) return null;
    const revenue = Math.max(1, Math.floor(units * price));
    this.cargo[commodity] = 0;
    this.credits += revenue;
    return { units, revenue };
  }

  jettison(commodity) {
    const units = this.cargo[commodity] || 0;
    if (units <= 0) return 0;
    this.cargo[commodity] = 0;
    return units;
  }

  spendCredits(amount) {
    if (this.credits < amount) return false;
    this.credits -= amount;
    return true;
  }

  refuel(amount = 100) {
    const before = this.fuel;
    this.fuel = clamp(this.fuel + amount, 0, 100);
    return this.fuel - before;
  }

  repair(amount = 100) {
    const before = this.hull;
    this.hull = clamp(this.hull + amount, 0, 100);
    this.heat = Math.max(0, this.heat - 30);
    return this.hull - before;
  }

  consumeEnergy(amount) {
    if (this.energy < amount) return false;
    this.energy -= amount;
    return true;
  }

  damage(amount, reason, world = this.world) {
    if (this.invulnerable > 0 || amount <= 0) return;
    this.hull = clamp(this.hull - amount, 0, 100);
    this.heat = clamp(this.heat + amount * 0.18, 0, 100);
    this.notify(`${reason.toUpperCase()}  -${amount.toFixed(0)}% HULL`, 'bad', { type: 'damage', reason });
    world?.pushEvent?.({ type: 'shipDamage', x: this.x, y: this.y, amount, reason });
  }

  holdPadClamp(world) {
    const clampState = this.padClamp;
    const body = clampState?.body;
    if (!body || !body.dock || body.integrity?.() < 0.18) {
      this.releaseClamp(world);
      return false;
    }
    const target = body.localToWorld(clampState.localX, clampState.localY);
    const normal = body.dockClampNormal?.() || clampState.normal || norm(0, -1, 0, -1);
    this.x = target.x;
    this.y = target.y;
    this.prevX = target.x;
    this.prevY = target.y;
    this.angle = wrap(body.rotation || clampState.angle || 0, 0, TAU);
    this.omega = 0;
    this.vx = body.vx || 0;
    this.vy = body.vy || 0;
    this.landed = true;
    this.landedBody = body;
    this.clamped = true;
    this.requestingLaunch = false;
    this.contact = true;
    this.contactBody = body;
    this.contactNormal = normal;
    this.thrustLevel = lerp(this.thrustLevel, 0, Math.min(1, 1 / 6));
    this.thrustVector = { x: 0, y: 0 };
    this.boosting = false;
    return true;
  }

  releaseClamp(world = this.world) {
    if (!this.padClamp) return false;
    const body = this.padClamp.body;
    const normal = this.padClamp.normal || body?.dockClampNormal?.() || norm(0, -1, 0, -1);
    this.padClamp = null;
    this.clamped = false;
    this.clampReleaseRequested = false;
    this.landed = false;
    this.landedBody = null;
    this.contact = false;
    this.requestingLaunch = true;
    this.touchdownCooldown = 0.85;
    this.vx = (body?.vx || 0) + normal.x * 8;
    this.vy = (body?.vy || 0) + normal.y * 8;
    this.notify('PAD CLAMPS RELEASED · MANUAL LIFT-OFF', '', { type: 'launch' });
    world?.pushEvent?.({ type: 'launch', x: this.x, y: this.y });
    return true;
  }

  toggleOrbitHold(world = this.world) {
    if (!world?.nearestBody) return false;
    if (this.eva?.active) {
      this.notify('RETURN EVA SUIT BEFORE CHANGING ORBIT HOLD', 'warn', { type: 'eva' });
      return false;
    }
    if (this.orbitHold) {
      this.orbitHold = null;
      this.notify('SLOW ORBIT HOLD RELEASED', '', { type: 'orbit' });
      return false;
    }
    if (this.padClamp) this.releaseClamp(world);
    const nav = world.nearestBody(this.x, this.y);
    const record = nav.body;
    if (!record || record.type === 'station' || nav.altitude > 900) {
      this.notify('NO ASTEROID IN ORBIT-HOLD RANGE', 'warn', { type: 'orbit' });
      return false;
    }
    const dx = this.x - record.x;
    const dy = this.y - record.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const rvx = this.vx - (record.vx || 0);
    const rvy = this.vy - (record.vy || 0);
    const cross = dx * rvy - dy * rvx;
    this.landed = false;
    this.landedBody = null;
    this.orbitHold = {
      recordId: record.id,
      radius: clamp(distance, record.radius + 115, record.radius + 230),
      angle: Math.atan2(dy, dx),
      sign: cross < 0 ? -1 : 1,
      speed: 0.16,
      time: 0
    };
    this.notify(`SLOW ORBIT HOLD · ${record.catalogued ? record.name : 'UNCATALOGUED MASS'} · O TO RELEASE`, 'good', { type: 'orbit' });
    world.pushEvent?.({ type: 'orbitHold', x: this.x, y: this.y, radius: this.orbitHold.radius });
    return true;
  }

  holdOrbit(dt, world) {
    const hold = this.orbitHold;
    if (!hold) return false;
    const record = world.recordFor?.(hold.recordId) ||
      world.recordsById?.get?.(hold.recordId) ||
      world.tracked?.find?.((r) => r.id === hold.recordId);
    if (!record) {
      this.orbitHold = null;
      return false;
    }
    hold.time += dt;
    hold.angle += hold.sign * hold.speed * dt;
    const c = Math.cos(hold.angle);
    const s = Math.sin(hold.angle);
    const targetX = record.x + c * hold.radius;
    const targetY = record.y + s * hold.radius;
    const desiredVX = (record.vx || 0) - s * hold.radius * hold.speed * hold.sign;
    const desiredVY = (record.vy || 0) + c * hold.radius * hold.speed * hold.sign;
    const follow = 1 - Math.exp(-dt * 4.6);
    this.x = lerp(this.x, targetX, follow);
    this.y = lerp(this.y, targetY, follow);
    this.vx = lerp(this.vx, desiredVX, follow);
    this.vy = lerp(this.vy, desiredVY, follow);
    this.angle = Math.atan2(desiredVY - (record.vy || 0), desiredVX - (record.vx || 0));
    this.omega = 0;
    this.contact = false;
    this.contactBody = null;
    this.requestingLaunch = false;
    this.thrustLevel = lerp(this.thrustLevel, 0.07, Math.min(1, dt * 3));
    this.thrustVector = { x: 0, y: 0 };
    this.boosting = false;
    return true;
  }

  startEVA(world = this.world) {
    if (!world?.nearestBody) return false;
    if (this.eva.active) return this.endEVA(world);
    if (!this.orbitHold && !this.landed) {
      this.notify('ENGAGE SLOW ORBIT HOLD OR LAND BEFORE EVA', 'warn', { type: 'eva' });
      return false;
    }
    const nav = world.nearestBody(this.x, this.y);
    const record = nav.body;
    if (!record || record.type === 'station' || nav.altitude > 340) {
      this.notify('EVA REQUIRES A NEARBY ASTEROID OR COMET CAVE FIELD', 'warn', { type: 'eva' });
      return false;
    }
    const toward = norm(record.x - this.x, record.y - this.y, 0, 1);
    this.eva = {
      active: true,
      x: this.x + toward.x * 18,
      y: this.y + toward.y * 18,
      vx: this.vx + toward.x * 7,
      vy: this.vy + toward.y * 7,
      recordId: record.id,
      oxygen: 100,
      tether: 270,
      caveTime: 0,
      samples: 0,
      salvaged: false
    };
    this.notify('EVA TETHER DEPLOYED · W/S/Q/E MOVE SUIT · G TO RETURN', 'good', { type: 'eva' });
    world.pushEvent?.({ type: 'evaStart', x: this.eva.x, y: this.eva.y, radius: 18 });
    return true;
  }

  endEVA(world = this.world) {
    if (!this.eva?.active) return false;
    this.eva.active = false;
    this.notify(`EVA COMPLETE · ${this.eva.samples} SAMPLE(S) STOWED`, 'good', { type: 'eva' });
    world?.pushEvent?.({ type: 'evaEnd', x: this.eva.x, y: this.eva.y, radius: 12 });
    return true;
  }

  updateEVA(dt, input, world) {
    const e = this.eva;
    if (!e.active) return;
    const forward = (held(input, 'KeyW', 'ArrowUp') ? 1 : 0) - (held(input, 'KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (held(input, 'KeyE') ? 1 : 0) - (held(input, 'KeyQ') ? 1 : 0);
    const boost = held(input, 'ShiftLeft', 'ShiftRight') ? 1.55 : 1;
    const f = this.forwardVector();
    const r = this.rightVector();
    let ax = (f.x * forward + r.x * strafe) * 34 * boost;
    let ay = (f.y * forward + r.y * strafe) * 34 * boost;
    const gravity = world.gravityAt?.(e.x, e.y);
    if (gravity) {
      ax += gravity.x * 0.42;
      ay += gravity.y * 0.42;
    }
    const tx = this.x - e.x;
    const ty = this.y - e.y;
    const tetherDistance = Math.hypot(tx, ty);
    if (tetherDistance > e.tether && tetherDistance > 1) {
      const pull = (tetherDistance - e.tether) * 0.7;
      ax += tx / tetherDistance * pull;
      ay += ty / tetherDistance * pull;
    }
    e.vx = (e.vx + ax * dt) * Math.pow(0.994, dt * 60);
    e.vy = (e.vy + ay * dt) * Math.pow(0.994, dt * 60);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.oxygen = Math.max(0, e.oxygen - dt * 0.55);

    const sample = world.sampleMaterial?.(e.x, e.y, true);
    if (sample) {
      e.x += sample.normal.x * 1.7;
      e.y += sample.normal.y * 1.7;
      e.vx *= 0.28;
      e.vy *= 0.28;
      const record = sample.body?.record || world.recordFor?.(e.recordId);
      if (record?.survey?.caveBiome || sample.material === MAT.BIOMASS) {
        e.caveTime += dt;
        if (e.caveTime > 1.2 && !record.explored) {
          record.explored = true;
          e.samples++;
          this.credits += 260;
          this.addCargo('exotic', 2);
          world.pushEvent?.({
            type: 'caveFind',
            text: `CAVE BIOME SAMPLE · ${record.designation || record.name}  +260 CR`,
            tone: 'good',
            x: e.x, y: e.y, radius: 28
          });
          this.notify('CAVE BIOME SAMPLE STOWED  +260 CR', 'good', { type: 'eva' });
        }
        if (record?.survey?.derelict && e.caveTime > 2.6 && !e.salvaged) {
          e.salvaged = true;
          e.samples++;
          this.addCargo('alloy', 5);
          world.pushEvent?.({
            type: 'caveFind',
            text: `DERELICT SALVAGE · ${record.designation || record.name}`,
            tone: 'good',
            x: e.x, y: e.y, radius: 22
          });
          this.notify('CRASHED DERELICT SALVAGE STOWED', 'good', { type: 'eva' });
        }
      }
    }
    if (e.oxygen <= 0) {
      this.endEVA(world);
      this.notify('EVA OXYGEN RESERVE LOW — AUTO RETURN', 'warn', { type: 'eva' });
    }
  }

  respawnAt(body) {
    const target = this.world?.dockPoint?.(body) || body.dockClampPoint?.() || body.localToWorld(body.dock.x, body.dock.y);
    const normal = body.dockClampNormal?.() || norm(0, -1, 0, -1);
    this.x = target.x + normal.x * 90;
    this.y = target.y + normal.y * 90;
    this.prevX = this.x;
    this.prevY = this.y;
    this.vx = body.vx || 0;
    this.vy = body.vy || 0;
    this.angle = wrap(body.rotation || 0, 0, TAU);
    this.omega = 0;
    this.hull = 72;
    this.fuel = 80;
    this.energy = 100;
    this.heat = 0;
    this.invulnerable = 2.4;
    this.gear = true;
    this.scoop = false;
    this.landed = false;
    this.landedBody = null;
    this.padClamp = null;
    this.clamped = false;
    this.orbitHold = null;
    this.eva.active = false;
    this.requestingLaunch = false;
    this.touchdownCooldown = 0.8;
    this.notify(`RECONSTRUCTED ABOVE ${body.name}`, 'warn', { type: 'respawn', body });
  }

  update(dt, input, world) {
    this.prevX = this.x;
    this.prevY = this.y;
    this.invulnerable = Math.max(0, this.invulnerable - dt);
    this.touchdownCooldown = Math.max(0, this.touchdownCooldown - dt);
    this.cargoWarnCooldown = Math.max(0, this.cargoWarnCooldown - dt);
    this.weaponCooldown = Math.max(0, this.weaponCooldown - dt);
    this.heat = Math.max(0, this.heat - 8.5 * dt);
    if (this.heat > 82) this.hull = clamp(this.hull - (this.heat - 82) * 0.11 * dt, 0, 100);

    if (this.scoop) {
      this.energy = Math.max(0, this.energy - 4.2 * dt);
      if (this.energy <= 0) {
        this.scoop = false;
        this.notify('SCOOP OFFLINE — ENERGY DEPLETED', 'warn', { type: 'energy' });
      }
    } else {
      this.energy = clamp(this.energy + 6.5 * dt, 0, 100);
    }

    const forward = (held(input, 'KeyW', 'ArrowUp') ? 1 : 0) - (held(input, 'KeyS', 'ArrowDown') ? 1 : 0);
    const strafe = (held(input, 'KeyE') ? 1 : 0) - (held(input, 'KeyQ') ? 1 : 0);
    const torque = (held(input, 'KeyD', 'ArrowRight') ? 1 : 0) - (held(input, 'KeyA', 'ArrowLeft') ? 1 : 0);
    const lane = (held(input, 'KeyU') ? 1 : 0) - (held(input, 'KeyJ') ? 1 : 0);
    const boost = held(input, 'ShiftLeft', 'ShiftRight') ? 1.8 : 1;
    const stabilizer = held(input, 'KeyX');
    const manualIntent = Math.abs(forward) + Math.abs(strafe) + Math.abs(torque) + Math.abs(lane) > 0 || !this.gear;
    this.requestingLaunch = false;
    this.laneDrive = lane;

    if (this.eva?.active) {
      if (this.orbitHold) this.holdOrbit(dt, world);
      else if (this.padClamp) this.holdPadClamp(world);
      this.updateEVA(dt, input, world);
      this.updateMetrics(world);
      return;
    }

    if (this.padClamp && this.gear && !this.clampReleaseRequested) {
      if (this.holdPadClamp(world)) {
        this.updateMetrics(world);
        return;
      }
    }
    if (this.padClamp && (!this.gear || this.clampReleaseRequested)) this.releaseClamp(world);

    if (this.orbitHold && manualIntent) {
      this.orbitHold = null;
      this.notify('MANUAL CONTROL — ORBIT HOLD RELEASED', '', { type: 'orbit' });
    } else if (this.orbitHold) {
      if (this.holdOrbit(dt, world)) {
        this.updateMetrics(world);
        return;
      }
    }

    if (this.landed && this.landedBody && this.gear && !manualIntent) {
      const up = this.upVector();
      const support = world.sampleMaterial(this.x - up.x * 12, this.y - up.y * 12, true);
      if (!support) {
        this.landed = false;
        this.landedBody = null;
      } else {
        this.vx = this.landedBody.vx || 0;
        this.vy = this.landedBody.vy || 0;
        this.omega = 0;
        this.contact = true;
        this.contactBody = this.landedBody;
        this.contactNormal = norm(this.x - this.landedBody.x, this.y - this.landedBody.y, 0, -1);
        this.thrustLevel = lerp(this.thrustLevel, 0, Math.min(1, dt * 8));
        this.thrustVector = { x: 0, y: 0 };
        this.updateMetrics(world);
        return;
      }
    }

    if (this.landed && manualIntent) {
      this.landed = false;
      this.landedBody = null;
      this.requestingLaunch = true;
      this.touchdownCooldown = 0.45;
      this.notify('MANUAL LIFT-OFF', '', { type: 'launch' });
      world.pushEvent?.({ type: 'launch', x: this.x, y: this.y });
    }

    let ax = 0;
    let ay = 0;
    const f = this.forwardVector();
    const r = this.rightVector();
    const mainPower = 92 * boost;
    if ((forward || strafe) && this.fuel > 0) {
      ax = (f.x * forward + r.x * strafe) * mainPower;
      ay = (f.y * forward + r.y * strafe) * mainPower;
      const consumption = (Math.abs(forward) * 1.35 + Math.abs(strafe) * 0.78) * boost * dt;
      this.fuel = Math.max(0, this.fuel - consumption);
      const exhaustX = this.x - f.x * 15 * Math.sign(forward || 0) - r.x * 11 * Math.sign(strafe || 0);
      const exhaustY = this.y - f.y * 15 * Math.sign(forward || 0) - r.y * 11 * Math.sign(strafe || 0);
      world.pushEvent?.({
        type: 'thrust', x: exhaustX, y: exhaustY,
        vx: -ax * 0.22, vy: -ay * 0.22,
        strength: Math.min(1, Math.hypot(ax, ay) / mainPower), boost: boost > 1
      });
    }

    if (lane && this.fuel > 0) {
      const moon = world.moon || { x: 0, y: 0 };
      const outward = norm(this.x - moon.x, this.y - moon.y, 0, -1);
      ax += outward.x * lane * 36;
      ay += outward.y * lane * 36;
      this.fuel = Math.max(0, this.fuel - 0.45 * dt);
    }

    if (torque && this.fuel > 0) {
      this.omega += torque * 2.85 * dt;
      this.fuel = Math.max(0, this.fuel - 0.22 * dt);
    }
    if (stabilizer && this.energy > 0) {
      this.omega *= Math.max(0, 1 - 4.2 * dt);
      this.energy = Math.max(0, this.energy - 1.1 * dt);
    }

    const gravity = world.gravityAt(this.x, this.y);
    this.gravity = gravity;
    this.vx += (gravity.x + ax) * dt;
    this.vy += (gravity.y + ay) * dt;
    const speed = Math.hypot(this.vx, this.vy);
    if (speed > 850) {
      this.vx *= 850 / speed;
      this.vy *= 850 / speed;
    }
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.angle = wrap(this.angle + this.omega * dt, 0, TAU);

    this.thrustLevel = lerp(this.thrustLevel, Math.min(1, Math.hypot(ax, ay) / 92), Math.min(1, dt * 10));
    this.thrustVector = { x: ax, y: ay };
    this.boosting = boost > 1 && (forward || strafe) !== 0;

    resolveTerrainCollision(this, world);
    this.updateMetrics(world);
  }

  updateMetrics(world) {
    const nav = world.nearestBody(this.x, this.y);
    if (!nav.body) return;
    const body = nav.body;
    const toward = norm(body.x - this.x, body.y - this.y, 0, 1);
    const away = { x: -toward.x, y: -toward.y };
    const surfaceNormal = this.contact && this.contactNormal ? this.contactNormal : away;
    const rvx = this.vx - (body.vx || 0);
    const rvy = this.vy - (body.vy || 0);
    const gravitySpeed = dot(rvx, rvy, toward.x, toward.y);
    const surfaceSpeed = -dot(rvx, rvy, surfaceNormal.x, surfaceNormal.y);
    const tangent = Math.hypot(rvx - gravitySpeed * toward.x, rvy - gravitySpeed * toward.y);
    const up = this.upVector();
    const align = clamp(dot(up.x, up.y, surfaceNormal.x, surfaceNormal.y), -1, 1);
    this.metrics = {
      body,
      detail: nav.detail,
      altitude: nav.altitude,
      distance: nav.distance,
      speed: Math.hypot(rvx, rvy),
      vertical: this.contact ? surfaceSpeed : gravitySpeed,
      horizontal: tangent,
      align,
      gravity: nav.gravity.magnitude,
      gravityVector: nav.gravity,
      toward,
      away,
      contact: this.contact,
      landed: this.landed,
      clamped: this.clamped,
      orbitHold: Boolean(this.orbitHold),
      eva: Boolean(this.eva?.active),
      docked: Boolean(this.docked?.ready)
    };
  }
}
