// Helpers for the objects inside a loaded model: free their memory, count their triangles,
// and prepare them before the first render. Kept apart from viewer.ts so Node can test them.
import * as THREE from 'three/webgpu';
import type { ModelStats, Vec3 } from './types';

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
 * Builds the object for a PLY from our pipeline: a mesh (the Poisson surface) or, without
 * faces, a point cloud (the sparse export). COLMAP writes vertex colours but no normals, and a
 * mesh without normals looks black under every light, so they are computed when missing.
 */
export function plyObject(geometry: THREE.BufferGeometry): THREE.Mesh | THREE.Points {
  const vertexColors = geometry.hasAttribute('color');
  if (!geometry.index) {
    // 1 px points: WebGPU cannot draw bigger point primitives.
    return new THREE.Points(geometry, new THREE.PointsMaterial({ vertexColors, sizeAttenuation: false }));
  }
  if (!geometry.hasAttribute('normal')) geometry.computeVertexNormals();
  // The colours are the photographed surface, so the material adds no shine (metalness 0,
  // roughness 1). DoubleSide: Poisson trimming leaves holes, and inner faces must not vanish.
  const material = new THREE.MeshStandardMaterial({ vertexColors, metalness: 0, roughness: 1, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

/**
 * Turns a model whose own up direction is `up` so that it stands +Y up, as the camera and the
 * ground shadow expect. COLMAP keeps the first photo's camera frame, where +Y points down.
 * Turning the object, not its vertices, keeps the file's coordinates for pins and the ruler.
 */
export function orientUp(root: THREE.Object3D, up: Vec3): void {
  root.quaternion.setFromUnitVectors(new THREE.Vector3(...up).normalize(), new THREE.Vector3(0, 1, 0));
}

/**
 * Bounding box and triangle count, measured before the model replaces the current one.
 * Throws when a vertex position is NaN or infinite: such a model cannot be framed, and the
 * camera maths would turn every camera value into NaN.
 */
export function measureModel(root: THREE.Object3D): { box: THREE.Box3; triangles: number } {
  // precise: from the vertices. A turned bounding box is looser, so the shadow would float.
  const box = new THREE.Box3().setFromObject(root, true);
  // An empty box reports size and centre 0, so an empty model passes and shows nothing.
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const finite = [...size.toArray(), ...center.toArray()].every(Number.isFinite);
  if (!finite) throw new Error('its vertex positions are not finite numbers (NaN or Infinity)');
  return { box, triangles: countTriangles(root) };
}

/** What a model is made of, for the inspector: counts, texture sizes and whether it has colours. */
export function modelStats(root: THREE.Object3D): ModelStats {
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const stats: ModelStats = { meshes: 0, points: 0, vertices: 0, materials: 0, textures: 0, maxTextureSize: 0, vertexColors: false };
  root.traverse((object) => {
    if (!isDrawable(object) || object.userData.helper) return;
    if (isMesh(object)) stats.meshes++;
    else if ((object as THREE.Points).isPoints) stats.points++;
    const position = object.geometry.attributes.position as THREE.BufferAttribute | undefined;
    stats.vertices += position?.count ?? 0;
    if (object.geometry.hasAttribute('color')) stats.vertexColors = true;
    for (const material of materialsOf(object)) {
      materials.add(material);
      for (const texture of texturesOf(material)) textures.add(texture);
    }
  });
  stats.materials = materials.size;
  stats.textures = textures.size;
  for (const texture of textures) {
    const image = texture.image as { width?: number; height?: number } | null;
    stats.maxTextureSize = Math.max(stats.maxTextureSize, image?.width ?? 0, image?.height ?? 0);
  }
  return stats;
}
