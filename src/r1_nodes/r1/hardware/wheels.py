from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True)
class WheelPins:
    enable_pin: int
    in_a_pin: int
    in_b_pin: int
    name: str
    inverted: bool = False


DEFAULT_WHEEL_PINS = (
    WheelPins(17, 23, 24, "front_left"),
    WheelPins(25, 22, 27, "front_right"),
    # Matches the working standalone wheel-control wiring.
    WheelPins(12, 6, 5, "back_left", inverted=True),
    WheelPins(13, 20, 16, "back_right"),
)


class Motor:
    def __init__(
        self,
        enable_device,
        in_a_device,
        in_b_device,
        name: str,
        inverted: bool = False,
    ):
        self.en = enable_device
        self.a = in_a_device
        self.b = in_b_device
        self.name = name
        self.inverted = inverted

    def enable(self):
        self.en.on()

    def disable(self):
        self.stop()
        self.en.off()

    def forward(self):
        self.enable()
        if not self.inverted:
            self.a.off()
            self.b.on()
        else:
            self.a.on()
            self.b.off()

    def backward(self):
        self.enable()
        if not self.inverted:
            self.a.on()
            self.b.off()
        else:
            self.a.off()
            self.b.on()

    def stop(self):
        self.a.off()
        self.b.off()


class WheelController:
    def __init__(self, enabled: bool = False, pin_layout=DEFAULT_WHEEL_PINS):
        self.enabled = enabled
        self.available = False
        self.init_error: str | None = None
        self.status = "disabled"
        self.motors: list[Motor] = []
        self.left_motors: list[Motor] = []
        self.right_motors: list[Motor] = []

        if not enabled:
            return

        try:
            from gpiozero import DigitalOutputDevice
        except Exception as exc:  # pragma: no cover - hardware dependent
            self.init_error = str(exc)
            self.status = "unavailable"
            return

        try:
            for config in pin_layout:
                motor = Motor(
                    DigitalOutputDevice(config.enable_pin),
                    DigitalOutputDevice(config.in_a_pin),
                    DigitalOutputDevice(config.in_b_pin),
                    config.name,
                    config.inverted,
                )
                self.motors.append(motor)

            self.left_motors = [
                motor for motor in self.motors if "left" in motor.name
            ]
            self.right_motors = [
                motor for motor in self.motors if "right" in motor.name
            ]
            self.available = True
            self.enable_all()
            self.stop()
        except Exception as exc:  # pragma: no cover - hardware dependent
            self.init_error = str(exc)
            self.status = "unavailable"
            self.available = False

    @property
    def error(self) -> str | None:
        if not self.enabled:
            return "wheel hardware is disabled"
        if not self.available:
            return self.init_error or "wheel GPIO is unavailable"
        return None

    def _run_if_available(self, command_name: str, fn: Callable[[], None]):
        if not self.enabled:
            self.status = "disabled"
            return False
        if not self.available:
            self.status = "unavailable"
            return False

        fn()
        self.status = command_name
        return True

    def _apply_all(self, direction: str):
        for motor in self.motors:
            getattr(motor, direction)()

    def enable_all(self):
        for motor in self.motors:
            motor.enable()

    def disable_all(self):
        if self.available:
            self.stop()
            for motor in self.motors:
                motor.disable()
        self.status = "disabled"

    def stop(self):
        if not self.enabled:
            self.status = "disabled"
            return False
        if not self.available:
            self.status = "unavailable"
            return False

        for motor in self.motors:
            motor.stop()
        self.status = "stopped"
        return True

    def forward(self):
        return self._run_if_available("forward", lambda: self._apply_all("forward"))

    def backward(self):
        return self._run_if_available("backward", lambda: self._apply_all("backward"))

    def left(self):
        def command():
            for motor in self.left_motors:
                motor.stop()
            for motor in self.right_motors:
                motor.forward()

        return self._run_if_available("left", command)

    def right(self):
        def command():
            for motor in self.right_motors:
                motor.stop()
            for motor in self.left_motors:
                motor.forward()

        return self._run_if_available("right", command)

    def rotate_left(self):
        def command():
            for motor in self.left_motors:
                motor.backward()
            for motor in self.right_motors:
                motor.forward()

        return self._run_if_available("rotate_left", command)

    def rotate_right(self):
        def command():
            for motor in self.left_motors:
                motor.forward()
            for motor in self.right_motors:
                motor.backward()

        return self._run_if_available("rotate_right", command)

    def shift_left(self):
        return self.drive_pattern("ccw", "cw", "cw", "ccw", status="shift_left")

    def shift_right(self):
        return self.drive_pattern("cw", "ccw", "ccw", "cw", status="shift_right")

    def drive_pattern(
        self,
        front_left_dir: str,
        front_right_dir: str,
        back_left_dir: str,
        back_right_dir: str,
        *,
        status: str,
    ):
        directions = {
            "front_left": front_left_dir,
            "front_right": front_right_dir,
            "back_left": back_left_dir,
            "back_right": back_right_dir,
        }

        def command():
            for motor in self.motors:
                direction = directions[motor.name]
                if direction == "cw":
                    motor.forward()
                elif direction == "ccw":
                    motor.backward()
                elif direction == "stop":
                    motor.stop()
                else:
                    raise ValueError(f"Unknown direction: {direction}")

        return self._run_if_available(status, command)

    def execute(self, command: str):
        commands = {
            "stop": self.stop,
            "forward": self.forward,
            "backward": self.backward,
            "left": self.left,
            "right": self.right,
            "rotate_left": self.rotate_left,
            "rotate_right": self.rotate_right,
            "shift_left": self.shift_left,
            "shift_right": self.shift_right,
        }
        handler = commands.get(command)
        if handler is None:
            raise ValueError(f"Unknown wheel command: {command}")
        return handler()
