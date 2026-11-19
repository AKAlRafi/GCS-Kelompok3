"""MAVLink raw telemetry (.tlog) file recorder."""

import os
import struct
import threading
import time
from datetime import datetime
from .. import config


class TlogService:
    def __init__(self, log_dir: str = config.LOG_DIR):
        self.log_dir = log_dir
        self._file = None
        self._lock = threading.Lock()
        self.current_path: str | None = None

    def is_recording(self) -> bool:
        with self._lock:
            return self._file is not None and not self._file.closed

    def start(self) -> str:
        with self._lock:
            self._close_unlocked()
            os.makedirs(self.log_dir, exist_ok=True)
            filename = datetime.now().strftime("flight_%Y-%m-%d_%H-%M-%S.tlog")
            self.current_path = os.path.join(self.log_dir, filename)
            self._file = open(self.current_path, "wb")
            return self.current_path

    def write_msg(self, msg) -> None:
        if msg is None:
            return
        raw_bytes = msg.get_msgbuf()
        if not raw_bytes:
            return

        timestamp_us = int(time.time() * 1_000_000)
        header = struct.pack(">Q", timestamp_us)

        with self._lock:
            if self._file is not None and not self._file.closed:
                self._file.write(header)
                self._file.write(raw_bytes)

    def stop(self) -> None:
        with self._lock:
            self._close_unlocked()

    def _close_unlocked(self) -> None:
        if self._file is not None and not self._file.closed:
            self._file.flush()
            self._file.close()
        self._file = None
        self.current_path = None