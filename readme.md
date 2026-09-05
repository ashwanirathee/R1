# R1

R1 is a Raspberry Pi 5-based Physical AI robot platform for experiments in robot perception, reasoning, and control. It uses ROS 2 to organize the system into modular software components.

<p align="center">
  <img src="assets/logo.jpg" width="500" alt="R1 logo">
</p>

## Goals

R1 is designed as a small, always-on research platform for testing embodied AI systems on real hardware. The platform focuses on:

- Perception: multi-camera sensing, object/face detection, and scene understanding
- Reasoning/AI: language-driven interpretation of visual events and robot state
- Control: modular action execution through ROS 2 nodes
- Observability: live monitoring through Foxglove, Prometheus, and Grafana
- Remote compute: offloading heavier AI workloads to a compute server when needed

The project theory is documented at https://projectnode1.github.io. This
repository focuses on implementing and running the R1 platform.

## Setup

### ROS Instructions

```bash
cd /home/ubuntu/r1
source /opt/ros/jazzy/setup.bash
source install/setup.bash

colcon build --symlink-install
```

To remove build artifacts:

```bash
rm -rf build install log
```

Launch the base bringup stack:

```bash
ros2 launch r1 bringup.launch.py \
  event_min_interval_sec:=5.0 \
  event_max_silence_sec:=5.0 \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  yolo_camera_uid:=10 \
  enable_slam:=false \
  enable_web:=true \
  enable_ear:=false \
  enable_audio:=false \
  enable_vlm:=false \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_detector:=false \
  enable_segmentor:=false \
  enable_semantic_segmentation:=false \
  enable_pose:=false \
  enable_monocular_depth:=false \
  enable_oriented_detection:=false \
  enable_sampler:=false \
  enable_wheels:=false \
  enable_ptz:=false \
  enable_sensors:=false \
  gpio_chip:=4
```

Task-specific perception nodes:

```bash
# Task 1: object detection
ros2 launch r1 bringup.launch.py \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_detector:=true \
  detector_camera_uid:=10 \
  task_1_output_mode:=both

# Task 2: instance segmentation
ros2 launch r1 bringup.launch.py \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_segmentor:=true \
  segmentor_camera_uid:=10 \
  task_2_segmentation_output_mode:=both

# Task 3: semantic segmentation
ros2 launch r1 bringup.launch.py \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_semantic_segmentation:=true \
  semantic_segmentation_camera_uid:=10 \
  task_3_semantic_segmentation_output_mode:=both

# Task 4: pose
ros2 launch r1 bringup.launch.py \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_pose:=true \
  pose_camera_uid:=10 \
  task_4_pose_output_mode:=both

# Task 5: monocular depth
ros2 launch r1 bringup.launch.py \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_monocular_depth:=true \
  monocular_depth_camera_uid:=10 \
  task_5_depth_output_mode:=both

# Task 6: oriented object detection
ros2 launch r1 bringup.launch.py \
  camera_uids:="[10]" \
  camera_labels:='["main"]' \
  enable_2dobd:=false \
  enable_3dobd:=false \
  enable_oriented_detection:=true \
  oriented_detection_camera_uid:=10 \
  task_6_obb_output_mode:=both
```

Perception overlay topics:

- Task 1: `/detector/overlay_image/compressed`
- Task 2: `/segmentor/overlay_image/compressed`
- Task 3: `/semantic_segmentation/overlay_image/compressed`
- Task 4: `/pose/overlay_image/compressed`
- Task 5: `/monocular_depth/overlay_image/compressed`
- Task 6: `/oriented_detection/overlay_image/compressed`

Run Foxglove bridge:

```bash
ros2 launch foxglove_bridge foxglove_bridge_launch.xml
```

Run an individual node:

```bash
ros2 run r1 node_name
```

### Docker Compose

Compose is the preferred way to start the ROS container because it keeps the
device mappings, ports, user IDs, and host mounts in one file.

Set host-specific IDs once per shell, or copy `.env.example` to `.env` and edit
the values:

```bash
export HOST_UID="$(id -u)"
export HOST_GID="$(id -g)"
export GPIO_GID="$(getent group gpio | cut -d: -f3)"
export I2C_GID="$(stat -c '%g' /dev/i2c-1)"
```

Build the image:

```bash
docker compose build
```

Start the container in the background:

```bash
docker compose up -d r1-ros
```

Enter the running container from any terminal:

```bash
docker compose exec r1-ros bash
```

Stop and remove the Compose container:

```bash
docker compose down
```

For quick one-off commands:

```bash
docker run --rm r1-ros date
docker compose run --rm r1-ros date
```

### Raw Docker

Use this only when Compose is not available:

```bash
docker build -t r1-ros .
docker run -it --rm \
  --name r1-ros \
  --user $(id -u):$(id -g) \
  --add-host=host.docker.internal:host-gateway \
  --group-add video \
  --device /dev/gpiochip0:/dev/gpiochip0 \
  --device /dev/gpiochip4:/dev/gpiochip4 \
  --group-add $(getent group gpio | cut -d: -f3) \
  --device /dev/video10 \
  --device /dev/i2c-1:/dev/i2c-1 \
  --group-add $(stat -c '%g' /dev/i2c-1) \
  -p 8765:8765 \
  -p 8002:8002 \
  -v /home/murphy/Documents/r1:/home/ubuntu/r1 \
  r1-ros:latest
```

The wheel and PTZ controllers need `gpiozero` and GPIO device access. The Docker
and Compose examples expose `/dev/gpiochip0`, `/dev/gpiochip4`, `/dev/video10`,
and `/dev/i2c-1`. If GPIO pins are exposed through `/dev/gpiochip4`, launch with
`gpio_chip:=4`.

After changing the image or command, rebuild, recreate the container, and source
`install/setup.bash` before launching.

## Node Notes

### Audio Node and Bluetooth Bridge

```bash
pactl list short sinks
pactl set-sink-volume bluez_output.41_42_12_84_8B_60.1 40%

chmod +x speaker_bridge.sh
apt update
apt install -y espeak alsa-utils
sudo apt install -y sox

ros2 topic pub --once /audio/heard_text std_msgs/msg/String "{data: 'how many cans are there and are of which brand? what about bottles?'}"

# run the speaker bridge in the host machine to forward audio from ROS to the bluetooth speaker
/home/murphy/Documents/r1/src/speaker_bridge.sh
```

### Camera Node Access

```bash
sudo apt install v4l2loopback-dkms v4l2loopback-utils ffmpeg

sudo modprobe v4l2loopback \
  video_nr=10 \
  card_label="R1 Camera" \
  exclusive_caps=1

v4l2-ctl --list-devices

rpicam-vid \
  -t 0 \
  --width 1280 \
  --height 720 \
  --framerate 30 \
  --codec yuv420 \
  -o - \
| ffmpeg \
    -f rawvideo \
    -pixel_format yuv420p \
    -video_size 1280x720 \
    -framerate 30 \
    -i - \
    -f v4l2 \
    -pix_fmt yuv420p \
    /dev/video10

```

### VLM Node

```bash
ollama run moondream # on the host
ollama serve
```

### Foxglove Visualization

```bash
ros2 launch foxglove_bridge foxglove_bridge_launch.xml
```

## R1 Compute Server

R1 can use a remote compute server for workloads that are too large for the
robot to handle locally.

## R1 System Monitor

Grafana and Prometheus can be used to monitor system performance and identify
runtime issues.

## References
- ROS 2 documentation: https://docs.ros.org/
- https://github.com/apple/ml-cubifyanything
- https://arxiv.org/abs/2005.14165
- https://arxiv.org/abs/2203.02155
- https://arxiv.org/pdf/2412.16720
- https://github.com/karpathy/autoresearch
- https://github.com/facebookresearch/dinov3
