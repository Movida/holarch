'use strict';
// Tests de lib/commun.js : seulement executer, arbrePropre, lireParamMission, insererSquelette.
// tacheDetacheeVivante / processusMissionVivant / commitStandard seront couverts par les tests des
// outils qui les utilisent (sessions suivantes).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const {
  executer,
  arbrePropre,
  lireParamMission,
  insererSquelette,
} = require('./lib/commun.js');

test('executer : succès', () => {
  const r = executer('node', ['-e', 'process.exit(0)']);
  assert.equal(r.code, 0);
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
});

test('executer : échec', () => {
  const r = executer('node', ['-e', 'process.exit(3)']);
  assert.equal(r.code, 3);
  assert.equal(typeof r.stdout, 'string');
  assert.equal(typeof r.stderr, 'string');
});

test('arbrePropre : propre, sale, exclusions', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-maint-test-'));
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });

    fs.writeFileSync(path.join(root, 'fichier.txt'), 'contenu initial\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: root });

    const apresCommit = arbrePropre(root);
    assert.equal(apresCommit.propre, true);
    assert.deepEqual(apresCommit.sales, []);

    fs.writeFileSync(path.join(root, 'fichier.txt'), 'contenu modifié\n');
    const sale = arbrePropre(root);
    assert.equal(sale.propre, false);
    assert.ok(sale.sales.includes('fichier.txt'));

    const avecExclusion = arbrePropre(root, ['fichier.txt']);
    assert.equal(avecExclusion.propre, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lireParamMission : valeur présente et clé absente', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-maint-test-'));
  try {
    const cheminConfig = path.join(root, 'CONFIG.md');
    fs.writeFileSync(
      cheminConfig,
      [
        '## Paramètres',
        '',
        '| clé | valeur |',
        '|---|---|',
        '| nom | ma-mission |',
        '| profil | concepteur |',
        '',
      ].join('\n'),
    );

    assert.equal(lireParamMission(cheminConfig, 'nom'), 'ma-mission');
    assert.equal(lireParamMission(cheminConfig, 'inexistante'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('insererSquelette : insertion puis no-op idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-maint-test-'));
  try {
    const cheminFichier = path.join(root, 'squelette.md');
    fs.writeFileSync(cheminFichier, ['# Titre', '<!-- ANCRE -->', 'suite'].join('\n'));

    const r1 = insererSquelette(cheminFichier, '<!-- ANCRE -->', 'texte inséré');
    assert.equal(r1, true);
    const contenuApresInsertion = fs.readFileSync(cheminFichier, 'utf8');
    assert.ok(contenuApresInsertion.includes('texte inséré'));

    const r2 = insererSquelette(cheminFichier, '<!-- ANCRE -->', 'texte inséré');
    assert.equal(r2, false);
    const contenuApresNoOp = fs.readFileSync(cheminFichier, 'utf8');
    assert.equal(contenuApresNoOp, contenuApresInsertion);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('insererSquelette : idempotence locale (le marqueur cité ailleurs dans le fichier n\'empêche pas l\'insertion)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-commun-'));
  try {
    const f = path.join(dir, 'doc.md');
    fs.writeFileSync(f, 'prose qui cite <!-- M -->\n\nANCRE\nsuite\n');
    assert.equal(insererSquelette(f, 'ANCRE', '<!-- M -->'), true);
    assert.equal(fs.readFileSync(f, 'utf8'), 'prose qui cite <!-- M -->\n\nANCRE\n<!-- M -->\nsuite\n');
    assert.equal(insererSquelette(f, 'ANCRE', '<!-- M -->'), false);
    assert.equal(insererSquelette(f, /^suite$/, 'X', { avant: true }), true);
    assert.equal(insererSquelette(f, null, 'FIN'), true);
    assert.match(fs.readFileSync(f, 'utf8'), /X\nsuite\nFIN/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
