// GPU grass: a field of instanced blades that follows the camera. Each blade
// wraps around a square window centered on the camera, so blades stay fixed
// in the world while the camera moves. Height comes from the terrain
// heightfield; blade length and color come from the turf textures.
import * as THREE from 'three';

const vert = /* glsl */ `
  uniform vec2 camXZ;
  uniform float R, time;
  uniform sampler2D heightTex, maskTex, colorTex;
  uniform vec4 bounds;      // minX, minZ, W, D (hole coords; world z = -hole z)
  uniform vec2 grid;        // nx, nz
  attribute vec2 offset;
  attribute vec4 rnd;
  varying vec3 vColor;
  varying float vFog, vT;
  varying vec3 vN;

  float heightAt(vec2 g) {
    vec2 f = fract(g); ivec2 i = ivec2(floor(g));
    float a = texelFetch(heightTex, i, 0).r, b = texelFetch(heightTex, i + ivec2(1, 0), 0).r;
    float c = texelFetch(heightTex, i + ivec2(0, 1), 0).r, d = texelFetch(heightTex, i + ivec2(1, 1), 0).r;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  void main() {
    vec2 wp = camXZ + mod(offset - camXZ + R, 2.0 * R) - R;   // world x, world z
    vec2 hole = vec2(wp.x, -wp.y);
    vec2 uv = (hole - bounds.xy) / bounds.zw;
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    uv = clamp(uv, 0.001, 0.999);
    vec4 m = texture2D(maskTex, uv);
    float dist = length(wp - camXZ);
    float fade = 1.0 - smoothstep(R * 0.55, R * 0.95, dist);
    float len = m.b * 0.16 * (0.6 + 0.8 * rnd.y) * fade * inside;

    float t = position.y;                       // 0 at base, 1 at tip
    vT = t;
    float ang = rnd.x * 6.2832;
    vec2 dir = vec2(cos(ang), sin(ang));
    float w = 0.012 * (1.0 - t * 0.85);
    // wind + natural lean
    float gust = sin(time * 1.7 + wp.x * 0.35 + wp.y * 0.21 + rnd.w * 6.0) * 0.5 + sin(time * 3.1 + wp.x * 0.9) * 0.2;
    vec2 bend = (vec2(0.8, 0.3) * gust * 0.35 + dir.yx * (rnd.z - 0.5) * 0.6) * t * t * len;
    vec3 p = vec3(wp.x + dir.x * position.x * w + bend.x,
                  heightAt(min(uv * grid, grid - 0.001)) + t * len,
                  wp.y + dir.y * position.x * w + bend.y);

    vec3 base = texture2D(colorTex, uv).rgb;
    vColor = base * (0.55 + 0.75 * t) * (0.85 + 0.3 * rnd.y);
    vN = normalize(vec3(-dir.y, 0.6, dir.x));
    vec4 mv = viewMatrix * vec4(p, 1.0);
    vFog = -mv.z;
    gl_Position = projectionMatrix * mv;
    if (len < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0); // no grass here: drop the blade
  }`;

const frag = /* glsl */ `
  uniform vec3 sunDir, sunColor, skyColor, fogColor;
  uniform float fogNear, fogFar;
  varying vec3 vColor, vN;
  varying float vFog, vT;
  void main() {
    float diff = abs(dot(normalize(vN), sunDir)) * 0.7 + 0.3;
    vec3 c = vColor * (sunColor * diff + skyColor * 0.35) + vColor * sunColor * 0.12 * vT; // translucent tips
    c = min(c, vec3(0.6)); // never brighter than sunlit turf (avoids bloom sparkles)
    float f = smoothstep(fogNear, fogFar, vFog);
    gl_FragColor = vec4(mix(c, fogColor, f), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Grass {
  constructor(count, radius) {
    this.R = radius;
    // A blade: 3 segments, tapered (x is -0.5..0.5, y is 0..1).
    const g = new THREE.InstancedBufferGeometry();
    const P = [], I = [];
    const segs = 3;
    for (let s = 0; s <= segs; s++) { const t = s / segs; P.push(-0.5, t, 0, 0.5, t, 0); }
    for (let s = 0; s < segs; s++) { const a = s * 2; I.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setIndex(I);
    const off = new Float32Array(count * 2), rnd = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      off[i * 2] = (Math.random() * 2 - 1) * radius;
      off[i * 2 + 1] = (Math.random() * 2 - 1) * radius;
      for (let k = 0; k < 4; k++) rnd[i * 4 + k] = Math.random();
    }
    g.setAttribute('offset', new THREE.InstancedBufferAttribute(off, 2));
    g.setAttribute('rnd', new THREE.InstancedBufferAttribute(rnd, 4));
    g.instanceCount = count;

    this.uniforms = {
      camXZ: { value: new THREE.Vector2() }, R: { value: radius }, time: { value: 0 },
      heightTex: { value: null }, maskTex: { value: null }, colorTex: { value: null },
      bounds: { value: new THREE.Vector4() }, grid: { value: new THREE.Vector2() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunColor: { value: new THREE.Color(1, 0.95, 0.85) },
      skyColor: { value: new THREE.Color(0.55, 0.65, 0.8) },
      fogColor: { value: new THREE.Color() }, fogNear: { value: 400 }, fogFar: { value: 2000 },
    };
    const mat = new THREE.ShaderMaterial({ vertexShader: vert, fragmentShader: frag, uniforms: this.uniforms, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
  }

  setHole(t) {
    const u = this.uniforms, b = t.bounds;
    u.heightTex.value = t.heightTex;
    u.maskTex.value = t.maskTex;
    u.colorTex.value = t.colorTex;
    u.bounds.value.set(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ);
    u.grid.value.set(t.grid.nx, t.grid.nz);
  }

  update(camera, time, scene, sunDir) {
    const u = this.uniforms;
    u.camXZ.value.set(camera.position.x, camera.position.z);
    u.time.value = time;
    u.sunDir.value.copy(sunDir);
    if (scene.fog) { u.fogColor.value.copy(scene.fog.color); u.fogNear.value = scene.fog.near; u.fogFar.value = scene.fog.far; }
    // Only worth drawing when the camera is near the ground.
    this.mesh.visible = camera.position.y - (this.groundY ?? 0) < 60;
  }
}
