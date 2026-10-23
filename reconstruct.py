#!/usr/bin/env python3
"""
Images -> COLMAP sparse reconstruction -> OpenMVS dense mesh
       -> textured GLB model suitable for Blender.

Usage:
    python3 reconstruct.py ./images ./output

Optional:
    python3 reconstruct.py ./images ./output \
        --openmvs-bin ~/src/openMVS_build/bin
"""

import argparse
import shutil
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("images", type=Path, help="Folder containing photos")
    parser.add_argument("output", type=Path, help="Output folder")
    parser.add_argument(
        "--openmvs-bin",
        type=Path,
        help="Directory containing OpenMVS executables",
    )
    parser.add_argument(
        "--camera-model",
        default="SIMPLE_RADIAL",
        help="COLMAP camera model (default: SIMPLE_RADIAL)",
    )
    parser.add_argument(
        "--single-camera",
        action="store_true",
        help="Use when all photos were taken with the same camera settings",
    )
    args = parser.parse_args()

    images: Path = args.images.expanduser().resolve()
    output: Path = args.output.expanduser().resolve()

    if not images.is_dir():
        parser.error(f"Image directory does not exist: {images}")

    supported = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".bmp", ".webp"}
    photo_count = sum(
        1 for p in images.rglob("*") if p.is_file() and p.suffix.lower() in supported
    )
    if photo_count < 3:
        parser.error(f"Found only {photo_count} images; use at least 3.")

    output.mkdir(parents=True, exist_ok=True)

    # Keep intermediate files so failed runs can be diagnosed.
    database = output / "database.db"
    sparse_dir = output / "sparse"
    dense_dir = output / "dense"
    mvs_dir = output / "mvs"
    mvs_dir.mkdir(exist_ok=True)

    def tool(name):
        if args.openmvs_bin:
            candidate = args.openmvs_bin.expanduser() / name
            if candidate.is_file():
                return str(candidate)
        found = shutil.which(name)
        if not found:
            raise RuntimeError(
                f"Cannot find executable '{name}'. Install it or provide --openmvs-bin."
            )
        return found

    def run(command, cwd=None):
        print("\n+", " ".join(map(str, command)), flush=True)
        subprocess.run(
            list(map(str, command)),
            cwd=cwd,
            check=True,
        )

    colmap = shutil.which("colmap")
    if not colmap:
        raise RuntimeError("Cannot find 'colmap' on PATH.")

    # ---------------------------------------------------------
    # 1. COLMAP: extract local image features
    # ---------------------------------------------------------
    run(
        [
            colmap,
            "feature_extractor",
            "--database_path",
            database,
            "--image_path",
            images,
            "--ImageReader.camera_model",
            args.camera_model,
            "--SiftExtraction.use_gpu",
            "1",
            *(["--ImageReader.single_camera", "1"] if args.single_camera else []),
        ]
    )

    # ---------------------------------------------------------
    # 2. COLMAP: match features across images
    # Exhaustive matching is a good simple default for small scans.
    # ---------------------------------------------------------
    run(
        [
            colmap,
            "exhaustive_matcher",
            "--database_path",
            database,
            "--SiftMatching.use_gpu",
            "1",
        ]
    )

    # ---------------------------------------------------------
    # 3. COLMAP: estimate camera poses and sparse geometry
    # ---------------------------------------------------------
    sparse_dir.mkdir(exist_ok=True)
    run(
        [
            colmap,
            "mapper",
            "--database_path",
            database,
            "--image_path",
            images,
            "--output_path",
            sparse_dir,
        ]
    )

    # COLMAP normally writes the first reconstruction to sparse/0.
    models = sorted(
        p for p in sparse_dir.iterdir() if p.is_dir() and (p / "cameras.bin").exists()
    )
    if not models:
        raise RuntimeError(
            "COLMAP registered no reconstruction. Check image overlap and COLMAP logs."
        )
    sparse_model = models[0]
    print(f"\nUsing COLMAP model: {sparse_model}")

    # ---------------------------------------------------------
    # 4. COLMAP: undistort images for dense reconstruction
    # ---------------------------------------------------------
    # run(
    #     [
    #         colmap,
    #         "image_undistorter",
    #         "--image_path",
    #         images,
    #         "--input_path",
    #         sparse_model,
    #         "--output_path",
    #         dense_dir,
    #         "--output_type",
    #         "COLMAP",
    #     ]
    # )

    # ---------------------------------------------------------
    # 5. OpenMVS: convert COLMAP scene
    # ---------------------------------------------------------
    scene = mvs_dir / "scene.mvs"
    run(
        [
            tool("InterfaceCOLMAP"),
            "-i",
            dense_dir,
            "-o",
            scene,
            "--image-folder",
            dense_dir / "images",
        ]
    )

    # ---------------------------------------------------------
    # 6. OpenMVS: dense point cloud
    # ---------------------------------------------------------
    # run([tool("DensifyPointCloud"), scene], cwd=dense_dir)
    dense_scene = mvs_dir / "scene_dense.mvs"
    #
    if not dense_scene.exists():
        raise RuntimeError(f"Expected output not found: {dense_scene}")

    # ---------------------------------------------------------
    # 7. OpenMVS: create an actual triangle mesh
    # ---------------------------------------------------------
    mesh = mvs_dir / "model_mesh.ply"
    scene_mesh = mvs_dir / "scene_dense_mesh.ply"
    # run(
    #     [
    #         tool("ReconstructMesh"),
    #         dense_scene,
    #         "-p",
    #         mesh,
    #     ],
    #     cwd=dense_dir,
    # )

    if not scene_mesh.exists():
        raise RuntimeError(
            f"Mesh was not created at {scene_mesh}. Check the ReconstructMesh output above."
        )

    # ---------------------------------------------------------
    # 8. OpenMVS: project photographs onto the mesh
    # ---------------------------------------------------------
    model = mvs_dir / "scene_textured.glb"
    run(
        [
            tool("TextureMesh"),
            dense_scene,
            "-m",
            scene_mesh,
            "--export-type",
            "glb",
            "-o",
            model,
        ],
        cwd=images.parent,
    )

    if not model.exists():
        raise RuntimeError(f"Textured scene not found: {model}")

    print("\n" + "=" * 60)
    print("RECONSTRUCTION COMPLETE")
    print(f"Input images: {photo_count}")
    print(f"Triangle mesh: {mesh}")
    print(f"Blender model: {model}")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"\nERROR: {exc}", file=sys.stderr)
        sys.exit(1)
