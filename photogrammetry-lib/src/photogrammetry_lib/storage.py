import hashlib
from pathlib import Path


STORAGE_DIR = Path.home() / ".bbpa3mv" / "storage"


def dir_hash(dir: Path) -> str:
    """
    Generate a hash for the given directory based on its contents, not file names.

    Args:
        dir (Path): The directory to hash.

    Returns:
        str: A hash string representing the contents of the directory.
    """

    if not dir.exists():
        raise FileNotFoundError(f"Directory does not exist: {dir}")
    if not dir.is_dir():
        raise NotADirectoryError(f"Path is not a directory: {dir}")

    directory_hash = hashlib.sha256()

    files = [p for p in dir.rglob("*") if p.is_file()]

    file_hashes = []

    for file in files:
        file_hash = hashlib.sha256()

        with open(file, "rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                file_hash.update(chunk)

        file_hashes.append(file_hash.hexdigest())

    for file_hash in sorted(file_hashes):
        directory_hash.update(file_hash.encode())

    return directory_hash.hexdigest()


def get_output_directory(photo_dir: Path) -> Path:
    """
    Get the output directory for the generated 3D model based on the input photo directory.

    Args:
        photo_dir (Path): The directory containing the photos.

    Returns:
        output_dir (Path): The directory where the generated 3D model can be saved.
    """
    directory_hash = dir_hash(photo_dir)[:16]

    output_dir = STORAGE_DIR / directory_hash
    output_dir.mkdir(parents=True, exist_ok=True)
    return output_dir
