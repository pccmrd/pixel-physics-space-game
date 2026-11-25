import { clamp, dot, lerp, norm } from '../core/math.js';

// Larger, more detailed hull. The gear points define the magnetic clamp footprint.
const HULL_POINTS = [
  [15, 0], [9, -5], [0, -7], [-9, -5], [-13, -2],
  [-13, 2], [-9, 5], [0, 7], [9, 5]
];
const GEAR_POINTS = [
  [-8, 12], [8, 12]
];

function transformPoint(ship, ox, oy, px, py) {
  const c = Math.cos(ship.angle);
  const s = Math.sin(ship.angle);
  return { x: ox + px * c - py * s, y: oy + px * s + py * c };
}

export function resolveTerrainCollision(ship, world) {
  ship.contact = false;
  ship.contactBody = null;
  ship.contactNormal = null;

  // A clamped ship is kinematically held by the pad until the pilot releases it.
  if (ship.padClamp && ship.gear && !ship.requestingLaunch) {
    ship.contact = true;
    ship.contactBody = ship.padClamp.body;
    ship.contactNormal = ship.padClamp.normal || norm(0, -1, 0, -1);
    return false;
  }

  if (ship.landed && ship.gear && !ship.requestingLaunch && ship.landedBody) {
    ship.contact = true;
    ship.contactBody = ship.landedBody;
    const away = norm(ship.x - ship.landedBody.x, ship.y - ship.landedBody.y, 0, -1);
    ship.contactNormal = away;
    return false;
  }

  const startX = ship.prevX;
  const startY = ship.prevY;
  const endX = ship.x;
  const endY = ship.y;
  const distance = Math.hypot(endX - startX, endY - startY);
  const steps = clamp(Math.ceil(distance / 4.5), 1, 8);
  const points = ship.gear ? HULL_POINTS.concat(GEAR_POINTS) : HULL_POINTS;
  let hitT = 1;
  let normalX = 0;
  let normalY = 0;
  let contacts = 0;
  let contactBody = null;
  let contactMaterial = null;
  let contactX = 0;
  let contactY = 0;

  outer:
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const ox = lerp(startX, endX, t);
    const oy = lerp(startY, endY, t);
    let subHit = false;
    for (const [px, py] of points) {
      const p = transformPoint(ship, ox, oy, px, py);
      const sample = world.sampleMaterial(p.x, p.y, true);
      if (!sample) continue;
      if (!subHit) {
        hitT = t;
        contactBody = sample.body;
        subHit = true;
      }
      normalX += sample.normal.x;
      normalY += sample.normal.y;
      contactX += p.x;
      contactY += p.y;
      contactMaterial = sample.material;
      contacts++;
    }
    if (subHit) break outer;
  }

  if (!contacts || !contactBody) return false;

  if (hitT < 1) {
    ship.x = lerp(startX, endX, hitT);
    ship.y = lerp(startY, endY, hitT);
  }
  contactX /= contacts;
  contactY /= contacts;
  let n = norm(normalX, normalY, 0, -1);
  const away = norm(ship.x - contactBody.x, ship.y - contactBody.y, 0, -1);
  if (n.l < 0.05) n = away;

  const bodyVX = contactBody.vx || 0;
  const bodyVY = contactBody.vy || 0;
  let rvx = ship.vx - bodyVX;
  let rvy = ship.vy - bodyVY;
  const vn = dot(rvx, rvy, n.x, n.y);
  const impactSpeed = Math.max(0, -vn);
  const tx = rvx - vn * n.x;
  const ty = rvy - vn * n.y;
  const horizontal = Math.hypot(tx, ty);
  const restitution = ship.gear ? 0.035 : 0.18;
  const friction = ship.gear ? 0.36 : 0.86;

  if (vn < 0) {
    const newVX = tx * friction - vn * restitution * n.x;
    const newVY = ty * friction - vn * restitution * n.y;
    ship.vx = bodyVX + newVX;
    ship.vy = bodyVY + newVY;
  } else {
    ship.vx = bodyVX + tx * friction + vn * n.x;
    ship.vy = bodyVY + ty * friction + vn * n.y;
  }

  const correction = 1.15 + Math.min(3, contacts * 0.34);
  ship.x += n.x * correction;
  ship.y += n.y * correction;
  ship.contact = true;
  ship.contactBody = contactBody;
  ship.contactNormal = n;

  if (impactSpeed > 7 && ship.invulnerable <= 0) {
    const damage = (impactSpeed - 7) * 2.25;
    ship.hull = clamp(ship.hull - damage, 0, 100);
    ship.heat = Math.min(100, ship.heat + damage * 0.22);
    const local = contactBody.worldToLocal(contactX, contactY);
    contactBody.grindArea(local.x, local.y, 3 + impactSpeed * 0.045, impactSpeed * 2.4);
    world.pushEvent({
      type: 'impact', x: contactX, y: contactY,
      normalX: n.x, normalY: n.y,
      power: impactSpeed, material: contactMaterial, body: contactBody
    });
    ship.notify(`HULL IMPACT ${impactSpeed.toFixed(1)} m/s  -${damage.toFixed(0)}%`, 'bad', { type: 'impact', power: impactSpeed });
  } else if (impactSpeed > 1.2) {
    world.pushEvent({ type: 'contactDust', x: contactX, y: contactY, normalX: n.x, normalY: n.y, power: impactSpeed });
  }

  const up = ship.upVector();
  const align = clamp(dot(up.x, up.y, n.x, n.y), -1, 1);
  const canLand = ship.gear
    && impactSpeed < 2.6
    && horizontal < 2.1
    && Math.abs(ship.omega) < 0.42
    && align > 0.70;

  if (canLand && !ship.landed && ship.touchdownCooldown <= 0) {
    const quality = clamp(100 - impactSpeed * 24 - horizontal * 14 - (1 - align) * 72, 0, 100);
    const landing = { impactSpeed, horizontal, align };
    const clamped = typeof world.clampToPad === 'function' ? world.clampToPad(ship, contactBody, landing) : false;
    ship.landed = true;
    ship.landedBody = contactBody;
    ship.omega = 0;
    ship.touchdownCooldown = 1.15;
    ship.lastLanding = { body: contactBody, quality, vertical: impactSpeed, horizontal, align, time: world.time, clamped: Boolean(clamped) };
    if (!clamped) {
      ship.clamped = false;
      ship.padClamp = null;
      ship.vx = bodyVX;
      ship.vy = bodyVY;
    }
    world.pushEvent({ type: 'touchdown', x: contactX, y: contactY, body: contactBody, quality, vertical: impactSpeed, horizontal, clamped: Boolean(clamped) });
    const label = clamped ? 'PAD CLAMP ENGAGED' : quality > 86 ? 'PRECISION TOUCHDOWN' : 'SAFE TOUCHDOWN';
    ship.notify(`${label}  ${impactSpeed.toFixed(1)} m/s  ${quality.toFixed(0)}%`, 'good', {
      type: 'landing', body: contactBody, quality, vertical: impactSpeed, horizontal, clamped: Boolean(clamped)
    });
  }

  return true;
}
