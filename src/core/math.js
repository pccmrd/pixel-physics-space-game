export const TAU = Math.PI * 2;

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;
export const smoothstep = (edge0, edge1, x) => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v < 0 ? -1 : v > 0 ? 1 : 0);
export const sq = (v) => v * v;
export const len = (x, y) => Math.hypot(x, y);
export const dot = (ax, ay, bx, by) => ax * bx + ay * by;

export function norm(x, y, fallbackX = 0, fallbackY = 0) {
  const l = Math.hypot(x, y);
  if (l < 1e-8) return { x: fallbackX, y: fallbackY, l: 0 };
  return { x: x / l, y: y / l, l };
}

export function approach(current, target, delta) {
  if (current < target) return Math.min(current + delta, target);
  if (current > target) return Math.max(current - delta, target);
  return target;
}

export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

export function wrap(v, min, max) {
  const range = max - min;
  return ((v - min) % range + range) % range + min;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `T+${mm}:${ss}`;
}

export function formatDistance(v) {
  const n = Math.abs(v);
  if (n >= 1000) return `${(v / 1000).toFixed(2)} km`;
  return `${v.toFixed(n < 10 ? 1 : 0)} m`;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function packRGBA(r, g, b, a = 255) {
  return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
}
