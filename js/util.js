// js/util.js
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ema = (prev, next, alpha) =>
  prev === null || prev === undefined ? next : prev + (next - prev) * alpha;
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export const nowMs = () => performance.now();

// Sudut (derajat) di titik B, antara vektor B->A dan B->C
export function angleDeg(ax, ay, bx, by, cx, cy) {
  const v1x = ax - bx, v1y = ay - by;
  const v2x = cx - bx, v2y = cy - by;
  const n1 = Math.hypot(v1x, v1y) || 1e-6;
  const n2 = Math.hypot(v2x, v2y) || 1e-6;
  const cos = clamp((v1x * v2x + v1y * v2y) / (n1 * n2), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}
