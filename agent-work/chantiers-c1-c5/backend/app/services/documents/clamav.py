"""Client minimal du protocole INSTREAM de clamd; aucune donnée du fichier n'est journalisée."""
from __future__ import annotations

import socket
import struct

from app.core.config import settings


class ScannerUnavailable(RuntimeError):
    pass


class MalwareDetected(RuntimeError):
    pass


def scan_bytes(data: bytes) -> tuple[str, str]:
    host = settings.clamav_host.strip()
    if not host:
        raise ScannerUnavailable("Scanner antivirus non configuré.")
    try:
        with socket.create_connection((host, settings.clamav_port), timeout=12) as sock:
            sock.settimeout(20)
            sock.sendall(b"zINSTREAM\0")
            for start in range(0, len(data), 64 * 1024):
                chunk = data[start : start + 64 * 1024]
                sock.sendall(struct.pack("!I", len(chunk)))
                sock.sendall(chunk)
            sock.sendall(struct.pack("!I", 0))
            response = bytearray()
            while len(response) < 4096:
                part = sock.recv(512)
                if not part:
                    break
                response.extend(part)
                if b"\0" in response or b"\n" in response:
                    break
    except (OSError, TimeoutError) as exc:
        raise ScannerUnavailable("Scanner antivirus indisponible.") from exc

    result = bytes(response).rstrip(b"\0\r\n").decode("utf-8", errors="replace")
    if result.endswith(": OK") or result == "stream: OK":
        return "ClamAV", "clean"
    if "FOUND" in result:
        raise MalwareDetected("Le fichier a été détecté comme malveillant.")
    raise ScannerUnavailable("Réponse antivirus inexploitable.")
