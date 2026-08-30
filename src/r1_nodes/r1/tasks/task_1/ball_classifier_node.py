import rclpy
from rclpy.node import Node
from .opencv_based_classification import detect_yellow_ball
from sensor_msgs.msg import Image
from std_msgs.msg import String
from cv_bridge import CvBridge
import json

class BallClassifierNode(Node):
    def __init__(self):
        super().__init__("ball_classifier_node")
        self.bridge = CvBridge()

        self.declare_parameter("camera_uid", 0)
        self.camera_uid = int(self.get_parameter("camera_uid").value)

        self.create_subscription(
            Image,
            f"/camera/uid_{self.camera_uid}/image_raw",
            self.image_callback,
            10,
        )

        self.event_pub = self.create_publisher(String, "/ball_classifier/events", 10)
        self.get_logger().info("Ball Classifier node started. Listening on /brain/actions")


    def image_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding="bgr8")
        # self.get_logger().info("Processing image for ball classification")

        found, _vis, _mask, info = detect_yellow_ball(frame)

        if found:
            event = {
                "type": "ball_detection",
                "label": "yellow_ball",
                "camera_uid": self.camera_uid,
                "found": True,
                "center": list(info["center"]),
                "bbox": list(info["bbox"]),
                "radius": info["radius"],
                "area": info["area"],
                "circularity": info["circularity"],
                "solidity": info["solidity"],
                "fill_ratio": info["fill_ratio"],
            }
            self.event_pub.publish(String(data=json.dumps(event)))

def main(args=None):
    rclpy.init(args=args)
    node = BallClassifierNode()

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        if rclpy.ok():
            rclpy.shutdown()


if __name__ == "__main__":
    main()
