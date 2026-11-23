import path from 'node:path';
import { buildSite } from './build.ts';
import { analyticsFromEnv } from './config.ts';

const repoRoot = path.resolve(import.meta.dirname, '..');
const outDir = path.join(repoRoot, 'site', 'dist');
const analytics = analyticsFromEnv(process.env);
const files = await buildSite(repoRoot, outDir, { analytics });
console.log(analytics ? `Analytics on, sending to ${analytics.host}` : 'Analytics off: SITE_POSTHOG_KEY is not set');
console.log(`Built ${files.length} files into ${path.relative(repoRoot, outDir)}`);
