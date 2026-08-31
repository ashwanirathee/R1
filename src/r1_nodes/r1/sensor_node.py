import json
import time

import rclpy
from rclpy.node import Node
from std_msgs.msg import String

from r1.hardware.imu import IMUReader


class SensorNode(Node):
    def __init__(self):
        super().__init__("sensor_node")

        self.declare_parameter("enable_imu", True)
        self.declare_parameter("imu_update_interval_sec", 0.5)
        self.declare_parameter("publish_interval_sec", 0.5)

        self.enable_imu = bool(self.get_parameter("enable_imu").value)
        self.imu_update_interval_sec = float(
            self.get_parameter("imu_update_interval_sec").value
        )
        self.publish_interval_sec = float(
            self.get_parameter("publish_interval_sec").value
        )

        self.imu_pub = self.create_publisher(String, "/sensors/imu", 10)
        self.status_pub = self.create_publisher(String, "/sensors/status", 10)

        self.imu_reader = IMUReader(
            enabled=self.enable_imu,
            update_interval=self.imu_update_interval_sec,
        )
        self.imu_reader.start()

        self.create_timer(self.publish_interval_sec, self.publish_sensor_updates)

        self.get_logger().info(
            "Sensor node started. Publishing /sensors/imu and /sensors/status"
        )

    def publish_sensor_updates(self):
        now = time.time()

        status = {
            "type": "sensor_status",
            "timestamp": now,
            "imu": {
                "enabled": self.enable_imu,
                "available": self.imu_reader.available,
                "error": self.imu_reader.error,
                "has_snapshot": self.imu_reader.snapshot is not None,
            },
        }
        self._publish_json(self.status_pub, status)

        snapshot = self.imu_reader.snapshot
        if snapshot is None:
            return

        imu_msg = {
            "type": "imu",
            "timestamp": now,
            "sensor_timestamp": snapshot.timestamp,
            "acceleration": list(snapshot.acceleration),
            "gyro": list(snapshot.gyro),
            "magnetic": list(snapshot.magnetic),
            "quaternion": list(snapshot.quaternion),
        }
        self._publish_json(self.imu_pub, imu_msg)

    def _publish_json(self, publisher, payload):
        msg = String()
        msg.data = json.dumps(payload)
        publisher.publish(msg)

    def destroy_node(self):
        self.imu_reader.stop()
        super().destroy_node()


def main(args=None):
    rclpy.init(args=args)
    node = SensorNode()

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass

    node.destroy_node()
    rclpy.shutdown()


if __name__ == "__main__":
    main()
