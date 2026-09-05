from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.conditions import IfCondition
from launch.substitutions import LaunchConfiguration, PythonExpression
from launch_ros.actions import Node


def generate_launch_description():
    camera_uids = LaunchConfiguration("camera_uids")
    camera_labels = LaunchConfiguration("camera_labels")
    latest_image_path = LaunchConfiguration("latest_image_path")
    ollama_url = LaunchConfiguration("ollama_url")
    vlm_model = LaunchConfiguration("vlm_model")
    use_espeak = LaunchConfiguration("use_espeak")
    enable_2dobd = LaunchConfiguration("enable_2dobd")
    enable_3dobd = LaunchConfiguration("enable_3dobd")
    yolo_camera_uid = LaunchConfiguration("yolo_camera_uid")
    enable_ear = LaunchConfiguration("enable_ear")
    enable_detector = LaunchConfiguration("enable_detector")
    detector_camera_uid = LaunchConfiguration("detector_camera_uid")
    enable_segmentor = LaunchConfiguration("enable_segmentor")
    segmentor_camera_uid = LaunchConfiguration("segmentor_camera_uid")
    enable_task_2_segmentation_tracking = LaunchConfiguration(
        "enable_task_2_segmentation_tracking"
    )
    task_2_segmentation_output_mode = LaunchConfiguration(
        "task_2_segmentation_output_mode"
    )
    segmentor_model = LaunchConfiguration("segmentor_model")
    enable_semantic_segmentation = LaunchConfiguration(
        "enable_semantic_segmentation"
    )
    semantic_segmentation_camera_uid = LaunchConfiguration(
        "semantic_segmentation_camera_uid"
    )
    enable_task_3_semantic_segmentation_tracking = LaunchConfiguration(
        "enable_task_3_semantic_segmentation_tracking"
    )
    task_3_semantic_segmentation_output_mode = LaunchConfiguration(
        "task_3_semantic_segmentation_output_mode"
    )
    semantic_segmentation_model = LaunchConfiguration(
        "semantic_segmentation_model"
    )
    enable_pose = LaunchConfiguration("enable_pose")
    pose_camera_uid = LaunchConfiguration("pose_camera_uid")
    enable_task_4_pose_tracking = LaunchConfiguration(
        "enable_task_4_pose_tracking"
    )
    task_4_pose_output_mode = LaunchConfiguration("task_4_pose_output_mode")
    pose_model = LaunchConfiguration("pose_model")
    enable_monocular_depth = LaunchConfiguration("enable_monocular_depth")
    monocular_depth_camera_uid = LaunchConfiguration(
        "monocular_depth_camera_uid"
    )
    task_5_depth_output_mode = LaunchConfiguration("task_5_depth_output_mode")
    depth_model = LaunchConfiguration("depth_model")
    enable_oriented_detection = LaunchConfiguration("enable_oriented_detection")
    oriented_detection_camera_uid = LaunchConfiguration(
        "oriented_detection_camera_uid"
    )
    enable_task_6_obb_tracking = LaunchConfiguration(
        "enable_task_6_obb_tracking"
    )
    task_6_obb_output_mode = LaunchConfiguration("task_6_obb_output_mode")
    obb_model = LaunchConfiguration("obb_model")
    enable_sampler = LaunchConfiguration("enable_sampler")
    sampler_camera_uid = LaunchConfiguration("sampler_camera_uid")
    sampler_save_dir = LaunchConfiguration("sampler_save_dir")
    enable_vlm = LaunchConfiguration("enable_vlm")
    enable_slam = LaunchConfiguration("enable_slam")
    enable_web = LaunchConfiguration("enable_web")
    enable_sensors = LaunchConfiguration("enable_sensors")
    enable_wheels = LaunchConfiguration("enable_wheels")
    enable_ptz = LaunchConfiguration("enable_ptz")
    gpio_chip = LaunchConfiguration("gpio_chip")
    event_min_interval_sec = LaunchConfiguration("event_min_interval_sec")
    event_max_silence_sec = LaunchConfiguration("event_max_silence_sec")
    imu_update_interval_sec = LaunchConfiguration("imu_update_interval_sec")
    sensor_publish_interval_sec = LaunchConfiguration("sensor_publish_interval_sec")
    slam_camera_topic = LaunchConfiguration("slam_camera_topic")
    slam_focal_length = LaunchConfiguration("slam_focal_length")
    slam_principal_point_x = LaunchConfiguration("slam_principal_point_x")
    slam_principal_point_y = LaunchConfiguration("slam_principal_point_y")
    slam_publish_debug_image = LaunchConfiguration("slam_publish_debug_image")
    enable_any_obd = PythonExpression(
        ["'", enable_2dobd, "' == 'true' or '", enable_3dobd, "' == 'true'"]
    )

    enable_task_1_tracking = LaunchConfiguration("enable_task_1_tracking")
    task_1_output_mode = LaunchConfiguration("task_1_output_mode")
    return LaunchDescription(
        [
            DeclareLaunchArgument(
                "camera_uids",
                default_value="[0, 1]",
                description="Camera device ids for the cameras node and visual processor.",
            ),
            DeclareLaunchArgument(
                "camera_labels",
                default_value='["left", "right"]',
                description="Labels matching camera_uids.",
            ),
            DeclareLaunchArgument(
                "latest_image_path",
                default_value="/home/ubuntu/r1/latest_frame.jpg",
                description="Path shared by the visual processor and brain/VLM nodes.",
            ),
            DeclareLaunchArgument(
                "ollama_url",
                default_value="http://192.168.68.59:11434",
                description="Base URL for the Ollama server used by vlm_node.",
            ),
            DeclareLaunchArgument(
                "vlm_model",
                default_value="moondream",
                description="Vision-language model name for vlm_node.",
            ),
            DeclareLaunchArgument(
                "use_espeak",
                default_value="true",
                description="Whether audio_node should speak with espeak-ng.",
            ),
            DeclareLaunchArgument(
                "enable_2dobd",
                default_value="true",
                description="Start the 2D obstacle detection visual processor node.",
            ),
            DeclareLaunchArgument(
                "enable_3dobd",
                default_value="false",
                description="Enable 3D obstacle detection mode in visual_processor_node.",
            ),
            DeclareLaunchArgument(
                "yolo_camera_uid",
                default_value="0",
                description="Camera uid whose image stream should be used by YOLO.",
            ),
            DeclareLaunchArgument(
                "event_min_interval_sec",
                default_value="0.5",
                description="Minimum time between changed visual events from the same camera.",
            ),
            DeclareLaunchArgument(
                "event_max_silence_sec",
                default_value="2.0",
                description="Maximum silence before republishing a visual heartbeat event.",
            ),
            DeclareLaunchArgument(
                "enable_ear",
                default_value="true",
                description="Start ear_node for terminal text input.",
            ),
            DeclareLaunchArgument(
                "enable_detector",
                default_value="false",
                description="Start detector_node for object detection.",
            ),
            DeclareLaunchArgument(
                "detector_camera_uid",
                default_value="10",
                description="Camera uid whose image stream should be used by detector_node.",
            ),
            DeclareLaunchArgument(
                "enable_task_1_tracking",
                default_value="false",
                description="Enable object tracking in detector_node for task_1.",
            ),
            DeclareLaunchArgument(
                "task_1_output_mode",
                default_value="events",
                description="Detector output mode: events, overlay, or both.",
            ),
            DeclareLaunchArgument(
                "enable_segmentor",
                default_value="false",
                description="Start segmentor_node for object segmentation.",
            ),
            DeclareLaunchArgument(
                "segmentor_camera_uid",
                default_value="10",
                description=(
                    "Camera uid whose image stream should be used by "
                    "segmentor_node."
                ),
            ),
            DeclareLaunchArgument(
                "enable_task_2_segmentation_tracking",
                default_value="false",
                description="Enable object tracking in segmentor_node for task_2.",
            ),
            DeclareLaunchArgument(
                "task_2_segmentation_output_mode",
                default_value="events",
                description="Segmentor output mode: events, overlay, or both.",
            ),
            DeclareLaunchArgument(
                "segmentor_model",
                default_value="yolo11n-seg.pt",
                description="YOLO segmentation model used by segmentor_node.",
            ),
            DeclareLaunchArgument(
                "enable_semantic_segmentation",
                default_value="false",
                description="Start semantic_segmentation_node for task_3.",
            ),
            DeclareLaunchArgument(
                "semantic_segmentation_camera_uid",
                default_value="10",
                description=(
                    "Camera uid whose image stream should be used by "
                    "semantic_segmentation_node."
                ),
            ),
            DeclareLaunchArgument(
                "enable_task_3_semantic_segmentation_tracking",
                default_value="false",
                description=(
                    "Enable tracking in semantic_segmentation_node for task_3."
                ),
            ),
            DeclareLaunchArgument(
                "task_3_semantic_segmentation_output_mode",
                default_value="events",
                description=(
                    "Semantic segmentation output mode: events, overlay, or "
                    "both."
                ),
            ),
            DeclareLaunchArgument(
                "semantic_segmentation_model",
                default_value="yolo26n-sem.pt",
                description="YOLO semantic segmentation model used by task_3.",
            ),
            DeclareLaunchArgument(
                "enable_pose",
                default_value="false",
                description="Start pose_node for task_4.",
            ),
            DeclareLaunchArgument(
                "pose_camera_uid",
                default_value="10",
                description="Camera uid whose image stream should be used by pose_node.",
            ),
            DeclareLaunchArgument(
                "enable_task_4_pose_tracking",
                default_value="false",
                description="Enable tracking in pose_node for task_4.",
            ),
            DeclareLaunchArgument(
                "task_4_pose_output_mode",
                default_value="events",
                description="Pose output mode: events, overlay, or both.",
            ),
            DeclareLaunchArgument(
                "pose_model",
                default_value="yolo26n-pose.pt",
                description="YOLO pose model used by task_4.",
            ),
            DeclareLaunchArgument(
                "enable_monocular_depth",
                default_value="false",
                description="Start monocular_depth_node for task_5.",
            ),
            DeclareLaunchArgument(
                "monocular_depth_camera_uid",
                default_value="10",
                description=(
                    "Camera uid whose image stream should be used by "
                    "monocular_depth_node."
                ),
            ),
            DeclareLaunchArgument(
                "task_5_depth_output_mode",
                default_value="events",
                description="Depth output mode: events, overlay, or both.",
            ),
            DeclareLaunchArgument(
                "depth_model",
                default_value="yolo26s-depth.pt",
                description="YOLO monocular depth model used by task_5.",
            ),
            DeclareLaunchArgument(
                "enable_oriented_detection",
                default_value="false",
                description="Start oriented_detection_node for task_6.",
            ),
            DeclareLaunchArgument(
                "oriented_detection_camera_uid",
                default_value="10",
                description=(
                    "Camera uid whose image stream should be used by "
                    "oriented_detection_node."
                ),
            ),
            DeclareLaunchArgument(
                "enable_task_6_obb_tracking",
                default_value="false",
                description="Enable tracking in oriented_detection_node for task_6.",
            ),
            DeclareLaunchArgument(
                "task_6_obb_output_mode",
                default_value="events",
                description="OBB output mode: events, overlay, or both.",
            ),
            DeclareLaunchArgument(
                "obb_model",
                default_value="yolo26n-obb.pt",
                description="YOLO oriented bounding box model used by task_6.",
            ),
            DeclareLaunchArgument(
                "enable_sampler",
                default_value="false",
                description="Start sampler_node for detector event sampling.",
            ),
            DeclareLaunchArgument(
                "sampler_camera_uid",
                default_value="10",
                description="Camera uid whose detector events should be sampled.",
            ),
            DeclareLaunchArgument(
                "sampler_save_dir",
                default_value="./flywheel/raw",
                description="Directory where sampler_node saves sampled images and metadata.",
            ),
            DeclareLaunchArgument(
                "enable_vlm",
                default_value="true",
                description="Start vlm_node for image question answering.",
            ),
            DeclareLaunchArgument(
                "enable_slam",
                default_value="false",
                description="Start the experimental monocular SLAM node.",
            ),
            DeclareLaunchArgument(
                "enable_web",
                default_value="true",
                description="Start the web dashboard node.",
            ),
            DeclareLaunchArgument(
                "enable_sensors",
                default_value="true",
                description="Start sensor_node for onboard sensor telemetry.",
            ),
            DeclareLaunchArgument(
                "enable_wheels",
                default_value="false",
                description="Allow action_node to access wheel hardware.",
            ),
            DeclareLaunchArgument(
                "enable_ptz",
                default_value="false",
                description="Allow action_node to access PTZ hardware.",
            ),
            DeclareLaunchArgument(
                "gpio_chip",
                default_value="0",
                description="GPIO character device number used by wheel and PTZ hardware.",
            ),
            DeclareLaunchArgument(
                "imu_update_interval_sec",
                default_value="0.5",
                description="Polling interval for IMU hardware access.",
            ),
            DeclareLaunchArgument(
                "sensor_publish_interval_sec",
                default_value="0.5",
                description="Publish interval for sensor telemetry topics.",
            ),
            DeclareLaunchArgument(
                "slam_camera_topic",
                default_value="/camera/uid_0/image_raw",
                description="Image topic for the monocular SLAM node.",
            ),
            DeclareLaunchArgument(
                "slam_focal_length",
                default_value="320.0",
                description="Approximate focal length in pixels for monocular SLAM.",
            ),
            DeclareLaunchArgument(
                "slam_principal_point_x",
                default_value="160.0",
                description="Principal point x in pixels for monocular SLAM.",
            ),
            DeclareLaunchArgument(
                "slam_principal_point_y",
                default_value="120.0",
                description="Principal point y in pixels for monocular SLAM.",
            ),
            DeclareLaunchArgument(
                "slam_publish_debug_image",
                default_value="true",
                description="Publish a debug image with tracked features for monocular SLAM.",
            ),
            Node(
                package="r1",
                executable="cameras_node",
                name="cameras_node",
                output="screen",
                parameters=[
                    {
                        "camera_uids": camera_uids,
                        "camera_labels": camera_labels,
                    }
                ],
            ),
            Node(
                package="r1",
                executable="visual_processor_node",
                name="visual_processor_node",
                output="screen",
                parameters=[
                    {
                        "camera_uids": camera_uids,
                        "camera_labels": camera_labels,
                        "event_min_interval_sec": event_min_interval_sec,
                        "event_max_silence_sec": event_max_silence_sec,
                        "enable_2dobd": enable_2dobd,
                        "enable_3dobd": enable_3dobd,
                        "yolo_camera_uid": yolo_camera_uid,
                    }
                ],
                condition=IfCondition(enable_any_obd),
            ),
            Node(
                package="r1",
                executable="brain_node",
                name="brain_node",
                output="screen",
                parameters=[{"latest_image_path": latest_image_path}],
            ),
            Node(
                package="r1",
                executable="audio_node",
                name="audio_node",
                output="screen",
                parameters=[{"use_espeak": use_espeak}],
            ),
            Node(
                package="r1",
                executable="action_node",
                name="action_node",
                output="screen",
                parameters=[
                    {
                        "enable_wheels": enable_wheels,
                        "enable_ptz": enable_ptz,
                        "gpio_chip": gpio_chip,
                    }
                ],
            ),
            Node(
                package="r1",
                executable="sensor_node",
                name="sensor_node",
                output="screen",
                parameters=[
                    {
                        "enable_imu": enable_sensors,
                        "imu_update_interval_sec": imu_update_interval_sec,
                        "publish_interval_sec": sensor_publish_interval_sec,
                    }
                ],
                condition=IfCondition(enable_sensors),
            ),
            Node(
                package="r1",
                executable="ear_node",
                name="ear_node",
                output="screen",
                condition=IfCondition(enable_ear),
            ),
            Node(
                package="r1_slam",
                executable="monocular_slam_node",
                name="monocular_slam_node",
                output="screen",
                parameters=[
                    {
                        "camera_topic": slam_camera_topic,
                        "focal_length": slam_focal_length,
                        "principal_point_x": slam_principal_point_x,
                        "principal_point_y": slam_principal_point_y,
                        "publish_debug_image": slam_publish_debug_image,
                    }
                ],
                condition=IfCondition(enable_slam),
            ),
            Node(
                package="r1",
                executable="vlm_node",
                name="vlm_node",
                output="screen",
                parameters=[
                    {
                        "ollama_url": ollama_url,
                        "model": vlm_model,
                    }
                ],
                condition=IfCondition(enable_vlm),
            ),
            Node(
                package="r1",
                executable="detector_node",
                name="detector_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": detector_camera_uid,
                        "enable_task_1_tracking": enable_task_1_tracking,
                        "task_1_output_mode": task_1_output_mode,
                    }
                ],
                condition=IfCondition(enable_detector),
            ),
            Node(
                package="r1",
                executable="segmentor_node",
                name="segmentor_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": segmentor_camera_uid,
                        "enable_task_2_segmentation_tracking": (
                            enable_task_2_segmentation_tracking
                        ),
                        "task_2_segmentation_output_mode": (
                            task_2_segmentation_output_mode
                        ),
                        "segmentor_model": segmentor_model,
                    }
                ],
                condition=IfCondition(enable_segmentor),
            ),
            Node(
                package="r1",
                executable="semantic_segmentation_node",
                name="semantic_segmentation_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": semantic_segmentation_camera_uid,
                        "enable_task_3_semantic_segmentation_tracking": (
                            enable_task_3_semantic_segmentation_tracking
                        ),
                        "task_3_semantic_segmentation_output_mode": (
                            task_3_semantic_segmentation_output_mode
                        ),
                        "semantic_segmentation_model": (
                            semantic_segmentation_model
                        ),
                    }
                ],
                condition=IfCondition(enable_semantic_segmentation),
            ),
            Node(
                package="r1",
                executable="pose_node",
                name="pose_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": pose_camera_uid,
                        "enable_task_4_pose_tracking": (
                            enable_task_4_pose_tracking
                        ),
                        "task_4_pose_output_mode": task_4_pose_output_mode,
                        "pose_model": pose_model,
                    }
                ],
                condition=IfCondition(enable_pose),
            ),
            Node(
                package="r1",
                executable="monocular_depth_node",
                name="monocular_depth_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": monocular_depth_camera_uid,
                        "task_5_depth_output_mode": task_5_depth_output_mode,
                        "depth_model": depth_model,
                    }
                ],
                condition=IfCondition(enable_monocular_depth),
            ),
            Node(
                package="r1",
                executable="oriented_detection_node",
                name="oriented_detection_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": oriented_detection_camera_uid,
                        "enable_task_6_obb_tracking": (
                            enable_task_6_obb_tracking
                        ),
                        "task_6_obb_output_mode": task_6_obb_output_mode,
                        "obb_model": obb_model,
                    }
                ],
                condition=IfCondition(enable_oriented_detection),
            ),
            Node(
                package="r1",
                executable="sampler_node",
                name="sampler_node",
                output="screen",
                parameters=[
                    {
                        "camera_uid": sampler_camera_uid,
                        "save_dir": sampler_save_dir,
                    }
                ],
                condition=IfCondition(enable_sampler),
            ),
            Node(
                package="r1_web",
                executable="web_ui_node",
                name="web_ui_node",
                output="screen",
                condition=IfCondition(enable_web),
            ),
        ]
    )
