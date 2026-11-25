import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

/**
 * file:// is the hard product requirement, and it is stricter than a server:
 * Chrome refuses `<script type="module" src="./assets/…">` from a file:// page
 * (opaque origin, CORS-blocked), and refuses a cross-file stylesheet fetch the
 * same way. So the production build is emitted as ONE self-contained
 * index.html: an IIFE bundle and the stylesheet inlined, no sibling requests
 * at all. Double-clicking dist/index.html then works with zero console errors.
 */
function singleFile(): Plugin {
  return {
    name: 'sentinel-single-file',
    enforce: 'post',
    apply: 'build',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset') return;

      let source = String(html.source);
      const drop: string[] = [];
      const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      // NOTE: every replacement uses a FUNCTION, never a string — bundle code
      // is full of `$&`, `` $` `` and `$'` sequences that a string replacement
      // would expand, silently corrupting the output.
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName === 'index.html') continue;

        if (chunk.type === 'chunk' && chunk.isEntry) {
          const tag = new RegExp(`<script[^>]*src="[^"]*${esc(fileName)}"[^>]*></script>`);
          if (!tag.test(source)) this.error(`could not find the script tag for ${fileName}`);
          // Vite hoists the module script into <head>; a module script is
          // deferred, an inline classic script is not. So drop the tag where
          // it stands and re-emit it at the end of <body>, after #root exists.
          source = source.replace(tag, () => '');
          source = source.replace(
            '</body>',
            () => `  <script>\n${chunk.code}\n</script>\n  </body>`,
          );
          drop.push(fileName);
        } else if (chunk.type === 'asset' && fileName.endsWith('.css')) {
          const tag = new RegExp(`<link[^>]*href="[^"]*${esc(fileName)}"[^>]*>`);
          if (!tag.test(source)) this.error(`could not find the link tag for ${fileName}`);
          source = source.replace(tag, () => `<style>\n${String(chunk.source)}\n</style>`);
          drop.push(fileName);
        }
      }

      // strip modulepreload hints — nothing is preloaded from a single file
      source = source.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, () => '');

      if (/src="\.\/assets|href="\.\/assets/.test(source))
        this.error('index.html still references a sibling asset — file:// would break');

      html.source = source;
      for (const f of drop) delete bundle[f];
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), singleFile()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: 'es2022',
    // everything embeds; nothing is fetched as a sibling file
    assetsInlineLimit: 100 * 1024 * 1024,
    cssCodeSplit: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      // Vite's preload helper carries `import.meta.resolve`/`import.meta.url`,
      // which the IIFE format cannot express. With code splitting off there are
      // no dynamic imports, so the helper is dead code and the warning is
      // noise — silence just that code, never the rest.
      onwarn(warning, defaultHandler) {
        if (warning.code === 'EMPTY_IMPORT_META') return;
        defaultHandler(warning);
      },
      output: {
        // IIFE, not ESM: a file:// page cannot load a module script at all,
        // and an inlined module script would still be a separate origin fetch
        // for anything it imported.
        format: 'iife',
        entryFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
