/**
 * Fits a Meshy model to the game (docs/art/meshy-prompts.md):
 *
 *   pnpm models:fit <meshy.glb> <name> [--size 1024]
 *
 * Writes public/models/<name>.glb: Meshy's sample animations dropped (the
 * game animates guardians in code), the mesh renamed after the model, and
 * every texture resized to `--size` (1024 by default; normal maps as PNG,
 * the rest as JPEG) so the file stays near the 1.5 MB budget of
 * docs/art/models-brief.md, and the geometry meshopt-compressed (the game's
 * loaders decode it). Run `pnpm textures:ktx2 --only models <name>` afterwards.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, textureCompress } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';

const ROOT = new URL('../../', import.meta.url).pathname;
const args = process.argv.slice(2);
const sizeAt = args.indexOf('--size');
const size = sizeAt >= 0 ? Number(args[sizeAt + 1]) : 1024;
const [input, name] = args.filter((a, i) => !a.startsWith('--') && (sizeAt < 0 || i !== sizeAt + 1));
if (!input || !name || !Number.isFinite(size)) {
  console.error('usage: pnpm models:fit <meshy.glb> <name> [--size 1024]');
  process.exit(1);
}

await MeshoptEncoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();

for (const anim of root.listAnimations()) anim.dispose();
for (const mesh of root.listMeshes()) mesh.setName(name);
for (const node of root.listNodes()) if (node.getMesh()) node.setName(name);

const normals = new Set(
  root
    .listMaterials()
    .map((m) => m.getNormalTexture())
    .filter((t) => t !== null),
);
await doc.transform(
  textureCompress({
    encoder: sharp,
    resize: [size, size],
    targetFormat: 'jpeg',
    quality: 88,
    slots: /^(?!normalTexture).*$/,
  }),
  textureCompress({ encoder: sharp, resize: [size, size], targetFormat: 'png', slots: /^normalTexture$/ }),
  prune(),
  dedup(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const out = join(ROOT, 'public/models', `${name}.glb`);
mkdirSync(dirname(out), { recursive: true });
await io.write(out, doc);
const tris = root
  .listMeshes()
  .flatMap((m) => m.listPrimitives())
  .reduce((n, p) => n + (p.getIndices()?.getCount() ?? 0) / 3, 0);
console.log(
  `${out}: ${tris} triangles, ${root.listTextures().length} textures at ${size} px, ` +
    `${root.listSkins().length} skin, ${normals.size} normal map`,
);
