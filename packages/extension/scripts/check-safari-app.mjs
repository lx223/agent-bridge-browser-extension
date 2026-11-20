import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const projectLocation = join(root, 'safari');
const appIconSet = join(root, 'safari-app', 'AppIcon.appiconset');
const packagedFiles = ['manifest.json', 'background.js', 'icons/icon-128.png', 'src/welcome/index.html', 'src/options/index.html'];

const findBySuffix = (directory, suffix) =>
  readdirSync(directory, { recursive: true })
    .map(String)
    .filter((path) => path.endsWith(suffix))
    .map((path) => join(directory, path));

function fail(message) {
  console.error(message);
  process.exit(1);
}

function summarise(title, body) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### ${title}\n\n\`\`\`\n${body.trim()}\n\`\`\`\n\n`);
}

if (process.platform !== 'darwin') fail('The Safari app can only be built on macOS with Xcode installed.');

const conversion = spawnSync('npm', ['run', 'build:safari', '--', '--no-open'], { cwd: root, encoding: 'utf-8' });
process.stdout.write(conversion.stdout);
process.stderr.write(conversion.stderr);
if (conversion.status !== 0) fail('Generating the Safari app project failed.');

const unsupportedKeys = /^Warning: The following keys in your manifest\.json are not supported.*\n(?:\t.*\n?)*/m.exec(conversion.stderr)?.[0] ?? '';
const converterReport = conversion.stdout.slice(Math.max(0, conversion.stdout.indexOf('Xcode Project Location')));
summarise('Safari web extension converter', `${unsupportedKeys}\n${converterReport}`);

const [project] = findBySuffix(projectLocation, '.xcodeproj');
if (!project) fail(`The converter did not create an Xcode project under ${projectLocation}.`);

const { schemes } = JSON.parse(execFileSync('xcodebuild', ['-list', '-json', '-project', project], { encoding: 'utf-8' })).project;
if (!schemes?.length) fail(`The Xcode project ${project} has no scheme to build.`);

const derivedData = mkdtempSync(join(tmpdir(), 'agent-browser-bridge-safari-'));
try {
  execFileSync(
    'xcodebuild',
    ['-quiet', '-project', project, '-scheme', schemes[0], '-configuration', 'Debug', '-derivedDataPath', derivedData, 'CODE_SIGNING_ALLOWED=NO', 'build'],
    { stdio: 'inherit' },
  );

  const [extension] = findBySuffix(join(derivedData, 'Build', 'Products'), '.appex');
  if (!extension) fail('The build produced no Safari extension bundle (.appex).');

  const resources = join(extension, 'Contents', 'Resources');
  const missing = packagedFiles.filter((file) => !existsSync(join(resources, file)));
  if (missing.length) fail(`The Safari extension bundle is missing: ${missing.join(', ')}`);

  for (const file of ['manifest.json', 'background.js']) {
    if (!readFileSync(join(resources, file)).equals(readFileSync(join(dist, file)))) {
      fail(`${file} in the Safari extension bundle differs from the built extension.`);
    }
  }

  const [projectIconSet] = findBySuffix(projectLocation, 'AppIcon.appiconset');
  const changedIconFiles = readdirSync(appIconSet).filter(
    (file) => !existsSync(join(projectIconSet, file)) || !readFileSync(join(projectIconSet, file)).equals(readFileSync(join(appIconSet, file))),
  );
  if (changedIconFiles.length) fail(`The Xcode project does not use the committed app icon for: ${changedIconFiles.join(', ')}`);

  const [assetCatalog] = findBySuffix(join(derivedData, 'Build', 'Products'), join('.app', 'Contents', 'Resources', 'Assets.car'));
  if (!assetCatalog) fail('The Safari app has no compiled asset catalog (Assets.car).');
  const renditions = JSON.parse(execFileSync('assetutil', ['--info', assetCatalog], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }));
  const iconWidths = [...new Set(renditions.filter((rendition) => rendition.Name === 'AppIcon' && rendition.PixelWidth).map((rendition) => rendition.PixelWidth))];
  const storeIconWidth = Math.max(0, ...iconWidths);
  if (storeIconWidth !== 1024) {
    fail(`The largest Safari app icon image is ${storeIconWidth}px wide instead of 1024px; the app holds: ${iconWidths.sort((a, b) => a - b).join(', ') || 'none'}`);
  }

  const { version } = JSON.parse(readFileSync(join(resources, 'manifest.json'), 'utf-8'));
  const xcodeVersion = execFileSync('xcodebuild', ['-version'], { encoding: 'utf-8' });
  summarise(
    'Safari app build',
    `Built ${extension.split('/').pop()} with extension version ${version} and a ${storeIconWidth}px app icon\n${xcodeVersion}`,
  );
  console.log(`The Safari app builds and packages extension version ${version}.`);
} finally {
  rmSync(derivedData, { recursive: true, force: true });
}
