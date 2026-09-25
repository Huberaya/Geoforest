"""Secure supplier magic-link helpers and profile completeness indicator."""
from __future__ import annotations

import asyncio
import hashlib
import logging
import secrets
import smtplib
import ssl
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from typing import Any

from jose import JWTError, jwt

from app.core.config import settings
from app.models.suppliers import Supplier

logger = logging.getLogger(__name__)


PURPOSE_INVITATION = "invitation"
PURPOSE_LOGIN = "login"


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def hash_jti(jti: str) -> str:
    return hashlib.sha256(jti.encode("utf-8")).hexdigest()


def issue_supplier_link(
    *,
    supplier_id: uuid.UUID,
    organization_id: uuid.UUID,
    email: str,
    purpose: str,
    now: datetime | None = None,
) -> tuple[str, str, datetime]:
    """Sign an expiring bearer link; persist only the digest of its random JTI."""
    issued_at = now or utc_now()
    if purpose == PURPOSE_INVITATION:
        expires_at = issued_at + timedelta(hours=settings.supplier_invitation_ttl_hours)
    elif purpose == PURPOSE_LOGIN:
        expires_at = issued_at + timedelta(minutes=settings.supplier_magic_link_ttl_minutes)
    else:
        raise ValueError("Objet de lien fournisseur inconnu")

    jti = secrets.token_urlsafe(32)
    claims = {
        "iss": "geoforest-trace",
        "sub": str(supplier_id),
        "org_id": str(organization_id),
        "email": email.lower(),
        "purpose": purpose,
        "type": "supplier_magic_link",
        "jti": jti,
        "iat": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    token = jwt.encode(claims, settings.secret_key, algorithm=settings.jwt_algorithm)
    return token, jti, expires_at


def decode_supplier_link(token: str) -> dict[str, Any] | None:
    try:
        claims = jwt.decode(
            token,
            settings.secret_key,
            algorithms=[settings.jwt_algorithm],
            issuer="geoforest-trace",
            options={
                "require_exp": True,
                "require_iat": True,
                "require_iss": True,
                "require_sub": True,
                "require_jti": True,
            },
        )
    except JWTError:
        return None
    if claims.get("type") != "supplier_magic_link" or claims.get("purpose") not in {
        PURPOSE_INVITATION,
        PURPOSE_LOGIN,
    }:
        return None
    if not isinstance(claims.get("email"), str) or not claims["email"].strip():
        return None
    if not isinstance(claims.get("org_id"), str) or not isinstance(claims.get("jti"), str):
        return None
    return claims


def supplier_link_url(token: str) -> str:
    # Fragment non transmis au serveur HTTP ni dans l'en-tête Referer.
    return f"{settings.app_url.rstrip('/')}/supplier-portal#token={token}"


def profile_completeness(supplier: Supplier) -> tuple[int, int, list[dict[str, Any]]]:
    """Five equally weighted profile fields; an internal UX aid, not a compliance score."""
    items = [
        {"key": "address", "label": "Adresse", "complete": bool((supplier.address or "").strip())},
        {"key": "contact_name", "label": "Nom du contact", "complete": bool((supplier.contact_name or "").strip())},
        {
            "key": "contact_email",
            "label": "Email de contact",
            "complete": bool((supplier.contact_email or supplier.email or "").strip()),
        },
        {
            "key": "contact_phone",
            "label": "Téléphone du contact",
            "complete": bool((supplier.contact_phone or supplier.phone or "").strip()),
        },
        {
            "key": "legal_identifier",
            "label": "Identifiant légal (fiscal, immatriculation ou EORI)",
            "complete": bool((supplier.tax_id or "").strip() or (supplier.registration_number or "").strip() or (supplier.eori or "").strip()),
        },
    ]
    completed = sum(1 for item in items if item["complete"])
    percent = round(completed * 100 / len(items))
    return percent, completed, items


def risk_label(value: str) -> str:
    return {
        "unknown": "Non évalué",
        "low": "Faible — appréciation interne",
        "medium": "Moyen — appréciation interne",
        "high": "Élevé — appréciation interne",
    }.get(value, "Non évalué")


def _send_email_sync(email: str, supplier_name: str, link: str, purpose: str) -> bool:
    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = email
    if purpose == PURPOSE_INVITATION:
        message["Subject"] = "Accès au portail fournisseur GeoForest Trace"
        intro = f"Vous êtes invité à compléter le profil fournisseur « {supplier_name} »."
        action = "Activer mon accès"
    else:
        message["Subject"] = "Votre lien de connexion GeoForest Trace"
        intro = f"Voici le lien de connexion au portail fournisseur « {supplier_name} »."
        action = "Me connecter"
    message.set_content(
        f"{intro}\n\n{action} : {link}\n\n"
        "Ce lien est personnel, à usage unique et expire à la date indiquée dans le portail. "
        "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
    )

    try:
        if settings.smtp_port == 465:
            context = ssl.create_default_context()
            with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10, context=context) as server:
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password or "")
                server.send_message(message)
        else:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
                server.ehlo()
                server.starttls(context=ssl.create_default_context())
                server.ehlo()
                if settings.smtp_user:
                    server.login(settings.smtp_user, settings.smtp_password or "")
                server.send_message(message)
        return True
    except Exception as exc:
        # Ne jamais écrire le lien, l'adresse, le fournisseur ni le message SMTP dans les logs.
        logger.error("Échec d'envoi du lien fournisseur (%s)", type(exc).__name__)
        return False


async def deliver_supplier_link(email: str, supplier_name: str, link: str, purpose: str) -> str:
    """Returns sent / not_configured / failed; never treats generation as delivery."""
    if not settings.smtp_host:
        return "not_configured"
    sent = await asyncio.to_thread(_send_email_sync, email, supplier_name, link, purpose)
    return "sent" if sent else "failed"
