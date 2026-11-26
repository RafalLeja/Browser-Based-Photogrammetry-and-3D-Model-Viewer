import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three/webgpu';

import { dimensionEdges, distance, mirrorView, subjectCrop } from '../src/measure.ts';
import { modelStats } from '../src/model.ts';

test('dimension edges start at the bottom corner nearest the camera and span the box', () => {
  const edges = dimensionEdges([0, 0, 0], [2, 3, 4], [10, 5, -10]);
  assert.deepEqual(edges.width[0], [2, 0, 0]); // Nearest x side is max x, nearest z side is min z.
  assert.equal(distance(...edges.width), 2);
  assert.equal(distance(...edges.height), 3);
  assert.equal(distance(...edges.depth), 4);
  assert.equal(edges.height[1][1], 3);
});

test('a subject crop pads the subject, keeps the aspect and stays inside the image', () => {
  const crop = subjectCrop([{ x: 400, y: 300 }, { x: 600, y: 500 }], 1000, 800, 4 / 3, 0.1)!;
  assert.ok(Math.abs(crop.width / crop.height - 4 / 3) < 1e-9);
  assert.ok(crop.x <= 380 && crop.x + crop.width >= 620, 'the padded subject is inside the crop');
  assert.ok(crop.y <= 280 && crop.y + crop.height >= 520);

  const edge = subjectCrop([{ x: 0, y: 0 }, { x: 990, y: 790 }], 1000, 800, 4 / 3)!;
  assert.ok(edge.x >= 0 && edge.y >= 0 && edge.x + edge.width <= 1000 + 1e-9 && edge.y + edge.height <= 800 + 1e-9);
  assert.equal(subjectCrop([], 100, 100, 1), null);
});

test('mirroring a view keeps the viewing angle and the zoom relative to the model size', () => {
  const view = { position: [3, 1, 0] as [number, number, number], target: [1, 1, 0] as [number, number, number] };
  const mirrored = mirrorView(view, { center: [1, 1, 0], radius: 1 }, { center: [10, 0, 0], radius: 5 });
  assert.deepEqual(mirrored.target, [10, 0, 0]);
  assert.deepEqual(mirrored.position, [20, 0, 0]); // Twice the radius away, along +x, as before.
});

test('model statistics count meshes, vertices, materials and vertex colours, not helpers', () => {
  const geometry = new THREE.BoxGeometry();
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geometry.attributes.position.count * 3).fill(1), 3));
  const material = new THREE.MeshStandardMaterial();
  const root = new THREE.Group();
  root.add(new THREE.Mesh(geometry, material), new THREE.Mesh(new THREE.BoxGeometry(), material));
  const helper = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
  helper.userData.helper = true;
  root.add(helper);

  const stats = modelStats(root);
  assert.equal(stats.meshes, 2);
  assert.equal(stats.vertices, 48);
  assert.equal(stats.materials, 1);
  assert.equal(stats.vertexColors, true);
  assert.equal(stats.textures, 0);
});
