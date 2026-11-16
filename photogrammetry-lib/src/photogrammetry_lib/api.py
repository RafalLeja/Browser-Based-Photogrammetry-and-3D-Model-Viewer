from collections.abc import AsyncGenerator
from dataclasses import dataclass
from pathlib import Path

from .photogrammetry import PhotogrammetryModel, PhotogrammetryStep


PIPELINE_STEPS = 4


@dataclass
class PhotogrammetryProgress:
    """Represents the progress of the photogrammetry process.

    Attributes:
        status (str): The current status of the process (e.g. "success", "error", "in_progress").
        step (str): The current step in the process (e.g. "2/4").
        step_description (str): A description of the current step (e.g. "Generating 3D model from photos").
    """

    status: str
    step: str
    step_description: str


async def get_model_from_photos(
    photo_dir: Path, output_file: Path
) -> AsyncGenerator[PhotogrammetryProgress]:
    """
    Generate a 3D model from photos in the specified directory.

    Each pipeline step runs in a worker thread (via ``asyncio.to_thread``) so
    that the blocking pycolmap work does not stall the event loop. Progress
    is yielded before and after every step.

    Args:
        photo_dir (Path): The directory containing the photos.
        output_file (Path): The path where the generated 3D model will be saved.

    Yields:
        PhotogrammetryProgress: An object containing the progress of the photogrammetry process.
    """
    model = PhotogrammetryModel(photo_dir, output_file)

    descriptions = {
        PhotogrammetryStep.LOADING: "Loading photos",
        PhotogrammetryStep.FEATURE_EXTRACTION: "Extracting features",
        PhotogrammetryStep.FEATURE_MATCHING: "Matching features",
        PhotogrammetryStep.SPARSE_RECONSTRUCTION: "Generating 3D model from photos",
        PhotogrammetryStep.FINISHED: "3D model generated successfully",
    }

    total_steps = max(model.steps, key=lambda step: step.value).value + 1

    try:
        async for step in model.run_pipeline():
            yield PhotogrammetryProgress(
                status="in_progress",
                step=f"{step.value}/{total_steps}",
                step_description=descriptions[step],
            )

    except Exception as error:
        yield PhotogrammetryProgress(
            status="error",
            step="0",
            step_progress=0,
            step_description=f"Pipeline failed: {error}",
        )
