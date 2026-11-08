const fs = require('fs');
const path = require('path');
const { createFingerprintAsync, SourceSkips, DEFAULT_SOURCE_SKIPS } = require('@expo/fingerprint');
const { assertReleasable } = require('./release-guard');

const root = path.resolve(__dirname, '..');
const baseline = path.join(root, '.github', 'last-release-fingerprint');
const sourceSkips = DEFAULT_SOURCE_SKIPS | SourceSkips.ExpoConfigVersions | SourceSkips.ExpoConfigRuntimeVersionIfString;

function verdict(current, stored) {
  if (!stored) return 'There is no native fingerprint of a store release. Ship a native build (npm run release:android), not an over-the-air update.';
  if (current !== stored) return 'The native fingerprint differs from the last store release. Run npm ci, then try again. If it still differs, ship a native build (npm run release:android), not an over-the-air update.';
  return null;
}

async function main(mode) {
  if (mode !== '--write' && mode !== '--check') throw new Error('Usage: node scripts/fingerprint.js --write|--check');
  if (mode === '--check') assertReleasable();
  const { hash } = await createFingerprintAsync(root, { sourceSkips });
  if (mode === '--write') {
    fs.writeFileSync(baseline, `${hash}\n`);
    return;
  }
  const stored = fs.existsSync(baseline) ? fs.readFileSync(baseline, 'utf8').trim() : '';
  const error = verdict(hash, stored);
  if (error) throw new Error(error);
}

if (require.main === module) {
  main(process.argv[2]).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
}

module.exports = { verdict };
