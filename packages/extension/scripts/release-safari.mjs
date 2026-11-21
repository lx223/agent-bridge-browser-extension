import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectLocation = join(root, 'safari');

const { values: options } = parseArgs({
  options: {
    'build-number': { type: 'string' },
    'output': { type: 'string', default: join(root, 'safari-release') },
    'no-upload': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('The Safari app can only be released from macOS with Xcode installed.');

const buildNumber = options['build-number'];
if (!buildNumber) fail('Pass --build-number with a number higher than every build already uploaded to App Store Connect.');

const required = ['APPLE_TEAM_ID', 'APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_KEY_PATH'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length) fail(`Set ${missing.join(', ')}. See docs/safari-app-store.md.`);
if (!existsSync(process.env.APP_STORE_CONNECT_KEY_PATH)) fail(`No App Store Connect API key at ${process.env.APP_STORE_CONNECT_KEY_PATH}.`);

const teamId = process.env.APPLE_TEAM_ID;
const authentication = [
  '-allowProvisioningUpdates',
  '-authenticationKeyPath',
  process.env.APP_STORE_CONNECT_KEY_PATH,
  '-authenticationKeyID',
  process.env.APP_STORE_CONNECT_KEY_ID,
  '-authenticationKeyIssuerID',
  process.env.APP_STORE_CONNECT_ISSUER_ID,
];

execFileSync('npm', ['run', 'build:safari', '--', '--no-open', '--build-number', buildNumber], { cwd: root, stdio: 'inherit' });

const project = readdirSync(projectLocation, { recursive: true })
  .map(String)
  .find((path) => path.endsWith('.xcodeproj'));
if (!project) fail(`The converter did not create an Xcode project under ${projectLocation}.`);
const projectPath = join(projectLocation, project);
const { schemes } = JSON.parse(execFileSync('xcodebuild', ['-list', '-json', '-project', projectPath], { encoding: 'utf-8' })).project;
if (!schemes?.length) fail(`The Xcode project ${projectPath} has no scheme to archive.`);

const output = resolve(options.output);
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const archivePath = join(output, 'Agent Browser Bridge.xcarchive');
const exportOptionsPath = join(output, 'ExportOptions.plist');

execFileSync(
  'xcodebuild',
  [
    '-quiet',
    '-project',
    projectPath,
    '-scheme',
    schemes[0],
    '-configuration',
    'Release',
    '-destination',
    'generic/platform=macOS',
    '-archivePath',
    archivePath,
    `DEVELOPMENT_TEAM=${teamId}`,
    'CODE_SIGN_STYLE=Manual',
    'CODE_SIGN_IDENTITY=-',
    'archive',
  ],
  { stdio: 'inherit' },
);

writeFileSync(
  exportOptionsPath,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store-connect</string>
  <key>destination</key>
  <string>${options['no-upload'] ? 'export' : 'upload'}</string>
  <key>teamID</key>
  <string>${teamId}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>manageAppVersionAndBuildNumber</key>
  <false/>
</dict>
</plist>
`,
);

execFileSync(
  'xcodebuild',
  ['-exportArchive', '-archivePath', archivePath, '-exportOptionsPlist', exportOptionsPath, '-exportPath', output, ...authentication],
  { stdio: 'inherit' },
);

console.log(
  options['no-upload']
    ? `Exported the signed App Store package to ${output}.`
    : `Uploaded build ${buildNumber} to App Store Connect. It appears under TestFlight once Apple has processed it.`,
);
