import json
import threading
import time

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from r1.hardware.ptz import PTZController
from r1.hardware.wheels import WheelController


class ActionNode(Node):
    def __init__(self):
        super().__init__("action_node")

        self.declare_parameter("cooldown_sec", 1.0)
        self.declare_parameter("enable_wheels", False)
        self.declare_parameter("enable_ptz", False)
        self.declare_parameter("gpio_chip", 0)
        self.declare_parameter("default_move_duration_sec", 0.75)
        self.declare_parameter("ptz_pin", 18)
        self.declare_parameter("ptz_min_angle", -15.0)
        self.declare_parameter("ptz_max_angle", 15.0)

        self.cooldown_sec = float(self.get_parameter("cooldown_sec").value)
        self.enable_wheels = bool(self.get_parameter("enable_wheels").value)
        self.enable_ptz = bool(self.get_parameter("enable_ptz").value)
        self.gpio_chip = int(self.get_parameter("gpio_chip").value)
        self.default_move_duration_sec = float(
            self.get_parameter("default_move_duration_sec").value
        )

        self.last_action_key = None
        self.last_action_time = 0.0
        self.stop_timer = None

        self.configure_gpio_factory()
        self.wheels = WheelController(enabled=self.enable_wheels)
        self.ptz = PTZController(
            pin=int(self.get_parameter("ptz_pin").value),
            min_angle=float(self.get_parameter("ptz_min_angle").value),
            max_angle=float(self.get_parameter("ptz_max_angle").value),
            enabled=self.enable_ptz,
        )

        self.action_sub = self.create_subscription(
            String,
            "/brain/actions",
            self.action_callback,
            10,
        )

        self.status_pub = self.create_publisher(
            String,
            "/action/status",
            10,
        )

        self.get_logger().info("Action node started. Listening on /brain/actions")
        self.get_logger().info(
            "Hardware access: "
            f"wheels enabled={self.enable_wheels} available={self.wheels.available}, "
            f"ptz enabled={self.enable_ptz} available={self.ptz.available}"
        )
        if self.enable_wheels and self.wheels.error:
            self.get_logger().warn(f"Wheel hardware unavailable: {self.wheels.error}")
        if self.enable_ptz and not self.ptz.available:
            self.get_logger().warn(f"PTZ hardware unavailable: {self.ptz.init_error}")

    def configure_gpio_factory(self):
        """Select the host GPIO character device before gpiozero creates pins."""
        if not (self.enable_wheels or self.enable_ptz):
            return

        try:
            from gpiozero import Device
            from gpiozero.pins.lgpio import LGPIOFactory

            Device.pin_factory = LGPIOFactory(chip=self.gpio_chip)
            self.get_logger().info(f"Using gpiochip{self.gpio_chip} via lgpio")
        except Exception as exc:  # pragma: no cover - hardware dependent
            self.get_logger().warn(
                f"Unable to configure gpiochip{self.gpio_chip}: {exc}"
            )

    def action_callback(self, msg):
        try:
            action = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warn(f"Invalid action JSON: {msg.data}")
            return

        if not self.should_execute(action):
            return

        self.execute_action(action)

    def should_execute(self, action):
        """
        Prevents the same action from being executed too repeatedly.
        """
        action_type = action.get("action", "unknown")
        # Operator commands must never be delayed by the autonomy cooldown.
        if action_type in {"wheel_command", "ptz_command", "stop"}:
            return True

        now = time.time()
        direction = action.get("direction", "")
        message = action.get("message", "")
        command = action.get("command", "")

        action_key = f"{action_type}:{direction}:{message}:{command}"

        if (
            action_key == self.last_action_key
            and now - self.last_action_time < self.cooldown_sec
        ):
            return False

        self.last_action_key = action_key
        self.last_action_time = now

        return True

    def execute_action(self, action):
        """
        Translate higher-level actions into currently available hardware
        controllers and publish structured execution status.
        """
        action_type = action.get("action", "unknown")
        priority = action.get("priority", "normal")
        reason = action.get("reason", "")
        result = {"ok": True}

        if action_type == "stop":
            result = self.handle_stop(action)

        elif action_type == "move_suggestion":
            result = self.handle_move_suggestion(action)

        elif action_type == "wheel_command":
            result = self.handle_wheel_command(action)

        elif action_type == "ptz_command":
            result = self.handle_ptz_command(action)

        elif action_type == "warn":
            result = self.handle_warning(action)

        elif action_type == "idle":
            result = self.handle_idle(action)

        else:
            self.get_logger().warn(f"Unknown action type: {action_type}")
            result = {"ok": False, "error": f"unknown_action:{action_type}"}

        status = {
            "type": "action_status",
            "request_id": action.get("request_id"),
            "executed_action": action_type,
            "priority": priority,
            "reason": reason,
            "result": result,
            "wheels": {
                "enabled": self.enable_wheels,
                "available": self.wheels.available,
                "status": self.wheels.status,
                "error": self.wheels.init_error,
            },
            "ptz": {
                "enabled": self.enable_ptz,
                "available": self.ptz.available,
                "angle": self.ptz.current_angle,
                "error": self.ptz.init_error,
            },
            "timestamp": time.time(),
        }

        status_msg = String()
        status_msg.data = json.dumps(status)
        self.status_pub.publish(status_msg)

    def handle_stop(self, action):
        reason = action.get("reason", "no reason provided")
        priority = action.get("priority", "high")

        self.get_logger().warn(
            f"[ACTION] STOP | priority={priority} | reason={reason}"
        )
        self.cancel_stop_timer()
        ok = self.wheels.stop()
        return {"ok": ok, "command": "stop"}

    def handle_move_suggestion(self, action):
        direction = action.get("direction", "unknown")
        reason = action.get("reason", "no reason provided")

        self.get_logger().info(
            f"[ACTION] MOVE SUGGESTION | direction={direction} | reason={reason}"
        )
        command_map = {
            "left": "left",
            "right": "right",
            "forward": "forward",
            "backward": "backward",
        }
        command = command_map.get(direction)
        if command is None:
            return {"ok": False, "error": f"unknown_direction:{direction}"}

        move_action = dict(action)
        move_action["command"] = command
        move_action.setdefault("duration_sec", self.default_move_duration_sec)
        return self.handle_wheel_command(move_action)

    def handle_wheel_command(self, action):
        command = action.get("command", "stop")
        duration_sec = float(
            action.get("duration_sec", self.default_move_duration_sec)
        )

        self.cancel_stop_timer()
        if not self.wheels.available:
            error = self.wheels.error
            self.get_logger().error(f"Wheel command rejected: {error}")
            return {"ok": False, "command": command, "error": error}
        try:
            ok = self.wheels.execute(command)
        except ValueError as exc:
            self.get_logger().warn(str(exc))
            return {"ok": False, "error": str(exc)}

        if ok and command != "stop" and duration_sec > 0:
            self.stop_timer = threading.Timer(duration_sec, self.wheels.stop)
            self.stop_timer.daemon = True
            self.stop_timer.start()

        self.get_logger().info(
            f"[ACTION] WHEEL COMMAND | command={command} | duration={duration_sec:.2f}s"
        )
        return {
            "ok": ok,
            "command": command,
            "duration_sec": duration_sec,
        }

    def handle_ptz_command(self, action):
        target = action.get("target_angle")
        delta = action.get("delta")

        if target is None and delta is None:
            return {"ok": False, "error": "ptz_command requires target_angle or delta"}

        if target is not None:
            target = float(target)
            ok = self.ptz.move_to(target)
            command_desc = f"move_to:{target:.2f}"
        else:
            delta = float(delta)
            ok = self.ptz.nudge(delta)
            command_desc = f"nudge:{delta:.2f}"

        self.get_logger().info(f"[ACTION] PTZ COMMAND | {command_desc}")
        return {"ok": ok, "command": command_desc, "angle": self.ptz.current_angle}

    def handle_warning(self, action):
        message = action.get("message", "warning")
        priority = action.get("priority", "normal")

        self.get_logger().warn(
            f"[ACTION] WARNING | priority={priority} | message={message}"
        )
        return {"ok": True, "message": message}

    def handle_idle(self, action):
        self.get_logger().info("[ACTION] IDLE / NO ACTION")
        self.cancel_stop_timer()
        ok = self.wheels.stop()
        return {"ok": ok, "command": "stop"}

    def cancel_stop_timer(self):
        if self.stop_timer is not None:
            self.stop_timer.cancel()
            self.stop_timer = None

    def destroy_node(self):
        self.cancel_stop_timer()
        self.wheels.disable_all()
        self.ptz.cleanup()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = ActionNode()

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass

    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
