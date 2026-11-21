import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectLocation = join(root, 'safari');
const appIconSet = join(root, 'safari-app', 'AppIcon.appiconset');
const appWindowIcon = join(appIconSet, 'icon_128x128@2x.png');
const appName = 'Agent Browser Bridge';
const bundleIdentifier = 'dev.agentbrowserbridge';
const extensionBundleIdentifier = `${bundleIdentifier}.Extension`;
const bundleIdentifierSetting = /("?PRODUCT_BUNDLE_IDENTIFIER"?\s*[:=]\s*)"?([^";,\s]+)"?/g;
const projectFileNames = ['project.pbxproj', 'project.xcproj'].map((name) => join('.xcodeproj', name));
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

const generatedPaths = readdirSync(projectLocation, { recursive: true }).map(String);
const projectFile = generatedPaths.find((path) => projectFileNames.some((name) => path.endsWith(name)));
if (!projectFile) fail(`The converter did not create an Xcode project under ${projectLocation}.`);

const projectPath = join(projectLocation, projectFile);
const generated = readFileSync(projectPath, 'utf-8');
const identifiersIn = (project) => [...new Set([...project.matchAll(bundleIdentifierSetting)].map((match) => match[2]))].sort();
const corrected = generated.replace(bundleIdentifierSetting, (setting, key, identifier) =>
  identifier === extensionBundleIdentifier ? setting : `${key}"${bundleIdentifier}"`,
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

const generatedIconSets = generatedPaths.filter((path) => path.endsWith(`${sep}AppIcon.appiconset`));
if (generatedIconSets.length !== 1) {
  fail(`Expected the converter to create one AppIcon.appiconset, but found ${generatedIconSets.length}: ${generatedIconSets.join(', ')}`);
}
const generatedIconSet = join(projectLocation, generatedIconSets[0]);
rmSync(generatedIconSet, { recursive: true });
cpSync(appIconSet, generatedIconSet, { recursive: true });
console.log(`Replaced the app icon in ${generatedIconSets[0]}.`);

for (const windowIcon of generatedPaths.filter((path) => path.endsWith(join('Resources', 'Icon.png')))) {
  cpSync(appWindowIcon, join(projectLocation, windowIcon));
  console.log(`Replaced the icon shown in the app window at ${windowIcon}.`);
}

if (openInXcode) execFileSync('open', [dirname(projectPath)]);
