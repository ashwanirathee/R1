import rclpy
from rclpy.node import Node
from sensor_msgs.msg import Image
from std_msgs.msg import String
from cv_bridge import CvBridge
import json

from ultralytics import YOLO

class DetectorNode(Node):
    def __init__(self):
        super().__init__("detector_node")
        self.bridge = CvBridge()

        self.declare_parameter("camera_uid", 10)
        self.camera_uid = int(self.get_parameter("camera_uid").value)

        self.create_subscription(
            Image,
            f"/camera/uid_{self.camera_uid}/image_raw",
            self.image_callback,
            10,
        )

        self.event_pub = self.create_publisher(String, "/detector/events", 10)
        
        self.model = YOLO("yolo26n.pt") 

        self.get_logger().info("Detecto node started. Listening on /brain/actions")


    def image_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding="bgr8")

        height, width, _ = frame.shape


        # Predict with the model
        results = self.model(frame)  # predict on an image

        output = []

        for result in results:
            boxes = result.boxes

            for xywh, xywhn, xyxy, xyxyn, cls, conf in zip(
                boxes.xywh,
                boxes.xywhn,
                boxes.xyxy,
                boxes.xyxyn,
                boxes.cls,
                boxes.conf,
            ):
                class_id = int(cls.item())

                output.append({
                    # "class_id": class_id,
                    "class_name": result.names[class_id],
                    "confidence": float(conf.item()),

                    # "xywh": xywh.tolist(),
                    # "xywhn": xywhn.tolist(),
                    # "xyxy": xyxy.tolist(),
                    # "xyxyn": xyxyn.tolist(),
                })

        ros_msg = String()
        ros_msg.data = json.dumps(output)
        self.event_pub.publish(ros_msg)
            
def main(args=None):
    rclpy.init(args=args)
    node = DetectorNode()

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
