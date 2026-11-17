import { defineConfig } from 'astro/config';

// SITE and BASE_PATH are provided by the deploy workflow (actions/configure-pages).
// Locally the site is served under /F1RainRadar to match the GitHub Pages project URL.
export default defineConfig({
  site: process.env.SITE ?? 'https://example.github.io',
  base: process.env.BASE_PATH || '/F1RainRadar',
  trailingSlash: 'always',
  compressHTML: true,
});
