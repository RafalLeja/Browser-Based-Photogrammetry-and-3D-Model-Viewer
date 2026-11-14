import hashlib
from pathlib import Path

import pytest

from photogrammetry_lib import storage
from photogrammetry_lib.storage import dir_hash, get_output_directory


def write(path: Path, content: bytes) -> None:
    """Helper to create a file with nested parent directories."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(content)


def expected_dir_hash(file_contents: list[bytes]) -> str:
    """Recompute the expected dir_hash independently of the implementation."""
    file_hashes = sorted(
        hashlib.sha256(content).hexdigest() for content in file_contents
    )
    return hashlib.sha256("".join(file_hashes).encode()).hexdigest()


# --- dir_hash: correctness against a manual reference computation ---


def test_empty_dir_hash(tmp_path: Path) -> None:
    assert dir_hash(tmp_path) == expected_dir_hash([])


def test_single_file_hash_matches_reference(tmp_path: Path) -> None:
    write(tmp_path / "a.txt", b"hello world")
    assert dir_hash(tmp_path) == expected_dir_hash([b"hello world"])


def test_multiple_files_match_reference(tmp_path: Path) -> None:
    write(tmp_path / "a.txt", b"alpha")
    write(tmp_path / "b.txt", b"beta")
    write(tmp_path / "c.bin", b"\x00\x01\x02\x03")
    assert dir_hash(tmp_path) == expected_dir_hash(
        [b"alpha", b"beta", b"\x00\x01\x02\x03"]
    )


def test_empty_file_matches_reference(tmp_path: Path) -> None:
    write(tmp_path / "empty.txt", b"")
    assert dir_hash(tmp_path) == expected_dir_hash([b""])


# --- dir_hash: behavioral properties ---


def test_content_change_changes_hash(tmp_path: Path) -> None:
    write(tmp_path / "a.txt", b"original content")
    hash_before = dir_hash(tmp_path)

    write(tmp_path / "a.txt", b"modified content")
    assert dir_hash(tmp_path) != hash_before


def test_file_names_do_not_affect_hash(tmp_path: Path) -> None:
    d1 = tmp_path / "one"
    d2 = tmp_path / "two"
    write(d1 / "foo.txt", b"same bytes")
    write(d2 / "completely-different-name.bin", b"same bytes")
    assert dir_hash(d1) == dir_hash(d2)


def test_creation_order_does_not_affect_hash(tmp_path: Path) -> None:
    d1 = tmp_path / "one"
    d2 = tmp_path / "two"
    write(d1 / "a.txt", b"first")
    write(d1 / "b.txt", b"second")
    # d2 gets the same files, but created in reverse order
    write(d2 / "b.txt", b"second")
    write(d2 / "a.txt", b"first")
    assert dir_hash(d1) == dir_hash(d2)


def test_nested_files_are_included(tmp_path: Path) -> None:
    write(tmp_path / "subdir" / "deep" / "nested.txt", b"deeply nested")
    assert dir_hash(tmp_path) == expected_dir_hash([b"deeply nested"])


def test_adding_a_file_changes_hash(tmp_path: Path) -> None:
    write(tmp_path / "a.txt", b"one")
    hash_before = dir_hash(tmp_path)

    write(tmp_path / "b.txt", b"two")
    assert dir_hash(tmp_path) != hash_before


def test_deleting_a_file_changes_hash(tmp_path: Path) -> None:
    write(tmp_path / "a.txt", b"one")
    write(tmp_path / "b.txt", b"two")
    hash_before = dir_hash(tmp_path)

    (tmp_path / "b.txt").unlink()
    assert dir_hash(tmp_path) != hash_before


def test_large_file_is_hashed_correctly(tmp_path: Path) -> None:
    # Larger than the 1 MiB chunk size used in the implementation
    large_content = b"x" * (1024 * 1024 + 12345)
    write(tmp_path / "large.bin", large_content)
    assert dir_hash(tmp_path) == expected_dir_hash([large_content])


# --- dir_hash: invalid inputs ---


def test_missing_dir_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        dir_hash(tmp_path / "does-not-exist")


def test_file_instead_of_dir_raises(tmp_path: Path) -> None:
    file_path = tmp_path / "a_file.txt"
    file_path.write_bytes(b"data")
    with pytest.raises(NotADirectoryError):
        dir_hash(file_path)


# --- get_output_directory ---


@pytest.fixture
def isolated_storage_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point STORAGE_DIR at a temporary directory so tests don't touch $HOME."""
    storage_dir = tmp_path / "storage"
    monkeypatch.setattr(storage, "STORAGE_DIR", storage_dir)
    return storage_dir


def test_output_dir_is_inside_storage_dir(
    tmp_path: Path, isolated_storage_dir: Path
) -> None:
    write(tmp_path / "photos" / "img.jpg", b"image bytes")

    result = get_output_directory(tmp_path / "photos")

    assert result.parent == isolated_storage_dir


def test_output_dir_name_is_16_char_hash_prefix(
    tmp_path: Path, isolated_storage_dir: Path
) -> None:
    photos = tmp_path / "photos"
    write(photos / "img.jpg", b"image bytes")

    result = get_output_directory(photos)

    expected_name = dir_hash(photos)[:16]
    assert result.name == expected_name
    assert len(result.name) == 16


def test_output_dir_is_created(tmp_path: Path, isolated_storage_dir: Path) -> None:
    write(tmp_path / "photos" / "img.jpg", b"image bytes")
    result = get_output_directory(tmp_path / "photos")
    assert result.is_dir()


def test_same_photos_yield_same_output_dir(
    tmp_path: Path, isolated_storage_dir: Path
) -> None:
    d1 = tmp_path / "one"
    d2 = tmp_path / "two"
    write(d1 / "img.jpg", b"identical photos")
    write(d2 / "other-name.jpg", b"identical photos")  # same content, different name

    assert get_output_directory(d1) == get_output_directory(d2)


def test_different_photos_yield_different_output_dirs(
    tmp_path: Path, isolated_storage_dir: Path
) -> None:
    d1 = tmp_path / "one"
    d2 = tmp_path / "two"
    write(d1 / "img.jpg", b"photo set one")
    write(d2 / "img.jpg", b"photo set two")

    assert get_output_directory(d1) != get_output_directory(d2)
