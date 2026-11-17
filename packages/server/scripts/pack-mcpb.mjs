import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(serverDir, '../..');
const stageDir = join(serverDir, 'mcpb-dist');
const outputFile = resolve(process.argv[2] ?? join(serverDir, 'agent-browser-bridge.mcpb'));

const run = (command, args) => execFileSync(command, args, { cwd: serverDir, stdio: 'inherit' });

run('npx', ['vite', 'build', '--config', 'vite.mcpb.config.ts']);

const { version } = JSON.parse(readFileSync(join(serverDir, 'package.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(serverDir, 'mcpb/manifest.json'), 'utf8'));
mkdirSync(stageDir, { recursive: true });
writeFileSync(join(stageDir, 'manifest.json'), `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
copyFileSync(join(repoDir, 'packages/extension/public/icons/icon-128.png'), join(stageDir, 'icon.png'));
copyFileSync(join(repoDir, 'LICENSE'), join(stageDir, 'LICENSE'));

run('npx', ['mcpb', 'validate', join(stageDir, 'manifest.json')]);
run('npx', ['mcpb', 'pack', stageDir, outputFile]);
