"""Bounded, authenticated files. Keys are separate from the backup directory.

No extraction of archives, filenames from users, or overwrite. This is not a
secure-erasure mechanism and does not establish offsite durability by itself.
"""

import hashlib
import json
import os
import re
import stat
from pathlib import Path
from uuid import uuid4

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

MAX_DUMP = 64 * 1024**2
MAX_TOTAL = 256 * 1024**2
MAX_MANIFEST = 2 * 1024**2
MAX_ITEMS = 2048
AAD = b"geoforest-document-recovery-v1/"


class RecoveryError(Exception):
    pass


def private_directory(path):
    p = Path(path).absolute()
    if p.resolve() != p:
        raise RecoveryError("UNSAFE_DIRECTORY")
    s = p.stat()
    if (
        not stat.S_ISDIR(s.st_mode)
        or s.st_uid != os.getuid()
        or stat.S_IMODE(s.st_mode) != 0o700
    ):
        raise RecoveryError("PRIVATE_DIRECTORY_REQUIRED")
    return p


def private_read(path, limit):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as f:
        s = os.fstat(f.fileno())
        if (
            not stat.S_ISREG(s.st_mode)
            or s.st_uid != os.getuid()
            or s.st_nlink != 1
            or stat.S_IMODE(s.st_mode) != 0o600
            or s.st_size > limit
        ):
            raise RecoveryError("UNSAFE_OR_OVERSIZED_FILE")
        data = f.read(limit + 1)
        if len(data) > limit:
            raise RecoveryError("FILE_LIMIT")
        return data


def load_key(path, backup_directory):
    p = Path(path).absolute()
    if p.resolve() != p or p.is_relative_to(Path(backup_directory).absolute()):
        raise RecoveryError("KEY_MUST_BE_SEPARATE")
    key = private_read(p, 32)
    if len(key) != 32:
        raise RecoveryError("KEY_MUST_BE_32_RANDOM_BYTES")
    return key


def write_private(path, payload):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "wb") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(payload)
        f.flush()
        os.fsync(f.fileno())


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def filename(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}\.gcm", value):
        raise RecoveryError("INVALID_ARCHIVE_FILENAME")
    return value


def encrypt_file(directory, key, data, name=None):
    name = filename(name or uuid4().hex + ".gcm")
    if len(data) > MAX_DUMP:
        raise RecoveryError("FILE_LIMIT")
    nonce = os.urandom(12)
    write_private(
        directory / name, nonce + AESGCM(key).encrypt(nonce, data, AAD + name.encode())
    )
    return {"file": name, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def read_payload(directory, key, entry):
    name = filename(entry["file"])
    if type(entry["size"]) is not int or not 0 <= entry["size"] <= MAX_DUMP:
        raise RecoveryError("FILE_LIMIT")
    raw = private_read(directory / name, MAX_DUMP + 28)
    try:
        data = AESGCM(key).decrypt(raw[:12], raw[12:], AAD + name.encode())
    except Exception:
        raise RecoveryError("ARCHIVE_AUTHENTICATION_FAILED") from None
    if (
        len(data) != entry["size"]
        or hashlib.sha256(data).hexdigest() != entry["sha256"]
    ):
        raise RecoveryError("ARCHIVE_INTEGRITY_FAILED")
    return data


def seal(directory, key, manifest):
    data = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    if len(data) > MAX_MANIFEST:
        raise RecoveryError("MANIFEST_LIMIT")
    nonce = os.urandom(12)
    # Last write is the completion marker. A partial backup is never restorable.
    write_private(
        directory / "manifest.gcm",
        nonce + AESGCM(key).encrypt(nonce, data, AAD + b"manifest"),
    )
    sync_directory(directory)


def read_manifest(directory, key):
    raw = private_read(directory / "manifest.gcm", MAX_MANIFEST + 28)
    try:
        return json.loads(AESGCM(key).decrypt(raw[:12], raw[12:], AAD + b"manifest"))
    except Exception:
        raise RecoveryError("MANIFEST_AUTHENTICATION_FAILED") from None
