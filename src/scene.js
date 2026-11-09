// three.js rendering of one hole at a time.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { heightAt, pointAt, waterLevel } from './course.js';
import { QUALITY, URLS, loadTexture, loadHDRI } from './assets.js';
import { buildTerrain } from './terrain.js';
import { buildTrees } from './trees.js';
import { Grass } from './grass.js';
import { Post } from './post.js';

// Hole coords (x right, z toward green) -> world (x, y, -z).
const V = (x, y, z) => new THREE.Vector3(x, y, -z);
const TRACE_COLORS = { 0: 0x3fc1ff, 20: 0xffa23a };

export class HoleScene {
  constructor(canvas) {
    this.canvas = canvas;
    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !QUALITY.post, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, QUALITY.pixelRatio));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.62;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xb9cfe0, 500, 2600);

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.12, 6000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.focusDist = 100;

    // Procedural sky until the photographed sky (HDRI) arrives.
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(52), THREE.MathUtils.degToRad(-140));
    const sky = new Sky();
    sky.scale.setScalar(5000);
    const u = sky.material.uniforms;
    u.turbidity.value = 3; u.rayleigh.value = 2.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;
    this.scene.add(sky);
    this.pmrem = new THREE.PMREMGenerator(r);
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    this.scene.environment = this.pmrem.fromScene(envScene).texture;

    this.hemi = new THREE.HemisphereLight(0xdfeeff, 0x3d5a28, 0.25);
    this.sun = new THREE.DirectionalLight(0xfff0d6, 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(QUALITY.shadow, QUALITY.shadow);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.5;
    this.scene.add(this.hemi, this.sun, this.sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: 0x23401a, roughness: 1 })
    );
    ground.receiveShadow = true;
    this.ground = ground;
    this.scene.add(ground);

    this.waterNormals = loadTexture(URLS.waterNormals);
    this.waters = [];
    if (QUALITY.grass) {
      this.grass = new Grass(QUALITY.grass, QUALITY.grassRadius);
      this.scene.add(this.grass.mesh);
    }
    if (QUALITY.post) this.post = new Post(r, this.scene, this.camera, QUALITY);
    this.loadSky();

    // Skip rendering while the canvas is scrolled out of view.
    this.visible = true;
    new IntersectionObserver(([e]) => (this.visible = e.isIntersecting)).observe(canvas);
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
    this.resize();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  async loadSky() {
    try {
      const hdr = await loadHDRI(QUALITY.hdri);
      hdr.mapping = THREE.EquirectangularReflectionMapping;
      this.scene.remove(this.sky);
      this.scene.background = hdr;
      this.scene.environment = this.pmrem.fromEquirectangular(hdr).texture;
      const { sunDir, horizon } = analyzeHDR(hdr);
      this.sunDir.copy(sunDir);
      this.scene.fog.color.copy(horizon);
      if (this.hole) this.placeSun();
      this.waters.forEach((w) => w.material.uniforms?.sunDirection?.value.copy(this.sunDir));
      this.skyLoaded = true;
    } catch (e) {
      console.warn('HDRI sky failed to load; keeping procedural sky', e);
    }
  }

  // Override the sun (e.g. low golden-hour light for photos).
  setSunAngles(elevDeg, azimDeg, color = 0xfff0d6, intensity = 3.4) {
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevDeg), THREE.MathUtils.degToRad(azimDeg));
    this.sun.color.set(color);
    this.sun.intensity = intensity;
    if (this.hole) this.placeSun();
    this.waters.forEach((w) => w.material.uniforms?.sunDirection?.value.copy(this.sunDir));
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
    this.renderer.setSize(w, h, false);
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  show(h) {
    this.hole = h;
    this.fly = null;
    this.controls.enabled = true;
    if (this.group) this.dispose(this.group);
    this.terrain?.maskTex.dispose();
    this.terrain?.heightTex.dispose();
    this.group = new THREE.Group();
    this.traceGroup = null;
    this.scene.add(this.group);

    const t = (this.terrain = buildTerrain(h, this.renderer));
    this.bounds = t.bounds;
    this.ground.position.y = t.minY - 5;
    this.group.add(t.mesh);
    this.buildWater(h);
    this.group.add(buildTrees(h, t.bounds, QUALITY, t.minY - 5));
    this.buildFlagAndTees(h);
    if (this.grass) { this.grass.setHole(t); this.grass.groundY = heightAt(h, 0, 0); }
    if (this.post) this.post.hidden = [this.grass?.mesh, ...this.waters].filter(Boolean);
    this.placeSun();
    this.setView('tee');
  }

  // Shared materials (trees) are flagged userData.shared and survive hole changes.
  dispose(obj) {
    obj.traverse((o) => {
      o.geometry?.dispose();
      const m = o.material;
      if (m && !m.userData?.shared) { m.map?.dispose(); m.dispose?.(); }
    });
    obj.parent?.remove(obj);
  }

  buildWater(h) {
    this.waters = [];
    for (const w of h.water) {
      const geo = new THREE.CircleGeometry(1, 72).scale(w[2], w[3], 1);
      let m;
      if (QUALITY.water === 'reflect') {
        m = new Water(geo, {
          textureWidth: 1024, textureHeight: 1024, waterNormals: this.waterNormals,
          sunDirection: this.sunDir.clone(), sunColor: 0xfff4e0, waterColor: 0x08303a,
          distortionScale: 0.9, fog: true,
        });
        m.material.uniforms.size.value = 3;
      } else {
        m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
          color: 0x0e3a4a, roughness: 0.08, metalness: 0.1, clearcoat: 0.6, normalMap: this.waterNormals,
          normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.6,
        }));
        m.material.userData.shared = false;
      }
      m.rotation.x = -Math.PI / 2;
      m.position.copy(V(w[0], waterLevel(h, w), w[1]));
      this.waters.push(m);
      this.group.add(m);
    }
  }

  buildFlagAndTees(h) {
    const [px, pz] = h.pin;
    const y = heightAt(h, px, pz);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xf4f4f4, roughness: 0.4 }));
    pole.position.copy(V(px, y + 1.3, pz));
    pole.castShadow = true;
    const flagGeo = new THREE.PlaneGeometry(0.9, 0.6, 12, 4).translate(0.45, 0, 0);
    this.flagBase = flagGeo.attributes.position.array.slice();
    const flag = new THREE.Mesh(flagGeo, new THREE.MeshStandardMaterial({ color: 0xd8261c, side: THREE.DoubleSide, roughness: 0.7 }));
    flag.position.copy(V(px, y + 2.28, pz));
    flag.castShadow = true;
    this.flag = flag;
    const cup = new THREE.Mesh(new THREE.CircleGeometry(0.06, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0a0a0a }));
    cup.position.copy(V(px, y + 0.02, pz));
    this.group.add(pole, flag, cup);

    const ty = heightAt(h, 0, 0);
    for (const x of [-4, 4]) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), new THREE.MeshStandardMaterial({ color: 0x1f4fd1, roughness: 0.35 }));
      m.position.copy(V(x * 0.8, ty + 0.06, 1.5));
      m.castShadow = true;
      this.group.add(m);
    }
  }

  placeSun() {
    const b = this.bounds;
    const center = V((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
    const span = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2 + 40;
    this.sun.target.position.copy(center);
    this.sun.position.copy(center).addScaledVector(this.sunDir, 900);
    Object.assign(this.sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, near: 50, far: 2200 });
    this.sun.shadow.camera.updateProjectionMatrix();
  }

  // Draw simulated ball flights. byH: { handicap: [ [shot, ...], ... ] }
  setTraces(byH) {
    if (this.traceGroup) this.dispose(this.traceGroup);
    this.traceGroup = new THREE.Group();
    this.group.add(this.traceGroup);
    const h = this.hole;
    for (const [H, rounds] of Object.entries(byH)) {
      const seg = [], dots = [];
      for (const shots of rounds) {
        for (const sh of shots) {
          if (sh.putt) continue;
          const end = sh.splash ?? sh.to;
          const y0 = heightAt(h, ...sh.from), y1 = heightAt(h, ...end);
          const horiz = Math.hypot(end[0] - sh.from[0], end[1] - sh.from[1]);
          const apex = horiz > 60 ? Math.min(38, 10 + horiz * 0.085) : horiz * 0.25;
          const n = Math.max(4, Math.round(horiz / 8));
          let prev = null;
          for (let i = 0; i <= n; i++) {
            const s = i / n;
            const p = [sh.from[0] + (end[0] - sh.from[0]) * s, y0 + (y1 - y0) * s + apex * Math.sin(Math.PI * Math.pow(s, 1.25)) + 0.2, -(sh.from[1] + (end[1] - sh.from[1]) * s)];
            if (prev) seg.push(...prev, ...p);
            prev = p;
          }
          dots.push(end[0], y1 + 0.3, -end[1]);
        }
      }
      const color = TRACE_COLORS[H] ?? 0xffffff;
      const lg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
      this.traceGroup.add(new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false })));
      const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
      this.traceGroup.add(new THREE.Points(pg, new THREE.PointsMaterial({ color, size: 1.4, toneMapped: false })));
    }
  }

  setView(name) {
    const h = this.hole;
    const hy = (p) => heightAt(h, p[0], p[1]);
    if (name === 'tee') {
      const look = pointAt(h, Math.min(250, h.len));
      const d = Math.hypot(...look);
      this.place([(-look[0] / d) * 14, (-look[1] / d) * 14], hy([0, 0]) + (h.par === 3 ? 5 : 3.2), look, hy(look) + 2);
    } else if (name === 'approach') {
      const p = pointAt(h, Math.max(h.len * 0.4, h.len - 150));
      this.place(p, hy(p) + 6, h.green, hy(h.green));
    } else if (name === 'green') {
      const p = pointAt(h, h.len - 30);
      this.place(p, hy(p) + 3.5, h.pin, hy(h.pin));
    } else {
      const b = this.bounds;
      const c = [(b.minX + b.maxX) / 2, h.len / 2];
      this.place([c[0], c[1] - h.len * 0.75], h.len * 1.15, c, hy(c));
    }
  }

  place(eye, eyeY, look, lookY) {
    this.camera.position.copy(V(eye[0], eyeY, eye[1]));
    this.controls.target.copy(V(look[0], lookY, look[1]));
    this.controls.update();
  }

  flyover() {
    this.fly = { t0: performance.now(), dur: Math.max(6000, this.hole.len * 16) };
    this.controls.enabled = false;
  }

  frame(now) {
    if (!this.visible && !this.director?.active) return;
    const time = now / 1000;
    const h = this.hole;
    if (this.director?.active) {
      this.director.update(now);
    } else if (this.fly && h) {
      const t = Math.min(1, (now - this.fly.t0) / this.fly.dur);
      const e = t * t * (3 - 2 * t);
      const s = e * (h.len - 40);
      const a = pointAt(h, s - 45), b = pointAt(h, Math.min(h.len, s + 80));
      this.camera.position.copy(V(a[0], heightAt(h, ...a) + 22 - 10 * e, a[1]));
      this.controls.target.copy(V(b[0], heightAt(h, ...b), b[1]));
      this.camera.lookAt(this.controls.target);
      this.focusDist = this.camera.position.distanceTo(this.controls.target);
      if (t >= 1) { this.fly = null; this.controls.enabled = true; this.setView('green'); this.onFlyEnd?.(); }
    } else {
      this.controls.update();
      this.focusDist = this.camera.position.distanceTo(this.controls.target);
    }

    // Flag ripple and water motion.
    if (this.flag) {
      const p = this.flag.geometry.attributes.position, base = this.flagBase;
      for (let i = 0; i < p.count; i++) {
        const x = base[i * 3];
        p.setZ(i, Math.sin(x * 6 - time * 7) * 0.06 * x + Math.sin(time * 2.3) * 0.05 * x);
      }
      p.needsUpdate = true;
      this.flag.rotation.y = 0.6 + Math.sin(time * 0.6) * 0.15;
    }
    for (const w of this.waters) if (w.material.uniforms?.time) w.material.uniforms.time.value = time * 0.6;
    this.waterNormals.offset.set(time * 0.01, time * 0.007);
    this.grass?.update(this.camera, time, this.scene, this.sunDir);

    if (!h) return;
    const above = this.camera.position.y - heightAt(h, this.camera.position.x, -this.camera.position.z);
    if (this.post) this.post.render(this.focusDist, above < 40 ? 1 : 0);
    else this.renderer.render(this.scene, this.camera);
  }
}

// Find the sun (brightest pixel) and the horizon color in an equirect HDR.
function analyzeHDR(tex) {
  const { data, width, height } = tex.image;
  const half = tex.type === THREE.HalfFloatType;
  const get = (i) => (half ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i]);
  const ch = data.length / (width * height);
  let best = -1, bx = 0, by = 0;
  for (let y = 0; y < height / 2; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * ch;
      const l = get(i) * 0.2126 + get(i + 1) * 0.7152 + get(i + 2) * 0.0722;
      if (l > best) { best = l; bx = x; by = y; }
    }
  }
  // flipY: row 0 is the top of the sky.
  const v = 1 - (by + 0.5) / height, u = (bx + 0.5) / width;
  const el = (v - 0.5) * Math.PI, az = (u - 0.5) * 2 * Math.PI;
  const sunDir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
  if (sunDir.y < 0.25) { sunDir.y = 0.25; sunDir.normalize(); }
  const row = Math.floor(height * 0.47);
  const c = [0, 0, 0];
  for (let x = 0; x < width; x += 4) {
    const i = (row * width + x) * ch;
    c[0] += get(i); c[1] += get(i + 1); c[2] += get(i + 2);
  }
  const n = width / 4;
  return { sunDir, horizon: new THREE.Color(c[0] / n, c[1] / n, c[2] / n) };
}
