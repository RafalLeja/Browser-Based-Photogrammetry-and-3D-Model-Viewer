// Image-based lighting generated from tiny scenes, like three's RoomEnvironment, so the
// "studio" and "outdoor" looks need no download. PMREM blurs them into smooth lighting.
import * as THREE from 'three/webgpu';

/** A glowing panel. Colours above 1 are brighter than white: PMREM renders in HDR. */
function light(width: number, height: number, intensity: number, tint = '#ffffff'): THREE.Mesh {
  const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(tint).multiplyScalar(intensity), side: THREE.DoubleSide });
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
}

/** Dark grey cyclorama with a large key softbox, a fill and a rim light: even, product-photo light. */
export function studioScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(20, 32, 16),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#2a2b2e'), side: THREE.BackSide }),
  );
  scene.add(room);

  const key = light(8, 6, 14);
  key.position.set(-6, 7, 6);
  key.lookAt(0, 0, 0);
  const fill = light(10, 4, 4, '#dde6ff');
  fill.position.set(8, 3, 3);
  fill.lookAt(0, 0, 0);
  const rim = light(3, 9, 10, '#fff4e6');
  rim.position.set(0, 6, -9);
  rim.lookAt(0, 0, 0);
  const top = light(12, 12, 3);
  top.position.set(0, 14, 0);
  top.lookAt(0, 0, 0);
  scene.add(key, fill, rim, top);
  return scene;
}

/** Blue sky fading to a bright horizon, warm ground bounce and a small, strong sun. */
export function outdoorScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const sky = new THREE.SphereGeometry(20, 48, 24);
  const zenith = new THREE.Color('#4a7fd6');
  const horizon = new THREE.Color('#dfe9f5');
  const ground = new THREE.Color('#5b5045');
  const colors: number[] = [];
  const position = sky.getAttribute('position');
  const c = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i) / 20;
    if (y >= 0) c.copy(horizon).lerp(zenith, Math.pow(y, 0.6));
    else c.copy(horizon).lerp(ground, Math.min(1, -y * 4));
    colors.push(c.r * 1.6, c.g * 1.6, c.b * 1.6);
  }
  sky.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  scene.add(new THREE.Mesh(sky, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));

  const sun = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 16, 8),
    new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff2d6').multiplyScalar(120) }),
  );
  sun.position.set(8, 12, 6);
  scene.add(sun);
  return scene;
}

/** Frees the geometries and materials of a generated scene once PMREM has baked it. */
export function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  });
}
