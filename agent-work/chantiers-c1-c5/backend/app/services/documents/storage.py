"""Stockage objet privé S3/MinIO; les clés ne contiennent jamais le nom fourni par le client."""
from __future__ import annotations

from urllib.parse import quote

from botocore.config import Config
from botocore.exceptions import ClientError, BotoCoreError

from app.core.config import settings


class StorageUnavailable(RuntimeError):
    pass


def _client(*, public_endpoint: bool = False):
    try:
        import boto3

        endpoint = settings.s3_public_endpoint_url.strip() if public_endpoint else (settings.s3_endpoint_url or None)
        if public_endpoint and not endpoint:
            return None
        return boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=settings.s3_access_key or None,
            aws_secret_access_key=settings.s3_secret_key or None,
            region_name=settings.s3_region,
            config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
        )
    except Exception as exc:
        raise StorageUnavailable("Stockage objet indisponible.") from exc


def _ensure_bucket(client) -> None:
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if code not in {"404", "NoSuchBucket", "NotFound"} and status != 404:
            raise StorageUnavailable("Le bucket privé n'est pas accessible.") from exc
        try:
            args = {"Bucket": settings.s3_bucket}
            if settings.s3_region and settings.s3_region != "us-east-1":
                args["CreateBucketConfiguration"] = {"LocationConstraint": settings.s3_region}
            client.create_bucket(**args)
        except (ClientError, BotoCoreError) as create_exc:
            raise StorageUnavailable("Impossible d'initialiser le bucket privé.") from create_exc


def put_bytes(key: str, data: bytes, content_type: str, sha256: str) -> None:
    client = _client()
    try:
        _ensure_bucket(client)
        client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
            Metadata={"sha256": sha256},
        )
    except (ClientError, BotoCoreError) as exc:
        raise StorageUnavailable("Échec du dépôt dans le stockage objet.") from exc


def get_bytes(key: str) -> bytes:
    client = _client()
    try:
        response = client.get_object(Bucket=settings.s3_bucket, Key=key)
        body = response["Body"]
        try:
            return body.read()
        finally:
            body.close()
    except (ClientError, BotoCoreError, KeyError) as exc:
        raise StorageUnavailable("Le fichier n'est pas disponible dans le stockage objet.") from exc


def delete_object(key: str) -> None:
    client = _client()
    try:
        client.delete_object(Bucket=settings.s3_bucket, Key=key)
    except (ClientError, BotoCoreError) as exc:
        raise StorageUnavailable("Impossible de nettoyer le stockage objet.") from exc


def presigned_get_url(
    key: str,
    *,
    expires_in: int = 300,
    filename: str | None = None,
    content_type: str | None = None,
) -> str | None:
    client = _client(public_endpoint=True)
    if client is None:
        return None
    params = {"Bucket": settings.s3_bucket, "Key": key}
    if content_type:
        params["ResponseContentType"] = content_type
    if filename:
        params["ResponseContentDisposition"] = f"attachment; filename*=UTF-8''{quote(filename, safe='')}"
    try:
        return client.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )
    except (ClientError, BotoCoreError) as exc:
        raise StorageUnavailable("Impossible de créer le lien temporaire de téléchargement.") from exc
