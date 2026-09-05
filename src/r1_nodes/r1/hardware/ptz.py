from __future__ import annotations

import threading
import time


class PTZController:
    def __init__(
        self,
        *,
        pin: int = 18,
        min_angle: float = -15.0,
        max_angle: float = 15.0,
        enabled: bool = False,
    ):
        self.pin = pin
        self.min_angle = min_angle
        self.max_angle = max_angle
        self.current_angle = 0.0
        self.enabled = enabled
        self.available = False
        self.init_error: str | None = None
        self.lock = threading.Lock()
        self.servo = None

        if not enabled:
            return

        try:
            from gpiozero import AngularServo

            self.servo = AngularServo(
                pin,
                min_angle=min_angle,
                max_angle=max_angle,
                min_pulse_width=0.00135,
                max_pulse_width=0.00165,
            )
            self.servo.angle = self.current_angle
            self.available = True
        except Exception as exc:  # pragma: no cover - hardware dependent
            self.init_error = str(exc)
            self.available = False

    def move_to(self, target: float, step: float = 0.25, delay: float = 0.02):
        if not self.enabled or not self.available or self.servo is None:
            return False

        with self.lock:
            target = max(self.min_angle, min(self.max_angle, target))
            angle = self.current_angle
            direction = 1 if target > angle else -1

            while abs(angle - target) > step:
                angle += direction * step
                self.servo.angle = angle
                time.sleep(delay)

            self.servo.angle = target
            self.current_angle = target
            time.sleep(0.2)
            self.servo.detach()
            return True

    def nudge(self, delta: float):
        return self.move_to(self.current_angle + delta)

    def cleanup(self):
        if not self.enabled or not self.available or self.servo is None:
            return

        with self.lock:
            self.servo.detach()
