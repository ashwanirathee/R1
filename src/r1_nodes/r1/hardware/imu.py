from __future__ import annotations

import threading
import time
from dataclasses import asdict, dataclass


@dataclass
class IMUSnapshot:
    acceleration: tuple[float, float, float]
    gyro: tuple[float, float, float]
    magnetic: tuple[float, float, float]
    quaternion: tuple[float, float, float, float]
    timestamp: float

    def to_dict(self):
        return asdict(self)


class IMUReader:
    def __init__(self, enabled: bool = False, update_interval: float = 0.5):
        self.enabled = enabled
        self.update_interval = update_interval
        self.snapshot: IMUSnapshot | None = None
        self.error: str | None = None
        self.available = False
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self):
        if not self.enabled:
            self.error = "imu_disabled"
            return

        if self._thread is not None and self._thread.is_alive():
            return

        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def _run(self):
        try:
            import board
            import busio
            from adafruit_bno08x import (
                BNO_REPORT_ACCELEROMETER,
                BNO_REPORT_GYROSCOPE,
                BNO_REPORT_MAGNETOMETER,
                BNO_REPORT_ROTATION_VECTOR,
            )
            from adafruit_bno08x.i2c import BNO08X_I2C

            i2c = busio.I2C(board.SCL, board.SDA, frequency=400000)
            bno = BNO08X_I2C(i2c)
            bno.enable_feature(BNO_REPORT_ACCELEROMETER)
            bno.enable_feature(BNO_REPORT_GYROSCOPE)
            bno.enable_feature(BNO_REPORT_MAGNETOMETER)
            bno.enable_feature(BNO_REPORT_ROTATION_VECTOR)
            self.available = True
            self.error = None

            while not self._stop.is_set():
                self.snapshot = IMUSnapshot(
                    acceleration=tuple(bno.acceleration),
                    gyro=tuple(bno.gyro),
                    magnetic=tuple(bno.magnetic),
                    quaternion=tuple(bno.quaternion),
                    timestamp=time.time(),
                )
                self.error = None
                self._stop.wait(self.update_interval)
        except Exception as exc:  # pragma: no cover - hardware dependent
            self.available = False
            self.error = str(exc)

    def stop(self):
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1.0)
