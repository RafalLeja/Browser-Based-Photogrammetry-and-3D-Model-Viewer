import asyncio
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from pathlib import Path


@dataclass
class PhotogrammetryProgress:
    """Represents the progress of the photogrammetry process.

    Attributes:
        status (str): The current status of the process (e.g., "success", "error", "in_progress").
        step (str): The current step in the process (e.g., "2/7").
        step_progress (int): The progress of the current step as a percentage (0-100).
        step_description (str): A description of the current step (e.g., "Generating 3D model from photos").
    """

    status: str
    step: str
    step_progress: int
    step_description: str


async def get_model_from_photos(
    photo_dir: Path, output_file: Path
) -> AsyncGenerator[PhotogrammetryProgress]:
    """
    Generate a 3D model from photos in the specified directory.

    Args:
        photo_dir (Path): The directory containing the photos.
        output_file (Path): The path where the generated 3D model will be saved.

    Returns:
        PhotogrammetryProgress: An object containing the progress of the photogrammetry process.
    """
    for step in range(1, 8):
        # Simulate processing time for each step
        for percentage in range(0, 101, 10):
            await asyncio.sleep(
                0.1
            )  # Simulate time taken for each percentage increment
            yield PhotogrammetryProgress(
                status="in_progress",
                step=f"{step}/7",
                step_progress=percentage,
                step_description=f"Processing step {step} of 7",
            )
