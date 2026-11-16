// Camera framing maths. No three import, so Node can test it.

/** Space left around the model: 1.2 keeps a 20 % margin so it never touches the edge. */
export const FRAME_MARGIN = 1.2;

/**
 * How far the camera must stand from the centre of a sphere to see all of it.
 *
 * Right triangle: camera to centre is the hypotenuse, and the radius is the side opposite
 * half the viewing angle, so sin(halfAngle) = radius / distance.
 *
 * The camera has two viewing angles: vertical (the camera's fov) and horizontal (wider in a
 * wide container, narrower in a tall one). The sphere must fit inside both, so the smaller
 * angle decides. Using only the vertical one crops the model in a tall, narrow panel.
 *
 * @param verticalFov the camera's vertical field of view, in radians
 * @param aspect width ÷ height of the container
 */
export function fitDistance(radius: number, verticalFov: number, aspect: number): number {
  const verticalHalf = verticalFov / 2;
  const horizontalHalf = Math.atan(Math.tan(verticalHalf) * aspect);
  return (radius / Math.sin(Math.min(verticalHalf, horizontalHalf))) * FRAME_MARGIN;
}
