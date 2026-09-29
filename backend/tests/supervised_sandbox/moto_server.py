"""Loopback-only S3 emulator, fake data. Not a provider or production service."""

from moto.server import DomainDispatcherApplication, create_backend_app
from werkzeug.serving import run_simple

if __name__ == "__main__":
    run_simple(
        "127.0.0.1",
        5017,
        DomainDispatcherApplication(create_backend_app),
        threaded=True,
    )
