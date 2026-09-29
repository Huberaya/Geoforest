"""Private local blob primitives. Authorization, quotas and scan state belong to
an authenticated service transaction, NOT to this filesystem adapter.

No public URL, overwrite or committed-blob deletion is provided here.
"""

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID, uuid4

MAX_BYTES = 20 * 1024 * 1024
CHUNK = 64 * 1024


class StorageError(Exception):
    pass


@dataclass(frozen=True)
class Blob:
    organization_id: UUID
    object_id: UUID
    size: int
    sha256: str
    storage_version: str | None = None


def identifier(value):
    if type(value) is not UUID:
        raise StorageError("UUID_REQUIRED")
    return value.hex


class LocalStore:
    def __init__(self, root: Path):
        # Provision separately. Never silently chmod a possibly shared directory.
        root = Path(root).absolute()
        if root.resolve() != root:
            raise StorageError("SYMLINK_ROOT_FORBIDDEN")
        self.root = root

    def _root_fd(self):
        fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            os.close(fd)
            raise StorageError("PRIVATE_ROOT_REQUIRED")
        return fd

    def _tenant_fd(self, organization_id, *, create=False):
        name = identifier(organization_id)
        root = self._root_fd()
        try:
            if create:
                try:
                    os.mkdir(name, 0o700, dir_fd=root)
                    os.fsync(root)
                except FileExistsError:
                    pass
            fd = os.open(
                name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root
            )
            info = os.fstat(fd)
            if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
                os.close(fd)
                raise StorageError("PRIVATE_TENANT_DIRECTORY_REQUIRED")
            return fd
        finally:
            os.close(root)

    def put_quarantined(self, organization_id, chunks, *, declared_size):
        identifier(organization_id)
        if type(declared_size) is not int or not 1 <= declared_size <= MAX_BYTES:
            raise StorageError("INVALID_DECLARED_SIZE")
        folder = self._tenant_fd(organization_id, create=True)
        object_id = uuid4()
        name = object_id.hex
        temporary = name + ".part"
        created = False
        try:
            fd = os.open(
                temporary,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
                dir_fd=folder,
            )
            created = True
            digest = hashlib.sha256()
            total = 0
            with os.fdopen(fd, "wb") as f:
                for index, chunk in enumerate(chunks):
                    if index >= 4096:
                        raise StorageError("UPLOAD_CHUNK_BUDGET")
                    if type(chunk) is not bytes or len(chunk) > CHUNK:
                        raise StorageError("INVALID_UPLOAD_CHUNK")
                    total += len(chunk)
                    if total > declared_size or total > MAX_BYTES:
                        raise StorageError("UPLOAD_SIZE_EXCEEDED")
                    f.write(chunk)
                    digest.update(chunk)
                if total != declared_size:
                    raise StorageError("UPLOAD_TRUNCATED")
                f.flush()
                os.fchmod(f.fileno(), 0o400)
                os.fsync(f.fileno())
            # link() is atomic and cannot replace an existing destination.
            os.link(
                temporary,
                name,
                src_dir_fd=folder,
                dst_dir_fd=folder,
                follow_symlinks=False,
            )
            os.unlink(temporary, dir_fd=folder)
            created = False
            os.fsync(folder)
            return Blob(organization_id, object_id, total, digest.hexdigest())
        finally:
            if created:
                os.unlink(temporary, dir_fd=folder)
            os.close(folder)

    def open_verified(self, blob: Blob):
        """Internal use only. A successful hash check does NOT release quarantine.

        Verify before returning any bytes; pin the opened inode across the check
        and read. This is not immutability against a compromised OS administrator.
        """
        if (
            type(blob) is not Blob
            or type(blob.size) is not int
            or not 1 <= blob.size <= MAX_BYTES
        ):
            raise StorageError("INVALID_BLOB")
        name = identifier(blob.object_id)
        folder = self._tenant_fd(blob.organization_id)
        try:
            fd = os.open(
                name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=folder
            )
        finally:
            os.close(folder)
        f = os.fdopen(fd, "rb")
        try:
            info = os.fstat(f.fileno())
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_size != blob.size
                or info.st_uid != os.getuid()
                or info.st_nlink != 1
                or stat.S_IMODE(info.st_mode) != 0o400
            ):
                raise StorageError("INVALID_STORED_OBJECT")
            digest = hashlib.sha256()
            total = 0
            while chunk := f.read(CHUNK):
                total += len(chunk)
                if total > blob.size:
                    raise StorageError("OBJECT_SIZE_CHANGED")
                digest.update(chunk)
            if total != blob.size or digest.hexdigest() != blob.sha256:
                raise StorageError("OBJECT_INTEGRITY_FAILED")
            f.seek(0)
            return f
        except BaseException:
            f.close()
            raise
