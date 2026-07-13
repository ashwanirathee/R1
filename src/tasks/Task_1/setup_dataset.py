import os
import cv2
import numpy as np
from mcap_ros2.reader import read_ros2_messages


MCAP_PATH = "data/rosbag2_2026_07_09-14_05_52/rosbag2_2026_07_09-14_05_52_0.mcap"
OUTPUT_DIR = "extracted_images"

# Set this after checking topics, example:
IMAGE_TOPIC = "/camera/uid_10/image_compressed"
# IMAGE_TOPIC = "/camera/color/image_raw"
# IMAGE_TOPIC = "/camera/image/compressed"


def save_ros_image(msg, output_path):
    """
    Handles sensor_msgs/msg/Image.
    """
    height = msg.height
    width = msg.width
    encoding = msg.encoding

    data = np.frombuffer(msg.data, dtype=np.uint8)

    if encoding in ["rgb8", "bgr8"]:
        img = data.reshape((height, width, 3))

        if encoding == "rgb8":
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)

    elif encoding in ["mono8", "8UC1"]:
        img = data.reshape((height, width))

    elif encoding in ["rgba8", "bgra8"]:
        img = data.reshape((height, width, 4))

        if encoding == "rgba8":
            img = cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
        else:
            img = cv2.cvtColor(img, cv2.COLOR_BGRA2BGR)

    else:
        raise ValueError(f"Unsupported encoding: {encoding}")

    cv2.imwrite(output_path, img)


def save_compressed_image(msg, output_path):
    """
    Handles sensor_msgs/msg/CompressedImage.
    """
    data = np.frombuffer(msg.data, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)

    if img is None:
        raise ValueError("cv2.imdecode failed")

    cv2.imwrite(output_path, img)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    count = 0

    for ros_msg in read_ros2_messages(MCAP_PATH):
        topic = ros_msg.channel.topic

        if topic != IMAGE_TOPIC:
            continue

        msg = ros_msg.ros_msg
        schema_name = ros_msg.channel.message_encoding

        # Better type check using decoded message class name
        msg_type = type(msg).__name__

        if msg_type == "Image":
            save_path = os.path.join(OUTPUT_DIR, f"frame_{count:06d}.png")
            save_ros_image(msg, save_path)

        elif msg_type == "CompressedImage":
            save_path = os.path.join(OUTPUT_DIR, f"frame_{count:06d}.jpg")
            save_compressed_image(msg, save_path)

        else:
            print(f"Skipping unsupported message type: {msg_type}")
            continue

        print(save_path)
        count += 1

    print(f"Saved {count} images to {OUTPUT_DIR}")


if __name__ == "__main__":
    main()