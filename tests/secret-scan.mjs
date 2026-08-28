import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const allowedAgentIdPattern = /agent_[a-z0-9]+/g;
const suspiciousPatterns = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /ELEVENLABS_API_KEY\s*[:=]/i,
  /OPENAI_API_KEY\s*[:=]/i,
  /ANTHROPIC_API_KEY\s*[:=]/i,
  /GITHUB_TOKEN\s*[:=]/i,
  /[A-Za-z0-9_]*(?:SECRET|TOKEN|PRIVATE_KEY|PASSWORD)[A-Za-z0-9_]*\s*[:=]\s*['\"][^'\"]{8,}/i,
];
const ignoreDirs = new Set(['.git', 'node_modules']);
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (ignoreDirs.has(entry)) continue;
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) walk(path);
    else if (/\.(html|css|js|mjs|json|md)$/.test(entry)) files.push(path);
  }
}
walk(root);

const findings = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8').replace(allowedAgentIdPattern, 'PUBLIC_AGENT_ID');
  for (const pattern of suspiciousPatterns) {
    if (pattern.test(text)) findings.push(`${file}: ${pattern}`);
  }
}

if (findings.length) {
  console.error(findings.join('\n'));
  process.exit(1);
}
console.log(`secret scan passed (${files.length} files)`);
