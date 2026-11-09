// Quality presets and bundled assets (CC0 textures and sky from Poly Haven,
// water normals from the three.js examples), served from ./assets.
import * as THREE from 'three';

const PRESETS = {
  ultra: { grass: 320000, grassRadius: 34, post: true, dof: true, ao: false, water: 'reflect', shadow: 4096, pixelRatio: 2, hdri: '2k' },
  high: { grass: 180000, grassRadius: 28, post: true, dof: true, ao: false, water: 'reflect', shadow: 4096, pixelRatio: 1.5, hdri: '2k' },
  medium: { grass: 0, grassRadius: 0, post: true, dof: false, ao: false, water: 'reflect', shadow: 2048, pixelRatio: 1.25, hdri: '2k' },
  low: { grass: 0, grassRadius: 0, post: false, dof: false, ao: false, water: 'simple', shadow: 2048, pixelRatio: 1, hdri: '2k' },
};

export const QUALITY_NAMES = Object.keys(PRESETS);

export function getQualityName() {
  const q = new URLSearchParams(location.search).get('quality'); // ?quality=ultra overrides the saved choice
  if (PRESETS[q]) return q;
  try { return PRESETS[localStorage.getItem('quality')] ? localStorage.getItem('quality') : 'high'; } catch { return 'high'; }
}
export function setQualityName(q) {
  try { localStorage.setItem('quality', q); } catch {}
}
export const QUALITY = PRESETS[getQualityName()];

const A = new URL('../assets/', import.meta.url).href; // resolves from this module, not the page

export const URLS = {
  skyRGB: `${A}sky_rgb.png`,
  skyExp: `${A}sky_exp.png`,
  grassDiff: `${A}sparse_grass_diff_1k.jpg`,
  grassNor: `${A}sparse_grass_nor_gl_1k.jpg`,
  sandDiff: `${A}sand_01_diff_1k.jpg`,
  sandNor: `${A}sand_01_nor_gl_1k.jpg`,
  barkDiff: `${A}bark_brown_02_diff_1k.jpg`,
  barkNor: `${A}bark_brown_02_nor_gl_1k.jpg`,
  waterNormals: `${A}waternormals.jpg`,
};

const texLoader = new THREE.TextureLoader();

// Returns a texture immediately; it fills in when the download finishes.
export function loadTexture(url, { srgb = false, repeat = true } = {}) {
  const t = texLoader.load(url, undefined, undefined, () => console.warn('texture failed', url));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// The HDR sky ships as two lossless PNGs (RGBE mantissas + exponents), since
// artifact hosting doesn't serve .hdr files. Rebuild the HDR pixels here.
// Decode an 8-bit, non-interlaced grayscale/RGB/RGBA PNG straight from its bytes.
// The sky is decoded this way instead of through a canvas because Safari adds
// anti-fingerprinting noise to canvas pixel reads, which turned the sky to static.
async function decodePNG(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const dv = new DataView(buf.buffer);
  let W = 0, H = 0, channels = 0;
  const idat = [];
  for (let p = 8; p < buf.length;) {
    const len = dv.getUint32(p), type = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    if (type === 'IHDR') { W = dv.getUint32(p + 8); H = dv.getUint32(p + 12); channels = { 0: 1, 2: 3, 6: 4 }[buf[p + 17]]; }
    else if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = W * channels, data = new Uint8Array(stride * H);
  for (let y = 0; y < H; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride, prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? data[row + x - channels] : 0, b = y ? data[prev + x] : 0, c = y && x >= channels ? data[prev + x - channels] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      data[row + x] = v & 255;
    }
  }
  return { width: W, height: H, channels, data };
}

export async function loadHDRI() {
  const [rgb, exp] = await Promise.all([decodePNG(URLS.skyRGB), decodePNG(URLS.skyExp)]);
  const { width: W, height: H } = rgb;
  const out = new Uint16Array(W * H * 4);
  const one = THREE.DataUtils.toHalfFloat(1);
  for (let i = 0; i < W * H; i++) {
    const e = exp.data[i * exp.channels];
    const scale = e ? Math.pow(2, e - 136) : 0; // RGBE: value = mantissa * 2^(e - 128) / 256
    const j = i * rgb.channels;
    out[i * 4] = THREE.DataUtils.toHalfFloat(rgb.data[j] * scale);
    out[i * 4 + 1] = THREE.DataUtils.toHalfFloat(rgb.data[j + 1] * scale);
    out[i * 4 + 2] = THREE.DataUtils.toHalfFloat(rgb.data[j + 2] * scale);
    out[i * 4 + 3] = one;
  }
  const tex = new THREE.DataTexture(out, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.colorSpace = THREE.LinearSRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.flipY = true;
  tex.needsUpdate = true;
  return tex;
}
