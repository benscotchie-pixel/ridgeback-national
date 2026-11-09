// Trees built from alpha-tested leaf cards. Card normals point away from the
// crown center, which makes a crown shade like one soft volume instead of
// a pile of flat quads.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { surfaceAt, heightAt, rng32 } from './course.js';
import { URLS, loadTexture } from './assets.js';

const V = (x, y, z) => new THREE.Vector3(x, y, -z);

let mats = null;
function materials() {
  if (mats) return mats;
  const foliage = (map) => {
    const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8, envMapIntensity: 0.6 });
    m.onBeforeCompile = (s) => {
      s.fragmentShader = s.fragmentShader
        .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
        // a little light passing through the leaves
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * 0.06;');
    };
    return m;
  };
  const barkMap = loadTexture(URLS.barkDiff, { srgb: true });
  const barkNor = loadTexture(URLS.barkNor);
  barkMap.repeat.set(2, 4); barkNor.repeat.set(2, 4);
  mats = {
    leaf: foliage(leafTexture()),
    needle: foliage(needleTexture()),
    frond: foliage(frondTexture()),
    bark: new THREE.MeshStandardMaterial({ map: barkMap, normalMap: barkNor, roughness: 0.95, color: 0xb8a898 }),
  };
  for (const m of Object.values(mats)) m.userData.shared = true;
  return mats;
}

function leafTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng32(42);
  for (let i = 0; i < 420; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7) * S * 0.44;
    const x = S / 2 + Math.cos(a) * d, y = S / 2 + Math.sin(a) * d;
    const L = 12 + r() * 14;
    g.save();
    g.translate(x, y);
    g.rotate(r() * Math.PI * 2);
    const light = 22 + r() * 22 - (d / S) * 10;
    g.fillStyle = `hsl(${88 + r() * 30}, ${45 + r() * 20}%, ${light}%)`;
    g.beginPath();
    g.ellipse(0, 0, L, L * 0.45, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = `hsla(90, 40%, ${light + 12}%, 0.5)`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(-L, 0); g.lineTo(L, 0); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A palm frond: a central stem running bottom to top with leaflets angled toward the tip.
function frondTexture() {
  const Wd = 128, Ht = 512, c = document.createElement('canvas');
  c.width = Wd; c.height = Ht;
  const g = c.getContext('2d');
  const r = rng32(11);
  for (let i = 0; i < 90; i++) {
    const t = i / 90;                      // 0 at base (bottom), 1 at tip (top)
    const y = Ht * (1 - t);
    const len = (Wd / 2 - 4) * Math.sin(Math.PI * (0.15 + 0.85 * t)) * (0.85 + r() * 0.15);
    g.strokeStyle = `hsl(${92 + r() * 22}, ${38 + r() * 18}%, ${20 + r() * 14}%)`;
    g.lineWidth = 3 + r() * 1.5;
    for (const side of [-1, 1]) {
      g.beginPath(); g.moveTo(Wd / 2, y);
      g.quadraticCurveTo(Wd / 2 + side * len * 0.6, y - 10, Wd / 2 + side * len, y - 26 - r() * 8);
      g.stroke();
    }
  }
  g.strokeStyle = '#6b6a3a'; g.lineWidth = 4;
  g.beginPath(); g.moveTo(Wd / 2, Ht); g.lineTo(Wd / 2, 4); g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function needleTexture() {
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng32(7);
  // Branch runs left (trunk) to right (tip) along the middle.
  g.strokeStyle = '#4a3626';
  g.lineWidth = 6;
  g.beginPath(); g.moveTo(0, S / 2); g.lineTo(S * 0.95, S / 2); g.stroke();
  for (let i = 0; i < 1600; i++) {
    const x = r() * S * 0.95;
    const spread = (1 - x / S) * S * 0.42 + 20;
    const y = S / 2 + (r() - 0.5) * 2 * spread * 0.4;
    const len = 18 + r() * 26;
    const ang = (y < S / 2 ? -1 : 1) * (0.5 + r() * 0.7);
    g.strokeStyle = `hsl(${120 + r() * 25}, ${35 + r() * 20}%, ${14 + r() * 16}%)`;
    g.lineWidth = 2 + r() * 1.5;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// One quad (2 tris) from 4 corners, with normals pointing away from `center`.
function quad(corners, center, nBias = new THREE.Vector3()) {
  const g = new THREE.BufferGeometry();
  const p = [], n = [];
  for (const c of corners) {
    p.push(c.x, c.y, c.z);
    const nn = c.clone().sub(center).normalize().add(nBias).normalize();
    n.push(nn.x, nn.y, nn.z);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

function oakCrown(seed) {
  const r = rng32(seed);
  const center = new THREE.Vector3(0, 10, 0);
  const parts = [];
  for (let b = 0; b < 7; b++) {
    const bc = new THREE.Vector3((r() - 0.5) * 6, 8 + r() * 5, (r() - 0.5) * 6);
    if (b === 0) bc.set(0, 11.5, 0);
    for (let i = 0; i < 12; i++) {
      const c = bc.clone().add(new THREE.Vector3((r() - 0.5) * 3.6, (r() - 0.5) * 3, (r() - 0.5) * 3.6));
      const s = 2.4 + r() * 1.4;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 6.28, r() * 6.28, r() * 6.28));
      const ax = new THREE.Vector3(s, 0, 0).applyQuaternion(q), ay = new THREE.Vector3(0, s, 0).applyQuaternion(q);
      parts.push(quad([
        c.clone().sub(ax).sub(ay), c.clone().add(ax).sub(ay), c.clone().add(ax).add(ay), c.clone().sub(ax).add(ay),
      ], center, new THREE.Vector3(0, 0.25, 0)));
    }
  }
  return mergeGeometries(parts);
}

function pineCrown(seed) {
  const r = rng32(seed);
  const parts = [];
  const tiers = 9;
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = 3.5 + t * 12;
    const len = 4.6 * (1 - t) + 0.8;
    const center = new THREE.Vector3(0, y + 1.5, 0);
    const n = 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + k * 0.7 + r() * 0.4;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      const w = len * 0.55;
      const base = new THREE.Vector3(0, y, 0);
      const tip = base.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, -len * 0.3, 0));
      // horizontal card + a tilted one to thicken the silhouette
      parts.push(quad([base.clone().addScaledVector(side, -w * 0.3), tip.clone().addScaledVector(side, -w),
        tip.clone().addScaledVector(side, w), base.clone().addScaledVector(side, w * 0.3)], center, new THREE.Vector3(0, 0.6, 0)));
      const upv = new THREE.Vector3(0, w * 0.7, 0);
      parts.push(quad([base.clone().sub(upv.clone().multiplyScalar(0.3)), tip.clone().sub(upv),
        tip.clone().add(upv), base.clone().add(upv.clone().multiplyScalar(0.3))], center, new THREE.Vector3(0, 0.6, 0)));
    }
  }
  return mergeGeometries(parts);
}

// Palm crown: fronds arching out and drooping from the top of the trunk (origin).
function palmCrown(seed) {
  const r = rng32(seed);
  const parts = [];
  const n = 15;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.3;
    const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const lift = 0.4 + r() * 1.4 - (i % 3 === 0 ? 1.2 : 0);
    const pts = [
      new THREE.Vector3(0, 0, 0),
      dir.clone().multiplyScalar(2.6).add(new THREE.Vector3(0, lift, 0)),
      dir.clone().multiplyScalar(4.8 + r()).add(new THREE.Vector3(0, lift - 2.2, 0)),
    ];
    const widths = [0.35, 1.25, 0.25];
    const g = new THREE.BufferGeometry();
    const P = [], N = [], U = [];
    pts.forEach((p, k) => {
      for (const sgn of [-1, 1]) {
        const q = p.clone().addScaledVector(side, sgn * widths[k]);
        P.push(q.x, q.y, q.z);
        const nn = dir.clone().multiplyScalar(0.4).add(new THREE.Vector3(0, 1, 0)).normalize();
        N.push(nn.x, nn.y, nn.z);
        U.push(sgn < 0 ? 0 : 1, k / 2);
      }
    });
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    g.setIndex([0, 1, 3, 0, 3, 2, 2, 3, 5, 2, 5, 4]);
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function buildTrees(h, bounds, quality, groundY = -10) {
  const M = materials();
  const r = rng32(h.seed * 101);
  const pines = [], oaks = [];
  for (const [cx, cz, rad] of h.trees) {
    const n = Math.round((rad * rad) / 36);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const px = cx + Math.cos(a) * d, pz = cz + Math.sin(a) * d;
      const sf = surfaceAt(h, px, pz);
      if (sf !== 'trees' && sf !== 'rough') continue; // never plant on fairways, greens, sand or water
      (r() < 0.65 ? oaks : pines).push([px, pz]);
    }
  }
  // Florida touch: palms ringing the ponds and scattered along the tree lines.
  const palms = [];
  for (const [cx, cz, rx, rz] of h.water) {
    const n = Math.round((rx + rz) / 6);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, e = 1.25 + r() * 0.5;
      const px = cx + Math.cos(a) * rx * e, pz = cz + Math.sin(a) * rz * e;
      const sf = surfaceAt(h, px, pz);
      if (sf === 'rough' || sf === 'trees') palms.push([px, pz]);
    }
  }
  const b = bounds;
  const step = quality.grass ? 6.5 : 7.5;
  for (let z = b.minZ; z < b.maxZ; z += step) {
    for (let x = b.minX; x < b.maxX; x += step) {
      const px = x + (r() - 0.5) * step, pz = z + (r() - 0.5) * step;
      if (r() < 0.7 && surfaceAt(h, px, pz) === 'trees') {
        const roll = r();
        (roll < 0.1 ? palms : roll < 0.37 ? pines : oaks).push([px, pz]);
      }
    }
  }

  const group = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.3, 0.65, 12, 7, 1, true).translate(0, 6, 0);
  // Use a few crown variants so trees don't look copy-pasted.
  const add = (spots, crowns, hue, light) => {
    const per = crowns.map(() => []);
    spots.forEach((s, i) => per[i % crowns.length].push(s));
    const allSpots = [];
    per.forEach((list, v) => {
      const leaves = new THREE.InstancedMesh(crowns[v], crowns[v].userData.mat, list.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), c = new THREE.Color();
      list.forEach(([x, z], i) => {
        const k = 1.05 + r() * 0.75;
        sc.set(k, k * (0.9 + r() * 0.3), k);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
        m.compose(V(x, heightAt(h, x, z) - 0.3, z), q, sc);
        leaves.setMatrixAt(i, m);
        leaves.setColorAt(i, c.setHSL(hue + (r() - 0.5) * 0.06, 0.25 + r() * 0.3, light + r() * 0.12));
        allSpots.push(m.clone());
      });
      leaves.castShadow = leaves.receiveShadow = true;
      group.add(leaves);
    });
    const trunks = new THREE.InstancedMesh(trunkGeo, M.bark, allSpots.length);
    allSpots.forEach((m, i) => trunks.setMatrixAt(i, m));
    trunks.castShadow = true;
    group.add(trunks);
  };
  const oakVariants = [1, 2, 3].map((s) => Object.assign(oakCrown(s * 97), { userData: { mat: M.leaf } }));
  const pineVariants = [1, 2].map((s) => Object.assign(pineCrown(s * 31), { userData: { mat: M.needle } }));
  add(oaks, oakVariants, 0.22, 0.72);
  add(pines, pineVariants, 0.3, 0.7);

  // Palms: thin leaning trunks with a frond crown on top.
  if (palms.length) {
    const palmTrunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1, 8, 1, true).translate(0, 0.5, 0);
    const crownGeo = palmCrown(5);
    const trunks = new THREE.InstancedMesh(palmTrunkGeo, M.bark, palms.length);
    const crowns = new THREE.InstancedMesh(crownGeo, M.frond, palms.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), c = new THREE.Color();
    palms.forEach(([x, z], i) => {
      const H = 8 + r() * 6;
      const lean = new THREE.Euler((r() - 0.5) * 0.25, 0, (r() - 0.5) * 0.25);
      q.setFromEuler(lean);
      const base = V(x, heightAt(h, x, z) - 0.2, z);
      m.compose(base, q, new THREE.Vector3(1, H, 1));
      trunks.setMatrixAt(i, m);
      const top = base.clone().add(new THREE.Vector3(0, H, 0).applyQuaternion(q));
      const k = 0.85 + r() * 0.35;
      m.compose(top, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28), new THREE.Vector3(k, k, k));
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, c.setHSL(0.2 + r() * 0.05, 0.25 + r() * 0.2, 0.75 + r() * 0.1));
    });
    trunks.castShadow = crowns.castShadow = true;
    group.add(trunks, crowns);
  }

  // Distant tree line beyond the hole so aerial views have a horizon.
  const far = [];
  for (let i = 0; i < 2600; i++) {
    const x = b.minX - 900 + r() * (b.maxX - b.minX + 1800);
    const z = b.minZ - 700 + r() * (b.maxZ - b.minZ + 1600);
    if (x > b.minX - 4 && x < b.maxX + 4 && z > b.minZ - 4 && z < b.maxZ + 4) continue;
    far.push([x, z]);
  }
  const farMesh = new THREE.InstancedMesh(oakVariants[0], M.leaf, far.length);
  const m2 = new THREE.Matrix4(), q2 = new THREE.Quaternion(), c2 = new THREE.Color();
  far.forEach(([x, z], i) => {
    const k = 1.6 + r() * 1.4;
    q2.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * 6.28);
    m2.compose(V(x, groundY - 1, z), q2, new THREE.Vector3(k, k * (0.9 + r() * 0.3), k));
    farMesh.setMatrixAt(i, m2);
    farMesh.setColorAt(i, c2.setHSL(0.24 + (r() - 0.5) * 0.06, 0.3, 0.6 + r() * 0.1));
  });
  group.add(farMesh);
  return group;
}
