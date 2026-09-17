// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://starlight.astro.build
export default defineConfig({
  // Intended public host — not wired up yet (no DNS/Caddy/CI for it in v1).
  site: 'https://docs.galene.finance',
  integrations: [
    starlight({
      title: 'Galene Docs',
      customCss: ['./src/styles/custom.css'],
      components: {
        // Custom header title: wave mark + "Galene" (bold) + "Docs" (lighter).
        SiteTitle: './src/components/SiteTitle.astro',
      },
      sidebar: [
        {
          label: 'Start',
          items: [
            { label: 'Introduction', link: '/' },
            { label: 'Quick start', slug: 'quick-start' },
            { label: 'Getting an account', slug: 'getting-an-account' },
            { label: 'API tokens', slug: 'api-tokens' },
            { label: 'Configuration', slug: 'configuration' },
          ],
        },
        {
          label: 'Self-host',
          items: [
            { label: 'Docker & Compose', slug: 'self-host/docker' },
            { label: 'Podman (compose & quadlets)', slug: 'self-host/podman' },
            { label: 'From source', slug: 'self-host/from-source' },
            { label: 'Reverse proxy', slug: 'self-host/reverse-proxy' },
            { label: 'Backups', slug: 'self-host/backups' },
          ],
        },
        {
          label: 'Features',
          items: [
            { label: 'Bank sync', slug: 'features/bank-sync' },
            { label: 'SimpleFIN', slug: 'features/simplefin' },
            { label: 'Plaid', slug: 'features/plaid' },
            { label: 'Budgets & rules', slug: 'features/budgets-rules' },
            { label: 'Categories & cashflow', slug: 'features/categories-cashflow' },
            { label: 'Accounts & tags', slug: 'features/accounts-tags' },
            { label: 'Import transactions', slug: 'features/import-transactions' },
            { label: 'API & MCP', slug: 'features/api-mcp' },
          ],
        },
        {
          label: 'Reference',
          items: [{ label: 'Environment variables', slug: 'reference/environment-variables' }],
        },
      ],
    }),
  ],
});
