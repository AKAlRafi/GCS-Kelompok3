"""MAVLink parameter protocol: download all, read single, and set parameters."""

import logging
import time
import math
from pymavlink import mavutil
from .. import config

logger = logging.getLogger(__name__)


class ParameterService:
    def __init__(self, mavlink_service, timeout: float = config.COMMAND_TIMEOUT, max_retries: int = 3):
        self.mavlink = mavlink_service
        self.timeout = timeout
        self.max_retries = max_retries
        self._param_types: dict[str, int] = {}

    def is_connected(self) -> bool:
        return self.mavlink is not None and self.mavlink.master() is not None

    def wait_message(self, msg_types: list[str], timeout: float | None = None):
        wait_time = timeout if timeout is not None else self.timeout
        return self.mavlink.wait_for(msg_types, wait_time)

    @staticmethod
    def _clean_param_id(raw_id) -> str:
        if isinstance(raw_id, bytes):
            return raw_id.decode("utf-8", errors="ignore").rstrip("\x00")
        return str(raw_id).rstrip("\x00")

    def download_all_params(self) -> dict:
        """Unduh seluruh daftar parameter dari Flight Controller."""
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}

        master = self.mavlink.master()
        logger.info("Requesting full parameter list from vehicle.")

        try:
            master.mav.param_request_list_send(
                master.target_system,
                master.target_component,
            )

            received_by_index: dict[int, dict] = {}
            total_count: int | None = None
            overall_deadline = time.monotonic() + 30.0

            while time.monotonic() < overall_deadline:
                msg = self.wait_message(["PARAM_VALUE"], timeout=1.5)
                if msg is None:
                    if total_count is not None:
                        break
                    continue

                param_id = self._clean_param_id(msg.param_id)
                total_count = int(msg.param_count)
                index = int(msg.param_index)
                param_type = int(msg.param_type)

                if 0 <= index < total_count:
                    self._param_types[param_id] = param_type
                    received_by_index[index] = {
                        "index": index,
                        "id": param_id,
                        "value": float(msg.param_value),
                        "type": param_type,
                    }

                if len(received_by_index) >= total_count:
                    break

            if total_count is None:
                return {"ok": False, "error": "Timeout waiting for PARAM_VALUE stream"}

            # Minta ulang indeks parameter yang terlewat di tengah jalan
            for attempt in range(1, self.max_retries + 1):
                missing = [i for i in range(total_count) if i not in received_by_index]
                if not missing:
                    break

                logger.warning(f"Missing {len(missing)} parameters, retry {attempt}/{self.max_retries}")
                for idx in missing:
                    master.mav.param_request_read_send(
                        master.target_system,
                        master.target_component,
                        b"",
                        idx,
                    )
                    msg = self.wait_message(["PARAM_VALUE"], timeout=0.5)
                    if msg is not None:
                        param_id = self._clean_param_id(msg.param_id)
                        r_idx = int(msg.param_index)
                        param_type = int(msg.param_type)
                        if 0 <= r_idx < total_count:
                            self._param_types[param_id] = param_type
                            received_by_index[r_idx] = {
                                "index": r_idx,
                                "id": param_id,
                                "value": float(msg.param_value),
                                "type": param_type,
                            }

            ordered_params = [received_by_index[i] for i in sorted(received_by_index.keys())]
            logger.info(f"Downloaded {len(ordered_params)}/{total_count} parameters.")
            return {
                "ok": True,
                "count": len(ordered_params),
                "total": total_count,
                "parameters": ordered_params,
            }

        except OSError as e:
            logger.error(f"Connection error downloading parameters: {e}")
            return {"ok": False, "error": f"Connection error: {e}"}
        except Exception as e:
            logger.exception(f"Unexpected error downloading parameters: {e}")
            return {"ok": False, "error": f"Unexpected error: {e}"}

    def get_param(self, param_id: str) -> dict:
        """Baca satu parameter berdasarkan namanya."""
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}

        target_id = str(param_id).strip().upper()
        if not target_id or len(target_id) > 16:
            return {"ok": False, "error": "Invalid parameter ID"}

        master = self.mavlink.master()
        encoded_id = target_id.encode("utf-8").ljust(16, b"\x00")

        try:
            for attempt in range(1, self.max_retries + 1):
                master.mav.param_request_read_send(
                    master.target_system,
                    master.target_component,
                    encoded_id,
                    -1,
                )
                deadline = time.monotonic() + self.timeout
                while time.monotonic() < deadline:
                    msg = self.wait_message(["PARAM_VALUE"], timeout=0.5)
                    if msg is not None and self._clean_param_id(msg.param_id) == target_id:
                        param_type = int(msg.param_type)
                        self._param_types[target_id] = param_type
                        return {
                            "ok": True,
                            "id": target_id,
                            "value": float(msg.param_value),
                            "type": param_type,
                        }
                logger.warning(f"Timeout reading {target_id} on attempt {attempt}/{self.max_retries}")

            return {"ok": False, "error": f"Parameter {target_id} not found or timeout"}
        except Exception as e:
            logger.exception(f"Error reading parameter {target_id}: {e}")
            return {"ok": False, "error": str(e)}

    def set_param(self, param_id: str, value: float, param_type: int | None = None) -> dict:
        """Ubah nilai satu parameter di Flight Controller."""
        if not self.is_connected():
            return {"ok": False, "error": "MAVLink is not connected"}

        target_id = str(param_id).strip().upper()
        if not target_id or len(target_id) > 16:
            return {"ok": False, "error": "Invalid parameter ID"}

        try:
            numeric_value = float(value)
        except (TypeError, ValueError):
            return {"ok": False, "error": "Parameter value must be numeric"}

        if not math.isfinite(numeric_value):
            return {"ok": False, "error": "Parameter value must be finite"}

        resolved_type = (
            int(param_type)
            if param_type is not None
            else self._param_types.get(target_id, mavutil.mavlink.MAV_PARAM_TYPE_REAL32)
        )
        encoded_id = target_id.encode("utf-8").ljust(16, b"\x00")
        master = self.mavlink.master()

        try:
            for attempt in range(1, self.max_retries + 1):
                master.mav.param_set_send(
                    master.target_system,
                    master.target_component,
                    encoded_id,
                    numeric_value,
                    resolved_type,
                )
                deadline = time.monotonic() + self.timeout
                while time.monotonic() < deadline:
                    msg = self.wait_message(["PARAM_VALUE"], timeout=0.5)
                    if msg is not None and self._clean_param_id(msg.param_id) == target_id:
                        return {
                            "ok": True,
                            "id": target_id,
                            "value": float(msg.param_value),
                            "type": int(msg.param_type),
                        }
                logger.warning(f"Timeout setting {target_id} on attempt {attempt}/{self.max_retries}")

            return {"ok": False, "error": f"Failed to confirm parameter {target_id}"}
        except Exception as e:
            logger.exception(f"Error setting parameter {target_id}: {e}")
            return {"ok": False, "error": str(e)}