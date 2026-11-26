from pathlib import Path

from photogrammetry_lib.storage import STORAGE_DIR as WORKSPACES  # a path constant; pycolmap is not loaded

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


def owned_folder(settings: Settings, folder: Path) -> bool:
    """Whether `folder` is one we created and may delete: inside the storage dir or COLMAP's workspaces."""
    folder = folder.resolve()
    roots = (settings.storage_dir.resolve(), WORKSPACES.resolve())
    return any(folder != root and folder.is_relative_to(root) for root in roots)
