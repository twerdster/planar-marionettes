// Reproduce/check the self-hosted inference assets. npm ci installs the pinned SDK.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'public/vendor/vision');
const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
const checkOnly = process.argv.includes('--check');
const digest = (buffer) => createHash('sha256').update(buffer).digest('hex');
const packageRoot = path.join(root, 'node_modules/@mediapipe/tasks-vision');
if (!checkOnly) {
  const installed = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (installed.version !== manifest.version) throw new Error(`Expected tasks-vision ${manifest.version}, found ${installed.version}`);
}

for (const entry of manifest.files) {
  const destination = path.join(target, entry.path);
  let bytes;
  try { bytes = await readFile(destination); } catch { /* Recreate below. */ }
  if (!bytes || digest(bytes) !== entry.sha256) {
    if (checkOnly) throw new Error(`Missing or changed asset: ${entry.path}`);
    if (entry.path.startsWith('wasm/')) bytes = await readFile(path.join(packageRoot, entry.path));
    else {
      const url = entry.path.endsWith('.task') ? manifest.model_url : manifest.license_source;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (digest(bytes) !== entry.sha256 || bytes.length !== entry.bytes) {
      throw new Error(`Upstream bytes changed for ${entry.path}; inspect explicitly before changing the pinned manifest.`);
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  if (digest(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error(`Integrity mismatch: ${entry.path}`);
  console.log(`${entry.path}: ${entry.bytes} bytes, SHA-256 verified`);
}
