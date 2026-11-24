import test from 'node:test';
import assert from 'node:assert/strict';
import { Ship } from '../src/game/ship.js';
import { MAT } from '../src/world/materials.js';

function fakeWorld() {
  const body = { id: 'test', name: 'TEST', x: 0, y: 1000, vx: 0, vy: 0, radius: 10 };
  return {
    time: 0,
    gravityAt: () => ({ x: 0, y: 0, magnitude: 0, dominant: body, dominantMagnitude: 0 }),
    nearestBody: () => ({
      body, distance: 1000, altitude: 990,
      gravity: { x: 0, y: 0, magnitude: 0 },
      away: { x: 0, y: -1 }
    }),
    sampleMaterial: () => null,
    pushEvent: () => {}
  };
}

function inputWith(down = []) {
  const set = new Set(down);
  return {
    anyDown: (...codes) => codes.some((code) => set.has(code)),
    isDown: (code) => set.has(code)
  };
}

test('vacuum flight preserves momentum with no passive damping', () => {
  const world = fakeWorld();
  const ship = new Ship(world);
  ship.x = 0;
  ship.y = 0;
  ship.vx = 10;
  ship.vy = 0;
  ship.angle = 0;
  ship.omega = 0;
  ship.gear = false;
  ship.landed = false;
  ship.update(1, inputWith(), world);
  assert.equal(ship.x, 10);
  assert.equal(ship.vx, 10);
  assert.equal(ship.omega, 0);
});

test('main thrust consumes fuel and adds Newtonian acceleration', () => {
  const world = fakeWorld();
  const ship = new Ship(world);
  ship.x = 0;
  ship.y = 0;
  ship.vx = 0;
  ship.vy = 0;
  ship.angle = 0;
  ship.gear = false;
  ship.landed = false;
  const fuelBefore = ship.fuel;
  ship.update(1, inputWith(['KeyW']), world);
  assert.ok(ship.vx > 80);
  assert.ok(ship.fuel < fuelBefore);
  assert.ok(ship.thrustLevel > 0);
});

test('cargo accepts material units and sells them for credits', () => {
  const ship = new Ship(fakeWorld());
  ship.credits = 0;
  assert.equal(ship.addMaterial(MAT.ORE_DUST), true);
  assert.ok(ship.cargo.ore > 0);
  const result = ship.sellCargo('ore', 100);
  assert.ok(result);
  assert.ok(result.revenue > 0);
  assert.equal(ship.credits, result.revenue);
  assert.equal(ship.cargo.ore, 0);
});
