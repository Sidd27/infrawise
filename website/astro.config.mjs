// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
	site: 'https://sidd27.github.io',
	base: '/infrawise',
	integrations: [
		starlight({
			title: 'infrawise',
			description: 'AI-aware infrastructure layer for your codebase',
			logo: { src: './src/assets/logo.svg', alt: 'infrawise logo' },
			social: [
				{ icon: 'npm',    label: 'npm',    href: 'https://www.npmjs.com/package/infrawise' },
				{ icon: 'github', label: 'GitHub', href: 'https://github.com/Sidd27/infrawise' },
			],
			customCss: [
				'./src/styles/global.css',
				'./src/styles/starlight-theme.css',
			],
			// Force dark theme: runs before Starlight's own theme script to prevent
			// any flash of light mode, even when the user's OS prefers light.
			head: [
				{ tag: 'link', attrs: { rel: 'icon', type: 'image/svg+xml', href: '/infrawise/favicon.svg' } },
				{ tag: 'script', content: "localStorage.setItem('starlight-theme','dark');document.documentElement.setAttribute('data-theme','dark');" },
				{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' } },
				{ tag: 'link', attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' } },
				{ tag: 'link', attrs: { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Libre+Baskerville:wght@700&family=JetBrains+Mono:wght@400;500&display=swap' } },
				{ tag: 'script', attrs: { type: 'application/ld+json' }, content: JSON.stringify({
					"@context": "https://schema.org",
					"@type": "TechArticle",
					"publisher": {
						"@type": "Person",
						"name": "Sidd27",
						"url": "https://github.com/Sidd27"
					},
					"isPartOf": {
						"@type": "WebSite",
						"name": "Infrawise",
						"url": "https://sidd27.github.io/infrawise/"
					}
				}) },
			],
			sidebar: [
				{
					label: 'Getting Started',
					items: [
						{ label: 'Installation',  slug: 'getting-started/installation' },
						{ label: 'Quick start',   slug: 'getting-started/quick-start'  },
						{ label: 'AWS setup',     slug: 'getting-started/aws-setup'    },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Configuration', slug: 'reference/configuration' },
						{ label: 'CLI reference', slug: 'reference/cli'           },
						{ label: 'MCP tools',     slug: 'reference/mcp-tools'    },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Analysis capabilities', slug: 'guides/analysis'         },
						{ label: 'LocalStack demo',        slug: 'guides/localstack-demo' },
					],
				},
				{
					label: 'Use Cases',
					items: [
						{ label: 'DynamoDB scan detection',   slug: 'use-cases/dynamodb-scans'      },
						{ label: 'SQS dead-letter queues',    slug: 'use-cases/sqs-dlq'             },
						{ label: 'Lambda event shapes',       slug: 'use-cases/lambda-event-shapes' },
						{ label: 'IaC drift detection',       slug: 'use-cases/iac-drift'           },
						{ label: 'AWS security posture',      slug: 'use-cases/security-posture'    },
					],
				},
			],
			expressiveCode: { themes: ['github-dark'] },
		}),
	],
});
