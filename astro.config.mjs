import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  // El middleware valida el origen en todas las escrituras y contempla el puerto
  // y el origen HTTPS público de los proxies inversos.
  security: { checkOrigin: false },
  vite: { plugins: [tailwindcss()] },
});
