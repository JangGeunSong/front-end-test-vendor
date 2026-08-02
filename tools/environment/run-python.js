const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const requirements = path.join(ROOT, 'tools', 'ai-generator', 'requirements.txt');
const pythonOverride = process.env.MVP_PYTHON;
const python = pythonOverride || path.join(ROOT, '.venv', 'Scripts', 'python.exe');

if (!pythonOverride && !fs.existsSync(python)) {
  console.error(`Project Python is unavailable. Run: npm run env:bootstrap`);
  process.exit(1);
}

const result = spawnSync('uv', [
  'run',
  '--python', python,
  '--with-requirements', requirements,
  'python',
  ...process.argv.slice(2),
], {
  cwd: ROOT,
  env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(`Unable to run uv: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
