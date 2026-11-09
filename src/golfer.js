// A procedurally animated golfer. The body is posed every frame from a small
// set of swing variables (arm angle on the swing plane, wrist hinge, shoulder
// and hip turn); arms and legs are solved with two-bone IK so hands stay on
// the club and feet stay planted.
//
// Local frame (meters): +X = toward the target, +Z = toward the ball,
// +Y = up, origin = between the feet on the ground. Right-handed golfer.
import * as THREE from 'three';
import { heightAt } from './course.js';

const YD = 1.0936; // meters -> yards
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const X = V3(1, 0, 0), Y = V3(0, 1, 0);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const easeInOut = (t) => t * t * (3 - 2 * t);
const rad = THREE.MathUtils.degToRad;

const BODY = {
  thigh: 0.45, shin: 0.44, ankle: 0.08, upperArm: 0.3, forearm: 0.27,
  hipHalf: 0.1, shoulderHalf: 0.19, spine: 0.5, stance: 0.24,
};

// Swing shapes. Angles in degrees: alpha = arms around the swing plane,
// psi = wrist hinge, sh/hip = shoulder/hip turn (negative = away from target).
function swingFor(kind, yards) {
  if (kind === 'putt') {
    const a = clamp(5 + yards * 0.9, 5, 24);
    return { kind, ball: V3(0.0, 0, 0.5), tilt: 42, alphaTop: a, psiTop: 0, shTop: -a * 0.2, hipTop: 0,
      alphaFin: -a * 1.1, psiFin: 0, shFin: a * 0.25, hipFin: 0, back: 650 + a * 15, down: 520 + a * 12, follow: 600 };
  }
  if (kind === 'chip') {
    const k = clamp(yards / 60, 0.15, 1);
    const a = 35 + 70 * k;
    return { kind, ball: V3(-0.03, 0, 0.62), tilt: 38, alphaTop: a, psiTop: 25 + 45 * k, shTop: -30 - 40 * k, hipTop: -10 - 15 * k,
      alphaFin: -a * 0.95, psiFin: -30 * k, shFin: 30 + 40 * k, hipFin: 25 + 30 * k, back: 800, down: 380, follow: 650 };
  }
  const driver = kind === 'driver';
  return { kind, ball: driver ? V3(0.16, 0, 0.88) : V3(0.03, 0, 0.72), tilt: driver ? 32 : 37,
    alphaTop: 125, psiTop: 108, shTop: -95, hipTop: -45, alphaFin: -158, psiFin: -85, shFin: 115, hipFin: 95,
    back: 950, down: 270, follow: 800 };
}

const P_box = () => new THREE.BoxGeometry(1, 1, 1);

function twoBoneIK(a, target, l1, l2, pole) {
  const d = target.clone().sub(a);
  const len = clamp(d.length(), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const dir = d.normalize();
  const cosA = clamp((l1 * l1 + len * len - l2 * l2) / (2 * l1 * len), -1, 1);
  const p = pole.clone().sub(a);
  p.sub(dir.clone().multiplyScalar(p.dot(dir))).normalize();
  const joint = a.clone().addScaledVector(dir, l1 * cosA).addScaledVector(p, l1 * Math.sqrt(1 - cosA * cosA));
  return { joint, end: a.clone().addScaledVector(dir, len) };
}

const OUTFITS = {
  scratch: { shirt: 0x1d2f5c, pants: 0x2b2f36, cap: 0xf2f2f2, shoe: 0xf4f4f4 },
  bogey: { shirt: 0xb3262e, pants: 0xc9b38a, cap: 0x20242c, shoe: 0x3b2a20 },
  // Ben: gray striped polo, black shorts, dark cap, gray sneakers, white ankle socks.
  ben: { shirt: 0xc6cacd, pants: 0x17191c, cap: 0x2a2c30, shoe: 0x979ca1, skin: 0xd8a586, hair: 0x5b3a22,
    shorts: true, shortSleeves: true, sock: 0xf3f3f3, stripes: true,
    // Full-swing shape measured from Ben's range videos with MediaPipe pose tracking
    // (capture/frames_7133.json face-on, frames_6982.json down-the-line): quick
    // ~2.2:1 tempo, ~77° shoulder / ~35° hip turn, 35° spine tilt, wrapped finish.
    swing: { tilt: 35, driverTilt: 31, alphaTop: 116, shTop: -80, hipTop: -35,
      alphaFin: -172, shFin: 120, hipFin: 92, back: 520, down: 240, follow: 520 } },
};

// Fine pinstripes for a polo.
function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 8, 64);
  g.fillStyle = '#c9ced4';
  for (let y = 0; y < 64; y += 8) g.fillRect(0, y, 8, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 6);
  return t;
}

export class Golfer {
  constructor(outfit = 'scratch') {
    const o = OUTFITS[outfit] ?? OUTFITS.scratch;
    const mat = (color, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough });
    const M = {
      skin: mat(o.skin ?? 0xc99a7a, 0.6), shirt: mat(o.shirt, 0.85), pants: mat(o.pants, 0.9), cap: mat(o.cap, 0.7),
      shoe: mat(o.shoe, 0.5), glove: mat(0xffffff, 0.7), belt: mat(0x15151a, 0.5), hair: mat(o.hair ?? 0x3a2a20, 0.9), sock: mat(o.sock ?? 0xffffff, 0.8),
      shaft: new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.9, roughness: 0.25 }),
      grip: mat(0x111111, 0.8), head: new THREE.MeshStandardMaterial({ color: 0x1a1a1e, metalness: 0.6, roughness: 0.3 }),
      iron: new THREE.MeshStandardMaterial({ color: 0xd8dce2, metalness: 0.95, roughness: 0.2 }),
    };
    if (o.stripes) M.shirt.map = stripeTexture();
    this.M = M;
    this.outfit = o;
    const legSkin = o.shorts ? M.skin : M.pants;
    const armSkin = o.shortSleeves ? M.skin : M.shirt;
    this.group = new THREE.Group();
    this.group.scale.setScalar(YD);
    const add = (geo, m) => { const mesh = new THREE.Mesh(geo, m); mesh.castShadow = true; mesh.receiveShadow = true; this.group.add(mesh); return mesh; };
    const limb = (r0, r1, m) => add(new THREE.CylinderGeometry(r1, r0, 1, 14).translate(0, 0.5, 0), m); // base at y=0
    const ball = (r, m) => add(new THREE.SphereGeometry(r, 18, 14), m);

    this.parts = {
      thighL: limb(0.085, 0.065, M.pants), thighR: limb(0.085, 0.065, M.pants),
      shinL: limb(0.058, 0.045, legSkin), shinR: limb(0.058, 0.045, legSkin),
      kneeL: ball(0.06, legSkin), kneeR: ball(0.06, legSkin),
      footL: add(new THREE.BoxGeometry(0.1, 0.07, 0.27).translate(0, 0.035, 0.07), M.shoe),
      footR: add(new THREE.BoxGeometry(0.1, 0.07, 0.27).translate(0, 0.035, 0.07), M.shoe),
      pelvis: add(new THREE.SphereGeometry(1, 20, 14), M.pants),
      belt: add(new THREE.CylinderGeometry(1, 1, 1, 20), M.belt),
      chest: add(new THREE.SphereGeometry(1, 24, 18), M.shirt),
      upperArmL: limb(0.052, 0.044, armSkin), upperArmR: limb(0.052, 0.044, armSkin),
      shoulderL: ball(0.07, M.shirt), shoulderR: ball(0.07, M.shirt),
      forearmL: limb(0.044, 0.035, M.skin), forearmR: limb(0.044, 0.035, M.skin),
      elbowL: ball(0.046, M.skin), elbowR: ball(0.046, M.skin),
      handL: ball(0.045, M.glove), handR: ball(0.043, M.skin),
      neck: limb(0.05, 0.048, M.skin),
      head: add(new THREE.SphereGeometry(1, 24, 18), M.skin),
      hair: add(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.hair),
      cap: add(new THREE.SphereGeometry(1, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), M.cap),
      brim: add(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 20, 1, false, -Math.PI / 2, Math.PI).translate(0, 0, 0.0), M.cap),
      shaft: limb(0.0065, 0.0065, M.shaft),
      grip: limb(0.013, 0.012, M.grip),
      clubHead: add(new THREE.BoxGeometry(1, 1, 1), M.head),
    };
    if (o.shortSleeves) {
      this.parts.sleeveL = limb(0.068, 0.062, M.shirt);
      this.parts.sleeveR = limb(0.068, 0.062, M.shirt);
    }
    if (o.shorts) {
      this.parts.sockL = limb(0.05, 0.048, M.sock);
      this.parts.sockR = limb(0.05, 0.048, M.sock);
    }
    this.headGeos = { box: P_box(), round: new THREE.SphereGeometry(0.5, 20, 14) };
    this.setClub('iron');
    this.swing = swingFor('iron', 150);
    this.t0 = null;
    this.state = { alpha: 0, psi: 0, sh: 0, hip: 0, shift: 0, tilt: 37, headTurn: 0, heel: 0 };
    this.solve();
  }

  setClub(kind) {
    const head = this.parts.clubHead;
    head.geometry = kind === 'driver' ? this.headGeos.round : this.headGeos.box;
    if (kind === 'driver') { head.material = this.M.head; this.headSize = V3(0.12, 0.06, 0.11); }
    else if (kind === 'putt') { head.material = this.M.iron; this.headSize = V3(0.11, 0.028, 0.035); }
    else { head.material = this.M.iron; this.headSize = V3(0.085, 0.05, 0.016); }
  }

  // Place the golfer beside a ball at hole coords `from`, facing so the shot
  // goes toward `dir` (unit vector in hole coords).
  address(h, from, dir, kind, yards) {
    this.swing = swingFor(kind, yards);
    const own = this.outfit.swing;
    if (own && (kind === 'driver' || kind === 'iron')) {
      const { driverTilt, ...rest } = own;
      Object.assign(this.swing, rest, { tilt: kind === 'driver' ? driverTilt : own.tilt });
    }
    this.setClub(kind === 'chip' ? 'iron' : kind);
    const T = V3(dir[0], 0, -dir[1]).normalize();      // world target direction
    const F = new THREE.Vector3().crossVectors(T, Y);  // world direction toward the ball
    this.group.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, Y, F));
    const b = this.swing.ball;
    const ballW = V3(from[0], 0, -from[1]);
    const origin = ballW.addScaledVector(T, -b.x * YD).addScaledVector(F, -b.z * YD);
    origin.y = heightAt(h, origin.x, -origin.z);
    this.group.position.copy(origin);
    this.t0 = null;
    this.phase = 'address';
    this.pose(0);
    this.solve();
  }

  // Start the swing; returns ms until impact.
  startSwing(now) {
    this.t0 = now;
    return this.swing.back + this.swing.down;
  }

  tick(now) {
    if (this.t0 == null) { this.pose(-1); this.solve(); return; }
    this.pose(now - this.t0);
    this.solve();
  }

  // Swing variables at time t (ms since start; negative = address/waggle).
  pose(t) {
    const s = this.swing, st = this.state;
    const B = s.back, D = s.down, Fo = s.follow;
    let alpha, psi, sh, hip, shift, headTurn = 0, heel = 0, tilt = s.tilt;
    if (t < 0) {
      alpha = 0; psi = 0; sh = 0; hip = 0; shift = 0;
    } else if (t < B) {
      const u = t / B, e = easeInOut(u);
      alpha = s.alphaTop * e;
      psi = s.psiTop * smooth(0.15, 0.85, u);
      sh = s.shTop * easeInOut(Math.min(1, u * 1.1));
      hip = s.hipTop * e;
      shift = -0.03 * e;
    } else if (t < B + D) {
      const u = (t - B) / D;
      alpha = s.alphaTop * (1 - u * u);                       // arms accelerate down
      psi = s.psiTop * (1 - smooth(0.5, 1.0, u));             // late release
      hip = s.hipTop + (s.hipFin * 0.45 - s.hipTop) * smooth(0, 0.8, u); // hips lead
      sh = s.shTop + (s.shFin * 0.15 - s.shTop) * Math.pow(u, 1.4);
      shift = -0.03 + 0.11 * smooth(0, 0.7, u);
    } else {
      const u = Math.min(1, (t - B - D) / Fo), e = 1 - Math.pow(1 - u, 2.2);
      alpha = s.alphaFin * e;
      psi = s.psiFin * smooth(0.25, 1, u);
      hip = s.hipFin * 0.45 + (s.hipFin - s.hipFin * 0.45) * e;
      sh = s.shFin * 0.15 + (s.shFin - s.shFin * 0.15) * e;
      shift = 0.08 + 0.02 * e;
      headTurn = s.kind === 'putt' ? 0 : 70 * smooth(0.1, 0.8, u);
      heel = s.kind === 'putt' ? 0 : smooth(0.0, 0.6, u);
      tilt = s.tilt - (s.kind === 'putt' ? 0 : (s.tilt - 8) * smooth(0.2, 1, u));
    }
    Object.assign(st, { alpha, psi, sh, hip, shift, tilt, headTurn, heel });
  }

  // Turn the swing variables into joint positions and update meshes.
  solve() {
    const b = BODY, st = this.state, s = this.swing, P = this.parts;
    // Pelvis: knees flexed, hips back, turned by `hip`, shifted toward the target.
    const pelvis = V3(st.shift, 0.9, -0.1);
    const hipRot = new THREE.Quaternion().setFromAxisAngle(Y, rad(st.hip));
    const hipL = pelvis.clone().add(X.clone().multiplyScalar(b.hipHalf).applyQuaternion(hipRot));
    const hipR = pelvis.clone().add(X.clone().multiplyScalar(-b.hipHalf).applyQuaternion(hipRot));

    // Spine tilted toward the ball; shoulders turn around the spine axis.
    const spineAxis = V3(0, Math.cos(rad(st.tilt)), Math.sin(rad(st.tilt))).normalize();
    const neck = pelvis.clone().addScaledVector(spineAxis, b.spine);
    const shRot = new THREE.Quaternion().setFromAxisAngle(spineAxis, rad(st.sh));
    const shLine = X.clone().applyQuaternion(shRot);
    const shoulderL = neck.clone().addScaledVector(shLine, b.shoulderHalf).addScaledVector(spineAxis, -0.04);
    const shoulderR = neck.clone().addScaledVector(shLine, -b.shoulderHalf).addScaledVector(spineAxis, -0.04);

    // Swing plane through the address shoulders and the ball.
    const addrNeck = V3(0, 0.9, -0.1).addScaledVector(V3(0, Math.cos(rad(s.tilt)), Math.sin(rad(s.tilt))).normalize(), b.spine);
    const C = addrNeck.clone().addScaledVector(V3(0, Math.cos(rad(s.tilt)), Math.sin(rad(s.tilt))).normalize(), -0.04);
    const v = s.ball.clone().sub(C);
    const toBall = v.length();
    v.normalize();
    const n = new THREE.Vector3().crossVectors(X, v).normalize();
    const w = new THREE.Vector3().crossVectors(n, v).normalize(); // points away from the target
    const R = 0.5; // keeps the hands within reach so the club meets the ball
    const L = toBall - R; // club length that puts the head on the ball at impact
    const onPlane = (deg) => v.clone().multiplyScalar(Math.cos(rad(deg))).addScaledVector(w, Math.sin(rad(deg)));
    const handsTarget = C.clone().addScaledVector(onPlane(st.alpha), R);
    const clubDir = onPlane(st.alpha + st.psi);

    // Arms: left hand on top of the grip, right hand just below it.
    const poleL = V3(0.4, -0.6, 0.6).add(neck), poleR = V3(-0.5, -0.8, 0.2).add(neck);
    const armL = twoBoneIK(shoulderL, handsTarget, b.upperArm, b.forearm, poleL);
    const grip = armL.end;
    const armR = twoBoneIK(shoulderR, grip.clone().addScaledVector(clubDir, 0.07), b.upperArm, b.forearm, poleR);
    const clubHead = grip.clone().addScaledVector(clubDir, L);

    // Legs: feet planted; the trail heel comes up in the follow-through.
    const ankleL = V3(b.stance, b.ankle, 0.0);
    const ankleR = V3(-b.stance + 0.06 * st.heel, b.ankle + 0.07 * st.heel, 0.02);
    const legL = twoBoneIK(hipL, ankleL, b.thigh, b.shin, V3(0.25, 0.5, 1.5));
    const legR = twoBoneIK(hipR, ankleR, b.thigh, b.shin, V3(-0.25, 0.5, 1.5));

    // ---- meshes ----
    const seg = (m, a, c) => {
      const d = c.clone().sub(a);
      m.position.copy(a);
      m.quaternion.setFromUnitVectors(Y, d.clone().normalize());
      m.scale.set(1, d.length(), 1);
    };
    seg(P.thighL, hipL, legL.joint); seg(P.thighR, hipR, legR.joint);
    seg(P.shinL, legL.joint, legL.end); seg(P.shinR, legR.joint, legR.end);
    P.kneeL.position.copy(legL.joint); P.kneeR.position.copy(legR.joint);
    if (P.sockL) {
      const up = (end, knee) => end.clone().add(knee.clone().sub(end).normalize().multiplyScalar(0.1));
      seg(P.sockL, legL.end, up(legL.end, legL.joint)); seg(P.sockR, legR.end, up(legR.end, legR.joint));
    }
    const footRot = (yaw, pitch) => new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, 0, 'YXZ'));
    P.footL.position.copy(ankleL).setY(0); P.footL.quaternion.copy(footRot(rad(20), 0));
    P.footR.position.set(ankleR.x, 0.07 * st.heel, ankleR.z);
    P.footR.quaternion.copy(footRot(rad(-8 + 40 * st.heel), rad(-55 * st.heel)));

    // Torso as two ellipsoids oriented along the spine and the turn.
    const facing = new THREE.Vector3().crossVectors(shLine, spineAxis).normalize();
    const basis = (xa, ya, za) => new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xa, ya, za));
    const hipX = X.clone().applyQuaternion(hipRot);
    const hipZ = new THREE.Vector3().crossVectors(hipX, Y).normalize();
    P.pelvis.position.copy(pelvis).addScaledVector(Y, 0.02);
    P.pelvis.quaternion.copy(basis(hipX, Y, hipZ));
    P.pelvis.scale.set(0.175, 0.13, 0.12);
    P.belt.position.copy(pelvis).addScaledVector(Y, 0.1);
    P.belt.quaternion.copy(P.pelvis.quaternion);
    P.belt.scale.set(0.168, 0.035, 0.118);
    const chestUp = new THREE.Vector3().crossVectors(facing, shLine).normalize();
    P.chest.position.copy(pelvis).addScaledVector(spineAxis, 0.3);
    P.chest.quaternion.copy(basis(shLine, chestUp, facing));
    P.chest.scale.set(0.2, 0.27, 0.13);

    P.shoulderL.position.copy(shoulderL); P.shoulderR.position.copy(shoulderR);
    seg(P.upperArmL, shoulderL, armL.joint); seg(P.upperArmR, shoulderR, armR.joint);
    if (P.sleeveL) {
      seg(P.sleeveL, shoulderL, shoulderL.clone().lerp(armL.joint, 0.5));
      seg(P.sleeveR, shoulderR, shoulderR.clone().lerp(armR.joint, 0.5));
    }
    seg(P.forearmL, armL.joint, armL.end); seg(P.forearmR, armR.joint, armR.end);
    P.elbowL.position.copy(armL.joint); P.elbowR.position.copy(armR.joint);
    P.handL.position.copy(armL.end); P.handR.position.copy(armR.end);

    // Head: eyes on the ball, then turns toward the target to watch the shot.
    const headPos = neck.clone().addScaledVector(spineAxis, 0.16).addScaledVector(facing, 0.03);
    seg(P.neck, neck, headPos);
    const look = facing.clone().applyAxisAngle(Y, rad(st.headTurn)).lerp(X, smooth(20, 70, st.headTurn) * 0.5).normalize();
    const headUp = spineAxis.clone().lerp(Y, smooth(0, 70, st.headTurn)).normalize();
    const headX = new THREE.Vector3().crossVectors(headUp, look).normalize();
    const headZ = new THREE.Vector3().crossVectors(headX, headUp).normalize();
    const headQ = basis(headX, headUp, headZ);
    P.head.position.copy(headPos); P.head.quaternion.copy(headQ); P.head.scale.set(0.095, 0.115, 0.105);
    P.hair.position.copy(headPos).addScaledVector(headUp, 0.005).addScaledVector(headZ, -0.01);
    P.hair.quaternion.copy(headQ); P.hair.scale.set(0.1, 0.11, 0.105);
    P.cap.position.copy(headPos).addScaledVector(headUp, 0.035);
    P.cap.quaternion.copy(headQ); P.cap.scale.set(0.1, 0.075, 0.107);
    P.brim.position.copy(headPos).addScaledVector(headUp, 0.035).addScaledVector(headZ, 0.07);
    P.brim.quaternion.copy(headQ).multiply(new THREE.Quaternion().setFromAxisAngle(X, rad(-8)));

    // Club.
    seg(P.shaft, grip, clubHead);
    seg(P.grip, grip.clone().addScaledVector(clubDir, -0.05), grip.clone().addScaledVector(clubDir, 0.22));
    const toe = n.clone().negate(); // heel-to-toe runs out away from the golfer
    const face = new THREE.Vector3().crossVectors(toe, clubDir).normalize();
    P.clubHead.quaternion.copy(basis(toe, clubDir, face));
    P.clubHead.scale.copy(this.headSize);
    P.clubHead.position.copy(clubHead).addScaledVector(toe, this.headSize.x * 0.38).addScaledVector(clubDir, this.headSize.y * 0.3);
  }
}
