import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three/webgpu';

import { countTriangles, disposeModel, measureModel, orientUp, plyObject, prepareModel } from '../src/model.ts';

/** A 2-unit pole of points from the origin along `direction`, like a scan's vertical axis. */
function pole(direction: [number, number, number]) {
  const d = new THREE.Vector3(...direction).normalize();
  const positions = [0, 0.5, 1, 1.5, 2].flatMap((t) => [d.x * t, d.y * t, d.z * t]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.Points(geometry);
}

function rounded(vector: THREE.Vector3): number[] {
  return vector.toArray().map((value) => Math.round(value * 1000) / 1000 + 0); // + 0 turns -0 into 0.
}

test('orientUp turns an upside-down scan (COLMAP: +Y points down) the right way up', () => {
  const scan = pole([0, -1, 0]);
  orientUp(scan, [0, -1, 0]);
  const { box } = measureModel(scan);
  assert.deepEqual(rounded(box.min), [0, 0, 0]);
  assert.deepEqual(rounded(box.max), [0, 2, 0]);
});

test('orientUp levels a tilted scan, and does not need a unit vector', () => {
  const scan = pole([0.2014, -0.6971, -0.6881]); // The eagle scan's measured up direction.
  orientUp(scan, [2.014, -6.971, -6.881]);
  const { box } = measureModel(scan);
  assert.deepEqual(rounded(box.min), [0, 0, 0]);
  assert.deepEqual(rounded(box.max), [0, 2, 0]);
});

test('measureModel measures the turned vertices, not a turned bounding box', () => {
  // A loose box would put the ground shadow below the model and frame it too far away.
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32));
  sphere.rotation.z = Math.PI / 4;
  const { box } = measureModel(sphere);
  assert.ok(box.max.x < 1.01, `box.max.x is ${box.max.x}, expected about 1`);
  assert.ok(box.max.y < 1.01, `box.max.y is ${box.max.y}, expected about 1`);
});

/** Two triangles sharing an edge, as PLYLoader returns a COLMAP Poisson mesh: no normals. */
function plyGeometry({ faces = true, colors = true } = {}) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  if (colors) geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Array(12).fill(0.5), 3));
  if (faces) geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

test('plyObject turns a PLY with faces into a lit mesh with smooth normals and its vertex colours', () => {
  const object = plyObject(plyGeometry());
  assert.ok(object instanceof THREE.Mesh);
  assert.equal(countTriangles(object), 2);
  // Without normals the mesh would look black under every light.
  const normal = object.geometry.getAttribute('normal');
  assert.ok(normal);
  assert.deepEqual([normal.getX(0), normal.getY(0), normal.getZ(0)], [0, 0, 1]);
  assert.equal((object.material as THREE.MeshStandardMaterial).vertexColors, true);
});

test('plyObject keeps the normals a PLY file already has', () => {
  const geometry = plyGeometry();
  const fromFile = new THREE.Float32BufferAttribute(new Array(12).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3);
  geometry.setAttribute('normal', fromFile);
  const object = plyObject(geometry);
  assert.equal(object.geometry.getAttribute('normal'), fromFile);
});

test('plyObject turns a PLY without faces into a point cloud', () => {
  const object = plyObject(plyGeometry({ faces: false }));
  assert.ok(object instanceof THREE.Points);
  assert.equal((object.material as THREE.PointsMaterial).vertexColors, true);
});

test('plyObject uses vertex colours only when the file has them', () => {
  const mesh = plyObject(plyGeometry({ colors: false }));
  const points = plyObject(plyGeometry({ faces: false, colors: false }));
  assert.equal((mesh.material as THREE.Material).vertexColors, false);
  assert.equal((points.material as THREE.Material).vertexColors, false);
});

/** A textured mesh plus a point cloud nested one level down, like a small glTF scene. */
function sampleModel() {
  const texture = new THREE.Texture();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ map: texture }),
  );
  const points = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());
  const root = new THREE.Group();
  root.add(mesh, new THREE.Group().add(points));
  return { root, mesh, points, texture };
}

test('countTriangles counts mesh triangles, indexed or not', () => {
  const { root, mesh } = sampleModel();
  assert.equal(countTriangles(root), 12); // A box has 6 faces of 2 triangles each.

  root.add(new THREE.Mesh(mesh.geometry.toNonIndexed(), mesh.material));
  assert.equal(countTriangles(root), 24);
});

test('disposeModel frees geometries, materials and textures of meshes and points', () => {
  const { root, mesh, points, texture } = sampleModel();
  const freed: string[] = [];
  mesh.geometry.addEventListener('dispose', () => freed.push('mesh geometry'));
  mesh.material.addEventListener('dispose', () => freed.push('mesh material'));
  texture.addEventListener('dispose', () => freed.push('texture'));
  points.geometry.addEventListener('dispose', () => freed.push('points geometry'));
  points.material.addEventListener('dispose', () => freed.push('points material'));

  disposeModel(root);

  assert.deepEqual(freed.sort(), [
    'mesh geometry',
    'mesh material',
    'points geometry',
    'points material',
    'texture',
  ]);
});

test('prepareModel sets texture anisotropy and warns once about unlit materials', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { root, texture } = sampleModel();

  prepareModel(root, 8);
  assert.equal(texture.anisotropy, 8);
  assert.equal(warn.mock.callCount(), 0);

  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()));
  prepareModel(root, 8);
  assert.equal(warn.mock.callCount(), 1);
});

test('countTriangles skips a mesh without vertex positions', () => {
  const root = new THREE.Group().add(new THREE.Mesh(new THREE.BufferGeometry()));
  assert.equal(countTriangles(root), 0);
});

test('measureModel returns the bounding box and the triangle count', () => {
  const { root } = sampleModel();
  const { box, triangles } = measureModel(root);
  assert.deepEqual(box.min.toArray(), [-0.5, -0.5, -0.5]);
  assert.deepEqual(box.max.toArray(), [0.5, 0.5, 0.5]);
  assert.equal(triangles, 12);
});

test('measureModel accepts an empty model', () => {
  const { box, triangles } = measureModel(new THREE.Group());
  assert.ok(box.isEmpty());
  assert.equal(triangles, 0);
});

test('measureModel rejects vertex positions that are not finite', (t) => {
  t.mock.method(console, 'error', () => {}); // three also logs the NaN bounding box.
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, NaN, 0, 0, 0, 0, 1], 3));
  const root = new THREE.Group().add(new THREE.Mesh(geometry));
  assert.throws(() => measureModel(root), /not finite/);
});
