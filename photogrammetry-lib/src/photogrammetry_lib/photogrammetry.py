import json
import time
from collections.abc import AsyncGenerator
from enum import Enum
from pathlib import Path

import pycolmap
import trimesh

from .storage import get_output_directory


class PhotogrammetryStep(Enum):
    INIT = 1
    LOADING = 2
    FEATURE_EXTRACTION = 3
    FEATURE_MATCHING = 4
    SPARSE_RECONSTRUCTION = 5
    EXPORT_SPARSE_MODEL = 6
    UNDISTORTION = 7
    PATCH_MATCHING = 8
    STEREO_FUSION = 9
    POISSON_MESHING = 10
    CONVERT_TO_GLB = 11
    EXPORT_DENSE_MODEL = 12
    FINISHED = 13


class PhotogrammetryModel:
    def __init__(
        self, image_path: Path, output_file: Path | None = None, restart: bool = False
    ) -> None:
        """
        Arguments:
            image_path (Path): The path to the directory containing the input images.
            output_file (Path | None): The path to the output file where the generated .ply file will be saved. If None, the model will not be exported to a file.

        """
        self.output_dir = get_output_directory(image_path)
        self.database_path = self.output_dir / "database.db"
        self.image_dir = image_path
        self.output_file = output_file
        self.sparse_dir = self.output_dir / "sparse"
        self.dense_dir = self.output_dir / "dense"
        self.meshed_glb_path: Path = self.dense_dir / "meshed-poisson.glb"
        self.times = {}

        self.steps = {
            PhotogrammetryStep.LOADING: self.load_images,
            PhotogrammetryStep.FEATURE_EXTRACTION: self.extract_features,
            PhotogrammetryStep.FEATURE_MATCHING: self.feature_matching,
            PhotogrammetryStep.SPARSE_RECONSTRUCTION: self.sparse_reconstruction,
            PhotogrammetryStep.EXPORT_SPARSE_MODEL: self.export_sparse_model,
            PhotogrammetryStep.UNDISTORTION: self.undistort_images,
            PhotogrammetryStep.PATCH_MATCHING: self.patch_match,
            PhotogrammetryStep.STEREO_FUSION: self.stereo_fusion,
            PhotogrammetryStep.POISSON_MESHING: self.poisson_meshing,
            PhotogrammetryStep.CONVERT_TO_GLB: self.convert_to_glb,
            PhotogrammetryStep.EXPORT_DENSE_MODEL: self.export_model,
        }
        if restart:
            self.step = PhotogrammetryStep.INIT
            self.times = {}
        else:
            self.get_status()

        if (
            self.step.value < PhotogrammetryStep.EXPORT_SPARSE_MODEL.value
            or not self.sparse_dir.exists()
        ):
            self.reconstruction: pycolmap.Reconstruction | None = None
            self.sparse_dir.mkdir(exist_ok=True)
        else:
            self.reconstruction = pycolmap.Reconstruction(self.sparse_dir)

        if pycolmap.get_num_cuda_devices() > 0:
            self.device = "cuda"
        else:
            raise RuntimeError(
                "No CUDA devices available for pycolmap. Please ensure that you have a compatible GPU and the necessary drivers installed."
            )

    def get_status(self):
        try:
            with open(self.output_dir / "status.json") as f:
                status_json = json.load(f)
                self.times = status_json.get("times", {})
                self.step = PhotogrammetryStep[status_json.get("step", "INIT")]
        except Exception as e:
            print(f"Warning: Failed to read status file: {e}")
            self.step = PhotogrammetryStep.INIT
            self.times = {}
            self.save_status()

    def save_status(self):
        status_json = {
            "step": self.step.name,
            "times": self.times,
        }

        with open(self.output_dir / "status.json", "w") as f:
            json.dump(status_json, f, indent=4)

    def load_images(self):
        (self.output_dir / "images").mkdir(exist_ok=True)
        for item in self.image_dir.iterdir():
            if item.is_file():
                item.copy_into(self.output_dir / "images")

        self.image_dir = self.output_dir / "images"

    def extract_features(self):
        pycolmap.extract_features(
            database_path=self.database_path,
            image_path=self.image_dir,
            device=self.device,
        )

    def feature_matching(self):
        pycolmap.match_exhaustive(
            database_path=self.database_path,
            device=self.device,
        )

    def sparse_reconstruction(self):
        maps = pycolmap.incremental_mapping(
            database_path=self.database_path,
            image_path=self.image_dir,
            output_path=self.output_dir,
        )

        if not maps:
            raise RuntimeError("Sparse reconstruction failed.")

        reconstruction = max(maps.values(), key=lambda r: r.num_reg_images())
        self.reconstruction = reconstruction

        reconstruction.write(self.sparse_dir)

    def undistort_images(self):
        pycolmap.undistort_images(
            output_path=self.dense_dir,
            input_path=self.sparse_dir,
            image_path=self.image_dir,
        )

    def patch_match(self):
        options = pycolmap.PatchMatchOptions()

        options.max_image_size = 1200
        options.geom_consistency = True
        options.gpu_index = "0"

        pycolmap.patch_match_stereo(
            workspace_path=self.dense_dir,
            options=options,
        )

    def stereo_fusion(self):
        self.fused_path = self.dense_dir / "fused.ply"

        pycolmap.stereo_fusion(
            workspace_path=self.dense_dir,
            output_path=self.fused_path,
            input_type="geometric",
            output_type="ply",
        )

    def poisson_meshing(self):
        options = pycolmap.PoissonMeshingOptions()

        options.depth = 13
        options.point_weight = 1.0
        options.trim = 10.0
        options.color = True

        pycolmap.poisson_meshing(
            input_path=self.fused_path,
            output_path=self.dense_dir / "meshed-poisson.ply",
            options=options,
        )

        self.meshed_ply_path = self.dense_dir / "meshed-poisson.ply"

    def convert_to_glb(self):
        trimesh_mesh = trimesh.load_mesh(self.meshed_ply_path)
        trimesh_mesh.export(self.meshed_glb_path, file_type="glb")

    def export_sparse_model(self):
        if self.output_file is None:
            return

        if self.reconstruction is not None:
            print(f"Exporting sparse model to {self.output_file}")
            self.output_file.parent.mkdir(parents=True, exist_ok=True)
            self.reconstruction.export_PLY(self.output_file)
            return

        raise RuntimeError("No sparse reconstruction available; run pipeline first.")

    def export_model(self):
        if self.output_file is None:
            return

        if self.meshed_glb_path.exists():
            print(f"Exporting dense model to {self.output_file}")
            self.output_file.parent.mkdir(parents=True, exist_ok=True)
            self.meshed_glb_path.copy(self.output_file)
            return

        raise RuntimeError("No dense reconstruction available; run pipeline first.")

    async def run_pipeline(self) -> AsyncGenerator[PhotogrammetryStep]:
        for step in self.steps:
            if self.step.value >= step.value:
                continue

            start_time = time.perf_counter()
            self.steps[step]()
            end_time = time.perf_counter()
            self.step = step
            self.times[step.name] = end_time - start_time
            self.save_status()

            yield step

        yield PhotogrammetryStep.FINISHED
