import path from 'node:path';
import { buildSite } from './build.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.join(repoRoot, 'site', 'dist');
const files = await buildSite(repoRoot, outDir);
console.log(`Built ${files.length} files into ${path.relative(repoRoot, outDir)}`);
