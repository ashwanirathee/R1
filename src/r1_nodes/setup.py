from setuptools import find_packages, setup

package_name = 'r1'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        ('share/' + package_name + '/launch', ['launch/bringup.launch.py']),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='root',
    maintainer_email='root@todo.todo',
    description='TODO: Package description',
    license='TODO: License declaration',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    scripts=[
        'r1/launchers/cameras_node',
        'r1/launchers/visual_processor_node',
        'r1/launchers/brain_node',
        'r1/launchers/audio_node',
        'r1/launchers/ear_node',
        'r1/launchers/action_node',
        'r1/launchers/vlm_node',
        'r1/launchers/detector_node'
    ],
)
