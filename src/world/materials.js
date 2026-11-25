import { clamp, hexToRgb, packRGBA } from '../core/math.js';

export const PHASE = Object.freeze({
  VOID: 0,
  SOLID: 1,
  GRANULAR: 2,
  LIQUID: 3,
  GAS: 4
});

export const MAT = Object.freeze({
  VACUUM: 0,
  REGOLITH: 1,
  ROCK: 2,
  ORE: 3,
  ICE: 4,
  WATER: 5,
  STEAM: 6,
  METAL: 7,
  SCRAP: 8,
  GLASS: 9,
  MAGNETITE: 10,
  MAGNET_DUST: 11,
  ORE_DUST: 12,
  ICE_DUST: 13,
  MOLTEN_ROCK: 14,
  MOLTEN_METAL: 15,
  SLAG: 16,
  CORE: 17,
  FUEL: 18,
  MAGNET_BLOCK: 19,
  LAMP: 20,
  EXOTIC: 21,
  EXOTIC_DUST: 22,
  BIOMASS: 23
});

const define = (data) => data;

export const MATERIALS = [
  define({ key: 'VACUUM', name: 'vacuum', color: '#000000', phase: PHASE.VOID, hp: 0, density: 0, alpha: 0 }),
  define({ key: 'REGOLITH', name: 'regolith', color: '#978b80', phase: PHASE.GRANULAR, hp: 10, density: 3, value: 0.02, commodity: 'regolith', alpha: 255 }),
  define({ key: 'ROCK', name: 'monolithic rock', color: '#5d5d68', phase: PHASE.SOLID, hp: 70, density: 6, melt: 165, grindTo: MAT.REGOLITH, alpha: 255 }),
  define({ key: 'ORE', name: 'ore vein', color: '#d39a48', phase: PHASE.SOLID, hp: 48, density: 6, melt: 145, grindTo: MAT.ORE_DUST, commodity: 'ore', alpha: 255 }),
  define({ key: 'ICE', name: 'ice', color: '#79bdd6', phase: PHASE.SOLID, hp: 32, density: 4, melt: 58, meltTo: MAT.WATER, grindTo: MAT.ICE_DUST, commodity: 'volatiles', alpha: 235 }),
  define({ key: 'WATER', name: 'water', color: '#348fc4', phase: PHASE.LIQUID, hp: 10, density: 2, vapor: 108, gasTo: MAT.STEAM, commodity: 'volatiles', alpha: 220 }),
  define({ key: 'STEAM', name: 'steam', color: '#a9dce8', phase: PHASE.GAS, hp: 1, density: 0, commodity: 'volatiles', alpha: 86 }),
  define({ key: 'METAL', name: 'hull alloy', color: '#748493', phase: PHASE.SOLID, hp: 86, density: 7, melt: 185, meltTo: MAT.MOLTEN_METAL, grindTo: MAT.SCRAP, commodity: 'alloy', alpha: 255 }),
  define({ key: 'SCRAP', name: 'metal sand', color: '#9aa9b6', phase: PHASE.GRANULAR, hp: 12, density: 4, magnetic: true, commodity: 'alloy', alpha: 255 }),
  define({ key: 'GLASS', name: 'brittle glass', color: '#397f9e', phase: PHASE.SOLID, hp: 24, density: 5, melt: 120, meltTo: MAT.MOLTEN_METAL, grindTo: MAT.SCRAP, commodity: 'alloy', alpha: 205 }),
  define({ key: 'MAGNETITE', name: 'magnetic monolith', color: '#9e59cb', phase: PHASE.SOLID, hp: 58, density: 6, magnetic: true, melt: 170, meltTo: MAT.MOLTEN_METAL, grindTo: MAT.MAGNET_DUST, commodity: 'magnetite', alpha: 255 }),
  define({ key: 'MAGNET_DUST', name: 'magnetite grains', color: '#c67bec', phase: PHASE.GRANULAR, hp: 10, density: 4, magnetic: true, commodity: 'magnetite', alpha: 255 }),
  define({ key: 'ORE_DUST', name: 'ore grains', color: '#efbd68', phase: PHASE.GRANULAR, hp: 10, density: 4, commodity: 'ore', alpha: 255 }),
  define({ key: 'ICE_DUST', name: 'ice grains', color: '#b8e6f5', phase: PHASE.GRANULAR, hp: 8, density: 3, commodity: 'volatiles', alpha: 245 }),
  define({ key: 'MOLTEN_ROCK', name: 'molten rock', color: '#ff7a35', phase: PHASE.LIQUID, hp: 12, density: 4, emissive: true, cool: 74, coolTo: MAT.ROCK, commodity: 'regolith', alpha: 255 }),
  define({ key: 'MOLTEN_METAL', name: 'molten alloy', color: '#ffd17b', phase: PHASE.LIQUID, hp: 12, density: 5, emissive: true, cool: 82, coolTo: MAT.METAL, commodity: 'alloy', alpha: 255 }),
  define({ key: 'SLAG', name: 'cooled slag', color: '#55434a', phase: PHASE.SOLID, hp: 45, density: 6, melt: 175, meltTo: MAT.MOLTEN_ROCK, grindTo: MAT.REGOLITH, commodity: 'regolith', alpha: 255 }),
  define({ key: 'CORE', name: 'dense core', color: '#3e425b', phase: PHASE.SOLID, hp: 190, density: 9, melt: 235, grindTo: MAT.EXOTIC_DUST, commodity: 'exotic', alpha: 255 }),
  define({ key: 'FUEL', name: 'volatile fuel', color: '#58e2a0', phase: PHASE.LIQUID, hp: 8, density: 2, vapor: 82, gasTo: MAT.STEAM, emissive: true, commodity: 'fuel', alpha: 235 }),
  define({ key: 'MAGNET_BLOCK', name: 'electromagnet', color: '#cb6cf0', phase: PHASE.SOLID, hp: 72, density: 7, magnetic: true, melt: 190, meltTo: MAT.MOLTEN_METAL, grindTo: MAT.SCRAP, emissive: true, alpha: 255 }),
  define({ key: 'LAMP', name: 'landing lamp', color: '#ffd47a', phase: PHASE.SOLID, hp: 20, density: 5, melt: 160, meltTo: MAT.MOLTEN_METAL, grindTo: MAT.SCRAP, emissive: true, alpha: 255 }),
  define({ key: 'EXOTIC', name: 'exotic crystal', color: '#69f6d1', phase: PHASE.SOLID, hp: 90, density: 6, magnetic: true, melt: 205, meltTo: MAT.MOLTEN_METAL, grindTo: MAT.EXOTIC_DUST, commodity: 'exotic', emissive: true, alpha: 255 }),
  define({ key: 'EXOTIC_DUST', name: 'exotic dust', color: '#a2ffe8', phase: PHASE.GRANULAR, hp: 14, density: 4, magnetic: true, commodity: 'exotic', emissive: true, alpha: 255 }),
  define({ key: 'BIOMASS', name: 'cave biome', color: '#63f2a2', phase: PHASE.SOLID, hp: 24, density: 4, grindTo: MAT.EXOTIC_DUST, commodity: 'exotic', emissive: true, alpha: 255 })
];

export const MATERIAL_COUNT = MATERIALS.length;

export const COMMODITIES = Object.freeze({
  regolith: { name: 'REGOLITH', price: 2, color: '#a79b91' },
  ore: { name: 'ORE', price: 18, color: '#efbd68' },
  volatiles: { name: 'VOLATILES', price: 9, color: '#8adcf0' },
  alloy: { name: 'ALLOY', price: 13, color: '#a8bbc9' },
  magnetite: { name: 'MAGNETITE', price: 27, color: '#ce83ef' },
  fuel: { name: 'FUEL', price: 16, color: '#6cf0ac' },
  exotic: { name: 'EXOTIC', price: 62, color: '#8fffe0' }
});

const RGB = MATERIALS.map((m) => hexToRgb(m.color));

export function info(id) {
  return MATERIALS[id] || MATERIALS[MAT.VACUUM];
}

export const isVoid = (id) => info(id).phase === PHASE.VOID;
export const isSolid = (id) => info(id).phase === PHASE.SOLID;
export const isGranular = (id) => info(id).phase === PHASE.GRANULAR;
export const isLiquid = (id) => info(id).phase === PHASE.LIQUID;
export const isGas = (id) => info(id).phase === PHASE.GAS;
export const isLoose = (id) => {
  const p = info(id).phase;
  return p === PHASE.GRANULAR || p === PHASE.LIQUID || p === PHASE.GAS;
};
export const isCollidable = (id) => {
  const p = info(id).phase;
  return p !== PHASE.VOID && p !== PHASE.GAS;
};
export const blocksLight = (id) => isCollidable(id);
export const isMagnetic = (id) => Boolean(info(id).magnetic);
export const isMagneticSource = (id) => id === MAT.MAGNET_BLOCK;
export const commodityFor = (id) => info(id).commodity || null;
export const densityOf = (id) => info(id).density || 0;

export function cargoForMaterial(id) {
  const commodity = commodityFor(id);
  if (!commodity) return null;
  const phase = info(id).phase;
  const units = phase === PHASE.SOLID ? 0.16 : phase === PHASE.GAS ? 0.025 : 0.09;
  return { commodity, units, price: COMMODITIES[commodity].price };
}

export function colorForCell(id, tint = 0, light = 255, heat = 8) {
  const m = info(id);
  if (id === MAT.VACUUM) return 0;
  const rgb = RGB[id] || RGB[0];
  let variation = 0.82 + (tint & 15) * 0.025;
  variation += (((tint >> 4) & 3) - 1.5) * 0.018;
  let shade = clamp(light / 255, 0.12, 1.35);
  if (m.emissive) shade = Math.max(shade, 0.92);
  let r = rgb.r * variation * shade;
  let g = rgb.g * variation * shade * 1.02;
  let b = rgb.b * variation * shade * 1.09 + (1 - Math.min(shade, 1)) * 7;

  if (heat > 52 && m.phase !== PHASE.GAS) {
    const h = clamp((heat - 52) / 190, 0, 1);
    r = r + (255 - r) * h * 0.72;
    g = g + (122 - g) * h * 0.32;
    b = b + (34 - b) * h * 0.18;
  }
  if (m.emissive) {
    const pulse = 0.9 + ((tint & 7) / 7) * 0.18;
    r *= pulse;
    g *= pulse;
    b *= pulse;
  }

  let alpha = m.alpha ?? 255;
  if (id === MAT.STEAM) alpha = 56 + ((tint * 7) & 63);
  if (id === MAT.WATER) alpha = 208 + ((tint * 3) & 31);
  return packRGBA(clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(b, 0, 255) | 0, alpha);
}

export const MAT_BY_KEY = Object.fromEntries(Object.entries(MAT).map(([key, id]) => [key, id]));
