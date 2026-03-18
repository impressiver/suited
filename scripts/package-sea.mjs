import { execSync } from 'child_process';
import { copyFileSync, mkdirSync, writeFileSync } from 'fs';
import { platform } from 'os';
import { join } from 'path';

const BINARY_NAME = platform() === 'darwin' ? 'suited-macos-arm64'
                  : platform() === 'linux'   ? 'suited-linux-x64'
                  : null;

if (!BINARY_NAME) throw new Error('Unsupported platform for binary build');

mkdirSync('dist-bin', { recursive: true });

// 1. Generate the SEA blob with embedded template assets
const seaConfig = {
  main: 'build/bundle.cjs',
  output: 'sea-prep.blob',
  disableExperimentalSEAWarning: true,
  assets: {
    'templates/classic/template.eta':  'src/templates/classic/template.eta',
    'templates/classic/style.css':     'src/templates/classic/style.css',
    'templates/modern/template.eta':   'src/templates/modern/template.eta',
    'templates/modern/style.css':      'src/templates/modern/style.css',
    'templates/bold/template.eta':     'src/templates/bold/template.eta',
    'templates/bold/style.css':        'src/templates/bold/style.css',
    'templates/timeline/template.eta': 'src/templates/timeline/template.eta',
    'templates/timeline/style.css':    'src/templates/timeline/style.css',
    'templates/retro/template.eta':    'src/templates/retro/template.eta',
    'templates/retro/style.css':       'src/templates/retro/style.css',
  },
};
writeFileSync('sea-config.json', JSON.stringify(seaConfig, null, 2));
execSync('node --experimental-sea-config sea-config.json', { stdio: 'inherit' });

// 2. Copy node binary
const outputBin = join('dist-bin', BINARY_NAME);
copyFileSync(process.execPath, outputBin);

// 3. Remove existing signature (macOS only, required before injection)
if (platform() === 'darwin') {
  execSync(`codesign --remove-signature "${outputBin}"`, { stdio: 'inherit' });
}

// 4. Inject SEA blob
execSync(
  `npx postject "${outputBin}" NODE_SEA_BLOB sea-prep.blob ` +
  `--sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` +
  (platform() === 'darwin' ? ` --macho-segment-name NODE_SEA` : ''),
  { stdio: 'inherit' },
);

// 5. Ad-hoc sign (macOS) — reduces Gatekeeper friction
if (platform() === 'darwin') {
  execSync(`codesign --sign - "${outputBin}"`, { stdio: 'inherit' });
}

console.log(`Binary written to ${outputBin}`);
