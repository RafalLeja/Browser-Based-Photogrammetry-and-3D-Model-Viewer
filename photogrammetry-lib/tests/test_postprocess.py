import json
import struct
from pathlib import Path

import numpy as np
import pytest

from photogrammetry_lib.postprocess import (
    Cameras,
    Mesh,
    auto_crop,
    convergence_point,
    crop_cylinder,
    decimate,
    largest_component,
    main,
    mean_camera_up,
    orient_up,
    postprocess,
    read_ply,
    rotation_between,
    scale_to_height,
    stand_on_ground,
    vertex_normals,
    write_glb,
)


def cube(center=(0.0, 0.0, 0.0), size=1.0) -> Mesh:
    corners = np.array([[x, y, z] for x in (0, 1) for y in (0, 1) for z in (0, 1)], dtype=float)
    faces = np.array(
        [[0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
         [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3]]
    )  # fmt: skip
    return Mesh((corners - 0.5) * size + center, faces, np.full((8, 3), 200, np.uint8))


def merge(*meshes: Mesh) -> Mesh:
    offsets = np.cumsum([0] + [len(m.vertices) for m in meshes[:-1]])
    return Mesh(
        np.vstack([m.vertices for m in meshes]),
        np.vstack([m.faces + o for m, o in zip(meshes, offsets, strict=True)]),
        np.vstack([m.colors for m in meshes]),
    )


def sphere(rings=60, segments=120) -> Mesh:
    theta = np.linspace(0, np.pi, rings)
    phi = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    t, p = np.meshgrid(theta, phi, indexing="ij")
    vertices = np.column_stack([np.sin(t).ravel() * np.cos(p).ravel(), np.cos(t).ravel(), np.sin(t).ravel() * np.sin(p).ravel()])
    faces = []
    for i in range(rings - 1):
        for j in range(segments):
            a, b = i * segments + j, i * segments + (j + 1) % segments
            c, d = a + segments, b + segments
            faces += [[a, b, c], [b, d, c]]  # counter-clockwise seen from outside
    colors = np.tile([[120, 80, 40]], (len(vertices), 1)).astype(np.uint8)
    return Mesh(vertices, np.array(faces), colors)


def test_largest_component_drops_floating_fragments() -> None:
    big = cube(size=2.0)
    fragment = cube(center=(5, 5, 5), size=0.1)
    kept = largest_component(merge(big, fragment))
    assert len(kept.faces) == 12
    assert len(kept.vertices) == 8
    assert np.allclose(kept.vertices.max(axis=0), [1, 1, 1])


def test_mean_camera_up_from_upright_cameras() -> None:
    # Identity rotation: the camera looks down +Z with +Y pointing down, so world up is -Y.
    assert np.allclose(mean_camera_up([np.eye(3), np.eye(3)]), [0, -1, 0])
    # A camera rolled 90 degrees about its viewing axis still averages to a sensible up.
    rolled = np.array([[0, -1, 0], [1, 0, 0], [0, 0, 1]], dtype=float)
    up = mean_camera_up([np.eye(3), rolled])
    assert np.isclose(np.linalg.norm(up), 1)
    with pytest.raises(ValueError, match="disagree"):
        mean_camera_up([np.eye(3), np.diag([1.0, -1.0, -1.0])])


@pytest.mark.parametrize("up", [[0, -1, 0], [1, 0, 0], [0.2014, -0.6971, -0.6881], [0, 1, 0]])
def test_rotation_between_turns_up_onto_y(up) -> None:
    rotation = rotation_between(np.array(up, dtype=float), np.array([0.0, 1.0, 0.0]))
    assert np.allclose(rotation @ (np.array(up) / np.linalg.norm(up)), [0, 1, 0])
    assert np.allclose(rotation @ rotation.T, np.eye(3))  # a pure rotation
    assert np.isclose(np.linalg.det(rotation), 1)


def test_orient_and_stand_on_ground() -> None:
    tall = Mesh(np.array([[0, 0, 0], [0, -2, 0], [1, 0, 0]], dtype=float), np.array([[0, 1, 2]]))
    upright = stand_on_ground(orient_up(tall, np.array([0.0, -1.0, 0.0])))
    assert np.isclose(upright.vertices[:, 1].min(), 0)
    assert np.isclose(np.ptp(upright.vertices[:, 1]), 2)
    low, high = upright.vertices.min(axis=0), upright.vertices.max(axis=0)
    assert np.isclose(low[0] + high[0], 0) and np.isclose(low[2] + high[2], 0)


def test_scale_to_height_gives_true_millimetres() -> None:
    scaled, factor = scale_to_height(cube(size=4.0), 250)
    assert np.isclose(np.ptp(scaled.vertices[:, 1]), 0.25)
    assert np.isclose(factor, 0.0625)


def test_decimate_meets_the_target_without_broken_faces() -> None:
    mesh = sphere()
    reduced = decimate(mesh, 2000)
    assert 500 < len(reduced.faces) <= 2000
    f = reduced.faces
    assert np.all((f[:, 0] != f[:, 1]) & (f[:, 1] != f[:, 2]) & (f[:, 0] != f[:, 2]))
    assert f.max() < len(reduced.vertices)
    assert np.all(reduced.colors == [120, 80, 40])  # averaging equal colours keeps them
    assert decimate(mesh, 10**9) is mesh


def test_vertex_normals_point_outwards_on_a_sphere() -> None:
    mesh = sphere(20, 40)
    normals = vertex_normals(mesh)
    outward = np.einsum("ij,ij->i", normals, mesh.vertices)
    assert np.mean(outward > 0.9) > 0.95


def read_glb(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<4sII", data)
    assert (magic, version, length) == (b"glTF", 2, len(data))
    json_length, kind = struct.unpack_from("<I4s", data, 12)
    assert kind == b"JSON"
    gltf = json.loads(data[20 : 20 + json_length])
    bin_length, kind = struct.unpack_from("<I4s", data, 20 + json_length)
    assert kind == b"BIN\x00"
    return gltf, data[28 + json_length : 28 + json_length + bin_length]


def test_write_glb_produces_a_valid_binary_gltf(tmp_path: Path) -> None:
    mesh = cube()
    path = tmp_path / "cube.glb"
    size = write_glb(path, mesh)
    assert size == path.stat().st_size
    gltf, blob = read_glb(path)
    primitive = gltf["meshes"][0]["primitives"][0]
    assert set(primitive["attributes"]) == {"POSITION", "NORMAL", "COLOR_0"}
    position = gltf["accessors"][primitive["attributes"]["POSITION"]]
    assert position["count"] == 8 and position["min"] == [-0.5] * 3 and position["max"] == [0.5] * 3
    assert gltf["accessors"][primitive["indices"]]["count"] == 36
    assert all(view["byteOffset"] % 4 == 0 for view in gltf["bufferViews"])
    assert len(blob) == gltf["buffers"][0]["byteLength"]


def test_read_ply_reads_colours_and_faces(tmp_path: Path) -> None:
    path = tmp_path / "quad.ply"
    path.write_text(
        "ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\n"
        "property uchar red\nproperty uchar green\nproperty uchar blue\nelement face 1\n"
        "property list uchar int vertex_indices\nend_header\n"
        "0 0 0 255 0 0\n1 0 0 0 255 0\n1 1 0 0 0 255\n0 1 0 9 9 9\n4 0 1 2 3\n"
    )
    mesh = read_ply(path)
    assert mesh.faces.tolist() == [[0, 1, 2], [0, 2, 3]]  # the quad becomes two triangles
    assert mesh.colors[0].tolist() == [255, 0, 0]


def test_postprocess_end_to_end_reports_true_dimensions(tmp_path: Path) -> None:
    scan = merge(sphere(), cube(center=(9, 9, 9), size=0.2))
    manifest = postprocess(scan, tmp_path / "model.glb", up=np.array([0.0, -1.0, 0.0]), height_mm=300, target_triangles=4000)
    assert manifest["triangles_removed_by_crop_and_cleanup"] == 12
    assert manifest["triangles"] <= 4000
    assert manifest["true_scale"] is True
    assert manifest["dimensions_mm"][1] == pytest.approx(300, rel=0.02)
    gltf, _ = read_glb(tmp_path / "model.glb")
    position = gltf["accessors"][gltf["meshes"][0]["primitives"][0]["attributes"]["POSITION"]]
    assert position["min"][1] == pytest.approx(0, abs=1e-6)  # standing on the ground


def test_cli_prints_the_manifest_as_json(tmp_path: Path, capsys) -> None:
    path = tmp_path / "tri.ply"
    path.write_text(
        "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n"
        "element face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n"
    )
    main([str(path), str(tmp_path / "tri.glb"), "--up", "0", "1", "0", "--json"])
    manifest = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert manifest["triangles"] == 1 and manifest["dimensions_mm"] is None


def test_convergence_point_finds_what_the_cameras_circled() -> None:
    target = np.array([1.0, 2.0, 3.0])
    angles = np.linspace(0, 2 * np.pi, 12, endpoint=False)
    centers = target + np.column_stack([5 * np.cos(angles), np.full(12, 1.5), 5 * np.sin(angles)])
    directions = target - centers
    assert np.allclose(convergence_point(centers, directions), target, atol=1e-9)


def test_crop_cylinder_keeps_only_the_object() -> None:
    scene = merge(cube(size=1.0), cube(center=(6, 0, 0), size=1.0))
    kept = crop_cylinder(scene, 0.0, 0.0, 1.0)
    assert len(kept.faces) == 12
    assert kept.vertices[:, 0].max() <= 0.5


def test_auto_crop_centres_on_the_cameras_target() -> None:
    angles = np.linspace(0, 2 * np.pi, 16, endpoint=False)
    centers = np.column_stack([4 * np.cos(angles), np.full(16, 1.0), 4 * np.sin(angles)])
    rotations = []
    for center in centers:
        forward = -center / np.linalg.norm(center)  # looking at the origin
        down = np.array([0.0, -1.0, 0.0])
        right = np.cross(down, forward)
        right /= np.linalg.norm(right)
        down = np.cross(forward, right)
        rotations.append(np.vstack([right, down, forward]))  # rows: camera x, y, z in the world
    cameras = Cameras(np.array(rotations), centers)
    assert np.allclose(mean_camera_up(cameras.rotations), [0, 1, 0], atol=1e-6)
    x, z, radius = auto_crop(cameras, np.array([0.0, 1.0, 0.0]), np.zeros(3))
    assert abs(x) < 1e-6 and abs(z) < 1e-6
    assert radius == pytest.approx(2.0)
