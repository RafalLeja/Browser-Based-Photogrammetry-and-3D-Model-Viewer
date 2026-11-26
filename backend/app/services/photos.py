"""Stores uploaded photos safely.

Every file is checked by its content (magic bytes), not its name, and saved under a name we
generate. Names inside a zip are never used as paths, so a zip cannot write outside the
upload folder (zip slip). Sizes are counted while copying, never taken from headers.
"""

import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

CHUNK = 1024 * 1024
# A photo barely compresses; a much higher ratio means a zip bomb.
MAX_ZIP_RATIO = 50

SIGNATURES: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xd8\xff", ".jpg"),
    (b"\x89PNG\r\n\x1a\n", ".png"),
)


class PhotoError(ValueError):
    """The upload breaks a rule. The message is safe to show to the user."""

    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass(frozen=True)
class Limits:
    min_photos: int
    max_photos: int
    max_photo_bytes: int
    max_upload_bytes: int


def sniff(head: bytes) -> str | None:
    for signature, extension in SIGNATURES:
        if head.startswith(signature):
            return extension
    return None


class PhotoWriter:
    def __init__(self, dest: Path, limits: Limits) -> None:
        self.dest = dest
        self.limits = limits
        self.count = 0
        self.total = 0
        self.skipped = 0
        dest.mkdir(parents=True, exist_ok=True)

    def add_stream(self, stream: BinaryIO, display_name: str, *, from_zip: bool = False) -> None:
        head = stream.read(16)
        extension = sniff(head)
        if extension is None:
            if from_zip:  # Archives often carry readme files or thumbnails; they are not photos.
                self.skipped += 1
                return
            raise PhotoError(f"“{display_name}” is not a JPEG or PNG photo.")
        if self.count >= self.limits.max_photos:
            raise PhotoError(f"Too many photos: the limit is {self.limits.max_photos}.", 413)

        target = self.dest / f"{self.count + 1:04d}{extension}"
        size = len(head)
        with open(target, "wb") as out:
            out.write(head)
            while chunk := stream.read(CHUNK):
                size += len(chunk)
                self._check_size(size, display_name)
                out.write(chunk)
        self._check_size(size, display_name)
        self.count += 1
        self.total += size

    def add_zip(self, stream: BinaryIO, display_name: str) -> None:
        try:
            archive = zipfile.ZipFile(stream)
        except zipfile.BadZipFile as error:
            raise PhotoError(f"“{display_name}” is not a valid zip file.") from error
        with archive:
            for entry in archive.infolist():
                name = entry.filename.rsplit("/", 1)[-1]
                if entry.is_dir() or not name or name.startswith(".") or "__MACOSX" in entry.filename:
                    continue
                if entry.file_size > self.limits.max_photo_bytes:
                    raise PhotoError(f"“{name}” in the zip is larger than the photo limit.", 413)
                if entry.compress_size and entry.file_size / entry.compress_size > MAX_ZIP_RATIO:
                    raise PhotoError(f"“{display_name}” looks like a zip bomb and was rejected.", 413)
                with archive.open(entry) as member:
                    self.add_stream(member, name, from_zip=True)

    def finish(self) -> int:
        if self.count < self.limits.min_photos:
            raise PhotoError(
                f"At least {self.limits.min_photos} photos are needed; 30 or more give the best result."
            )
        return self.count

    def discard(self) -> None:
        shutil.rmtree(self.dest, ignore_errors=True)

    def _check_size(self, size: int, display_name: str) -> None:
        # No clean-up here: the caller discards the whole upload folder on any PhotoError.
        if size > self.limits.max_photo_bytes:
            mb = self.limits.max_photo_bytes // (1024 * 1024)
            raise PhotoError(f"“{display_name}” is larger than {mb} MB.", 413)
        if self.total + size > self.limits.max_upload_bytes:
            raise PhotoError("The upload is larger than the total size limit.", 413)
