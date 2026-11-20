import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectLocation = join(root, 'safari');
const appName = 'Agent Browser Bridge';
const bundleIdentifier = 'dev.agentbrowserbridge.app';
const extensionBundleIdentifier = `${bundleIdentifier}.Extension`;
const bundleIdentifierSetting = /PRODUCT_BUNDLE_IDENTIFIER = "?([^";]+)"?;/g;
const openInXcode = !process.argv.includes('--no-open');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('The Safari app project can only be generated on macOS with Xcode installed.');

execFileSync(
  'xcrun',
  [
    'safari-web-extension-converter',
    'dist',
    '--project-location',
    'safari',
    '--app-name',
    appName,
    '--bundle-identifier',
    bundleIdentifier,
    '--macos-only',
    '--copy-resources',
    '--no-prompt',
    '--no-open',
    '--force',
  ],
  { cwd: root, stdio: 'inherit' },
);

const projectFile = readdirSync(projectLocation, { recursive: true })
  .map(String)
  .find((path) => path.endsWith(join('.xcodeproj', 'project.pbxproj')));
if (!projectFile) fail(`The converter did not create an Xcode project under ${projectLocation}.`);

const projectPath = join(projectLocation, projectFile);
const generated = readFileSync(projectPath, 'utf-8');
const identifiersIn = (project) => [...new Set([...project.matchAll(bundleIdentifierSetting)].map((match) => match[1]))].sort();
const corrected = generated.replace(bundleIdentifierSetting, (setting, identifier) =>
  identifier === extensionBundleIdentifier ? setting : `PRODUCT_BUNDLE_IDENTIFIER = "${bundleIdentifier}";`,
);

const identifiers = identifiersIn(corrected);
if (identifiers.join() !== [bundleIdentifier, extensionBundleIdentifier].join()) {
  fail(
    `Expected the Xcode project to use the bundle identifiers ${bundleIdentifier} and ${extensionBundleIdentifier}, but the converter generated: ${identifiersIn(generated).join(', ')}`,
  );
}

if (corrected !== generated) {
  writeFileSync(projectPath, corrected);
  console.log(`Set the app bundle identifier to ${bundleIdentifier}; the converter generated ${identifiersIn(generated).join(', ')}.`);
}

if (openInXcode) execFileSync('open', [dirname(projectPath)]);
