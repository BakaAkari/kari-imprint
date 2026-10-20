"""Private scratch lifecycles, independent of source and publication availability."""
from __future__ import annotations

import errno
import os
from contextlib import suppress
from pathlib import Path
from uuid import uuid4


class StorageUnavailable(Exception):
    """Only this allowlisted diagnostic crosses the API boundary."""

    def __init__(self, code):
        self.code = code
        super().__init__(code)


def workspace(root: Path, name: str, *, code: str, check_parent: bool = False) -> Path:
    """Never recreate a missing mount or follow a replaced scratch-root symlink."""
    try:
        fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            if check_parent:
                probe = '.ki-probe-' + uuid4().hex
                probe_fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
                os.close(probe_fd)
                os.unlink(probe, dir_fd=fd)
            with suppress(FileExistsError):
                os.mkdir(name, 0o700, dir_fd=fd)
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            try:
                probe = '.probe-' + uuid4().hex
                probe_fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=child)
                os.close(probe_fd)
                os.unlink(probe, dir_fd=child)
            finally:
                os.close(child)
        finally:
            os.close(fd)
    except OSError as exc:
        if exc.errno in {errno.ELOOP, errno.ENOTDIR}:
            raise ValueError('unsafe_workspace') from None
        raise StorageUnavailable(code) from None
    return root / name
