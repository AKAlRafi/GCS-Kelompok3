"""MAVLink raw telemetry (.tlog) file recorder."""

import json
import logging
import math
import os
import sqlite3
import threading
import time
from datetime import datetime
from .. import config

logger = logging.getLogger(__name__)

DB_UPDATE_INTERVAL = 1.0    # Secs between updates of the tlog row (count, size, end time)
MAX_BUFFER = 5000           # Messages kept in memory if the database write keeps failing


class TlogService:
    def __init__(self, log_dir: str = config.LOG_DIR, db_path: str | None = None):
        self.log_dir = log_dir
        self.db_path = db_path or os.path.join(log_dir, "tlogs.db")
        self.db_interval = DB_UPDATE_INTERVAL
        self._file = None
        self._lock = threading.Lock()
        self.current_path: str | None = None
        self._db = None             # sqlite3 connection, opened by start()
        self._row_id = None         # Row of the tlog being recorded
        self._buffer = []           # Messages waiting to be written to the database
        self._count = 0
        self._size = 0
        self._last_db_update = 0.0

    def is_recording(self) -> bool:
        with self._lock:
            return self._row_id is not None

    def start(self) -> str:
        with self._lock:
            self._close_unlocked()
            filename = datetime.now().strftime("flight_%Y-%m-%d_%H-%M-%S.tlog")
            self.current_path = filename
            self._db_open(filename)
            return filename

    def write_msg(self, msg) -> None:
        if msg is None or msg.get_type() == "BAD_DATA":
            return
        raw_bytes = msg.get_msgbuf()
        if not raw_bytes:
            return
        data = {k: (None if isinstance(v, float) and not math.isfinite(v) else v)
                for k, v in msg.to_dict().items()}
        row = (int(time.time() * 1_000_000), msg.get_msgId(), msg.get_type(), json.dumps(data, default=str))
        with self._lock:
            if self._row_id is None:
                return
            self._buffer.append((self._row_id, *row))
            self._count += 1
            self._size += 8 + len(raw_bytes)
            now = time.monotonic()
            if now - self._last_db_update >= self.db_interval:
                self._last_db_update = now
                self._db_flush()
                self._db_update()

    def list_tlogs(self, limit: int = 50) -> list[dict]:
        """Newest tlogs first. Empty list if the database cannot be read."""
        try:
            with self._lock:
                self._db_connect()
                cur = self._db.execute("SELECT * FROM tlogs ORDER BY id DESC LIMIT ?", (limit,))
                return [dict(row) for row in cur.fetchall()]
        except (sqlite3.Error, OSError) as e:
            logger.warning(f"Tlog database read failed: {e}")
            return []

    def stop(self) -> None:
        with self._lock:
            self._close_unlocked()

    def _close_unlocked(self) -> None:
        self._db_flush()
        self._db_update()
        self._row_id = None
        self.current_path = None

    # Database: one row per tlog. A failure here must never stop the recording.
    def _db_connect(self) -> None:
        if self._db is None:
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            self._db = sqlite3.connect(self.db_path, check_same_thread=False)
            self._db.row_factory = sqlite3.Row
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS tlog_messages ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, tlog_id INTEGER NOT NULL, "
                "ts_us INTEGER NOT NULL, msg_id INTEGER NOT NULL, msg_type TEXT NOT NULL, "
                "data TEXT NOT NULL)"
            )
            self._db.execute(
                "CREATE INDEX IF NOT EXISTS idx_tlog_messages_tlog ON tlog_messages (tlog_id, id)"
            )
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS tlogs ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT NOT NULL, file_path TEXT NOT NULL, "
                "started_at TEXT NOT NULL, ended_at TEXT, "
                "message_count INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0)"
            )
            self._db.commit()

    def _db_open(self, filename: str) -> None:
        self._count = 0
        self._size = 0
        self._last_db_update = time.monotonic()
        try:
            self._db_connect()
            now = datetime.now().isoformat(timespec="seconds")
            cur = self._db.execute(
                "INSERT INTO tlogs (file_name, file_path, started_at, ended_at) VALUES (?, ?, ?, ?)",
                (filename, self.current_path, now, now),
            )
            self._db.commit()
            self._row_id = cur.lastrowid
        except (sqlite3.Error, OSError) as e:
            self._row_id = None
            logger.warning(f"Tlog database unavailable, recording without it: {e}")

    def _db_update(self) -> None:
        if self._row_id is None or self._db is None:
            return
        try:
            self._db.execute(
                "UPDATE tlogs SET ended_at = ?, message_count = ?, size_bytes = ? WHERE id = ?",
                (datetime.now().isoformat(timespec="seconds"), self._count, self._size, self._row_id),
            )
            self._db.commit()
        except sqlite3.Error as e:
            logger.warning(f"Tlog database update failed: {e}")
    
    def flush(self) -> None:
        """Write buffered messages once a second, so the tail is saved even if messages stop arriving."""
        with self._lock:
            if self._row_id is not None and time.monotonic() - self._last_db_update >= self.db_interval:
                self._db_flush()

    def _db_flush(self) -> None:
        if not self._buffer or self._db is None:
            return
        try:
            self._db.executemany(
                "INSERT INTO tlog_messages (tlog_id, ts_us, msg_id, msg_type, data) VALUES (?, ?, ?, ?, ?)",
                self._buffer,
            )
            self._db.commit()
            self._buffer = []
        except sqlite3.Error as e:
            logger.warning(f"Tlog message write failed: {e}")
            del self._buffer[:-MAX_BUFFER]      # keep the newest