import assert from 'node:assert/strict';
import { test } from 'node:test';

import * as THREE from 'three/webgpu';

import { countTriangles, disposeModel, measureModel, prepareModel } from '../src/model.ts';

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
