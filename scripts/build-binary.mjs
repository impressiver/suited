import esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'build/bundle.cjs',
  minify: false,
  // figlet's node-figlet.mjs uses import.meta.url at module init to locate font files.
  // We always call figlet.parseFont() before textSync(), so the file-system font path
  // is never consulted. Define a dummy URL so fileURLToPath() doesn't throw on startup.
  define: { 'import.meta.url': '"file:///bundle.cjs"' },
});

console.log('Bundle written to build/bundle.cjs');
