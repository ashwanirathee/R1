import os
import threading
import uuid
from pathlib import Path
import json

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from fastapi import FastAPI
from fastapi import HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn


class WebUINode(Node):
    def __init__(self):
        super().__init__("web_ui_node")

        self.status_pub = self.create_publisher(String, "/web/status", 10)
        self.action_pub = self.create_publisher(String, "/brain/actions", 10)
        self.latest_action_status = None
        self.action_status_sub = self.create_subscription(
            String,
            "/action/status",
            self.action_status_callback,
            10,
        )

        self.get_logger().info("Web UI ROS node started")

    def publish_status(self, text: str):
        msg = String()
        msg.data = text
        self.status_pub.publish(msg)

    def publish_action(self, action: dict):
        msg = String()
        msg.data = json.dumps(action)
        self.action_pub.publish(msg)

    def action_status_callback(self, msg: String):
        try:
            self.latest_action_status = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warn("Ignoring invalid /action/status JSON")


def teleop_action_for_key(key: str):
    normalized = key.lower().strip()

    if normalized == "w":
        return {"action": "wheel_command", "command": "forward", "duration_sec": 0.35}
    if normalized == "a":
        return {"action": "wheel_command", "command": "left", "duration_sec": 0.35}
    if normalized == "s":
        return {"action": "wheel_command", "command": "backward", "duration_sec": 0.35}
    if normalized == "d":
        return {"action": "wheel_command", "command": "right", "duration_sec": 0.35}
    if normalized == "z":
        return {"action": "wheel_command", "command": "shift_left", "duration_sec": 0.35}
    if normalized == "c":
        return {"action": "wheel_command", "command": "shift_right", "duration_sec": 0.35}
    if normalized == "q":
        return {"action": "ptz_command", "delta": -5.0}
    if normalized == "e":
        return {"action": "ptz_command", "delta": 5.0}
    if normalized == " " or normalized == "space":
        return {"action": "stop", "reason": "web_teleop_stop", "priority": "high"}

    raise KeyError(normalized)


def create_app(ros_node: WebUINode):
    app = FastAPI()

    web_dir = os.path.join(os.path.dirname(__file__), "web")

    app.mount("/static", StaticFiles(directory=web_dir), name="static")

    @app.get("/")
    def index():
        return FileResponse(os.path.join(web_dir, "index.html"))

    @app.get("/status")
    def status():
        return {
            "robot": "R1",
            "web_node": "running",
        }

    @app.get("/hardware/status")
    def hardware_status():
        return ros_node.latest_action_status or {
            "ok": False,
            "error": "No action-node status received yet.",
        }

    @app.post("/say/{text}")
    def say(text: str):
        ros_node.publish_status(text)
        return {"ok": True, "published": text}

    @app.post("/teleop/{key}")
    def teleop(key: str):
        try:
            action = teleop_action_for_key(key)
        except KeyError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported teleop key: {exc.args[0]}",
            ) from exc

        request_id = uuid.uuid4().hex
        action["request_id"] = request_id
        ros_node.publish_action(action)
        return {
            "ok": True,
            "key": key,
            "action": action,
            "request_id": request_id,
            "message": "Command queued; check /hardware/status for execution result.",
        }

    return app


def main(args=None):
    rclpy.init(args=args)

    ros_node = WebUINode()
    app = create_app(ros_node)
    web_port = int(os.environ.get("R1_WEB_PORT", "8002"))

    cert_dir = Path("/home/ubuntu/certs")
    ssl_kwargs = {}
    key_file = cert_dir / "key.pem"
    cert_file = cert_dir / "cert.pem"
    if key_file.is_file() and cert_file.is_file():
        ssl_kwargs = {
            "ssl_keyfile": str(key_file),
            "ssl_certfile": str(cert_file),
        }
        ros_node.get_logger().info("Starting web UI with HTTPS")
    else:
        ros_node.get_logger().info("Starting web UI without TLS certs")

    server_thread = threading.Thread(
        target=lambda: uvicorn.run(
            app,
            host="0.0.0.0",
            port=web_port,
            **ssl_kwargs,
        ),
        daemon=True,
    )
    server_thread.start()

    try:
        rclpy.spin(ros_node)
    except KeyboardInterrupt:
        pass
    finally:
        ros_node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
