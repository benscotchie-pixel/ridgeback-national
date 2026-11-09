// TV-style replay of a simulated hole: broadcast camera cuts, a growing
// shot tracer, a scorebug and lower-third graphics.
import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { heightAt, surfaceAt, dist, COURSE_NAME } from './course.js';
import { Golfer } from './golfer.js';

const V = (x, y, z) => new THREE.Vector3(x, y, -z);
const LIE_NAMES = { tee: 'Tee', fairway: 'Fairway', rough: 'Rough', bunker: 'Bunker', trees: 'Trees', fringe: 'Fringe', green: 'Green', water: 'Water' };
const SCORE_NAMES = { '-3': 'Albatross', '-2': 'Eagle', '-1': 'Birdie', 0: 'Par', 1: 'Bogey', 2: 'Double Bogey', 3: 'Triple Bogey' };
const ease = (t) => t * t * (3 - 2 * t);

// Find a camera spot near `target` (hole coords) with a clear view: on dry
// ground, not in the trees, and no trees along the sight line. `dir` is the shot direction.
export function clearCamSpot(h, target, dir, { dist: d0 = 32, height = 5 } = {}) {
  // Tree canopies overhang the 'trees' ground area, so keep a margin around it.
  const treeNear = (x, z, r) => {
    if (surfaceAt(h, x, z) === 'trees') return true;
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      if (surfaceAt(h, x + Math.cos(a) * r, z + Math.sin(a) * r) === 'trees') return true;
    }
    return false;
  };
  const blocked = (a, b) => {
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      if (t < 0.85 && treeNear(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 6)) return true;
    }
    return false;
  };
  // Camera towers stand on dry land, a few yards clear of any pond.
  const wet = (x, z) => [[0, 0], [4, 0], [-4, 0], [0, 4], [0, -4]].some(([dx, dz]) => surfaceAt(h, x + dx, z + dz) === 'water');
  const back = [-dir[0], -dir[1]];
  for (const d of [d0, d0 * 0.75, d0 * 0.5, d0 * 1.4]) {
    for (const ang of [30, -30, 50, -50, 12, -12, 75, -75]) {
      const a = (ang * Math.PI) / 180;
      const ox = back[0] * Math.cos(a) - back[1] * Math.sin(a), oz = back[0] * Math.sin(a) + back[1] * Math.cos(a);
      const p = [target[0] + ox * d, target[1] + oz * d];
      if (!wet(p[0], p[1]) && !treeNear(p[0], p[1], 11) && !blocked(p, target)) return { pos: p, y: heightAt(h, p[0], p[1]) + height };
    }
  }
  // Nothing clear at ground level: go high above, behind the target.
  const p = [target[0] + back[0] * d0, target[1] + back[1] * d0];
  return { pos: p, y: heightAt(h, ...target) + 30 };
}

export class Broadcast {
  constructor(view, overlay) {
    this.view = view;
    this.overlay = overlay;
    this.tasks = [];
    this.active = false;
  }

  // Called by the scene every frame while active.
  update(now) {
    this.golfer?.tick(now);
    this.now = now;
    for (const task of [...this.tasks]) {
      if (task.t0 == null) task.t0 = now;
      const t = Math.min(1, (now - task.t0) / task.dur);
      task.fn(t);
      if (t >= 1) { this.tasks.splice(this.tasks.indexOf(task), 1); task.done(); }
    }
    if (this.lineMats) {
      const s = this.view.renderer.getSize(new THREE.Vector2());
      this.lineMats.forEach((m) => m.resolution.set(s.x, s.y));
    }
  }

  run(dur, fn) {
    if (this.cancelled) return Promise.reject(new Error('cancelled'));
    return new Promise((done, fail) => this.tasks.push({ dur, fn, done, fail }));
  }
  wait(ms) { return this.run(ms, () => {}); }

  stop() {
    this.cancelled = true;
    this.tasks.forEach((t) => t.fail(new Error('cancelled')));
    this.tasks = [];
  }

  cam(eye, look, fov) {
    const c = this.view.camera;
    c.position.copy(eye);
    this.view.controls.target.copy(look);
    c.lookAt(look);
    if (fov && c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
    this.view.focusDist = eye.distanceTo(this.focusOn ?? look);
  }

  // ---- overlay graphics ----
  scorebug(h, who, shot, toPar) {
    const tp = toPar == null ? '' : toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : `${toPar}`;
    this.overlay.querySelector('.bug').innerHTML = `
      <div class="bug-course">${COURSE_NAME}</div>
      <div class="bug-row"><span class="bug-hole">${h.number}</span><span>PAR ${h.par}</span><span>${h.yards} YDS</span></div>
      <div class="bug-row bug-player"><span>${who}</span><span class="bug-shot">${shot ? `SHOT ${shot}` : ''}</span><span class="bug-score ${toPar < 0 ? 'under' : ''}">${tp}</span></div>`;
  }
  lower(title, sub = '', accent = '') {
    const el = this.overlay.querySelector('.lower');
    el.classList.remove('in');
    void el.offsetWidth;
    el.innerHTML = `<div class="lt-title ${accent}">${title}</div>${sub ? `<div class="lt-sub">${sub}</div>` : ''}`;
    el.classList.add('in');
  }
  clearLower() { this.overlay.querySelector('.lower').classList.remove('in'); }

  // ---- playback ----
  async play(h, shots, who, outfit) {
    const token = (this.token = (this.token ?? 0) + 1);
    this.stop();
    if (this.group) { this.view.dispose(this.group); this.group = null; }
    this.cancelled = false;
    this.active = true;
    this.overlay.hidden = false;
    const v = this.view;
    v.controls.enabled = false;
    if (v.traceGroup) v.traceGroup.visible = false;
    this.group = new THREE.Group();
    v.group.add(this.group);
    this.lineMats = [];
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 20, 14), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x333333 }));
    ball.castShadow = true;
    this.group.add(ball);
    const ballY = (p) => heightAt(h, p[0], p[1]) + 0.04;
    const placeBall = (p, y) => ball.position.copy(V(p[0], y ?? ballY(p), p[1]));
    this.golfer = new Golfer(outfit ?? (who.startsWith('Bogey') ? 'bogey' : 'scratch'));
    this.group.add(this.golfer.group);
    if (shots[0]) {
      const s0 = shots[0], e0 = s0.splash ?? s0.to, d0 = Math.max(0.01, dist(s0.from, e0));
      this.golfer.address(h, s0.from, [(e0[0] - s0.from[0]) / d0, (e0[1] - s0.from[1]) / d0], h.par > 3 ? 'driver' : 'iron', d0);
    }

    try {
      // Hole intro: high establishing shot.
      this.scorebug(h, who, 0, 0);
      this.lower(`Hole ${h.number}`, `Par ${h.par} · ${h.yards} yards`);
      placeBall(h.tee);
      const mid = [h.green[0] * 0.5, h.green[1] * 0.5];
      await this.run(4200, (t) => {
        const e = ease(t);
        const eye = V(-30 + 20 * e, heightAt(h, 0, 0) + 70 - 40 * e, -60 + 40 * e);
        this.cam(eye, V(mid[0], heightAt(h, ...mid), mid[1]), 40);
      });
      this.clearLower();

      let strokes = 0;
      for (let i = 0; i < shots.length; i++) {
        const sh = shots[i];
        strokes += 1;
        this.scorebug(h, who, strokes, null);
        if (sh.putt) await this.playPutt(h, sh, ball, ballY, strokes);
        else {
          await this.playShot(h, sh, ball, ballY, strokes);
          if (sh.splash) strokes += 1; // penalty stroke
        }
      }
      const diff = strokes - h.par;
      this.scorebug(h, who, 0, diff);
      this.lower(SCORE_NAMES[diff] ?? `+${diff}`, `${who} · ${strokes} strokes`, diff < 0 ? 'red' : '');
      const p = h.pin;
      await this.run(3500, (t) => {
        const a = 0.6 + t * 0.6;
        this.cam(V(p[0] + Math.sin(a) * 9, ballY(p) + 3.2, p[1] - Math.cos(a) * 9), V(p[0], ballY(p) + 0.5, p[1]), 35);
      });
    } catch (e) {
      if (e.message !== 'cancelled') throw e;
    } finally {
      if (token === this.token) this.finish();
    }
  }

  finish() {
    this.active = false;
    this.overlay.hidden = true;
    this.clearLower();
    this.focusOn = null;
    if (this.view.post) this.view.post.hidden = this.view.post.hidden.filter((o) => !o.isLine2);
    if (this.group) { this.view.dispose(this.group); this.group = null; }
    this.golfer = null;
    this.lineMats = null;
    const v = this.view;
    if (v.traceGroup) v.traceGroup.visible = true;
    v.camera.fov = 45; v.camera.updateProjectionMatrix();
    v.controls.enabled = true;
    v.setView('green');
    this.onEnd?.();
  }

  // Only the current shot's tracer is on screen, like TV.
  hideTracers() {
    for (const o of this.group.children) if (o.isLine2) o.visible = false;
  }

  tracer(color = 0xff3b2f, width = 4) {
    const geo = new LineGeometry();
    const mat = new LineMaterial({ color, linewidth: width, transparent: true, opacity: 0.95, depthWrite: false });
    this.lineMats.push(mat);
    const line = new Line2(geo, mat);
    line.frustumCulled = false;
    line.renderOrder = 10;
    this.group.add(line);
    this.view.post?.hidden.push(line); // keep it out of the depth-of-field depth pass
    return line;
  }

  async playShot(h, sh, ball, ballY, n) {
    const end = sh.splash ?? sh.to;
    const horiz = dist(sh.from, end);
    const dir = [(end[0] - sh.from[0]) / horiz, (end[1] - sh.from[1]) / horiz];
    const side = [dir[1], -dir[0]];
    const toPin = Math.round(dist(sh.from, h.pin));
    const full = horiz > 60;
    // carry then roll (only on grass, and never through water, sand or trees)
    let rollFrac = full && ['fairway', 'green', 'fringe', 'rough'].includes(sh.surf) && !sh.splash
      ? (sh.surf === 'rough' ? 0.04 : sh.lie === 'tee' ? 0.1 : 0.05) : 0;
    for (let k = 0; k <= 8 && rollFrac; k++) {
      const back = horiz * rollFrac * (k / 8);
      if (['water', 'bunker', 'trees'].includes(surfaceAt(h, end[0] - dir[0] * back, end[1] - dir[1] * back))) rollFrac = 0;
    }
    const carryPt = [end[0] - dir[0] * horiz * rollFrac, end[1] - dir[1] * horiz * rollFrac];
    const carry = dist(sh.from, carryPt);
    const y0 = ballY(sh.from), y1 = ballY(carryPt);
    const apex = full ? Math.min(38, 10 + carry * 0.085) : Math.max(1.5, carry * 0.25);
    const ballAt = (u) => {
      // drag: covers ground quickly early, slows later; apex past the midpoint
      const s = (1 - Math.exp(-1.7 * u)) / (1 - Math.exp(-1.7));
      const y = y0 + (y1 - y0) * s + apex * Math.sin(Math.PI * Math.pow(s, 1.25));
      return V(sh.from[0] + (carryPt[0] - sh.from[0]) * s, y, sh.from[1] + (carryPt[1] - sh.from[1]) * s);
    };

    // 1. Setup: behind the ball.
    this.hideTracers();
    ball.position.copy(V(sh.from[0], y0, sh.from[1]));
    ball.visible = true;
    this.focusOn = ball.position;
    const inTrees = sh.lie === 'trees';
    const behind = (back, up) => V(sh.from[0] - dir[0] * back * (inTrees ? 1.6 : 1), y0 + up + (inTrees ? 14 : 0), sh.from[1] - dir[1] * back * (inTrees ? 1.6 : 1));
    const aimLook = V(sh.from[0] + dir[0] * 80, y0 + 6, sh.from[1] + dir[1] * 80);
    const kind = sh.lie === 'tee' && h.par > 3 ? 'driver' : full ? 'iron' : 'chip';
    const g = this.golfer;
    g.address(h, sh.from, dir, kind, horiz);
    // Down-the-line camera: behind the golfer's hands, looking down the target line.
    const golferSide = [-side[0], -side[1]];
    const dtl = (back) => inTrees ? behind(back, 1.9)
      : V(sh.from[0] - dir[0] * back + golferSide[0] * 0.55, y0 + 1.6, sh.from[1] - dir[1] * back + golferSide[1] * 0.55);
    const dtlLook = V(sh.from[0] + dir[0] * 40 + golferSide[0] * 0.3, y0 + 1.6, sh.from[1] + dir[1] * 40 + golferSide[1] * 0.3);
    this.lower(`${toPin} yds to the pin`, `Shot ${n} · from the ${LIE_NAMES[sh.lie] ?? sh.lie}`);
    await this.run(1600, (t) => this.cam(dtl(9.5 - t * 0.8), dtlLook, 30));
    this.clearLower();
    const impactIn = g.startSwing(this.now);
    await this.run(impactIn, () => this.cam(dtl(8.7), dtlLook, 30));

    // 2. Flight with tracer.
    const line = this.tracer();
    const pts = [];
    const T = 1300 + carry * 14;
    const fixedEye = dtl(8.7);
    const spot = clearCamSpot(h, carryPt, dir, { dist: full ? 34 : 14, height: full ? 5 : 2.5 });
    const landEye = V(spot.pos[0], spot.y, spot.pos[1]);
    const landLook = V(carryPt[0], y1 + 1, carryPt[1]);
    const cutAt = full && carry > 120 ? 0.5 : 2;
    let lastU = 0;
    await this.run(T, (u) => {
      const steps = 6;
      for (let k = 1; k <= steps; k++) {
        const p = ballAt(lastU + ((u - lastU) * k) / steps);
        pts.push(p.x, p.y, p.z);
      }
      lastU = u;
      if (pts.length >= 6) {
        // Fresh geometry each frame: three.js caches an instanced geometry's
        // first instance count, so a growing line would stay stuck at its start.
        line.geometry.dispose();
        line.geometry = new LineGeometry().setPositions(pts);
      }
      ball.position.copy(ballAt(u));
      this.focusOn = ball.position;
      if (u < cutAt) {
        // TV style: camera barely moves, the tracer climbs out of the frame's center
        const follow = full ? 0.12 + 0.18 * ease(Math.min(1, u * 2)) : 0.5;
        this.cam(fixedEye, dtlLook.clone().lerp(ball.position, follow), 30);
      } else {
        // frame the landing area and let the ball drop into the shot
        this.cam(landEye, landLook.clone().lerp(ball.position, 0.3), 30);
      }
    });

    // 3. Roll out, or splash.
    if (sh.splash) {
      ball.visible = false;
      this.lower('In the water', 'One-stroke penalty · drop', 'red');
      await this.wait(1800);
    } else {
      if (rollFrac) {
        await this.run(1100, (t) => {
          const e = 1 - (1 - t) * (1 - t);
          const p = [carryPt[0] + (end[0] - carryPt[0]) * e, carryPt[1] + (end[1] - carryPt[1]) * e];
          ball.position.copy(V(p[0], ballY(p), p[1]));
          this.cam(landEye, ball.position, 28);
        });
      }
      const yds = Math.round(horiz);
      const left = Math.round(dist(end, h.pin));
      const label = sh.surf === 'green' ? `On the green · ${left * 3} ft to the hole`
        : `${LIE_NAMES[sh.surf] ?? sh.surf} · ${left} yds to go`;
      this.lower(full ? `${sh.lie === 'tee' && h.par > 3 ? 'Drive' : 'Shot'} ${yds} yds` : `${yds} yd chip`, label);
      await this.wait(2000);
    }
    this.clearLower();
    line.material.opacity = 0.45;
    line.material.linewidth = 2;
  }

  async playPutt(h, sh, ball, ballY, n) {
    const d = Math.max(0.05, dist(sh.from, sh.to));
    const toHole = dist(sh.from, h.pin);
    const dir = [(h.pin[0] - sh.from[0]) / toHole, (h.pin[1] - sh.from[1]) / toHole];
    ball.visible = true;
    ball.position.copy(V(sh.from[0], ballY(sh.from), sh.from[1]));
    const ft = Math.max(1, Math.round(toHole * 3));
    this.hideTracers();
    // Far enough back and off to the side that the golfer stays out of the shot.
    const back = Math.min(9, 6 + toHole * 0.3), up = Math.min(1.8, 1.2 + toHole * 0.06);
    const away = [dir[1] * 1.8, -dir[0] * 1.8]; // step off to the side opposite the golfer
    const eye = V(sh.from[0] - dir[0] * back + away[0], ballY(sh.from) + up, sh.from[1] - dir[1] * back + away[1]);
    const look = V(h.pin[0], ballY(h.pin), h.pin[1]);
    this.focusOn = ball.position;
    const g = this.golfer;
    g.address(h, sh.from, dir, 'putt', toHole);
    this.lower(`${ft} ft putt`, `Shot ${n}`);
    await this.run(1400, () => this.cam(eye, look, 30));
    this.clearLower();
    const impactIn = g.startSwing(this.now);
    await this.run(impactIn, () => this.cam(eye, look, 30));
    const holed = sh.surf === 'holed';
    const T = 900 + d * 260;
    await this.run(T, (t) => {
      const e = 1 - Math.pow(1 - t, 2.2);
      const p = [sh.from[0] + (sh.to[0] - sh.from[0]) * e, sh.from[1] + (sh.to[1] - sh.from[1]) * e];
      ball.position.copy(V(p[0], ballY(p), p[1]));
      this.focusOn = ball.position;
      this.cam(eye.clone().lerp(V(p[0] - dir[0] * back + away[0], ballY(p) + up, p[1] - dir[1] * back + away[1]), e * 0.4), look, 30);
    });
    if (holed) {
      await this.run(300, (t) => { ball.position.y = ballY(h.pin) - t * 0.12; });
      ball.visible = false;
      this.lower('In the hole!', '', 'red');
      await this.wait(1200);
    } else {
      this.lower(`Leaves ${Math.max(1, Math.round(dist(sh.to, h.pin) * 3))} ft`);
      await this.wait(1200);
    }
    this.clearLower();
  }
}
