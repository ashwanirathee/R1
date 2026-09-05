import json
import random
import time
from collections import OrderedDict
from pathlib import Path

import cv2
import numpy as np

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import CompressedImage
from std_msgs.msg import String


class SamplerNode(Node):
    def __init__(self):
        super().__init__("sampler_node")

        self.declare_parameter("camera_uid", 10)
        self.declare_parameter("save_dir", "./flywheel/raw")

        self.camera_uid = int(
            self.get_parameter("camera_uid").value
        )

        self.save_dir = Path(
            self.get_parameter("save_dir").value
        )

        self.images_dir = self.save_dir / "images"
        self.metadata_dir = self.save_dir / "metadata"

        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.metadata_dir.mkdir(parents=True, exist_ok=True)

        # ------------------------
        # Sampling parameters
        # ------------------------

        self.low_conf_min = 0.20
        self.low_conf_max = 0.60

        self.empty_sample_rate = 0.02
        self.random_sample_rate = 0.005

        self.min_save_interval = 3.0

        # timestamp -> compressed image
        self.frame_cache = OrderedDict()
        self.max_cache_size = 150

        self.last_save_time = 0.0

        self.create_subscription(
            CompressedImage,
            f"/camera/uid_{self.camera_uid}/image_compressed",
            self.image_callback,
            10,
        )

        self.create_subscription(
            String,
            "/detector/events",
            self.detector_callback,
            10,
        )

        self.get_logger().info(
            f"Sampler running for camera {self.camera_uid}"
        )

    # --------------------------------------------------
    # Store recent frames
    # --------------------------------------------------

    def image_callback(self, msg):

        stamp_ns = (
            msg.header.stamp.sec * 1_000_000_000
            + msg.header.stamp.nanosec
        )

        self.frame_cache[stamp_ns] = msg.data

        while len(self.frame_cache) > self.max_cache_size:
            self.frame_cache.popitem(last=False)

    # --------------------------------------------------
    # Decide whether detector output is interesting
    # --------------------------------------------------

    def detector_callback(self, msg):

        try:
            event = json.loads(msg.data)
        except json.JSONDecodeError:
            self.get_logger().warning("Invalid detector JSON")
            return

        if event.get("camera_uid") != self.camera_uid:
            return

        stamp_ns = event["stamp_ns"]
        detections = event["detections"]

        score, reasons = self.score_sample(detections)

        if score <= 0:
            return

        # Temporal deduplication
        now = time.monotonic()

        if now - self.last_save_time < self.min_save_interval:
            return

        compressed = self.frame_cache.get(stamp_ns)

        if compressed is None:
            self.get_logger().warning(
                f"No cached frame for {stamp_ns}"
            )
            return

        frame = cv2.imdecode(
            np.frombuffer(compressed, dtype=np.uint8),
            cv2.IMREAD_COLOR,
        )

        if frame is None:
            self.get_logger().warning("Could not decode image")
            return

        self.save_sample(
            frame=frame,
            event=event,
            score=score,
            reasons=reasons,
        )

        self.last_save_time = now

    # --------------------------------------------------
    # Sampling policy
    # --------------------------------------------------

    def score_sample(self, detections):

        score = 0.0
        reasons = []

        # ----------------------------------------
        # Low-confidence detections
        # ----------------------------------------

        for detection in detections:

            conf = detection["confidence"]

            if self.low_conf_min <= conf <= self.low_conf_max:
                score += 1.0 - abs(conf - 0.40)
                reasons.append("low_confidence")

        # ----------------------------------------
        # Empty frames
        # ----------------------------------------

        if not detections:

            if random.random() < self.empty_sample_rate:
                score += 1.0
                reasons.append("sampled_empty")

        # ----------------------------------------
        # Random unbiased sample
        # ----------------------------------------

        if random.random() < self.random_sample_rate:
            score += 0.5
            reasons.append("random")

        return score, list(set(reasons))

    # --------------------------------------------------
    # Save image + metadata
    # --------------------------------------------------

    def save_sample(
        self,
        frame,
        event,
        score,
        reasons,
    ):

        sample_id = str(event["stamp_ns"])

        image_path = (
            self.images_dir /
            f"{sample_id}.jpg"
        )

        metadata_path = (
            self.metadata_dir /
            f"{sample_id}.json"
        )

        cv2.imwrite(
            str(image_path),
            frame,
            [cv2.IMWRITE_JPEG_QUALITY, 90],
        )

        metadata = {
            "sample_id": sample_id,

            "timestamp_ns": event["stamp_ns"],

            "camera_uid": event["camera_uid"],

            "model": {
                "name": event["model"],
                "version": "v1",
            },

            "sampling": {
                "score": score,
                "reasons": reasons,
            },

            "detections": event["detections"],

            "status": "unreviewed",
        }

        with open(metadata_path, "w") as f:
            json.dump(metadata, f, indent=2)

        self.get_logger().info(
            f"SAVED {sample_id}: "
            f"{reasons} score={score:.2f}"
        )


def main(args=None):

    rclpy.init(args=args)

    node = SamplerNode()

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