from __future__ import annotations

from contextlib import contextmanager

import pymysql
import pymysql.cursors

from .config import settings


def get_connection():
    if not all([settings.db_host, settings.db_user, settings.db_name]):
        raise RuntimeError(
            "Mini app DB configuration ontbreekt. Stel MINI_APP_DB_HOST, "
            "MINI_APP_DB_USER, MINI_APP_DB_PASS en MINI_APP_DB_NAME in."
        )
    return pymysql.connect(
        host=settings.db_host,
        user=settings.db_user,
        password=settings.db_pass,
        database=settings.db_name,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=True,
    )


@contextmanager
def db_cursor():
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            yield cursor
    finally:
        conn.close()
