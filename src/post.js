// Post-processing: ambient occlusion, depth of field, bloom, and a
// broadcast-style color grade with vignette.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, vignette: { value: 0.32 }, saturation: { value: 1.12 }, contrast: { value: 1.06 }, warmth: { value: 0.025 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette, saturation, contrast, warmth; varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(l), c, saturation);
      c = (c - 0.5) * contrast + 0.5;
      c += vec3(warmth, warmth * 0.4, -warmth);
      vec2 d = vUv - 0.5;
      c *= 1.0 - vignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = (this.composer = new EffectComposer(renderer, target));
    composer.addPass(new RenderPass(scene, camera));
    if (quality.ao) {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
      this.ao.blendIntensity = 0.8;
      composer.addPass(this.ao);
    }
    if (quality.dof) {
      this.dof = new BokehPass(scene, camera, { focus: 100, aperture: 0.00003, maxblur: 0.004 });
      composer.addPass(this.dof);
    }
    // AO and DOF re-render the scene with an override material, which would
    // drop the grass shader's vertex logic; hide shader-driven objects then.
    this.hidden = [];
    for (const pass of [this.ao, this.dof].filter(Boolean)) {
      const orig = pass.render.bind(pass);
      pass.render = (...args) => {
        const vis = this.hidden.map((o) => o.visible);
        this.hidden.forEach((o) => (o.visible = false));
        orig(...args);
        this.hidden.forEach((o, i) => (o.visible = vis[i]));
      };
    }
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.18, 0.5, 0.92));
    composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    composer.addPass(this.grade);
  }

  setSize(w, h, pr) {
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
  }

  // focusDist: distance from camera to what should be sharp; strength scales the blur.
  render(focusDist, strength = 1) {
    if (this.dof) {
      this.dof.uniforms.focus.value = focusDist;
      this.dof.uniforms.aperture.value = 0.000005 * strength;
      this.dof.enabled = strength > 0;
    }
    this.composer.render();
  }
}
