import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBody } from '../src/world/generation.js';
import { World } from '../src/world/world.js';
import { isCollidable } from '../src/world/materials.js';

test('procedural bodies generate solids, gravity directions and an active material list', () => {
  const body = generateBody({
    id: 'specimen', name: 'SPECIMEN', type: 'asteroid',
    x: 0, y: 0, w: 64, h: 64, radius: 24, g0: 8,
    seed: 0xabcd, structural: true
  });
  assert.ok(body.solidCount > 100);
  assert.ok(body.anchors.length > 0);
  assert.ok(body.active.length > 0);
  assert.equal(body.integrity(), 1);
  assert.equal(body.dir[body.index(32, 32)] & 7, body.dir[body.index(32, 32)]);
  assert.equal(body.surface, null, 'headless generation does not require a DOM canvas');
});

const world = new World();

test('gravity points into the dominant well and weakens with distance', () => {
  const surface = world.gravityAt(0, -150);
  assert.ok(surface.y > 0, 'north-pole gravity pulls toward the moon center');
  assert.ok(surface.magnitude > 10);
  const deep = world.gravityAt(2600, 2400);
  assert.ok(deep.magnitude < surface.magnitude * 0.2);
  assert.equal(world.discoveryCount().max, 9);
});

test('raycasts hit destructible dock pixels and explosions remove monolith cells', () => {
  const hit = world.raycast(0, -165, 0, 1, 40);
  assert.ok(hit, 'a downward ray over Selene finds the outpost platform');
  assert.equal(hit.body.id, 'selene');
  assert.ok(isCollidable(hit.material));

  const selene = world.bodyById.get('selene');
  const before = selene.solidCount;
  world.explode(0, -155, 9, 130);
  assert.ok(selene.solidCount < before, 'the blast grinds or vaporizes material');
  assert.ok(world.takeEvents().some((event) => event.type === 'shockwave'));
});

test('docking envelope requires a quiet, geared ship', () => {
  const dock = world.findDock({ x: 0, y: -163, vx: 0, vy: 0, gear: true, landedBody: null });
  assert.ok(dock);
  assert.equal(dock.body.id, 'selene');
  assert.equal(dock.ready, true);

  const fast = world.findDock({ x: 0, y: -163, vx: 30, vy: 0, gear: true, landedBody: null });
  assert.equal(fast.ready, false);
  const noGear = world.findDock({ x: 0, y: -163, vx: 0, vy: 0, gear: false, landedBody: null });
  assert.equal(noGear.ready, false);
});
