"""Descriptor-relative IO: reject symlinks at every untrusted path component."""
from __future__ import annotations

import hashlib
import os
import stat
from contextlib import contextmanager, suppress
from pathlib import Path, PurePosixPath


def relative_path(original: str, prefix: str) -> str:
    if not original.startswith('/') or any(p in {'.', '..', ''} for p in original.split('/')[1:]):
        raise ValueError('unsafe_path')
    relative = PurePosixPath(original).relative_to(PurePosixPath(prefix))
    parts = relative.parts
    if not parts or any(p.startswith('.') for p in parts) or relative.suffix.lower() not in {'.jpg', '.jpeg', '.png'}:
        raise ValueError('unsupported_path')
    return relative.as_posix()


def output_relative(relative: str, imprint: str) -> str:
    """Map a source-relative path to its published location under the imprint dir.

    An empty imprint means the output root already is the imprint directory
    (archive mode), so the relative path is used unchanged.
    """
    parts = PurePosixPath(relative).parts
    if not parts or relative.startswith('/') or any(p in {'.', '..'} for p in parts):
        raise ValueError('unsafe_path')
    if not imprint:
        return relative
    imprint_parts = PurePosixPath(imprint).parts
    if (PurePosixPath(imprint).is_absolute() or len(imprint_parts) != 1
            or imprint in {'.', '..'} or imprint.startswith('.') or len(imprint) > 64):
        raise ValueError('invalid_imprint_dir')
    return f'{imprint}/{relative}'


@contextmanager
def parent_fd(root: Path, relative: str, *, create: bool = False):
    parts = PurePosixPath(relative).parts
    if not parts or relative.startswith('/') or any(p in {'.', '..'} for p in parts):
        raise ValueError('unsafe_path')
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in parts[:-1]:
            if create:
                with suppress(FileExistsError):
                    os.mkdir(part, 0o750, dir_fd=fd)
            new = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = new
        yield fd, parts[-1]
    finally:
        os.close(fd)


@contextmanager
def open_source(root: Path, relative: str):
    with parent_fd(root, relative) as (directory, name):
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory)
        with os.fdopen(fd, 'rb') as source:
            if not stat.S_ISREG(os.fstat(source.fileno()).st_mode):
                raise ValueError('not_regular_file')
            yield source


def digest_file(file, maximum: int) -> str:
    digest = hashlib.sha256()
    size = 0
    while chunk := file.read(1024 * 1024):
        size += len(chunk)
        if size > maximum:
            raise ValueError('file_too_large')
        digest.update(chunk)
    return digest.hexdigest()


def snapshot(root: Path, relative: str, target: Path, maximum: int) -> str:
    with open_source(root, relative) as source, target.open('xb') as dest:
        before = os.fstat(source.fileno())
        if before.st_size > maximum:
            raise ValueError('file_too_large')
        size = 0
        digest = hashlib.sha256()
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > maximum:
                raise ValueError('file_too_large')
            digest.update(chunk)
            dest.write(chunk)
        after = os.fstat(source.fileno())
        if (before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_size, after.st_mtime_ns, after.st_ctime_ns):
            raise ValueError('source_changed')
        dest.flush()
        os.fsync(dest.fileno())
        return digest.hexdigest()
