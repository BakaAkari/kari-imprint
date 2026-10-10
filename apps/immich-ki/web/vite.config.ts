import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [{
    name: 'companion-editor-styles',
    enforce: 'pre',
    transform(code, id) {
      // The companion owns absolute /fonts URLs; reuse the editor's CSS rules
      // without the public website's deployment-relative font declarations.
      if (id.endsWith('/apps/web/src/styles.css')) return code.replace(/@font-face\s*\{[^}]*\}/g, '');
    },
  }, react()],
  define: {'import.meta.env.VITE_API_BASE': JSON.stringify(''), 'import.meta.env.VITE_PUBLIC_BASE': JSON.stringify('/')},
  resolve: {dedupe: ['react', 'react-dom']},
  server: {proxy: {'/api': 'http://127.0.0.1:2285', '/fonts': 'http://127.0.0.1:2285'}},
});
