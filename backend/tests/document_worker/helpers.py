from sqlalchemy import text


def enqueue(engine, ids, *, org=None, user=None, portal=""):
    with engine.begin() as c:
        c.execute(
            text(
                "SELECT set_config('app.user_id',:user,true),set_config('app.organization_id',:org,true),set_config('app.portal_session',:portal,true)"
            ),
            {
                "user": str(user if user is not None else ids["user"]),
                "org": str(org or ids["org"]),
                "portal": portal,
            },
        )
        c.execute(text("SELECT authz.document_enqueue(:org,:version)"), ids)
