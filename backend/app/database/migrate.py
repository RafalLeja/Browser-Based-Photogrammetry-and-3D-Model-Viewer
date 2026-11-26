"""Brings an existing database up to the current models.

`create_all` creates missing tables but never changes existing ones, so a column added to a
model would be missing from a database created by an older version. This adds such columns.

shortcut: additive changes only (new nullable columns, or columns with a server default). Renames,
type changes and removals need real migrations: add Alembic before making one of those.
"""

import logging

from sqlalchemy import Engine, inspect, text

from app.database.base import Base

logger = logging.getLogger(__name__)


def _default_sql(server_default: object) -> str | None:
    """The SQL of a column's server default: text("0") stays 0, a plain string becomes a literal."""
    if server_default is None:
        return None
    arg = server_default.arg  # type: ignore[attr-defined]
    return arg.text if hasattr(arg, "text") else "'" + str(arg).replace("'", "''") + "'"


def add_missing_columns(engine: Engine) -> list[str]:
    """Adds model columns that the database tables lack. Returns them as "table.column"."""
    inspector = inspect(engine)
    quote = engine.dialect.identifier_preparer.quote
    added: list[str] = []
    with engine.begin() as connection:
        for table in Base.metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue  # create_all makes it with every column.
            existing = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name in existing:
                    continue
                default = _default_sql(column.server_default)
                if not column.nullable and default is None:
                    raise RuntimeError(f"{table.name}.{column.name} needs a server default to be added to existing rows")
                ddl = f"ALTER TABLE {quote(table.name)} ADD COLUMN {quote(column.name)} {column.type.compile(engine.dialect)}"
                if default is not None:
                    ddl += f" DEFAULT {default}"
                if not column.nullable:
                    ddl += " NOT NULL"
                connection.execute(text(ddl))
                added.append(f"{table.name}.{column.name}")
    if added:
        logger.info("Added database columns: %s", ", ".join(added))
    return added
