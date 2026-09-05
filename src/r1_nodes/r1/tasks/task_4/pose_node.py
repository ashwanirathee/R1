import cv2
import json
import time

import rclpy
from cv_bridge import CvBridge
from rclpy.node import Node
from rclpy.qos import HistoryPolicy, QoSProfile, ReliabilityPolicy
from sensor_msgs.msg import CompressedImage, Image
from std_msgs.msg import String
from ultralytics import YOLO


def as_bool(value):
    if isinstance(value, str):
        return value.lower() in ("1", "true", "yes", "on")
    return bool(value)


class PoseNode(Node):
    def __init__(self):
        super().__init__("pose_node")
        self.bridge = CvBridge()

        self.declare_parameter("camera_uid", 10)
        self.camera_uid = int(self.get_parameter("camera_uid").value)

        self.declare_parameter("enable_task_4_pose_tracking", False)
        self.enable_tracking = as_bool(
            self.get_parameter("enable_task_4_pose_tracking").value
        )

        self.declare_parameter("task_4_pose_output_mode", "events")
        self.output_mode = (
            self.get_parameter("task_4_pose_output_mode").value
        ).lower()
        if self.output_mode not in ("events", "overlay", "both"):
            self.get_logger().warning(
                "Invalid task_4_pose_output_mode "
                f"'{self.output_mode}', falling back to 'events'."
            )
            self.output_mode = "events"

        self.declare_parameter("pose_model", "yolo26n-pose.pt")
        self.model_name = self.get_parameter("pose_model").value

        self.create_subscription(
            Image,
            f"/camera/uid_{self.camera_uid}/image_raw",
            self.image_callback,
            QoSProfile(
                history=HistoryPolicy.KEEP_LAST,
                depth=1,
                reliability=ReliabilityPolicy.BEST_EFFORT,
            ),
        )

        self.event_pub = self.create_publisher(String, "/pose/events", 10)
        self.overlay_pub = self.create_publisher(
            CompressedImage,
            "/pose/overlay_image/compressed",
            10,
        )

        self.model = YOLO(self.model_name)
        self.get_logger().info(f"Pose node started for camera {self.camera_uid}.")

    def image_callback(self, msg):
        frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding="bgr8")

        inference_start = time.perf_counter()
        if self.enable_tracking:
            results = self.model.track(frame, persist=True, verbose=False)
        else:
            results = self.model.predict(frame, verbose=False)
        inference_latency_ms = (time.perf_counter() - inference_start) * 1000
        results = results or []

        overlay_frame = results[0].plot() if results else frame
        poses = []

        for result in results:
            boxes = getattr(result, "boxes", None)
            keypoints = getattr(result, "keypoints", None)
            if boxes is None:
                continue

            track_ids = (
                boxes.id if boxes.id is not None else [None] * len(boxes.cls)
            )
            keypoints_xyn = keypoints.xyn if keypoints is not None else []
            keypoints_conf = (
                keypoints.conf
                if keypoints is not None and keypoints.conf is not None
                else []
            )

            for index, (xywhn, cls, conf, track_id) in enumerate(
                zip(boxes.xywhn, boxes.cls, boxes.conf, track_ids)
            ):
                class_id = int(cls.item())
                pose = {
                    "class_id": class_id,
                    "class_name": result.names[class_id],
                    "confidence": float(conf.item()),
                    "bbox": xywhn.tolist(),
                    "keypoints": (
                        keypoints_xyn[index].tolist()
                        if index < len(keypoints_xyn)
                        else []
                    ),
                    "keypoint_confidences": (
                        keypoints_conf[index].tolist()
                        if index < len(keypoints_conf)
                        else []
                    ),
                }

                if track_id is not None:
                    pose["track_id"] = int(track_id.item())

                poses.append(pose)

        stamp_ns = (
            msg.header.stamp.sec * 1_000_000_000
            + msg.header.stamp.nanosec
        )

        payload = {
            "stamp_ns": stamp_ns,
            "camera_uid": self.camera_uid,
            "model": self.model_name,
            "inference_latency_ms": inference_latency_ms,
            "poses": poses,
        }

        if self.output_mode in ("events", "both"):
            ros_msg = String()
            ros_msg.data = json.dumps(payload)
            self.event_pub.publish(ros_msg)

        if self.output_mode in ("overlay", "both"):
            cv2.putText(
                overlay_frame,
                f"model {inference_latency_ms:.1f} ms",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 255),
                2,
                cv2.LINE_AA,
            )
            ok, encoded = cv2.imencode(".jpg", overlay_frame)
            if ok:
                ros_msg = CompressedImage()
                ros_msg.header = msg.header
                ros_msg.format = "jpeg"
                ros_msg.data = encoded.tobytes()
                self.overlay_pub.publish(ros_msg)


def main(args=None):
    rclpy.init(args=args)
    node = PoseNode()

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
