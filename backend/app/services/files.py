from pathlib import Path

from app.core.config import Settings

SAMPLES_PREFIX = "samples:"


def resolve(settings: Settings, stored: str) -> Path:
    """Maps a stored path ("samples:models/x.glb" or "models/3/model.glb") to a file on disk."""
    if stored.startswith(SAMPLES_PREFIX):
        root, relative = settings.samples_dir, stored.removeprefix(SAMPLES_PREFIX)
    else:
        root, relative = settings.storage_dir, stored
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):  # Stored paths are ours, but never trust a path blindly.
        raise ValueError(f"path escapes its root: {stored}")
    return path


def is_sample(stored: str | None) -> bool:
    return bool(stored) and stored.startswith(SAMPLES_PREFIX)
