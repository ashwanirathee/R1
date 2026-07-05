import os
import threading
from pathlib import Path

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
import uvicorn


class WebUINode(Node):
    def __init__(self):
        super().__init__("web_ui_node")

        self.status_pub = self.create_publisher(String, "/web/status", 10)

        self.get_logger().info("Web UI ROS node started")

    def publish_status(self, text: str):
        msg = String()
        msg.data = text
        self.status_pub.publish(msg)


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

    @app.post("/say/{text}")
    def say(text: str):
        ros_node.publish_status(text)
        return {"ok": True, "published": text}

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