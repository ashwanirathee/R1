import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'R1',
  tagline: 'ROS Based RC Car',
  favicon: 'img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here
  url: 'https://ashwanirathee.github.io/',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'ashwanirathee', // Usually your GitHub org/user name.
  projectName: 'R1', // Usually your repo name.

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'ignore',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'experiments',
          routeBasePath: 'experiments',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      defaultMode: 'light',
      disableSwitch: true,
      respectPrefersColorScheme: false,
    },
    navbar: {
      title: 'R1',
      items: [
        {to: '/#overview', label: 'Overview', position: 'left'},
        {to: '/#goals', label: 'Goals', position: 'left'},
        {to: '/#hardware', label: 'Hardware', position: 'left'},
        {to: '/#components', label: 'Components', position: 'left'},
        {to: '/#running', label: 'Running', position: 'left'},
        {to: '/#future', label: 'Future', position: 'left'},
        {
          type: 'docSidebar',
          sidebarId: 'experimentsSidebar',
          position: 'left',
          label: 'Experiments',
        },
        {
          href: 'https://github.com/ashwanirathee/R1',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Page',
          items: [
            {
              label: 'Overview',
              to: '/#overview',
            },
            {
              label: 'Goals',
              to: '/#goals',
            },
            {
              label: 'Components',
              to: '/#components',
            },
            {
              label: 'Future',
              to: '/#future',
            },
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/ashwanirathee/R1',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Experiments',
              to: '/experiments',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} R1. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
