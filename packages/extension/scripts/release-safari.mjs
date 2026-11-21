import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const projectLocation = join(root, 'safari');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

const releaseAnalytics = {
  VITE_POSTHOG_KEY: 'phc_FtV2hwQzJhR4Ul4ts9ViUxKZIP9MlDPMjMyvvPfZFjg',
  VITE_POSTHOG_HOST: 'https://eu.i.posthog.com',
  VITE_UNINSTALL_SURVEY_URL: 'https://eu.posthogsurveys.com/external_surveys/01a1eb02-9bf0-0000-54ae-59e3f95e3984',
};

const utcTimestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 12);

const { values: options } = parseArgs({
  options: {
    team: { type: 'string', default: process.env.APPLE_TEAM_ID },
    'build-number': { type: 'string', default: utcTimestamp },
    output: { type: 'string', default: join(root, 'safari-release') },
    'no-upload': { type: 'boolean', default: false },
  },
});

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('The Safari app can only be released from macOS with Xcode installed.');

const teamId = options.team;
if (!teamId) fail('Pass --team with the Apple Developer team ID, or set APPLE_TEAM_ID.');
const buildNumber = options['build-number'];

const apiKey = ['APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_KEY_PATH'];
const apiKeySet = apiKey.filter((name) => process.env[name]);
if (apiKeySet.length && apiKeySet.length !== apiKey.length) fail(`Set all of ${apiKey.join(', ')} to use an API key, or none to use the Xcode account.`);
if (apiKeySet.length && !existsSync(process.env.APP_STORE_CONNECT_KEY_PATH)) fail(`No App Store Connect API key at ${process.env.APP_STORE_CONNECT_KEY_PATH}.`);
const authentication = apiKeySet.length
  ? [
      '-authenticationKeyPath',
      process.env.APP_STORE_CONNECT_KEY_PATH,
      '-authenticationKeyID',
      process.env.APP_STORE_CONNECT_KEY_ID,
      '-authenticationKeyIssuerID',
      process.env.APP_STORE_CONNECT_ISSUER_ID,
    ]
  : [];

execFileSync('npm', ['run', 'build:safari', '--', '--no-open', '--build-number', buildNumber], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, ...releaseAnalytics },
});

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
  ['-exportArchive', '-archivePath', archivePath, '-exportOptionsPlist', exportOptionsPath, '-exportPath', output, '-allowProvisioningUpdates', ...authentication],
  { stdio: 'inherit' },
);

console.log(
  options['no-upload']
    ? `Exported the signed App Store package for ${version} (${buildNumber}) to ${output}.`
    : `Uploaded ${version} (${buildNumber}) to App Store Connect. It appears under TestFlight once Apple has processed it.`,
);
