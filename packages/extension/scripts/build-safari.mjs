import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { safariManifest } from '../src/safariManifest.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectLocation = join(root, 'safari');
const appIconSet = join(root, 'safari-app', 'AppIcon.appiconset');
const appWindowIcon = join(appIconSet, 'icon_128x128@2x.png');
const appName = 'Agent Browser Bridge';
const bundleIdentifier = 'dev.agentbrowserbridge.app';
const extensionBundleIdentifier = `${bundleIdentifier}.Extension`;
const deploymentTarget = '14.0';
const appCategory = 'public.app-category.developer-tools';
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

const { values: options } = parseArgs({
  options: {
    'no-open': { type: 'boolean', default: false },
    'build-number': { type: 'string', default: '1' },
  },
});
const buildNumber = options['build-number'];

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('The Safari app project can only be generated on macOS with Xcode installed.');
if (!/^\d+(\.\d+){0,2}$/.test(buildNumber)) fail(`The build number must be up to three dot-separated integers, not "${buildNumber}".`);

const buildSetting = (key) => new RegExp(`(?<!\\w)("?${key}"?\\s*[=:]\\s*)"?([^";,\\n]+)"?`, 'g');
const valuesOf = (project, key) => [...new Set([...project.matchAll(buildSetting(key))].map((match) => match[2]))].sort();
const setEverywhere = (project, key, value) => project.replace(buildSetting(key), (_, prefix) => `${prefix}"${value}"`);

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
const projectFile = generatedPaths.find((path) => /\.xcodeproj[/\\]project\.(pbxproj|xcproj)$/.test(path));
if (!projectFile) fail(`The converter did not create an Xcode project under ${projectLocation}.`);

const projectPath = join(projectLocation, projectFile);
const generated = readFileSync(projectPath, 'utf-8');

let project = generated.replace(buildSetting('PRODUCT_BUNDLE_IDENTIFIER'), (setting, prefix, identifier) =>
  identifier === extensionBundleIdentifier ? setting : `${prefix}"${bundleIdentifier}"`,
);
const identifiers = valuesOf(project, 'PRODUCT_BUNDLE_IDENTIFIER');
if (identifiers.join() !== [bundleIdentifier, extensionBundleIdentifier].join()) {
  fail(
    `Expected the Xcode project to use the bundle identifiers ${bundleIdentifier} and ${extensionBundleIdentifier}, but the converter generated: ${valuesOf(generated, 'PRODUCT_BUNDLE_IDENTIFIER').join(', ')}`,
  );
}

const expectedSettings = {
  MARKETING_VERSION: version,
  CURRENT_PROJECT_VERSION: buildNumber,
  MACOSX_DEPLOYMENT_TARGET: deploymentTarget,
};
for (const [key, value] of Object.entries(expectedSettings)) {
  if (!valuesOf(project, key).length) fail(`The Xcode project has no ${key} setting to replace.`);
  project = setEverywhere(project, key, value);
}

writeFileSync(projectPath, project);
console.log(
  `Set the app bundle identifier to ${bundleIdentifier}, the version to ${version} (${buildNumber}) and the minimum macOS version to ${deploymentTarget}.`,
);

const extensionManifests = generatedPaths.filter((path) => path.endsWith(join('Resources', 'manifest.json')));
if (extensionManifests.length !== 1) fail(`Expected the converter to copy one extension manifest, but found ${extensionManifests.length}: ${extensionManifests.join(', ')}`);
const extensionManifest = join(projectLocation, extensionManifests[0]);
writeFileSync(extensionManifest, `${JSON.stringify(safariManifest(JSON.parse(readFileSync(extensionManifest, 'utf-8'))), null, 2)}\n`);
console.log(`Made the background script a non-persistent background page in ${extensionManifests[0]}.`);

const appInfoPlists = generatedPaths.filter(
  (path) => path.endsWith(`${sep}Info.plist`) && !path.includes('Extension') && !path.includes('.xcodeproj') && !path.includes(`Resources${sep}`),
);
if (appInfoPlists.length !== 1) fail(`Expected the converter to create one Info.plist for the app, but found ${appInfoPlists.length}: ${appInfoPlists.join(', ')}`);
const appInfoPlist = join(projectLocation, appInfoPlists[0]);
execFileSync('plutil', ['-replace', 'LSApplicationCategoryType', '-string', appCategory, appInfoPlist]);
execFileSync('plutil', ['-replace', 'ITSAppUsesNonExemptEncryption', '-bool', 'NO', appInfoPlist]);
console.log(`Set the App Store category and export compliance in ${appInfoPlists[0]}.`);

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

if (!options['no-open']) execFileSync('open', [dirname(projectPath)]);
