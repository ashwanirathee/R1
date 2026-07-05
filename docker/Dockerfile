FROM ros:jazzy-perception

ENV DEBIAN_FRONTEND=noninteractive
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics

# System + ROS dependencies
RUN apt update && apt install -y \
    python3-pip \
    python3-opencv \
    python3-requests \
    python3-numpy \
    python3-yaml \
    espeak \
    alsa-utils \
    sox \
    ros-jazzy-foxglove-bridge \
    && rm -rf /var/lib/apt/lists/*

# Normal Python packages WITH dependencies
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    requests \
    "fastapi[standard]" \
    uvicorn \
    matplotlib \
    cycler \
    kiwisolver \
    fonttools \
    contourpy \
    pyparsing \
    packaging \
    python-dateutil \
    onnx \
    onnxruntime

# Ultralytics without dependencies, to avoid it changing your torch/opencv stack
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    ultralytics --no-deps

# PyTorch CPU wheels
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

WORKDIR /home/ubuntu/r1

EXPOSE 8002

CMD ["/bin/bash"]
