"""The stages a reconstruction goes through, as the UI shows them. Both pipelines report these keys."""

STAGES: tuple[tuple[str, str, str], ...] = (
    ("upload", "Photos received", "Photos are checked and copied into the workspace."),
    ("features", "Finding features", "Distinctive points are detected in every photo."),
    ("matching", "Matching photos", "Photos that show the same points are paired up."),
    ("sparse", "Placing cameras", "Camera positions and a sparse point cloud are solved."),
    ("dense", "Measuring depth", "Depth is estimated for every pixel and fused into a dense cloud."),
    ("mesh", "Building the surface", "A watertight surface is fitted to the dense cloud."),
    ("optimize", "Cleaning up", "Stray fragments are removed, the model is turned upright and slimmed."),
    ("publish", "Publishing", "The model is added to the collection."),
)

STAGE_KEYS = tuple(key for key, _, _ in STAGES)


def progress_at(stage: str) -> int:
    """Progress in percent when `stage` starts: stages are spread evenly from 0 to 100."""
    return round(STAGE_KEYS.index(stage) * 100 / len(STAGE_KEYS))
