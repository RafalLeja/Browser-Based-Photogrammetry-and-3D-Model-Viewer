// Helpers for the objects inside a loaded model: free their memory, count their triangles,
// and prepare them before the first render. Kept apart from viewer.ts so Node can test them.
import * as THREE from 'three/webgpu';

/** Anything three draws from a geometry and a material: meshes, points and lines. */
type Drawable = THREE.Object3D & {
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
};

function isDrawable(object: THREE.Object3D): object is Drawable {
  return 'geometry' in object && 'material' in object;
}

function isMesh(object: THREE.Object3D): object is THREE.Mesh {
  return (object as THREE.Mesh).isMesh === true;
}

function materialsOf(object: Drawable): THREE.Material[] {
  return Array.isArray(object.material) ? object.material : [object.material];
}

/** Textures sit on many properties (map, normalMap, roughnessMap, ...), so check them all. */
function texturesOf(material: THREE.Material): THREE.Texture[] {
  return (Object.values(material) as unknown[]).filter(
    (value): value is THREE.Texture => value instanceof THREE.Texture,
  );
}

/** Frees GPU memory. JavaScript's garbage collector cannot release buffers and textures. */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!isDrawable(object)) return;
    object.geometry.dispose();

    for (const material of materialsOf(object)) {
      for (const texture of texturesOf(material)) {
        texture.dispose();
        // GLTFLoader decodes images into ImageBitmaps, which keep their memory until closed.
        // Node has no ImageBitmap, hence the typeof check.
        if (typeof ImageBitmap !== 'undefined' && texture.image instanceof ImageBitmap) {
          texture.image.close();
        }
      }
      material.dispose();
    }
  });
}

/** Triangles of all meshes. Points and lines have none. */
export function countTriangles(root: THREE.Object3D): number {
  let triangles = 0;
  root.traverse((object) => {
    if (!isMesh(object)) return;
    const { index, attributes } = object.geometry;
    // A broken file can have a mesh without positions. three draws nothing for it, so it counts 0.
    const position = attributes.position as THREE.BufferAttribute | undefined;
    triangles += (index?.count ?? position?.count ?? 0) / 3;
  });
  return triangles;
}

/**
 * Runs once on a new model, before its first render.
 * - Anisotropy keeps textures sharp on surfaces seen at a flat angle, such as a floor or the
 *   side of a scan. Setting it before the first render means the texture is uploaded once.
 * - Unlit materials (glTF KHR_materials_unlit) ignore lights and the environment, so a scan
 *   exported that way looks flat. One warning tells whoever exported it.
 */
export function prepareModel(root: THREE.Object3D, anisotropy: number): void {
  let hasUnlit = false;
  root.traverse((object) => {
    if (!isDrawable(object)) return;
    for (const material of materialsOf(object)) {
      if ('isMeshBasicMaterial' in material && material.isMeshBasicMaterial === true) {
        hasUnlit = true;
      }
      for (const texture of texturesOf(material)) texture.anisotropy = anisotropy;
    }
  });

  if (hasUnlit) {
    console.warn(
      '[viewer] The model has unlit materials (KHR_materials_unlit): lights and the environment do not affect them.',
    );
  }
}

/**
 * Bounding box and triangle count, measured before the model replaces the current one.
 * Throws when a vertex position is NaN or infinite: such a model cannot be framed, and the
 * camera maths would turn every camera value into NaN.
 */
export function measureModel(root: THREE.Object3D): { box: THREE.Box3; triangles: number } {
  const box = new THREE.Box3().setFromObject(root);
  // An empty box reports size and centre 0, so an empty model passes and shows nothing.
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const finite = [...size.toArray(), ...center.toArray()].every(Number.isFinite);
  if (!finite) throw new Error('its vertex positions are not finite numbers (NaN or Infinity)');
  return { box, triangles: countTriangles(root) };
}
