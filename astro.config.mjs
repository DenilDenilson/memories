import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter:
    process.env.VERCEL || process.env.DEPLOY_TARGET === 'vercel'
      ? vercel({
          maxDuration: 300,
          includeFiles: ['node_modules/libheif-js/libheif-wasm/libheif.wasm'],
          excludeFiles: [
            '.env',
            '.env.local',
            '.env.production',
            '.env.production.local',
            '.env.development',
            '.env.development.local',
          ],
        })
      : node({ mode: 'standalone' }),
  // El middleware valida el origen en todas las escrituras y contempla el puerto
  // y el origen HTTPS público de los proxies inversos.
  security: { checkOrigin: false },
  vite: { plugins: [tailwindcss()] },
});
