"""MAVLink raw telemetry (.tlog) recorder: one file per recording plus one index row in SQLite."""

import logging
import os
import sqlite3
import struct
import threading
import time
from datetime import datetime
from .. import config

logger = logging.getLogger(__name__)

DB_UPDATE_INTERVAL = 1.0    # Secs between file flushes and updates of the tlog row (count, size, end time)


class TlogService:
    def __init__(self, log_dir: str = config.LOG_DIR, db_path: str | None = None):
        self.log_dir = log_dir
        self.db_path = db_path or os.path.join(log_dir, "tlogs.db")
        self.db_interval = DB_UPDATE_INTERVAL
        self._file = None           # Raw .tlog file being written
        self._lock = threading.Lock()
        self.current_path: str | None = None
        self._db = None             # sqlite3 connection, opened by start()
        self._row_id = None         # Index row of the tlog being recorded
        self._count = 0
        self._size = 0
        self._last_db_update = 0.0

    def is_recording(self) -> bool:
        with self._lock:
            return self._file is not None

    def start(self) -> str:
        with self._lock:
            self._close_unlocked()
            filename = datetime.now().strftime("flight_%Y-%m-%d_%H-%M-%S.tlog")
            self._count = 0
            self._size = 0
            self._last_db_update = time.monotonic()
            try:
                os.makedirs(self.log_dir, exist_ok=True)
                self._file = open(os.path.join(self.log_dir, filename), "ab")
            except OSError as e:
                self._file = None
                logger.warning(f"Tlog file unavailable: {e}")
                return filename
            self.current_path = filename
            self._db_open(filename)
            return filename

    def write_msg(self, msg) -> None:
        if msg is None or msg.get_type() == "BAD_DATA":
            return
        raw_bytes = msg.get_msgbuf()
        if not raw_bytes:
            return
        with self._lock:
            if self._file is None:
                return
            try:
                self._file.write(struct.pack(">Q", int(time.time() * 1_000_000)) + raw_bytes)
            except OSError as e:
                logger.warning(f"Tlog file write failed, recording stopped: {e}")
                self._close_unlocked()
                return
            self._count += 1
            self._size += 8 + len(raw_bytes)
            self._tick()

    def flush(self) -> None:
        """Flush once a second, so the tail is saved even if messages stop arriving."""
        with self._lock:
            if self._file is not None:
                self._tick()

    def _tick(self) -> None:
        now = time.monotonic()
        if now - self._last_db_update >= self.db_interval:
            self._last_db_update = now
            try:
                self._file.flush()
            except OSError as e:
                logger.warning(f"Tlog file flush failed: {e}")
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
        if self._file is not None:
            try:
                self._file.close()
            except OSError:
                pass
            self._file = None
            self._db_update()
        self._row_id = None
        self.current_path = None

    # Database: one index row per tlog. A failure here must never stop the recording.
    def _db_connect(self) -> None:
        if self._db is None:
            os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
            self._db = sqlite3.connect(self.db_path, check_same_thread=False)
            self._db.row_factory = sqlite3.Row
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute(
                "CREATE TABLE IF NOT EXISTS tlogs ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT, file_name TEXT NOT NULL, file_path TEXT NOT NULL, "
                "started_at TEXT NOT NULL, ended_at TEXT, "
                "message_count INTEGER NOT NULL DEFAULT 0, size_bytes INTEGER NOT NULL DEFAULT 0)"
            )
            self._db.commit()

    def _db_open(self, filename: str) -> None:
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
            logger.warning(f"Tlog database unavailable, recording the file only: {e}")

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