import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAT,
  MATERIALS,
  PHASE,
  colorForCell,
  commodityFor,
  isMagnetic,
  isSolid,
  isLiquid,
  isGranular
} from '../src/world/materials.js';

test('material phases and properties are coherent', () => {
  assert.equal(MATERIALS.length, Object.keys(MAT).length);
  assert.ok(isSolid(MAT.ROCK));
  assert.ok(isGranular(MAT.REGOLITH));
  assert.ok(isLiquid(MAT.WATER));
  assert.equal(MATERIALS[MAT.METAL].phase, PHASE.SOLID);
  assert.ok(isMagnetic(MAT.MAGNETITE));
  assert.equal(commodityFor(MAT.ORE_DUST), 'ore');
  assert.equal(commodityFor(MAT.VACUUM), null);
});

test('cell colors encode alpha and vacuum is transparent', () => {
  assert.equal(colorForCell(MAT.VACUUM), 0);
  const rock = colorForCell(MAT.ROCK, 7, 220, 8);
  assert.equal(rock >>> 24, 255);
  const steam = colorForCell(MAT.STEAM, 3, 200, 20);
  assert.ok((steam >>> 24) > 0 && (steam >>> 24) < 255);
});
