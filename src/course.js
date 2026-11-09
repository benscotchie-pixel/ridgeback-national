// Course data + geometry helpers. All units are yards.
// Each hole lives in its own local frame: tee at (0,0), playing toward +z,
// +x is the golfer's right.

export const COURSE_NAME = 'Ridgeback National';

// path: centerline from tee to green center (last point is the green).
// w: fairway width, gr: green radius, rise: green elevation vs. tee (yards)
// bunkers: [x, z, r]   water: [x, z, rx, rz] (ellipse)   trees: [x, z, r]
// pin: offset of the flag from the green center
const hole = (par, path, o = {}) => ({
  par, path, w: 32, gr: 13, rise: 0, bunkers: [], water: [], trees: [], pin: [0, 0], ...o,
});

const RAW = [
  // ---- Front nine ----
  hole(4, [[0, 0], [0, 240], [20, 390]], { w: 34, gr: 14, rise: 4, pin: [3, 4],
    bunkers: [[-22, 235, 9], [42, 395, 7], [6, 370, 6]], trees: [[-55, 180, 28], [55, 260, 26]] }),
  hole(5, [[0, 0], [-10, 260], [40, 420], [60, 530]], { w: 36, gr: 15, rise: -6, pin: [-4, 5],
    bunkers: [[22, 265, 10], [30, 425, 8], [80, 515, 7]], water: [[-35, 450, 25, 40]], trees: [[-60, 120, 30], [70, 330, 30]] }),
  hole(3, [[0, 0], [0, 165]], { gr: 13, rise: -10, pin: [-4, -3],
    bunkers: [[-21, 170, 7], [21, 158, 7]], water: [[0, 120, 30, 22]], trees: [[-50, 90, 25]] }),
  hole(4, [[0, 0], [0, 250], [90, 400]], { w: 32, gr: 13, rise: 8, pin: [5, 2],
    bunkers: [[25, 240, 12], [100, 382, 6], [72, 412, 6]], trees: [[58, 272, 24], [-40, 250, 30]] }),
  hole(4, [[0, 0], [-15, 230], [-20, 360]], { w: 30, gr: 12, rise: 0, pin: [-3, 3],
    bunkers: [[-35, 235, 9], [-36, 350, 6]], water: [[20, 200, 18, 60]], trees: [[-60, 150, 30]] }),
  hole(3, [[0, 0], [15, 205]], { gr: 15, rise: -12, pin: [6, 5],
    bunkers: [[-2, 186, 8], [36, 198, 7], [6, 226, 6]], trees: [[-35, 120, 25], [50, 120, 25]] }),
  hole(5, [[0, 0], [0, 270], [-60, 430], [-70, 560]], { w: 38, gr: 14, rise: 5, pin: [0, -5],
    bunkers: [[25, 280, 10], [-92, 562, 7]], water: [[-40, 500, 30, 22]], trees: [[45, 180, 30], [-60, 300, 30]] }),
  hole(4, [[0, 0], [0, 200], [-30, 345]], { w: 28, gr: 12, rise: 10, pin: [-4, -2],
    bunkers: [[18, 200, 8], [-18, 205, 8], [-48, 338, 6], [-12, 352, 6]], trees: [[-45, 120, 25], [45, 260, 30]] }),
  hole(4, [[0, 0], [10, 260], [-20, 440]], { w: 34, gr: 14, rise: -4, pin: [-5, 4],
    bunkers: [[30, 255, 10], [2, 446, 7]], water: [[-40, 330, 25, 60]], trees: [[60, 150, 30]] }),
  // ---- Back nine ----
  hole(4, [[0, 0], [0, 260], [0, 410]], { w: 36, gr: 14, rise: 0, pin: [0, 5],
    bunkers: [[-25, 260, 10], [25, 275, 10], [-20, 400, 7], [20, 400, 7]] }),
  hole(4, [[0, 0], [-60, 230], [-80, 380]], { w: 30, gr: 13, rise: 6, pin: [-4, 0],
    bunkers: [[-100, 372, 7]], water: [[-20, 230, 22, 22]], trees: [[-110, 200, 30]] }),
  hole(3, [[0, 0], [-5, 145]], { gr: 11, rise: -8, pin: [3, 3],
    bunkers: [[-20, 155, 6], [12, 158, 6]], water: [[-5, 115, 40, 15]] }),
  hole(5, [[0, 0], [0, 280], [40, 450], [30, 520]], { w: 36, gr: 14, rise: 0, pin: [-4, 4],
    bunkers: [[20, 285, 10], [-20, 300, 10], [55, 440, 9], [8, 512, 7]], trees: [[-55, 400, 30]] }),
  hole(4, [[0, 0], [25, 250], [25, 450]], { w: 34, gr: 15, rise: 10, pin: [5, -5],
    bunkers: [[0, 250, 10], [47, 438, 8]], trees: [[60, 200, 30], [-25, 380, 25]] }),
  hole(4, [[0, 0], [0, 230], [-25, 330]], { w: 30, gr: 11, rise: -5, pin: [3, 2],
    bunkers: [[-45, 330, 6], [-15, 310, 6]], water: [[25, 320, 20, 25]], trees: [[-40, 180, 25]] }),
  hole(3, [[0, 0], [0, 215]], { gr: 14, rise: -6, pin: [5, 4],
    bunkers: [[-20, 205, 8], [20, 205, 8], [0, 235, 6]], water: [[30, 180, 15, 30]] }),
  hole(5, [[0, 0], [-20, 260], [10, 440], [30, 580]], { w: 34, gr: 13, rise: 8, pin: [4, 3],
    bunkers: [[-40, 255, 10], [12, 592, 6]], water: [[45, 500, 20, 60]], trees: [[25, 200, 25], [-30, 450, 30]] }),
  hole(4, [[0, 0], [0, 260], [-40, 440]], { w: 32, gr: 14, rise: 12, pin: [-3, 5],
    bunkers: [[20, 265, 10], [-20, 430, 7], [-58, 452, 7]], water: [[-55, 300, 25, 70]], trees: [[45, 330, 30]] }),
];

function prepare(h, i) {
  const segs = [];
  let len = 0;
  for (let k = 0; k < h.path.length - 1; k++) {
    const a = h.path[k], b = h.path[k + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, L, s0: len });
    len += L;
  }
  const green = h.path[h.path.length - 1];
  return {
    ...h,
    number: i + 1,
    segs,
    len,
    yards: Math.round(len),
    tee: [0, 0],
    green,
    pin: [green[0] + h.pin[0], green[1] + h.pin[1]],
    seed: i * 17 + 3,
    fwFrom: h.par === 3 ? Infinity : 35, // fairway starts this far from the tee
  };
}

export const HOLES = RAW.map(prepare);
export const PAR = HOLES.reduce((s, h) => s + h.par, 0);
export const YARDS = HOLES.reduce((s, h) => s + h.yards, 0);

// ---------- small math utils ----------
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(i, j) {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

// Smooth value noise in [-1, 1].
export function vnoise(x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  const fx = x - i, fz = z - j;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(i, j), b = hash(i + 1, j), c = hash(i, j + 1), d = hash(i + 1, j + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

// ---------- centerline geometry ----------

// Distance from (x,z) to the centerline, and how far along it (s) the closest point is.
export function projectOnPath(h, x, z) {
  let best = { d: Infinity, s: 0 };
  for (const g of h.segs) {
    const dx = g.b[0] - g.a[0], dz = g.b[1] - g.a[1];
    const t = clamp01(((x - g.a[0]) * dx + (z - g.a[1]) * dz) / (g.L * g.L));
    const px = g.a[0] + dx * t, pz = g.a[1] + dz * t;
    const d = Math.hypot(x - px, z - pz);
    if (d < best.d) best = { d, s: g.s0 + t * g.L };
  }
  return best;
}

// Point at distance s along the centerline (extrapolates past either end).
export function pointAt(h, s) {
  let g = h.segs[0];
  for (const seg of h.segs) if (s >= seg.s0) g = seg;
  const t = (s - g.s0) / g.L;
  return [lerp(g.a[0], g.b[0], t), lerp(g.a[1], g.b[1], t)];
}

// ---------- surfaces ----------

const inEllipse = (x, z, [cx, cz, rx, rz]) => ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2;

export function surfaceAt(h, x, z) {
  for (const w of h.water) if (inEllipse(x, z, w) <= 1) return 'water';
  for (const [cx, cz, r] of h.bunkers) if (Math.hypot(x - cx, z - cz) <= r) return 'bunker';
  const dg = Math.hypot(x - h.green[0], z - h.green[1]);
  if (dg <= h.gr) return 'green';
  if (dg <= h.gr + 3) return 'fringe';
  if (Math.hypot(x, z) <= 7) return 'tee';
  const { d, s } = projectOnPath(h, x, z);
  if (d <= h.w / 2 && s >= h.fwFrom && s <= h.len - h.gr - 4) return 'fairway';
  for (const [cx, cz, r] of h.trees) if (Math.hypot(x - cx, z - cz) <= r) return 'trees';
  if (d > Math.max(h.w / 2, 20) + 38) return 'trees'; // forest lining the corridor
  return 'rough';
}

// ---------- terrain height ----------

function rawHeight(h, x, z) {
  const { d, s } = projectOnPath(h, x, z);
  // Big rolls are damped inside the playing corridor so tee shots aren't blind
  // and par-3 greens can be seen from the tee; they return in the rough and trees.
  const calm = smooth(h.w / 2 + 35, h.w / 2 + 5, d) * (h.par === 3 ? 0.85 : 0.7);
  // Downhill holes fall away early and level out at the green; uphill holes rise
  // late. Either way the slope faces the tee, so the landing areas stay in view.
  const u = clamp01(s / h.len);
  let y = h.rise * (h.rise < 0 ? 1 - (1 - u) ** 2 : u * u)
    + 4 * (1 - calm) * vnoise(x / 80 + h.seed, z / 80)
    + 1.2 * (1 - calm * 0.5) * vnoise(x / 22, z / 22 + h.seed * 1.7);
  const edge = d - (Math.max(h.w / 2, 18) + 12);
  if (edge > 0) y += Math.min(9, edge * 0.12); // corridor mounding
  return y;
}

// A pond fills to just below the lowest point of its shore, so the water never
// sits above the ground around it (e.g. a green just past it). Cached per pond.
const levels = new WeakMap();
export function waterLevel(h, w) {
  if (!levels.has(w)) {
    let lo = rawHeight(h, w[0], w[1]);
    for (let k = 0; k < 32; k++) {
      const a = (k / 32) * Math.PI * 2;
      lo = Math.min(lo, rawHeight(h, w[0] + Math.cos(a) * w[2] * 1.1, w[1] + Math.sin(a) * w[3] * 1.1));
    }
    levels.set(w, lo - 0.6);
  }
  return levels.get(w);
}

export function heightAt(h, x, z) {
  let y = rawHeight(h, x, z);
  // Green: built up slightly, flattened, tilted back-to-front.
  const dg = Math.hypot(x - h.green[0], z - h.green[1]);
  if (dg < h.gr + 10) {
    const gy = rawHeight(h, h.green[0], h.green[1]) + 0.7 + 0.03 * (z - h.green[1]) - 0.015 * (x - h.green[0]);
    y = lerp(y, gy, smooth(h.gr + 10, h.gr, dg));
  }
  // Raised tee box.
  const dt = Math.hypot(x, z);
  if (dt < 14) y = lerp(y, rawHeight(h, 0, 0) + 0.6, smooth(14, 8, dt));
  // Bunkers are dug in.
  for (const [cx, cz, r] of h.bunkers) {
    const db = Math.hypot(x - cx, z - cz);
    if (db < r + 1.5) y -= 1.0 * smooth(r + 1.5, r - 2, db);
  }
  // Ponds.
  for (const w of h.water) {
    const e = inEllipse(x, z, w);
    const wl = waterLevel(h, w);
    // The whole ellipse sits under the water, and the bank rises gently from the
    // waterline so the shore is a smooth curve instead of a stepped edge.
    if (e < 1) y = Math.min(lerp(y, wl - 1.5, smooth(1.0, 0.55, e)), wl - 0.02 - 1.45 * smooth(1.0, 0.55, e));
    else if (e < 2.6) y = Math.max(wl + 0.02, lerp(wl + 0.02 + 0.28 * smooth(1, 1.5, e), y, smooth(1.3, 2.6, e)));
  }
  return y;
}
