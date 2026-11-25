import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBody } from '../src/world/generation.js';
import { World } from '../src/world/world.js';
import { Ship } from '../src/game/ship.js';
import { isCollidable } from '../src/world/materials.js';

const neutralInput = () => ({
  anyDown: () => false,
  isDown: () => false
});

const world = new World();
const cleanWorld = new World();

test('procedural bodies generate solids, weak density gravity and an active material list', () => {
  const body = generateBody({
    id: 'specimen', name: 'SPECIMEN', type: 'asteroid',
    x: 0, y: 0, w: 64, h: 64, radius: 24, density: 0.62,
    seed: 0xabcd, structural: true, biome: true, derelict: true
  });
  assert.ok(body.solidCount > 100);
  assert.ok(body.anchors.length > 0);
  assert.ok(body.active.length > 0);
  assert.equal(body.integrity(), 1);
  assert.equal(body.density, 0.62);
  assert.equal(body.g0, 0.62);
  assert.ok(body.mu < 0.62 * 24 * 24 * 1.2, 'small bodies do not get lunar-strength wells');
  assert.equal(body.dir[body.index(32, 32)] & 7, body.dir[body.index(32, 32)]);
  assert.equal(body.surface, null, 'headless generation does not require a DOM canvas');
});

test('2035 lunar-orbit belt starts with hundreds of bodies and 95% uncatalogued', () => {
  const stats = world.catalogStats();
  assert.equal(world.year, 2035);
  assert.equal(stats.total, 320);
  assert.equal(stats.catalogued, 16);
  assert.equal(stats.uncatalogued, 304);
  assert.equal(stats.initialRatio, 0.95);
  assert.ok(world.haulers.length >= 5, 'automatic haulers are present');
  assert.ok(world.moon.radius > 2000, 'Luna is a distant landmark/exclusion zone');
  assert.ok(world.moon.name.includes('NO-LANDING'));
  assert.ok(world.bodies.length >= 7);
  assert.ok(world.tracked.some((r) => !r.catalogued && !r.scanned));
});

test('gravity points into a small body and stays weak', () => {
  const selene = world.bodyById.get('selene');
  const p = world.dockPoint(selene);
  const surface = world.gravityAt(p.x, p.y);
  assert.ok(surface.y > 0, 'north-side gravity pulls toward the station center');
  assert.ok(surface.magnitude > 0.02);
  assert.ok(surface.magnitude < 1, 'small-body gravity wells are gentle');
  assert.ok(surface.dominantMagnitude < 0.25);
  assert.equal(surface.dominant.id, 'selene');
  const deep = world.gravityAt(9000, 9000);
  assert.ok(deep.magnitude < surface.magnitude);
  assert.ok(selene.g0 <= 0.2);
});

test('raycasts hit destructible dock pixels and explosions remove monolith cells', () => {
  const selene = world.bodyById.get('selene');
  const p = world.dockPoint(selene);
  const hit = world.raycast(p.x, p.y - 28, 0, 1, 60);
  assert.ok(hit, 'a downward ray above Selene finds the exchange pad');
  assert.equal(hit.body.id, 'selene');
  assert.ok(isCollidable(hit.material));

  const before = selene.solidCount;
  world.explode(p.x, p.y + 12, 10, 140);
  assert.ok(selene.solidCount < before, 'the blast grinds or vaporizes material');
  assert.ok(world.takeEvents().some((event) => event.type === 'shockwave'));
});

test('docking envelope requires a quiet, geared ship and has stable hysteresis', () => {
  const selene = cleanWorld.bodyById.get('selene');
  const p = cleanWorld.dockPoint(selene);
  const ship = {
    x: p.x, y: p.y, vx: selene.vx, vy: selene.vy,
    gear: true, landedBody: null, padClamp: null, docked: null
  };
  const dock = cleanWorld.findDock(ship);
  assert.ok(dock);
  assert.equal(dock.body.id, 'selene');
  assert.equal(dock.ready, true);

  const fast = cleanWorld.findDock({ ...ship, vx: selene.vx + 30 });
  assert.equal(fast.ready, false);
  const noGear = cleanWorld.findDock({ ...ship, gear: false });
  assert.equal(noGear.ready, false);
  const latching = cleanWorld.findDock({
    ...ship, x: p.x + 60, vx: selene.vx + 6,
    docked: { ready: true, body: selene }
  });
  assert.equal(latching.ready, true, 'an open docking link does not flicker off at the edge');
});

test('precision pad landing engages a clamp that remains stable through orbital motion', () => {
  const selene = cleanWorld.bodyById.get('selene');
  const p = cleanWorld.dockPoint(selene);
  const ship = new Ship(cleanWorld);
  ship.x = p.x;
  ship.y = p.y;
  ship.prevX = p.x;
  ship.prevY = p.y;
  ship.vx = selene.vx;
  ship.vy = selene.vy;
  ship.angle = 0;
  ship.omega = 0;
  ship.gear = true;
  ship.invulnerable = 0;
  assert.equal(cleanWorld.clampToPad(ship, selene, { impactSpeed: 0.8, horizontal: 0.2 }), true);
  const input = neutralInput();

  for (let frame = 0; frame < 120; frame++) {
    cleanWorld.advanceOrbits(1 / 60, ship);
    ship.update(1 / 60, input, cleanWorld);
    cleanWorld.update(1 / 60, ship, { preUpdated: true, collect: false });
    ship.docked = cleanWorld.findDock(ship);
    const target = cleanWorld.dockPoint(selene);
    assert.ok(Math.hypot(ship.x - target.x, ship.y - target.y) < 0.001, 'clamp position follows the pad exactly');
    assert.equal(ship.docked?.ready, true, 'market link stays ready');
    assert.equal(ship.docked?.clamped, true);
    assert.equal(ship.landed, true);
  }
  assert.equal(ship.clamped, true);
  ship.releaseClamp(cleanWorld);
  assert.equal(ship.padClamp, null);
  assert.equal(ship.clamped, false);
  assert.equal(ship.landed, false);
  assert.equal(ship.requestingLaunch, true);
});

test('survey pulses catalogue unknown signatures and reveal findings', () => {
  const unknown = world.tracked.find((r) => !r.catalogued && !r.scanned);
  assert.ok(unknown);
  const before = world.catalogStats().catalogued;
  const results = world.scanPulse({ x: unknown.x, y: unknown.y }, 120, 4);
  assert.ok(results.length > 0);
  assert.ok(results.some((r) => r.record.id === unknown.id));
  assert.equal(unknown.scanned, true);
  assert.equal(unknown.catalogued, true);
  assert.equal(unknown.name, unknown.designation);
  assert.match(results[0].text, /composition|rubble|volatile|fabricated/i);
  assert.ok(world.catalogStats().catalogued > before);
  const events = world.takeEvents();
  assert.ok(events.some((event) => event.type === 'scanPulse'));
  assert.ok(events.some((event) => event.type === 'scanResult'));
});

test('slow orbit hold and EVA tether work near an asteroid', () => {
  const record = cleanWorld.recordsById.get('kestrel');
  const ship = new Ship(cleanWorld);
  ship.x = record.x + record.radius + 130;
  ship.y = record.y;
  ship.vx = record.vx;
  ship.vy = record.vy + 18;
  ship.angle = 0;
  ship.eva.active = false;
  ship.orbitHold = null;
  assert.equal(ship.toggleOrbitHold(cleanWorld), true);
  assert.equal(ship.orbitHold.recordId, record.id);
  assert.equal(ship.startEVA(cleanWorld), true);
  assert.equal(ship.eva.active, true);
  assert.equal(ship.eva.recordId, record.id);
  ship.updateEVA(1 / 60, neutralInput(), cleanWorld);
  assert.ok(ship.eva.oxygen < 100);
  assert.equal(ship.endEVA(cleanWorld), true);
  assert.equal(ship.eva.active, false);
});

test('body streaming activates cached material synchronously and haulers deliver new bodies', () => {
  const record = world.tracked.find((r) => !r.featured && !r.body && r.radius < 60);
  assert.ok(record);
  const body = world.materialize(record);
  world.deactivate(record);
  assert.equal(record.active, false);
  world.updateStreaming({ x: record.x, y: record.y }, 0);
  assert.equal(record.active, true, 'a cached body is activated in the same update, without a loading scene');
  assert.ok(world.bodies.includes(body));
  assert.equal(world.bodyById.get(record.id), body);

  const before = world.tracked.length;
  const hauler = world.haulers[0];
  hauler.deliveryTimer = 0;
  world.updateHaulerDeliveries(1 / 60);
  assert.equal(world.tracked.length, before + 1);
  assert.ok(world.takeEvents().some((event) => event.type === 'haulerDelivery'));
});
