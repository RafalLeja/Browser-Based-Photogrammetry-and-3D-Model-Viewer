"""Turns COLMAP's raw Poisson mesh into a model that is ready for the web.

Steps, in order:
1. turn it upright: COLMAP keeps the first photo's axes, so "up" is taken from the cameras,
2. stand it on the ground at the origin (+Y up, base on y = 0, the glTF convention),
3. crop to the object: a vertical cylinder around the point all cameras looked at (or a given one),
4. keep the largest connected piece (drops the floating fragments Poisson leaves around a scan),
5. scale it to true size when the real height is known (1 unit = 1 m),
6. reduce the triangle count by vertex clustering,
7. write a GLB with vertex colours and normals, plus a manifest of its size and dimensions.

Usage: python -m photogrammetry_lib.postprocess raw.ply model.glb [--sparse DIR] [--height-mm 245]
"""

import argparse
import json
import struct
import sys
from collections.abc import Iterable
from dataclasses import dataclass, replace
from pathlib import Path

import numpy as np


DEFAULT_TARGET_TRIANGLES = 300_000
Y_UP = np.array([0.0, 1.0, 0.0])


@dataclass(frozen=True)
class Mesh:
    vertices: np.ndarray  # (N, 3) float64
    faces: np.ndarray  # (M, 3) int64
    colors: np.ndarray | None = None  # (N, 3) uint8, sRGB as photographed


def read_ply(path: Path) -> Mesh:
    from plyfile import PlyData

    ply = PlyData.read(str(path))
    vertex = ply["vertex"]
    vertices = np.column_stack([vertex["x"], vertex["y"], vertex["z"]]).astype(np.float64)
    names = set(vertex.data.dtype.names)
    colors = None
    if {"red", "green", "blue"} <= names:
        colors = np.column_stack([vertex["red"], vertex["green"], vertex["blue"]]).astype(np.uint8)
    faces = np.empty((0, 3), np.int64)
    if "face" in ply:
        face = ply["face"]
        prop = "vertex_indices" if "vertex_indices" in face.data.dtype.names else "vertex_index"
        faces = triangulate(face[prop])
    return Mesh(vertices, faces, colors)


def triangulate(polygons: Iterable[np.ndarray]) -> np.ndarray:
    """Poisson output is all triangles; a polygon with more corners is split into a fan."""
    polygons = list(polygons)
    if polygons and all(len(p) == 3 for p in polygons):
        return np.asarray(np.stack(polygons), dtype=np.int64)
    triangles = [(p[0], p[i], p[i + 1]) for p in polygons for i in range(1, len(p) - 1)]
    return np.asarray(triangles, dtype=np.int64).reshape(-1, 3)


def compact(mesh: Mesh) -> Mesh:
    """Drops vertices no face uses and renumbers the faces."""
    used, faces = np.unique(mesh.faces, return_inverse=True)
    return Mesh(
        mesh.vertices[used],
        faces.reshape(-1, 3),
        None if mesh.colors is None else mesh.colors[used],
    )


def largest_component(mesh: Mesh) -> Mesh:
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components

    if len(mesh.faces) == 0:
        return mesh
    f = mesh.faces
    rows = np.concatenate([f[:, 0], f[:, 1], f[:, 2]])
    cols = np.concatenate([f[:, 1], f[:, 2], f[:, 0]])
    n = len(mesh.vertices)
    graph = coo_matrix((np.ones(len(rows), dtype=bool), (rows, cols)), shape=(n, n))
    _, labels = connected_components(graph, directed=False)
    face_labels = labels[f[:, 0]]
    biggest = np.bincount(face_labels).argmax()
    return compact(replace(mesh, faces=f[face_labels == biggest]))


def mean_camera_up(rotations: Iterable[np.ndarray]) -> np.ndarray:
    """The world's up direction, from cameras held upright.

    Each rotation maps world to camera coordinates. COLMAP's camera +Y points down the image,
    so a camera's up direction in the world is minus the second row of its rotation.
    """
    ups = np.array([-np.asarray(r, dtype=np.float64)[1] for r in rotations])
    if len(ups) == 0:
        raise ValueError("no cameras")
    mean = ups.mean(axis=0)
    length = np.linalg.norm(mean)
    if length < 1e-6:
        raise ValueError("the cameras disagree about which way is up")
    return mean / length


@dataclass(frozen=True)
class Cameras:
    rotations: np.ndarray  # (K, 3, 3) world -> camera
    centers: np.ndarray  # (K, 3) camera positions in the world

    @property
    def directions(self) -> np.ndarray:
        """Viewing direction of each camera in the world (COLMAP cameras look along +Z)."""
        return self.rotations[:, 2, :]


def cameras_from_sparse(sparse_dir: Path) -> Cameras:
    import pycolmap

    reconstruction = pycolmap.Reconstruction(str(sparse_dir))
    rotations, centers = [], []
    for image in reconstruction.images.values():
        pose = image.cam_from_world() if callable(image.cam_from_world) else image.cam_from_world
        rotation = np.asarray(pose.rotation.matrix())
        rotations.append(rotation)
        centers.append(-rotation.T @ np.asarray(pose.translation))
    return Cameras(np.array(rotations), np.array(centers))


def convergence_point(centers: np.ndarray, directions: np.ndarray) -> np.ndarray:
    """The point closest to all viewing rays, in the least-squares sense: what the photographer circled."""
    eye = np.eye(3)
    a = np.zeros((3, 3))
    b = np.zeros(3)
    for center, direction in zip(centers, directions, strict=True):
        d = direction / np.linalg.norm(direction)
        projector = eye - np.outer(d, d)  # removes the part along the ray
        a += projector
        b += projector @ center
    return np.linalg.lstsq(a, b, rcond=None)[0]


def rotation_between(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """The rotation matrix that turns direction `a` onto direction `b` (Rodrigues' formula)."""
    a = np.asarray(a, dtype=np.float64) / np.linalg.norm(a)
    b = np.asarray(b, dtype=np.float64) / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -1 + 1e-9:  # Opposite directions: half a turn about any axis at right angles to a.
        axis = np.cross(a, [1.0, 0.0, 0.0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0.0, 0.0, 1.0])
        axis /= np.linalg.norm(axis)
        return 2 * np.outer(axis, axis) - np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx / (1 + c)


def orient_up(mesh: Mesh, up: np.ndarray) -> Mesh:
    return replace(mesh, vertices=mesh.vertices @ rotation_between(up, Y_UP).T)


def ground_offset(mesh: Mesh) -> np.ndarray:
    low, high = mesh.vertices.min(axis=0), mesh.vertices.max(axis=0)
    return np.array([(low[0] + high[0]) / 2, low[1], (low[2] + high[2]) / 2])


def stand_on_ground(mesh: Mesh) -> Mesh:
    """Centres the model over the origin with its lowest point on y = 0."""
    return replace(mesh, vertices=mesh.vertices - ground_offset(mesh))


def crop_cylinder(mesh: Mesh, x: float, z: float, radius: float) -> Mesh:
    """Keeps the faces whose corners all lie within `radius` of the vertical axis through (x, z)."""
    inside = (mesh.vertices[:, 0] - x) ** 2 + (mesh.vertices[:, 2] - z) ** 2 <= radius**2
    keep = inside[mesh.faces].all(axis=1)
    return compact(replace(mesh, faces=mesh.faces[keep]))


def auto_crop(cameras: Cameras, up: np.ndarray, offset: np.ndarray, share: float = 0.5) -> tuple[float, float, float]:
    """A crop cylinder around the point the cameras converge on, in the upright, grounded frame.

    The radius is `share` of the median horizontal camera distance: photographers stand back
    about twice the object's size, so this keeps the object and drops most of the surroundings.
    """
    rotation = rotation_between(up, Y_UP)
    target = rotation @ convergence_point(cameras.centers, cameras.directions) - offset
    centers = cameras.centers @ rotation.T - offset
    horizontal = np.hypot(centers[:, 0] - target[0], centers[:, 2] - target[2])
    return float(target[0]), float(target[2]), float(np.median(horizontal) * share)


def scale_to_height(mesh: Mesh, height_mm: float) -> tuple[Mesh, float]:
    extent = np.ptp(mesh.vertices[:, 1])
    if extent <= 0:
        raise ValueError("the model has no height to scale")
    factor = (height_mm / 1000) / extent
    return replace(mesh, vertices=mesh.vertices * factor), factor


def _cluster(mesh: Mesh, cell: float) -> Mesh:
    low = mesh.vertices.min(axis=0)
    keys = np.floor((mesh.vertices - low) / cell).astype(np.int64)
    dims = keys.max(axis=0) + 1
    if float(dims[0]) * float(dims[1]) * float(dims[2]) < 2**62:
        ids = (keys[:, 0] * dims[1] + keys[:, 1]) * dims[2] + keys[:, 2]
        _, inverse = np.unique(ids, return_inverse=True)
    else:
        _, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.ravel()
    clusters = inverse.max() + 1

    counts = np.bincount(inverse, minlength=clusters).astype(np.float64)
    vertices = np.column_stack(
        [np.bincount(inverse, weights=mesh.vertices[:, k], minlength=clusters) / counts for k in range(3)]
    )
    colors = None
    if mesh.colors is not None:
        colors = np.column_stack(
            [np.bincount(inverse, weights=mesh.colors[:, k], minlength=clusters) / counts for k in range(3)]
        )
        colors = np.clip(np.rint(colors), 0, 255).astype(np.uint8)

    faces = inverse[mesh.faces]
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    faces = faces[keep]
    # The same triangle can appear twice after merging; keep one, with its original winding.
    _, first = np.unique(np.sort(faces, axis=1), axis=0, return_index=True)
    faces = faces[np.sort(first)]
    return compact(Mesh(vertices, faces, colors))


def decimate(mesh: Mesh, target_triangles: int) -> Mesh:
    """Vertex clustering: vertices in the same grid cell merge into their average.

    The cell size is found by bisection so the result has at most `target_triangles` faces.
    shortcut: clustering is cruder than quadric edge collapse; the viewer's meshopt step
    (viewer/scripts/optimize-glb.mjs) simplifies further with error control when it runs.
    """
    if len(mesh.faces) <= target_triangles:
        return mesh
    diagonal = float(np.linalg.norm(np.ptp(mesh.vertices, axis=0)))
    low, high = diagonal * 1e-6, diagonal / 8
    best = _cluster(mesh, high)
    for _ in range(14):
        cell = (low * high) ** 0.5
        candidate = _cluster(mesh, cell)
        if len(candidate.faces) > target_triangles:
            low = cell
        else:
            high, best = cell, candidate
    return best


def vertex_normals(mesh: Mesh) -> np.ndarray:
    v, f = mesh.vertices, mesh.faces
    face_normals = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])  # length = 2 x area
    n = len(v)
    normals = np.zeros((n, 3))
    for corner in range(3):
        for axis in range(3):
            normals[:, axis] += np.bincount(f[:, corner], weights=face_normals[:, axis], minlength=n)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    normals = np.divide(normals, length, out=np.tile(Y_UP, (n, 1)), where=length > 0)
    return normals


def srgb_to_linear(colors: np.ndarray) -> np.ndarray:
    c = colors / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def write_glb(path: Path, mesh: Mesh, name: str = "scan") -> int:
    """Writes one triangle mesh as binary glTF 2.0 and returns the file size in bytes."""
    positions = mesh.vertices.astype(np.float32)
    attributes: list[tuple[str, np.ndarray, int, str, bool]] = [
        ("POSITION", positions, 5126, "VEC3", False),
        ("NORMAL", vertex_normals(mesh).astype(np.float32), 5126, "VEC3", False),
    ]
    if mesh.colors is not None:
        # glTF vertex colours are linear. 16-bit keeps dark tones free of banding; RGBA keeps
        # each vertex 4-byte aligned as the spec requires.
        linear = srgb_to_linear(mesh.colors)
        rgba = np.column_stack([linear, np.ones(len(linear))])
        attributes.append(("COLOR_0", np.rint(rgba * 65535).astype(np.uint16), 5123, "VEC4", True))
    indices = mesh.faces.astype(np.uint32).ravel()

    blob = bytearray()
    views: list[dict] = []
    accessors: list[dict] = []

    def add(data: np.ndarray, component: int, kind: str, target: int, normalized: bool = False) -> int:
        while len(blob) % 4:
            blob.append(0)
        raw = np.ascontiguousarray(data).tobytes()
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(raw), "target": target})
        blob.extend(raw)
        accessor = {"bufferView": len(views) - 1, "componentType": component, "count": len(data), "type": kind}
        if normalized:
            accessor["normalized"] = True
        accessors.append(accessor)
        return len(accessors) - 1

    primitive_attributes = {}
    for semantic, data, component, kind, normalized in attributes:
        primitive_attributes[semantic] = add(data, component, kind, 34962, normalized)
    accessors[primitive_attributes["POSITION"]]["min"] = positions.min(axis=0).tolist()
    accessors[primitive_attributes["POSITION"]]["max"] = positions.max(axis=0).tolist()
    index_accessor = add(indices, 5125, "SCALAR", 34963)
    while len(blob) % 4:
        blob.append(0)

    gltf = {
        "asset": {"version": "2.0", "generator": "photogrammetry-lib postprocess"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": name}],
        "meshes": [
            {"name": name, "primitives": [{"attributes": primitive_attributes, "indices": index_accessor, "material": 0}]}
        ],
        "materials": [
            {
                "name": "scan",
                # The colours are the photographed surface, so the material adds no shine.
                "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 1},
                "doubleSided": True,
            }
        ],
        "buffers": [{"byteLength": len(blob)}],
        "bufferViews": views,
        "accessors": accessors,
    }
    json_chunk = json.dumps(gltf, separators=(",", ":")).encode()
    json_chunk += b" " * (-len(json_chunk) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(blob)
    with open(path, "wb") as out:
        out.write(struct.pack("<4sII", b"glTF", 2, total))
        out.write(struct.pack("<I4s", len(json_chunk), b"JSON"))
        out.write(json_chunk)
        out.write(struct.pack("<I4s", len(blob), b"BIN\x00"))
        out.write(blob)
    return total


def postprocess(
    mesh: Mesh,
    output: Path,
    *,
    up: np.ndarray | None = None,
    cameras: Cameras | None = None,
    crop: tuple[float, float, float] | None = None,
    height_mm: float | None = None,
    target_triangles: int = DEFAULT_TARGET_TRIANGLES,
    keep_fragments: bool = False,
) -> dict:
    """`crop` is (x, z, radius) in the upright, grounded frame; without it, `cameras` suggest one."""
    source_triangles = len(mesh.faces)
    if up is not None:
        mesh = orient_up(mesh, up)
    offset = ground_offset(mesh)
    mesh = replace(mesh, vertices=mesh.vertices - offset)
    if crop is None and cameras is not None and up is not None:
        crop = auto_crop(cameras, up, offset)
    if crop is not None:
        mesh = crop_cylinder(mesh, *crop)
    if not keep_fragments:
        mesh = largest_component(mesh)
    kept_triangles = len(mesh.faces)
    scale = None
    if height_mm:
        mesh, scale = scale_to_height(mesh, height_mm)
    mesh = decimate(mesh, target_triangles)
    # Last, because clustering averages vertices and would lift the base off the ground.
    mesh = stand_on_ground(mesh)
    output.parent.mkdir(parents=True, exist_ok=True)
    size = write_glb(output, mesh, name=output.stem)
    extent = np.ptp(mesh.vertices, axis=0)
    return {
        "triangles": int(len(mesh.faces)),
        "vertices": int(len(mesh.vertices)),
        "source_triangles": int(source_triangles),
        "triangles_removed_by_crop_and_cleanup": int(source_triangles - kept_triangles),
        "crop": None if crop is None else [round(v, 4) for v in crop],
        # True millimetres only when the height was given; otherwise COLMAP's arbitrary units x 1000.
        "dimensions_mm": [round(float(v) * 1000, 1) for v in extent] if scale else None,
        "true_scale": scale is not None,
        "scale": scale,
        "up": None if up is None else [float(v) for v in up],
        "file_size": size,
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Clean, orient, scale and slim a raw COLMAP mesh into a GLB.")
    parser.add_argument("input", type=Path, help="raw mesh (.ply)")
    parser.add_argument("output", type=Path, help="output model (.glb)")
    parser.add_argument("--sparse", type=Path, help="COLMAP sparse model folder; its cameras give the up direction")
    parser.add_argument("--up", type=float, nargs=3, metavar=("X", "Y", "Z"), help="up direction, instead of --sparse")
    parser.add_argument(
        "--crop",
        type=float,
        nargs=3,
        metavar=("X", "Z", "RADIUS"),
        help="keep a vertical cylinder in the upright, grounded frame (with --sparse: around the cameras' target)",
    )
    parser.add_argument("--no-crop", action="store_true", help="keep the surroundings")
    parser.add_argument("--height-mm", type=float, help="real height of the object, for true scale")
    parser.add_argument("--target-triangles", type=int, default=DEFAULT_TARGET_TRIANGLES)
    parser.add_argument("--keep-fragments", action="store_true", help="do not drop disconnected pieces")
    parser.add_argument("--json", action="store_true", help="print the manifest as JSON on the last line")
    args = parser.parse_args(argv)

    up = np.array(args.up) if args.up else None
    cameras = None
    if args.sparse:
        try:
            cameras = cameras_from_sparse(args.sparse)
            if up is None:
                up = mean_camera_up(cameras.rotations)
        except Exception as error:  # noqa: BLE001 - orientation is a nicety; a missing one must not fail the job
            print(f"Could not read the cameras: {error}", file=sys.stderr)

    print(f"Reading {args.input}")
    mesh = read_ply(args.input)
    print(f"Read {len(mesh.vertices):,} vertices and {len(mesh.faces):,} triangles")
    manifest = postprocess(
        mesh,
        args.output,
        up=up,
        cameras=None if args.no_crop else cameras,
        crop=None if args.no_crop or not args.crop else tuple(args.crop),
        height_mm=args.height_mm,
        target_triangles=args.target_triangles,
        keep_fragments=args.keep_fragments,
    )
    print(f"Wrote {args.output}: {manifest['triangles']:,} triangles, {manifest['file_size'] / 1e6:.1f} MB")
    if args.json:
        print(json.dumps(manifest))


if __name__ == "__main__":
    main()
