import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://sidd27.github.io',
  base: '/infrawise',
  output: 'static',
  integrations: [
    starlight({
      title: 'Infrawise',
      description: 'AI-aware infrastructure analysis for your code assistant.',
      social: {
        github: 'https://github.com/Sidd27/infrawise',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick start', slug: 'getting-started/quick-start' },
            { label: 'AWS setup', slug: 'getting-started/aws-setup' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Configuration', slug: 'reference/configuration' },
            { label: 'CLI reference', slug: 'reference/cli' },
            { label: 'MCP tools', slug: 'reference/mcp-tools' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Analysis capabilities', slug: 'guides/analysis' },
            { label: 'LocalStack demo', slug: 'guides/localstack-demo' },
            { label: 'Contributing', slug: 'guides/contributing' },
          ],
        },
      ],
    }),
  ],
});
