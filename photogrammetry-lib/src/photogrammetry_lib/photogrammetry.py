from collections.abc import AsyncGenerator
from enum import Enum
from pathlib import Path

import pycolmap

from .storage import get_output_directory


class PhotogrammetryStep(Enum):
    INIT = 1
    LOADING = 2
    FEATURE_EXTRACTION = 3
    FEATURE_MATCHING = 4
    SPARSE_RECONSTRUCTION = 5
    FINISHED = 6


class PhotogrammetryModel:
    def __init__(self, image_path: Path, output_file: Path | None = None):
        """
        Arguments:
            image_path (Path): The path to the directory containing the input images.
            output_file (Path | None): The path to the output file where the generated .ply file will be saved. If None, the model will not be exported to a file.

        """
        self.output_dir = get_output_directory(image_path)
        self.database_path = self.output_dir / "database.db"
        self.image_path = image_path
        self.output_file = output_file

        self.steps = {
            PhotogrammetryStep.LOADING: self.load_images,
            PhotogrammetryStep.FEATURE_EXTRACTION: self.extract_features,
            PhotogrammetryStep.FEATURE_MATCHING: self.feature_matching,
            PhotogrammetryStep.SPARSE_RECONSTRUCTION: self.sparse_reconstruction,
        }
        self.get_status()

        if self.step.value < PhotogrammetryStep.SPARSE_RECONSTRUCTION.value:
            self.reconstruction: pycolmap.Reconstruction | None = None
        else:
            sparse_dir = self.output_dir / "sparse"
            if not sparse_dir.exists():
                raise RuntimeError(f"Sparse reconstruction directory does not exist: {sparse_dir}")
            self.reconstruction = pycolmap.Reconstruction(sparse_dir)

        if pycolmap.has_cuda:
            self.device = "cuda"
        else:
            self.device = "cpu"

    def get_status(self):
        try:
            if (self.output_dir / "status.txt").exists():
                with open(self.output_dir / "status.txt") as f:
                    self.step = PhotogrammetryStep[f.read().strip()]
        except Exception as e:
            print(f"Warning: Failed to read status file: {e}")
            self.step = PhotogrammetryStep.INIT
            self.save_status()

    def save_status(self):
        with open(self.output_dir / "status.txt", "w") as f:
            f.write(self.step.name)

    def load_images(self):
        (self.output_dir / "images").mkdir(exist_ok=True)
        for item in self.image_path.iterdir():
            if item.is_file():
                item.copy_into(self.output_dir / "images")

        self.image_path = self.output_dir / "images"

    def extract_features(self):
        pycolmap.extract_features(
            database_path=self.database_path,
            image_path=self.image_path,
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
            image_path=self.image_path,
            output_path=self.output_dir,
        )

        if not maps:
            raise RuntimeError("Sparse reconstruction failed.")

        reconstruction = max(maps.values(), key=lambda r: r.num_reg_images())
        self.reconstruction = reconstruction

        sparse_dir = self.output_dir / "sparse"
        sparse_dir.mkdir(exist_ok=True)

        reconstruction.write(sparse_dir)

    def export_model(self):
        if self.output_file is None:
            return
        if self.reconstruction is None:
            raise RuntimeError("No reconstruction available; run sparse_reconstruction first.")

        self.output_file.parent.mkdir(parents=True, exist_ok=True)

        self.reconstruction.export_PLY(self.output_file)

    async def run_pipeline(self) -> AsyncGenerator[PhotogrammetryStep]:
        for step in self.steps:
            if self.step.value >= step.value:
                continue

            self.steps[step]()
            self.step = step
            self.save_status()

            yield step

        yield PhotogrammetryStep.FINISHED
