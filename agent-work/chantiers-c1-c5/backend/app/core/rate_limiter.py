"""Rate limiting minimal en mémoire pour protéger les endpoints sensibles.

NOTE : pour la production horizontale (multi-workers), un store Redis devra être
utilisé. Ce module est une implémentation simple adaptée au MVP / dev, et pour la
protection basique contre le brute-force sur /auth/login.
"""
from __future__ import annotations

import time
from collections import defaultdict
from threading import Lock


class InMemoryRateLimiter:
    def __init__(self, window_seconds: int, max_requests: int):
        self.window_seconds = window_seconds
        self.max_requests = max_requests
        self._hits: dict[str, list[float]] = defaultdict(list)
        self._lock = Lock()

    def _cleanup(self, key: str, now: float) -> None:
        cutoff = now - self.window_seconds
        self._hits[key] = [t for t in self._hits[key] if t > cutoff]

    def hit(self, key: str) -> tuple[bool, int]:
        """Enregistre un hit. Retourne (allowed: bool, remaining: int)."""
        now = time.monotonic()
        with self._lock:
            self._cleanup(key, now)
            hits = self._hits[key]
            if len(hits) >= self.max_requests:
                return False, 0
            hits.append(now)
            return True, self.max_requests - len(hits)

    def reset(self, key: str) -> None:
        with self._lock:
            self._hits.pop(key, None)


# 5 tentatives de login par IP / minute (brute-force léger)
login_limiter = InMemoryRateLimiter(window_seconds=60, max_requests=10)
# Liens fournisseur : 5 demandes/heure par IP + adresse (la clé email est hachée avant usage).
supplier_link_request_limiter = InMemoryRateLimiter(window_seconds=3600, max_requests=5)
# Défense en profondeur contre le rejeu/brute-force des jetons d'accès fournisseur.
supplier_link_accept_limiter = InMemoryRateLimiter(window_seconds=60, max_requests=20)
# 60 requêtes/min par IP sur le reste de l'API (simple garde-fou)
api_limiter = InMemoryRateLimiter(window_seconds=60, max_requests=300)
