import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

const goals = [
  'Perception through cameras, object detection, face detection, and scene understanding.',
  'Reasoning with language-driven interpretation of visual events and robot state.',
  'Control through modular ROS 2 nodes that can be launched together or tested alone.',
  'Observability with Foxglove, Prometheus, and Grafana for live system insight.',
  'Remote compute for heavier AI workloads that do not fit comfortably on the robot.',
];

const components = [
  {
    name: 'Robot Nodes',
    path: 'src/r1_nodes',
    detail:
      'Core ROS 2 package for cameras, visual processing, audio, ear, action, brain, and VLM nodes.',
  },
  {
    name: 'Web Interface',
    path: 'src/r1_web',
    detail:
      'Browser-facing control and status layer for interacting with R1 while it is running.',
  },
  {
    name: 'SLAM',
    path: 'src/r1_slam',
    detail:
      'Monocular SLAM package for mapping and localization experiments.',
  },
  {
    name: 'Experiments',
    path: 'src/tasks',
    detail:
      'Research workspace for classification, labeling, model comparison, and analysis scripts.',
  },
];

const futureDirections = [
  'Object detection, segmentation, classification, and tracking.',
  'Pose estimation, motion estimation, and camera-based localization.',
  'Stereo and time-of-flight camera work in outdoor environments.',
  'Synthetic data generation and rendering for faster experiment loops.',
  'Active learning loops that find useful images to label and retrain on.',
  'Model serving and remote inference through Ollama, OpenRouter, or dedicated compute servers.',
];

function HomepageHeader() {
  const logoSrc = useBaseUrl('/img/r1-logo.jpg');

  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className={clsx('container', styles.heroInner)}>
        <div className={styles.heroCopy}>
          <Heading as="h1" className={styles.heroTitle}>
            R1
          </Heading>
          <p className={styles.heroSubtitle}>
            A Raspberry Pi 5-based Physical AI robot platform for experiments in
            perception, reasoning, and control.
          </p>
          <div className={styles.buttons}>
            <Link className="button button--primary button--lg" to="#goals">
              Goals
            </Link>
            <Link
              className="button button--outline button--primary button--lg"
              to="/experiments">
              Experiments
            </Link>
          </div>
        </div>
        <img
          className={styles.heroImage}
          src={logoSrc}
          alt="R1 robot platform"
        />
      </div>
    </header>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className={styles.section} id={id}>
      <div className="container">
        <Heading as="h2">{title}</Heading>
        <div className={styles.sectionBody}>{children}</div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="R1"
      description="R1 Physical AI robot platform for perception, reasoning, control, and experiments">
      <HomepageHeader />
      <main className={styles.main}>
        <Section id="overview" title="Overview">
          <p>
            R1 is a small, always-on robot research platform. The repository is
            less about theory and more about implementing a working system that
            can run on real hardware, publish ROS 2 topics, inspect the world
            through cameras, reason about events, and expose useful monitoring
            while experiments are running.
          </p>
          <p>
            The project is built around modular ROS 2 packages so perception,
            control, web interaction, SLAM, and research scripts can evolve
            independently without turning the robot into one tangled process.
          </p>
        </Section>

        <Section id="goals" title="Goals">
          <ul className={styles.featureList}>
            {goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </Section>

        <Section id="hardware" title="Hardware">
          <p>
            The current platform is based around a Raspberry Pi 5 running the R1
            ROS workspace. It is designed to work with camera devices, a
            Bluetooth speaker bridge, optional web services, and external compute
            when larger vision-language models are too heavy for the robot.
          </p>
          <div className={styles.calloutGrid}>
            <div>
              <strong>Compute</strong>
              <span>Raspberry Pi 5 on the robot, with optional remote server offload.</span>
            </div>
            <div>
              <strong>Sensing</strong>
              <span>Camera input today, with stereo and TOF cameras on the roadmap.</span>
            </div>
            <div>
              <strong>Audio</strong>
              <span>ROS audio topics plus a host-side Bluetooth speaker bridge.</span>
            </div>
          </div>
        </Section>

        <Section id="components" title="Components">
          <div className={styles.componentGrid}>
            {components.map((component) => (
              <article className={styles.componentCard} key={component.name}>
                <Heading as="h3">{component.name}</Heading>
                <code>{component.path}</code>
                <p>{component.detail}</p>
              </article>
            ))}
          </div>
        </Section>

        <Section id="running" title="Running">
          <p>
            R1 is normally built as a ROS workspace, then launched through the
            bringup file with feature flags for cameras, SLAM, web, ear, audio,
            VLM, and object-detection nodes.
          </p>
          <pre>
            <code>{`cd /home/ubuntu/r1
source /opt/ros/jazzy/setup.bash
colcon build --symlink-install
source install/setup.bash`}</code>
          </pre>
          <pre>
            <code>{`ros2 launch r1 bringup.launch.py \\
  camera_uids:="[10]" \\
  camera_labels:='["main"]' \\
  yolo_camera_uid:=10 \\
  enable_slam:=false \\
  enable_web:=true \\
  enable_ear:=false \\
  enable_audio:=false \\
  enable_vlm:=false`}</code>
          </pre>
          <p>
            Docker support is included for repeatable environments, and
            Foxglove can be launched separately for ROS visualization.
          </p>
        </Section>

        <Section id="observability" title="Observability">
          <p>
            R1 is meant to be watched while it runs. Foxglove is used for ROS
            visualization, while Prometheus and Grafana provide a path for
            system monitoring and performance dashboards.
          </p>
          <pre>
            <code>ros2 launch foxglove_bridge foxglove_bridge_launch.xml</code>
          </pre>
        </Section>

        <Section id="future" title="Future Directions">
          <ul className={styles.featureList}>
            {futureDirections.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Section>
      </main>
    </Layout>
  );
}
