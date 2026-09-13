'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, '..', 'bin', 'holarch-spawn.js');
const launcher = require(BIN);

/** Les deux tests « en shell normal » supposent la CLI `claude` installée et authentifiée : vrai sur le
 *  poste du mainteneur, faux sur la CI (GitHub Actions, 1.22.1) — ils y sont sautés, pas rouges. */
function claudePret() {
  const v = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (v.error || v.status !== 0) return false;
  const a = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
  return !a.error && a.status === 0;
}
const SANS_CLAUDE = claudePret() ? false : 'CLI claude absente ou non authentifiée (CI)';

test('verifierEnv : réunit Node, git, claude et son authentification en shell normal', { skip: SANS_CLAUDE }, () => {
  const r = launcher.verifierEnv();
  assert.strictEqual(r.ok, true, r.lignes.join('\n'));
  assert.ok(r.lignes.some((l) => l.startsWith('✓ Node ')));
  assert.ok(r.lignes.some((l) => l.startsWith('✓ git ')));
  assert.ok(r.lignes.some((l) => l.startsWith('✓ claude ')));
  assert.ok(r.lignes.some((l) => l === '✓ claude authentifié'));
});

test('--check-env : sort en 0 en shell normal, imprime chaque prérequis', { skip: SANS_CLAUDE }, () => {
  const r = spawnSync(process.execPath, [BIN, '--check-env'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /✓ Node /);
  assert.match(r.stdout, /prérequis d'Étape 0 réunis\./);
});

test('--check-env : sort en 1 et nomme le binaire manquant quand claude/git sont hors PATH', () => {
  const fakeBin = path.join(__dirname, 'fixtures-check-env-bin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(fakeBin, 'node'));
  try {
    const r = spawnSync(process.execPath, [BIN, '--check-env'], { encoding: 'utf8', env: { PATH: fakeBin } });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /✗ git introuvable/);
    assert.match(r.stdout, /✗ CLI `claude` introuvable/);
    assert.match(r.stdout, /prérequis manquants/);
  } finally {
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});

test('--help liste --check-env', () => {
  const r = spawnSync(process.execPath, [BIN, '--help'], { encoding: 'utf8' });
  assert.match(r.stdout, /--check-env/);
});
