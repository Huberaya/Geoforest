import csv
import hashlib
import io

from app.supply.schemas import SupplierInput
from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import text

# Table names are a closed server-side allowlist, never request-supplied SQL identifiers.
TABLES = {"suppliers", "products", "lots", "supplier_contacts", "supplier_collections"}


def row(conn, table, org, object_id, lock=False):
    assert table in TABLES
    result = (
        conn.execute(
            text(
                f"SELECT * FROM {table} WHERE organization_id=:o AND id=:id"
                + (" FOR UPDATE" if lock else "")
            ),
            {"o": org, "id": object_id},
        )
        .mappings()
        .first()
    )
    if not result:
        raise HTTPException(404, "Objet introuvable dans cet espace")
    return dict(result)


def ensure_active(record):
    if record.get("archived_at"):
        raise HTTPException(
            409,
            "Cet objet est archivé ; aucune modification ou nouvelle liaison n’est possible",
        )


def expect_version(record, version):
    if record["version"] != version:
        raise HTTPException(
            409, "La fiche a été modifiée entre-temps. Rechargez-la avant de réessayer."
        )


def insert(conn, table, org, values):
    assert table in TABLES
    columns = list(values)
    return dict(
        conn.execute(
            text(
                f"INSERT INTO {table}(organization_id,{','.join(columns)}) VALUES(:o,{','.join(':' + k for k in columns)}) RETURNING *"
            ),
            {"o": org, **values},
        )
        .mappings()
        .one()
    )


def update(conn, table, org, object_id, values):
    assert table in TABLES
    return dict(
        conn.execute(
            text(
                f"UPDATE {table} SET {','.join(k + '=:' + k for k in values)},version=version+1"
                + (",updated_at=now()" if table != "supplier_contacts" else "")
                + " WHERE organization_id=:o AND id=:id RETURNING *"
            ),
            {"o": org, "id": object_id, **values},
        )
        .mappings()
        .one()
    )


def csv_rows(raw):
    checksum = hashlib.sha256(("suppliers-csv-v1\n" + raw).encode()).hexdigest()
    try:
        reader = csv.DictReader(io.StringIO(raw.lstrip("\ufeff")), strict=True)
        headers = reader.fieldnames or []
    except csv.Error:
        raise HTTPException(422, "En-tête CSV illisible") from None
    allowed = {"reference", "name", "country", "email", "address"}
    if (
        not {"reference", "name"}.issubset(headers)
        or set(headers) - allowed
        or len(headers) != len(set(headers))
    ):
        raise HTTPException(
            422,
            {
                "message": "En-têtes attendus : reference,name,country,email,address (reference et name obligatoires)",
                "rows": [],
            },
        )
    rows = []
    errors = []
    seen = set()
    try:
        for index, item in enumerate(reader, start=2):
            if index > 101:
                raise HTTPException(422, "Import limité à 100 fournisseurs")
            try:
                if None in item or any(v is None for v in item.values()):
                    raise ValueError("Nombre de colonnes incorrect")
                item["country"] = item.get("country", "").strip() or None
                model = SupplierInput.model_validate(item)
                if model.reference in seen:
                    raise ValueError("Référence répétée dans le fichier")
                seen.add(model.reference)
                rows.append(model.model_dump())
            except (ValidationError, ValueError) as exc:
                errors.append(
                    {
                        "line": reader.line_num,
                        "message": "Champs invalides ou référence répétée",
                        "fields": list({str(e["loc"][0]) for e in exc.errors()})
                        if isinstance(exc, ValidationError)
                        else [],
                    }
                )
    except csv.Error:
        raise HTTPException(422, "Fichier CSV illisible") from None
    if errors:
        raise HTTPException(
            422,
            {"message": "Aucune ligne importée. Corrigez le fichier.", "rows": errors},
        )
    if not rows:
        raise HTTPException(422, "Le fichier ne contient aucun fournisseur")
    return rows, checksum
