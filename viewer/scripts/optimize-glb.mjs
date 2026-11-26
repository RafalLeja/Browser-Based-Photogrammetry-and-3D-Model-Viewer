// Shrinks a GLB for the web: merges duplicate vertices, optionally simplifies with meshoptimizer
// (error-bounded edge collapse), then quantizes and compresses with EXT_meshopt_compression,
// which the viewer decodes. The reconstruction worker runs this as its last step.
//
// Usage: node scripts/optimize-glb.mjs <in.glb> <out.glb> [--ratio 0.5] [--error 0.001]
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { statSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { ratio: { type: 'string', default: '1' }, error: { type: 'string', default: '0.001' } },
});
const [input, output] = positionals;
if (!input || !output) {
  console.error('Usage: node scripts/optimize-glb.mjs <in.glb> <out.glb> [--ratio 0.5] [--error 0.001]');
  process.exit(2);
}
const ratio = Number(values.ratio);
const error = Number(values.error);
if (!(ratio > 0 && ratio <= 1) || !(error > 0)) {
  console.error('--ratio must be in (0, 1] and --error must be positive');
  process.exit(2);
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const document = await io.read(input);

const steps = [dedup(), weld()];
if (ratio < 1) steps.push(simplify({ simplifier: MeshoptSimplifier, ratio, error }));
steps.push(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
await document.transform(...steps);
await io.write(output, document);

const before = statSync(input).size;
const after = statSync(output).size;
console.log(`Optimized ${input}: ${(before / 1e6).toFixed(1)} MB -> ${(after / 1e6).toFixed(1)} MB`);
