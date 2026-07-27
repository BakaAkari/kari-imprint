import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const publicBase = (env.VITE_PUBLIC_BASE || '/tools/kari-imprint').replace(/\/+$/, '');

  return {
    plugins: [react()],
    base: publicBase ? `${publicBase}/` : '/',
  };
});
