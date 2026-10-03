/**
 * Compresses the game's textures to KTX2 (Basis Universal), so phones keep
 * them compressed on the GPU (ASTC, ETC2 or BC) instead of four bytes a texel
 * (roadmap 0.2.5: texture memory under the 400 MB mobile budget).
 *
 *   pnpm textures:ktx2 [--only surfaces|models] [model names…]
 *
 * - Colour maps (albedo, base colour, emissive): ETC1S, sRGB.
 * - Normal maps: ETC1S in normal-map mode. On rough stone and props the
 *   blocks do not show, and UASTC made each one four or five times larger.
 *   Nora's normal map, seen close, is UASTC with Zstandard supercompression.
 * - Data maps (ARM, ORM): ETC1S, linear. UASTC made each one about five times
 *   the JPEG's download for no difference you can see in roughness or AO.
 * - Every texture gets its full mip chain.
 *
 * Level surfaces: art/textures/<name>/{albedo,normal,arm}.jpg are the scanned
 * sources; the albedo is softened here (towards its own mean colour, as the
 * game used to do at load) and written to public/textures/<name>/*.ktx2.
 *
 * Models: public/models/*.glb are rewritten in place with KHR_texture_basisu
 * (meshopt geometry stays meshopt). Textures already in KTX2 are left alone,
 * so running it again only converts what a rebuilt model brought back as
 * JPEG, PNG or WebP. scripts/blender/build_props.py writes JPEG/PNG models;
 * run this after it.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO, type Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions';
import { encodeToKTX2 } from 'ktx2-encoder';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

type Kind = 'color' | 'normal' | 'normal-hq' | 'data';

const ROOT = new URL('../../', import.meta.url).pathname;
const args = process.argv.slice(2);
const onlyIndex = args.indexOf('--only');
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const names = args.filter((a, i) => !a.startsWith('--') && i !== onlyIndex + 1);

/**
 * How far each surface's albedo moves towards its mean colour, and its normal
 * strength in the game (kept in src/render/materials.ts SOFTEN). The scans
 * read harsh and grainy on phone screens.
 */
const SURFACE_SOFTEN: Record<string, number> = {
  wall: 0.18,
  floor: 0.24,
  block: 0.12,
  sand: 0.28,
  ceiling: 0.15,
};

const decode = async (buffer: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> => {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    width: info.width,
    height: info.height,
  };
};

/** PNG bytes of an RGBA raster (the encoder decodes through `decode`). */
const png = (data: Uint8Array, width: number, height: number): Promise<Buffer> =>
  sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();

async function encode(image: Uint8Array, kind: Kind): Promise<Uint8Array> {
  const common = { isKTX2File: true, generateMipmap: true, imageDecoder: decode };
  if (kind === 'normal-hq') {
    return encodeToKTX2(image, {
      ...common,
      isUASTC: true,
      uastcLDRQualityLevel: 2,
      enableRDO: true,
      rdoQualityLevel: 0.75,
      needSupercompression: true,
      isNormalMap: true,
      isPerceptual: false,
      isSetKTX2SRGBTransferFunc: false,
    });
  }
  const srgb = kind === 'color';
  return encodeToKTX2(image, {
    ...common,
    isUASTC: false,
    qualityLevel: kind === 'normal' ? 255 : 200,
    compressionLevel: 2,
    isNormalMap: kind === 'normal',
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
  });
}

/** The albedo moved `k` of the way towards its mean colour (alpha kept). */
async function soften(jpeg: Uint8Array, k: number): Promise<Buffer> {
  const { data, width, height } = await decode(jpeg);
  const n = width * height;
  const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] = (mean[c] ?? 0) + (data[i * 4 + c] ?? 0);
  for (let c = 0; c < 3; c++) mean[c] = (mean[c] ?? 0) / n;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = data[i * 4 + c] ?? 0;
      data[i * 4 + c] = Math.round(v + ((mean[c] ?? 0) - v) * k);
    }
  }
  return png(data, width, height);
}

const kb = (b: number): string => `${(b / 1024).toFixed(0)} KB`;

async function surfaces(): Promise<void> {
  for (const name of Object.keys(SURFACE_SOFTEN)) {
    if (names.length && !names.includes(name)) continue;
    const src = join(ROOT, 'art/textures', name);
    const out = join(ROOT, 'public/textures', name);
    mkdirSync(out, { recursive: true });
    const albedo = new Uint8Array(readFileSync(join(src, 'albedo.jpg')));
    const jobs: [string, Uint8Array, Kind][] = [
      ['albedo', new Uint8Array(await soften(albedo, SURFACE_SOFTEN[name] ?? 0)), 'color'],
      ['normal', new Uint8Array(readFileSync(join(src, 'normal.jpg'))), 'normal'],
      ['arm', new Uint8Array(readFileSync(join(src, 'arm.jpg'))), 'data'],
    ];
    for (const [file, bytes, kind] of jobs) {
      const ktx = await encode(bytes, kind);
      writeFileSync(join(out, `${file}.ktx2`), ktx);
      console.log(`textures/${name}/${file}.ktx2  ${kind.padEnd(6)} ${kb(ktx.byteLength)}`);
    }
  }
}

/** What each texture of a glTF holds, from the material slots that use it. */
function kinds(
  textures: Texture[],
  doc: ReturnType<NodeIO['readBinary']> extends Promise<infer D> ? D : never,
): Map<Texture, Kind> {
  const out = new Map<Texture, Kind>();
  for (const m of doc.getRoot().listMaterials()) {
    const color = [m.getBaseColorTexture(), m.getEmissiveTexture()];
    for (const t of color) if (t) out.set(t, 'color');
    const normal = m.getNormalTexture();
    if (normal) out.set(normal, 'normal');
    for (const t of [m.getOcclusionTexture(), m.getMetallicRoughnessTexture()])
      if (t && !out.has(t)) out.set(t, 'data');
  }
  for (const t of textures) if (!out.has(t)) out.set(t, 'data');
  return out;
}

async function models(): Promise<void> {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const dir = join(ROOT, 'public/models');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.glb'))) {
    const name = file.replace(/\.glb$/, '');
    if (names.length && !names.includes(name)) continue;
    const path = join(dir, file);
    const before = readFileSync(path).byteLength;
    const doc = await io.readBinary(new Uint8Array(readFileSync(path)));
    const textures = doc.getRoot().listTextures();
    const todo = textures.filter((t) => t.getMimeType() !== 'image/ktx2');
    if (!todo.length) {
      console.log(`models/${file}  already KTX2`);
      continue;
    }
    const kind = kinds(textures, doc);
    for (const t of todo) {
      const image = t.getImage();
      if (!image) continue;
      let k = kind.get(t) ?? 'data';
      // The character is seen up close: her normal map keeps UASTC.
      if (k === 'normal' && name === 'nora') k = 'normal-hq';
      t.setImage(await encode(image, k)).setMimeType('image/ktx2');
      const uri = t.getURI();
      if (uri) t.setURI(uri.replace(/\.(jpe?g|png|webp)$/i, '.ktx2'));
    }
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    // WebP and other image formats are gone from the file.
    for (const ext of doc.getRoot().listExtensionsUsed()) {
      if (ext.extensionName === 'EXT_texture_webp' || ext.extensionName === 'EXT_texture_avif') ext.dispose();
    }
    const bytes = await io.writeBinary(doc);
    writeFileSync(path, bytes);
    console.log(`models/${file}  ${kb(before)} → ${kb(bytes.byteLength)}  (${todo.length} textures)`);
  }
}

if (!only || only === 'surfaces') await surfaces();
if (!only || only === 'models') await models();
