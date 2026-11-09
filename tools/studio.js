// Dev-only photo studio: renders stills of the 3D course for the website.
// Driven from the console: await studio.shoot({...}).
try { localStorage.setItem('quality', 'ultra'); } catch {}
const THREE = await import('three');
const { HOLES, heightAt, pointAt } = await import('../src/course.js');
const { HoleScene } = await import('../src/scene.js');

const stage = document.getElementById('stage');
const view = new HoleScene(document.getElementById('view'));
view.renderer.setAnimationLoop(null);
const V = (x, y, z) => new THREE.Vector3(x, y, -z);
let current = -1;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Photographic look: brighter exposure, softer haze, muted foliage, warmer grade.
function applyLook() {
  view.renderer.toneMappingExposure = 0.95;
  const g = view.post.grade.uniforms;
  g.saturation.value = 0.92; g.contrast.value = 1.12; g.warmth.value = 0.035; g.vignette.value = 0.2;
  view.hemi.intensity = 0.15;
  view.camera.far = 20000; view.camera.near = 0.5; view.camera.updateProjectionMatrix();
  view.scene.fog.near = 500; view.scene.fog.far = 14000;
  view.scene.fog.color.set(0xa7b6b8);
  view.ground.material.color.set(0x2a3f22);
  const col = new THREE.Color(), hsl = {};
  view.group.traverse((o) => {
    if (!(o.isInstancedMesh && o.instanceColor && o.material.alphaTest > 0)) return;
    for (let i = 0; i < o.count; i++) {
      o.getColorAt(i, col); col.getHSL(hsl);
      o.setColorAt(i, col.setHSL(hsl.h + 0.02, hsl.s * 0.55, hsl.l * 0.72));
    }
    o.instanceColor.needsUpdate = true;
  });
}

async function setHole(k) {
  if (k === current) return;
  view.show(HOLES[k]);
  current = k;
  applyLook();
  await wait(300);
}

// eye/look in hole coords: [x, z]; heights above the ground at that point.
async function shoot({ hole, eye, eyeUp, look, lookUp = 0, fov = 40, sun, w = 1600, h = 900, name, quality = 0.86, dof = 0 }) {
  await setHole(hole);
  stage.style.width = w + 'px'; stage.style.height = h + 'px';
  view.renderer.setPixelRatio(1);
  view.resize();
  const H = HOLES[hole];
  if (sun) view.setSunAngles(sun.elev, sun.azim, sun.color ?? 0xffe2b8, sun.intensity ?? 3.2);
  const cam = view.camera;
  cam.fov = fov; cam.updateProjectionMatrix();
  cam.position.copy(V(eye[0], heightAt(H, eye[0], eye[1]) + eyeUp, eye[1]));
  view.controls.target.copy(V(look[0], heightAt(H, look[0], look[1]) + lookUp, look[1]));
  cam.lookAt(view.controls.target);
  view.focusDist = cam.position.distanceTo(view.controls.target);
  const t = performance.now();
  for (let i = 0; i < 3; i++) {
    view.grass?.update(cam, t / 1000, view.scene, view.sunDir);
    if (view.post) view.post.render(view.focusDist, dof); else view.renderer.render(view.scene, cam);
  }
  const url = view.renderer.domElement.toDataURL('image/jpeg', quality);
  if (name) {
    const blob = await (await fetch(url)).blob();
    await fetch('/save/' + name, { method: 'POST', body: blob });
    return { name, kb: Math.round(blob.size / 1024) };
  }
  return { preview: true };
}

// Handy framings.
const frame = {
  // Drone shot from behind and above the tee looking down the hole.
  aerialTee: (k, { back = 40, side = 0, up = 55, at = 0.62 } = {}) => {
    const h = HOLES[k], a = pointAt(h, at * h.len), d = Math.hypot(a[0], a[1]);
    const ux = a[0] / d, uz = a[1] / d;
    return { hole: k, eye: [-ux * back + uz * side, -uz * back - ux * side], eyeUp: up, look: a };
  },
  // Drone shot hovering beside the approach, looking at the green.
  aerialGreen: (k, { s = 0.6, side = 35, up = 40 } = {}) => {
    const h = HOLES[k], p = pointAt(h, s * h.len), q = pointAt(h, s * h.len + 5);
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    return { hole: k, eye: [p[0] + (dz / L) * side, p[1] - (dx / L) * side], eyeUp: up, look: h.green };
  },
  // Low shot from the fairway or tee toward the flag.
  ground: (k, { s = 0.7, up = 1.7, side = 0 } = {}) => {
    const h = HOLES[k], p = pointAt(h, s * h.len), q = pointAt(h, s * h.len + 5);
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz);
    return { hole: k, eye: [p[0] + (dz / L) * side, p[1] - (dx / L) * side], eyeUp: up, look: h.pin, lookUp: 1 };
  },
};

window.studio = { shoot, frame, view, HOLES, ready: false };
await wait(2500);
window.studio.ready = true;
