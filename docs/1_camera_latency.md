
## Camera Latency

We want to ensure that the camera latency is real time and we are capturing images at around 24-30 frames per second.

Camera we have onboard is Sony IMX477 by ArduCam which is a high quality ca,era. The camera is connected to the Pi via the CSI interface.

```
Available cameras
-----------------
0 : imx477 [4056x3040 12-bit RGGB] (/base/axi/pcie@1000120000/rp1/i2c@88000/imx477@1a)
    Modes: 'SRGGB10_CSI2P' : 1332x990 [120.50 fps - (696, 528)/2664x1980 crop]
                             2028x1080 [74.74 fps - (0, 440)/4056x2160 crop]
                             2028x1520 [53.77 fps - (0, 0)/4056x3040 crop]
                             4056x2160 [19.58 fps - (0, 440)/4056x3040 crop]
                             4056x3040 [14.00 fps - (0, 0)/4056x3040 crop]
           'SRGGB12_CSI2P' : 1332x990 [101.68 fps - (696, 528)/2664x1980 crop]
                             2028x1080 [62.81 fps - (0, 440)/4056x2160 crop]
                             2028x1520 [45.19 fps - (0, 0)/4056x3040 crop]
                             4056x2160 [16.39 fps - (0, 440)/4056x3040 crop]
                             4056x3040 [11.72 fps - (0, 0)/4056x3040 crop]
           'SRGGB8' : 1332x990 [147.91 fps - (696, 528)/2664x1980 crop]
                      2028x1080 [92.27 fps - (0, 440)/4056x2160 crop]
                      2028x1520 [66.38 fps - (0, 0)/4056x3040 crop]
                      4056x2160 [24.32 fps - (0, 440)/4056x3040 crop]
                      4056x3040 [17.39 fps - (0, 0)/4056x3040 crop]

```

So it can deliver various resolutions and frame rates.

Questions:
- What is CSI / MIPI CSI-2?
- What are the potential use case I have?

Our system currently is limited in movement despite wheels due to power issues. Albeit it's structured as shown below:
```
Wheeled based
+ pan/tilt camera
+ IMX477 high-quality CSI camera
+ ROS 2 perception nodes
= active vision robot
```
So the cameras_node.py is the main node tha holds the code for
getting the images from the camera. It extends Node which comes through rclpy which is main ROS base library.

We want to learn about the camera stack so we'll take the proper path. Native method is via rpicam
```
rpicam-hello --list-cameras
rpicam-hello # open camera and show live preview
rpicam-still -o test.jpg --width 1280 --height 720 # saves a photo
```

We have ubuntu based docker which is incompatible with picamera2 hence we utilize loopback
to make the CSI work like normal webcam
```
sudo apt update
sudo apt install -y v4l2loopback-dkms v4l-utils ffmpeg

sudo modprobe v4l2loopback video_nr=10 card_label="IMX477Loopback" exclusive_caps=1

v4l2-ctl --list-devices
ls /dev/video10

rpicam-vid -t 0 --width 640 --height 480 --framerate 30 \
  --codec mjpeg -o - | \
ffmpeg -fflags nobuffer -flags low_delay -i - \
  -f v4l2 -pix_fmt yuyv422 /dev/video10

```

Question now:
- What can v4l2 loopback do?
- What are /dev/video*?
- What are different pixel formats?
- What are different color formats?
- What is mjpeg vs jpeg vs jpeg2000?

Current the stream is utilizing the old the ros node
and over the network also the speed is pretty so this is it currently.