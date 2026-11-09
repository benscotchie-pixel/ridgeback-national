// Terrain mesh + turf textures for one hole.
import * as THREE from 'three';
import { surfaceAt, heightAt, projectOnPath, vnoise, rng32 } from './course.js';
import { URLS, loadTexture } from './assets.js';

// Turf palette (sRGB 0-255).
const TURF = {
  fairway: [75, 129, 41],
  green: [79, 146, 51],
  fringe: [72, 130, 42],
  tee: [78, 136, 44],
  firstCut: [62, 110, 36],
  rough: [56, 100, 33],
  trees: [52, 72, 34],
  bunker: [236, 222, 188],
  water: [40, 62, 52],
};
// Grass blade length (0-255) per surface; drives the 3D grass layer.
const BLADE = { fairway: 55, green: 0, fringe: 35, tee: 45, firstCut: 95, rough: 150, trees: 110, bunker: 0, water: 0 };

// Mask G channel: which kind of short grass (drives mowing stripes in the shader).
const SHORT = { fairway: 255, tee: 255, green: 200, fringe: 120 };

let shared = null;
function sharedTextures(renderer) {
  if (shared) return shared;
  const aniso = renderer.capabilities.getMaxAnisotropy();
  shared = {
    grassDiff: loadTexture(URLS.grassDiff),
    grassNor: loadTexture(URLS.grassNor),
    sandDiff: loadTexture(URLS.sandDiff),
    sandNor: loadTexture(URLS.sandNor),
  };
  for (const t of Object.values(shared)) t.anisotropy = aniso;
  return shared;
}

export function buildTerrain(h, renderer) {
  const xs = h.path.map((p) => p[0]), zs = h.path.map((p) => p[1]);
  const b = { minX: Math.min(...xs) - 130, maxX: Math.max(...xs) + 130, minZ: -70, maxZ: Math.max(...zs) + 100 };
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;

  // Heightfield on a 1.5 yd grid.
  const nx = Math.ceil(W / 1.5), nz = Math.ceil(D / 1.5);
  const heights = new Float32Array((nx + 1) * (nz + 1));
  const pos = new Float32Array(heights.length * 3);
  const uv = new Float32Array(heights.length * 2);
  let minY = Infinity;
  for (let j = 0, v = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++, v++) {
      const x = b.minX + (i * W) / nx, z = b.minZ + (j * D) / nz;
      const y = heightAt(h, x, z);
      heights[v] = y;
      minY = Math.min(minY, y);
      pos.set([x, y, -z], v * 3);
      uv.set([i / nx, j / nz], v * 2);
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  for (let j = 0, k = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++, k += 6) {
      const a = j * (nx + 1) + i, bb = a + 1, c = a + nx + 1, d = c + 1;
      idx.set([a, bb, c, bb, d, c], k);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const { color, mask } = paintTurf(h, b, renderer);
  const heightTex = new THREE.DataTexture(heights, nx + 1, nz + 1, THREE.RedFormat, THREE.FloatType);
  heightTex.needsUpdate = true;

  const mowDir = new THREE.Vector2(h.green[0], -h.green[1]).normalize();
  const mesh = new THREE.Mesh(geo, terrainMaterial(color, mask, mowDir, renderer));
  mesh.receiveShadow = true;
  return { mesh, bounds: b, minY, colorTex: color, maskTex: mask, heightTex, grid: { nx, nz } };
}

// Paint surfaces into a color texture (~0.35 yd/pixel) and a mask texture:
// R = sand, G = short grass (170/255 alternate mowing stripes), B = blade length.
function paintTurf(h, b, renderer) {
  const W = b.maxX - b.minX, D = b.maxZ - b.minZ;
  const res = Math.max(0.35, Math.max(W, D) / 4096);
  const cw = Math.round(W / res), ch = Math.round(D / res);
  const mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
  const cc = mk(), mc = mk();
  const cctx = cc.getContext('2d'), mctx = mc.getContext('2d');
  const img = cctx.createImageData(cw, ch), mimg = mctx.createImageData(cw, ch);
  const px = img.data, mp = mimg.data;
  const rnd = rng32(h.seed * 7);

  for (let py = 0; py < ch; py++) {
    const z = b.maxZ - (py + 0.5) * res;
    for (let pxi = 0; pxi < cw; pxi++) {
      const x = b.minX + (pxi + 0.5) * res;
      let surf = surfaceAt(h, x, z);
      let c, shade = 1;
      if (surf === 'fairway' || surf === 'tee') {
        const { s } = projectOnPath(h, x, z);
        c = surf === 'tee' ? TURF.tee : TURF.fairway;
      } else if (surf === 'green') {
        c = TURF.green;
      } else if (surf === 'rough' && h.w > 0) {
        const { d, s } = projectOnPath(h, x, z);
        if (d <= h.w / 2 + 2.5 && s >= h.fwFrom - 3 && s <= h.len - h.gr) surf = 'firstCut';
        c = TURF[surf];
      } else if (surf === 'bunker') {
        c = TURF.bunker;
        for (const [cx, cz, r] of h.bunkers) {
          const dd = Math.hypot(x - cx, z - cz);
          if (dd <= r) shade = 1 - Math.max(0, 1 - (r - dd) / 1.4) * 0.22;
        }
      } else {
        c = TURF[surf];
      }
      // Wear/dryness patches in rough and under trees.
      let dry = 0;
      if (surf === 'rough' || surf === 'trees') dry = Math.max(0, vnoise(x / 18 + 50, z / 18)) * 0.25;
      const n = 1 + 0.06 * vnoise(x / 7, z / 7) + 0.035 * vnoise(x / 1.7, z / 1.7) + (rnd() - 0.5) * 0.05;
      const f = shade * n;
      const o = (py * cw + pxi) * 4;
      px[o] = (c[0] + dry * 40) * f; px[o + 1] = (c[1] + dry * 18) * f; px[o + 2] = c[2] * f; px[o + 3] = 255;
      mp[o] = surf === 'bunker' ? 255 : 0;
      mp[o + 1] = SHORT[surf] ?? 0;
      mp[o + 2] = BLADE[surf] ?? 0;
      mp[o + 3] = 255;
    }
  }
  cctx.putImageData(img, 0, 0);
  mctx.putImageData(mimg, 0, 0);
  const color = new THREE.CanvasTexture(cc);
  color.colorSpace = THREE.SRGBColorSpace;
  color.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const mask = new THREE.CanvasTexture(mc);
  mask.anisotropy = color.anisotropy;
  return { color, mask };
}

// MeshStandardMaterial + photo detail textures, detail normals, and
// view-dependent mowing stripes.
function terrainMaterial(color, mask, mowDir, renderer) {
  const T = sharedTextures(renderer);
  const mat = new THREE.MeshStandardMaterial({ map: color, roughness: 0.95, envMapIntensity: 0.55 });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      maskMap: { value: mask },
      grassDiff: { value: T.grassDiff }, grassNor: { value: T.grassNor },
      sandDiff: { value: T.sandDiff }, sandNor: { value: T.sandNor },
      mowDir: { value: mowDir },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        uniform sampler2D maskMap, grassDiff, grassNor, sandDiff, sandNor;
        uniform vec2 mowDir;
        float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        vec4 tm = texture2D(maskMap, vMapUv);
        float sand = tm.r, shortG = step(0.3, tm.g);
        float isFair = step(0.9, tm.g), isGreen = step(0.7, tm.g) * (1.0 - isFair);
        // Mowing stripes, computed per pixel so the edges stay crisp up close.
        vec2 greenDir = vec2(0.7071, 0.7071);
        vec2 sDir = isFair > 0.5 ? mowDir : greenDir;
        float coord = dot(vWPos.xz, sDir) / (isFair > 0.5 ? 11.0 : 3.0);
        float stripeSign = clamp(sin(coord * 3.14159) / (fwidth(coord) * 4.7 + 0.03), -1.0, 1.0) * (isFair + isGreen);
        vec2 gUv = vWPos.xz / 2.2, sUv = vWPos.xz / 3.5;
        float gl = lum(texture2D(grassDiff, gUv).rgb) / max(0.05, lum(textureLod(grassDiff, vec2(0.5), 12.0).rgb));
        float gl2 = lum(texture2D(grassDiff, vWPos.xz / 9.0).rgb) / max(0.05, lum(textureLod(grassDiff, vec2(0.5), 12.0).rgb));
        float sl = lum(texture2D(sandDiff, sUv).rgb) / max(0.05, lum(textureLod(sandDiff, vec2(0.5), 12.0).rgb));
        float grassDetail = mix(1.0, clamp(gl * 0.6 + gl2 * 0.4, 0.7, 1.3), mix(0.45, 0.3, shortG));
        float detail = mix(grassDetail, clamp(sl, 0.75, 1.25), sand);
        diffuseColor.rgb *= detail;
        // Mowing stripes: light or dark depending on which way you look along the mow line.
        vec2 viewXZ = normalize(vWPos.xz - cameraPosition.xz + 1e-4);
        diffuseColor.rgb *= 1.0 + stripeSign * (0.06 + 0.13 * dot(viewXZ, sDir));`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec3 gn = texture2D(grassNor, gUv).xyz * 2.0 - 1.0;
          vec3 sn = texture2D(sandNor, sUv).xyz * 2.0 - 1.0;
          vec2 dn = mix(gn.xy * mix(0.9, 0.35, shortG), sn.xy * 0.7, sand);
          vec3 wn = vec3(dn.x, 0.0, -dn.y);
          normal = normalize(normal + (viewMatrix * vec4(wn, 0.0)).xyz);
        }`);
  };
  return mat;
}
