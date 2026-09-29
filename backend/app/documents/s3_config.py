"""Storage-only configuration, also usable by a worker without Clerk secrets."""

import re
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ObjectStorageSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=None, extra="ignore", hide_input_in_errors=True
    )
    app_env: str = "development"
    document_storage_backend: Literal["local", "s3"] = "local"
    document_s3_endpoint: str = ""
    document_s3_region: str = ""
    document_s3_bucket: str = ""
    document_s3_access_key: str = Field(default="", repr=False)
    document_s3_secret_key: str = Field(default="", repr=False)
    document_s3_local_test: bool = False

    @model_validator(mode="after")
    def valid_storage(self):
        if self.document_storage_backend != "s3":
            return self
        u = urlsplit(self.document_s3_endpoint)
        if (
            u.username
            or u.password
            or u.query
            or u.fragment
            or u.path
            or not u.hostname
            or any(c.isspace() for c in self.document_s3_endpoint)
        ):
            raise ValueError("S3 endpoint must be an explicit origin")
        _ = u.port
        if self.document_s3_local_test:
            if (
                self.app_env != "test"
                or u.scheme != "http"
                or u.hostname != "127.0.0.1"
            ):
                raise ValueError(
                    "Insecure S3 is restricted to loopback in APP_ENV=test"
                )
        elif u.scheme != "https" or u.hostname in {"localhost", "127.0.0.1", "::1"}:
            raise ValueError("S3 requires verified HTTPS")
        if (
            not re.fullmatch(
                r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", self.document_s3_bucket
            )
            or not re.fullmatch(r"[a-z0-9-]{2,64}", self.document_s3_region)
            or not self.document_s3_access_key
            or not self.document_s3_secret_key
        ):
            raise ValueError("Explicit bucket, region and storage credentials required")
        return self
