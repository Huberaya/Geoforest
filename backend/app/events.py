import json

from sqlalchemy import text


def event(conn, org, identity, action, kind, object_id, before, after):
    conn.execute(
        text("""INSERT INTO audit_events(organization_id,actor_id,action,object_type,object_id,previous_value,new_value)
      VALUES(:o,:u,:a,:k,:id,CAST(:b AS jsonb),CAST(:n AS jsonb))"""),
        {
            "o": org,
            "u": identity.id,
            "a": action,
            "k": kind,
            "id": object_id,
            "b": json.dumps(before, default=str) if before is not None else None,
            "n": json.dumps(after, default=str) if after is not None else None,
        },
    )
