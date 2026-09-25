"""Backward-compat alias pour RateLimitMiddleware.

Le vrai middleware est dans security.py. Ce module ré-exporte RateLimitMiddleware
pour éviter les imports cassés.
"""
from app.middleware.security import RateLimitMiddleware  # noqa: F401
