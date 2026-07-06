from setuptools import setup

package_name = "r1_web"

setup(
    name=package_name,
    version="0.0.0",
    packages=[package_name],
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    include_package_data=True,
    package_data={package_name: ["web/*"]},
    install_requires=["setuptools", "fastapi", "uvicorn"],
    zip_safe=True,
    maintainer="ubuntu",
    maintainer_email="todo@example.com",
    description="Web dashboard for R1 robot",
    license="TODO",
    tests_require=["pytest"],
    scripts=[
        'r1_web/launchers/web_ui_node',
    ],
)