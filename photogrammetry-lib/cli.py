import argparse
import asyncio
import sys
from pathlib import Path

from photogrammetry_lib import PhotogrammetryProgress, get_model_from_photos


def print_progress(progress: PhotogrammetryProgress) -> None:
    print(f"[{progress.status}] step {progress.step}: {progress.step_description}")


async def run(photo_dir: Path, output_file: Path) -> PhotogrammetryProgress:
    last_progress: PhotogrammetryProgress | None = None
    async for progress in get_model_from_photos(photo_dir, output_file):
        print_progress(progress)
        last_progress = progress

    assert last_progress is not None
    return last_progress


def main() -> None:
    arg_parser = argparse.ArgumentParser(
        description="Generate a 3D model from a directory of photos"
    )
    arg_parser.add_argument(
        "-i",
        "--input",
        type=Path,
        required=True,
        help="Input directory containing photos",
    )
    arg_parser.add_argument(
        "-o",
        "--output",
        type=Path,
        required=True,
        help="Output path for the generated model (.ply file, or a directory for the sparse model)",
    )
    args = arg_parser.parse_args()

    if not args.input.is_dir():
        arg_parser.error(f"Input directory does not exist: {args.input}")

    try:
        last_progress = asyncio.run(run(args.input, args.output))
    except KeyboardInterrupt:
        print("Interrupted.", file=sys.stderr)
        sys.exit(130)

    if last_progress.status == "error":
        sys.exit(1)


if __name__ == "__main__":
    main()
