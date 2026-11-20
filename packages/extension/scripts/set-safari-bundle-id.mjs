import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const appId = process.argv[2];
if (!appId) {
  console.error('Usage: node scripts/set-safari-bundle-id.mjs <app bundle id>');
  process.exit(1);
}

const safariDir = resolve(import.meta.dirname, '../safari');
const projectFiles = readdirSync(safariDir, { recursive: true })
  .map(String)
  .filter((path) => /\.xcodeproj\/project\.(pbxproj|xcproj)$/.test(path))
  .map((path) => join(safariDir, path));

if (projectFiles.length === 0) {
  console.error(`No Xcode project found in ${safariDir}`);
  process.exit(1);
}

const bundleIdSetting = /("?PRODUCT_BUNDLE_IDENTIFIER"?\s*[:=]\s*"?)([^";,\s]+)/g;

for (const file of projectFiles) {
  const source = readFileSync(file, 'utf8');
  const found = [];
  const updated = source.replace(bundleIdSetting, (_, prefix, value) => {
    const next = value.startsWith(`${appId}.`) ? value : appId;
    found.push(`${value} -> ${next}`);
    return `${prefix}${next}`;
  });
  if (found.length === 0) {
    console.error(`No PRODUCT_BUNDLE_IDENTIFIER in ${file}`);
    process.exit(1);
  }
  writeFileSync(file, updated);
  console.log(`${file}\n  ${found.join('\n  ')}`);
}
