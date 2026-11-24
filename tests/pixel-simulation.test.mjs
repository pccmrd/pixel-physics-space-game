import test from 'node:test';
import assert from 'node:assert/strict';
import { PixelBody } from '../src/world/pixelBody.js';
import { MAT } from '../src/world/materials.js';

function tinyBody(type = 'test') {
  return new PixelBody({
    id: 'tiny', name: 'TINY', type,
    x: 0, y: 0, w: 9, h: 9, radius: 4, g0: 30,
    seed: 1234, structural: false
  });
}

const context = () => ({ time: 0, far: false, scoop: false, shipLocal: null, collect: null });

test('granular pixels fall toward the gravity well and leave their source cell', () => {
  const body = tinyBody();
  body.put(4, 1, MAT.REGOLITH, { heat: 8, tint: 2 });
  body.finishGeneration();
  const before = body.index(4, 1);
  assert.equal(body.mat[before], MAT.REGOLITH);

  for (let frame = 0; frame < 90; frame++) body.step(1 / 60, context(), 1000, 1);

  let grains = 0;
  let advanced = false;
  for (let i = 0; i < body.size; i++) {
    if (body.mat[i] === MAT.REGOLITH) {
      grains++;
      const y = (i / body.w) | 0;
      if (y > 1) advanced = true;
    }
  }
  assert.equal(grains, 1, 'the grain is conserved');
  assert.ok(advanced, 'the grain moved inward toward the well');
  assert.notEqual(body.mat[before], MAT.REGOLITH);
});

test('heated ice melts into water and hot rock grinds into sand', () => {
  const iceBody = tinyBody();
  iceBody.put(4, 4, MAT.ICE);
  iceBody.finishGeneration();
  const iceIndex = iceBody.index(4, 4);
  iceBody.addHeat(iceIndex, 90);
  iceBody.caStep(context(), 1000);
  assert.equal(iceBody.mat[iceIndex], MAT.WATER);

  const rockBody = tinyBody();
  rockBody.put(3, 4, MAT.ROCK);
  rockBody.finishGeneration();
  const rockIndex = rockBody.index(3, 4);
  rockBody.damageCell(rockIndex, 999, 0, 'grind');
  assert.equal(rockBody.mat[rockIndex], MAT.REGOLITH);
});

test('molten material cools back into a monolith', () => {
  const body = tinyBody();
  body.put(4, 4, MAT.MOLTEN_ROCK, { heat: 90 });
  body.finishGeneration();
  const i = body.index(4, 4);
  body.heat[i] = 40;
  body.wake(i);
  body.caStep(context(), 1000);
  assert.equal(body.mat[i], MAT.ROCK);
});
