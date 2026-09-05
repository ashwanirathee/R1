FROM ros:jazzy-perception

ENV TZ=America/Los_Angeles
ENV YOLO_CONFIG_DIR=/tmp/Ultralytics

# Timezone + system + ROS dependencies
RUN apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y \
    tzdata \
    python3-pip \
    python3-opencv \
    python3-requests \
    python3-numpy \
    python3-yaml \
    python3-gpiozero \
    python3-lgpio \
    espeak \
    alsa-utils \
    sox \
    ros-jazzy-foxglove-bridge \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# PyTorch CPU wheels
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu

# Normal Python packages WITH dependencies
RUN python3 -m pip install --break-system-packages --ignore-installed --no-cache-dir \
    requests \
    "fastapi[standard]" \
    uvicorn \
    "numpy==1.26.4" \
    matplotlib \
    cycler \
    kiwisolver \
    fonttools \
    contourpy \
    pyparsing \
    packaging \
    python-dateutil \
    onnx \
    onnxruntime \
    lap \
    adafruit-blinka \
    adafruit-extended-bus \
    adafruit-circuitpython-bno08x

# Ultralytics without dependencies, to avoid it changing your torch/opencv stack
RUN python3 -m pip install --break-system-packages --no-cache-dir \
    ultralytics --no-deps

WORKDIR /home/ubuntu/r1

EXPOSE 8002

CMD ["/bin/bash"]
