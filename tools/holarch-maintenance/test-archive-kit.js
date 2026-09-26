'use strict';

// Chantier 17, §17.2 : `archive.js --kit <domaine>` propose, puis avec --appliquer copie, sans jamais écraser ni committer.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ARCHIVE = path.join(__dirname, 'archive.js');

function depot() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-archive-kit-'));
  const w = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(d, rel)), { recursive: true }); fs.writeFileSync(path.join(d, rel), txt); };
  w('mission/concepteur/ROLE.md', '# Rôle\n');
  w('mission/concepteur/monteur/ROLE.md', '# Rôle\n');
  w('mission/concepteur/monteur/REGLES-OR.md', '# Règles\n- Loudnorm deux passes.\n');
  w('mission/concepteur/monteur/workspace/REGLES-OR.md', 'brouillon\n');
  w('mission/shared/concepteur/monteur/verificateurs/qc.py', 'print("qc")\n');
  w('mission/shared/concepteur/cible-framework/framework/kits/m/verificateurs/autre.py', 'print("x")\n');
  return d;
}

const lancer = (d, args) => spawnSync('node', [ARCHIVE, ...args], { cwd: d, encoding: 'utf8' });

test('sans --appliquer : propositions listées, aucune écriture, kit en fabrication et workspace ignorés', () => {
  const d = depot();
  const r = lancer(d, ['--kit', 'media']);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /mission\/concepteur\/monteur\/REGLES-OR\.md → framework\/kits\/media\/references\/concepteur-monteur-REGLES-OR\.md \(à relire\)/);
  assert.match(r.stdout, /verificateurs\/qc\.py → framework\/kits\/media\/verificateurs\/qc\.py/);
  assert.ok(!r.stdout.includes('autre.py') && !r.stdout.includes('workspace'), r.stdout);
  assert.ok(!fs.existsSync(path.join(d, 'framework')), 'aucune écriture attendue sans --appliquer');
});

test('--appliquer : copie, référence ouverte par « à relire », aucun écrasement au second passage', () => {
  const d = depot();
  assert.strictEqual(lancer(d, ['--kit', 'media', '--appliquer']).status, 0);
  const ref = fs.readFileSync(path.join(d, 'framework/kits/media/references/concepteur-monteur-REGLES-OR.md'), 'utf8');
  assert.ok(ref.startsWith('<!-- à relire -->\n# Règles'));
  assert.ok(fs.existsSync(path.join(d, 'framework/kits/media/verificateurs/qc.py')));
  const r = lancer(d, ['--kit', 'media', '--appliquer']);
  assert.strictEqual(r.status, 1);
  assert.match(r.stderr, /destination existante, jamais écrasée/);
});

test('domaine invalide refusé ; mission sans règles : rien à proposer', () => {
  const d = depot();
  assert.strictEqual(lancer(d, ['--kit', 'Media']).status, 1);
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-archive-kit-vide-'));
  const r = lancer(vide, ['--kit', 'media']);
  assert.strictEqual(r.status, 0);
  assert.match(r.stdout, /rien à proposer/);
});
