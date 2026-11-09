// Shot model, caddie strategy, and USGA-style course rating.
import { HOLES, surfaceAt, heightAt, projectOnPath, pointAt, dist, lerp, rng32 } from './course.js';

function gauss(r) {
  let u = 0;
  while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

// A golfer's skill as a function of handicap H. Tune these to calibrate.
export function golfer(H) {
  return {
    H,
    drive: 280 - 3.0 * H,          // total driver distance (yds)
    angSD: 3.5 + 0.155 * H,        // full-swing direction spread (degrees, 1 SD)
    distSD: 0.06 + 0.004 * H,     // full-swing distance spread (fraction, 1 SD)
    mishit: 0.01 + 0.0055 * H,     // chance of a topped/shanked shot
    shortSD: 0.09 + 0.006 * H,     // pitch/chip spread (fraction of distance)
    sandFail: 0.03 + 0.015 * H,    // chance of leaving a greenside bunker shot in the bunker
    puttR0: 5.6 - 0.01 * H,        // putt length (ft) made ~50% of the time
    puttLeave: 0.08 + 0.003 * H,  // how far misses finish from the hole (fraction)
  };
}

// How each lie limits distance (max) and inflates spread (sd).
const LIE = {
  tee: { max: 1, sd: 1 },
  fairway: { max: 0.9, sd: 1 },
  fringe: { max: 0.9, sd: 1 },
  rough: { max: 0.78, sd: 1.35 },
  bunker: { max: 0.6, sd: 1.6 },
  trees: { max: 0.35, sd: 1.8 },
};
const BAD = new Set(['water', 'bunker', 'trees']);

// Caddie: go for the green if reachable, otherwise pick the longest safe layup
// along the centerline.
function chooseShot(h, g, pos, lie) {
  const L = LIE[lie];
  const maxD = g.drive * L.max;
  const y0 = heightAt(h, pos[0], pos[1]);
  // Better players aim at the flag; higher handicaps aim at the middle of the green.
  const t = Math.min(1, g.H / 15);
  const aimG = [lerp(h.pin[0], h.green[0], t), lerp(h.pin[1], h.green[1], t)];
  const playsG = dist(pos, aimG) + (heightAt(h, aimG[0], aimG[1]) - y0);
  if (playsG <= maxD * 1.02) return { aim: aimG, plays: playsG };

  const s0 = projectOnPath(h, pos[0], pos[1]).s;
  let best = null;
  for (const f of [1, 0.94, 0.88, 0.82, 0.76, 0.7, 0.62, 0.55, 0.45]) {
    const D = maxD * f;
    const pt = pointAhead(h, pos, s0, D);
    const risk = layupRisk(h, g, pos, pt, L);
    if (!best || risk < best.risk) best = { pt, risk };
    if (risk === 0) break;
  }
  const pt = best.pt;
  return { aim: pt, plays: dist(pos, pt) + (heightAt(h, pt[0], pt[1]) - y0) };
}

function pointAhead(h, pos, s0, D) {
  const sMax = h.len - h.gr - 15;
  for (let s = s0; s < sMax; s += 3) {
    const p = pointAt(h, s);
    if (dist(pos, p) >= D) return p;
  }
  return pointAt(h, sMax);
}

// Count how many points of a typical miss pattern end up in trouble.
function layupRisk(h, g, pos, pt, L) {
  const D = Math.max(1, dist(pos, pt));
  const ux = (pt[0] - pos[0]) / D, uz = (pt[1] - pos[1]) / D;
  const lat = D * Math.tan((g.angSD * L.sd * Math.PI) / 180);
  const lon = D * g.distSD * L.sd;
  const samples = [[0, 0], [lat, 0], [-lat, 0], [0, lon], [0, -lon]];
  let risk = 0;
  for (const [a, b] of samples) {
    const s = surfaceAt(h, pt[0] + uz * a + ux * b, pt[1] - ux * a + uz * b);
    if (BAD.has(s)) risk += s === 'water' ? 2 : 1;
  }
  if (surfaceAt(h, pt[0], pt[1]) !== 'fairway') risk += 0.5;
  return risk;
}

// Execute a shot; returns where the ball comes to rest.
function hit(h, g, pos, lie, shot, r) {
  const L = LIE[lie];
  const [ax, az] = shot.aim;
  const horiz = Math.max(0.01, dist(pos, shot.aim));
  const ux = (ax - pos[0]) / horiz, uz = (az - pos[1]) / horiz;
  const scatter = (sdAlong, sdLat) => {
    const a = gauss(r) * sdAlong, b = gauss(r) * sdLat;
    return [ax + ux * a + uz * b, az + uz * a - ux * b];
  };

  if (lie === 'bunker' && horiz < 45) {
    if (r() < g.sandFail) return [pos[0] + ux * r() * 2, pos[1] + uz * r() * 2];
    const sd = horiz * (0.12 + 0.01 * g.H) + 1.5;
    return scatter(sd, sd * 0.6);
  }
  if (horiz < 60 && lie !== 'tee') {
    const sd = horiz * g.shortSD * L.sd + 1;
    return scatter(sd, sd * 0.6);
  }

  let ang = (gauss(r) * g.angSD * L.sd * Math.PI) / 180;
  let plays = shot.plays * (1 + gauss(r) * g.distSD * L.sd);
  if (r() < g.mishit) {
    plays *= 0.35 + 0.4 * r();
    ang += gauss(r) * 0.17;
  }
  plays = Math.min(plays, g.drive * L.max * 1.06);
  const carry = Math.max(5, plays - (shot.plays - horiz)); // undo the elevation adjustment
  const c = Math.cos(ang), s = Math.sin(ang);
  return [pos[0] + (ux * c - uz * s) * carry, pos[1] + (ux * s + uz * c) * carry];
}

// Water: one-stroke penalty, drop back along the line the ball came in on.
function drop(h, from, splash) {
  const D = dist(from, splash);
  const n = Math.ceil(D / 2);
  for (let k = 1; k <= n; k++) {
    const t = k / n;
    const p = [lerp(splash[0], from[0], t), lerp(splash[1], from[1], t)];
    if (surfaceAt(h, p[0], p[1]) !== 'water') {
      const t2 = Math.min(1, t + 2 / Math.max(D, 1));
      return [lerp(splash[0], from[0], t2), lerp(splash[1], from[1], t2)];
    }
  }
  return from;
}

// Play one hole. If record is true, the shot list is returned for drawing.
export function playHole(h, g, r, record = false) {
  const cap = h.par + 5;
  const shots = record ? [] : null;
  let pos = [...h.tee], lie = 'tee', strokes = 0;

  while (strokes < cap) {
    if (lie === 'green' || lie === 'fringe') {
      let ft = dist(pos, h.pin) * 3 + (lie === 'fringe' ? 4 : 0);
      while (strokes < cap) {
        strokes++;
        const p = 1 / (1 + Math.pow(ft / g.puttR0, 2.5));
        if (r() < p) {
          if (record) shots.push({ from: pos, to: [...h.pin], surf: 'holed', lie, putt: true });
          return { score: strokes, shots };
        }
        ft = ft * g.puttLeave * Math.abs(gauss(r)) * 1.4 + 0.6 * r();
        if (record) {
          // Place the miss: mostly long of the hole, a little to one side.
          const d = Math.max(0.01, dist(pos, h.pin));
          const ux = (h.pin[0] - pos[0]) / d, uz = (h.pin[1] - pos[1]) / d;
          const yd = ft / 3, a = (r() - 0.35) * 2.2;
          const to = [h.pin[0] + (ux * Math.cos(a) - uz * Math.sin(a)) * yd, h.pin[1] + (ux * Math.sin(a) + uz * Math.cos(a)) * yd];
          shots.push({ from: pos, to, surf: 'green', lie, putt: true });
          pos = to;
        }
        lie = 'green';
      }
      break;
    }
    const shot = chooseShot(h, g, pos, lie);
    let land = hit(h, g, pos, lie, shot, r);
    strokes++;
    let surf = surfaceAt(h, land[0], land[1]);
    let splash = null;
    if (surf === 'water') {
      strokes++;
      splash = land;
      land = drop(h, pos, land);
      surf = surfaceAt(h, land[0], land[1]);
    }
    if (record) shots.push({ from: pos, to: land, splash, surf, lie });
    pos = land;
    lie = surf;
    if (dist(pos, h.pin) < 0.3) return { score: strokes, shots }; // holed out
  }
  return { score: cap, shots };
}

const BUCKETS = ['Eagle-', 'Birdie', 'Par', 'Bogey', 'Double', 'Triple+'];
export { BUCKETS };
const bucketOf = (score, par) => Math.max(0, Math.min(5, score - par + 2));
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const betterHalf = (a) => mean([...a].sort((x, y) => x - y).slice(0, Math.ceil(a.length / 2)));
const tick = () => new Promise((res) => setTimeout(res, 0));

// Quick sim of a single hole for the given handicaps.
export function simulateHole(k, { plays = 500, handicaps = [0, 20], tracePlays = 40 } = {}) {
  const h = HOLES[k];
  const stats = {}, traces = {};
  for (const H of handicaps) {
    const g = golfer(H), r = rng32(k * 7919 + H * 31 + 1);
    let sum = 0;
    const b = Array(6).fill(0);
    traces[H] = [];
    for (let i = 0; i < plays; i++) {
      const res = playHole(h, g, r, i < tracePlays);
      sum += res.score;
      b[bucketOf(res.score, h.par)]++;
      if (res.shots) traces[H].push(res.shots);
    }
    stats[H] = { avg: sum / plays, buckets: b.map((c) => c / plays) };
  }
  return { stats, traces };
}

// Full rating: simulate whole rounds for each handicap.
// Course Rating ~ scratch golfer's better-half average; Bogey Rating ~ the
// 20-handicap's. Slope = 5.381 x (Bogey Rating - Course Rating), per USGA (men).
export async function rateCourse({ rounds = 400, handicaps = [0, 5, 10, 15, 20, 25, 30], tracePlays = 30, onProgress, holes = HOLES } = {}) {
  const HOLES_ = holes;
  const holeStats = HOLES_.map(() => ({}));
  const traces = HOLES_.map(() => ({}));
  const byH = {};
  const total = handicaps.length * rounds;
  let done = 0;

  for (const H of handicaps) {
    const g = golfer(H), r = rng32(1000 + H);
    const tracing = H === 0 || H === 20;
    const sums = Array(HOLES_.length).fill(0);
    const buckets = HOLES_.map(() => Array(6).fill(0));
    if (tracing) HOLES_.forEach((_, k) => (traces[k][H] = []));
    const totals = [];
    for (let i = 0; i < rounds; i++) {
      let tot = 0;
      HOLES_.forEach((h, k) => {
        const res = playHole(h, g, r, tracing && i < tracePlays);
        tot += res.score;
        sums[k] += res.score;
        buckets[k][bucketOf(res.score, h.par)]++;
        if (res.shots) traces[k][H].push(res.shots);
      });
      totals.push(tot);
      if (++done % 25 === 0) { onProgress?.(done / total); await tick(); }
    }
    HOLES_.forEach((_, k) => (holeStats[k][H] = { avg: sums[k] / rounds, buckets: buckets[k].map((c) => c / rounds) }));
    byH[H] = { avg: mean(totals), betterHalf: betterHalf(totals), best: Math.min(...totals), worst: Math.max(...totals) };
  }

  const courseRating = byH[0].betterHalf;
  const bogeyRating = byH[20].betterHalf;
  const slope = Math.max(55, Math.min(155, Math.round(5.381 * (bogeyRating - courseRating))));
  onProgress?.(1);
  return { courseRating, bogeyRating, slope, byH, holeStats, traces, rounds };
}
