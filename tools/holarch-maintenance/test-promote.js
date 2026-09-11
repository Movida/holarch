'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { executer } = require('./lib/commun.js');

const CHEMIN_PROMOTE = path.join(__dirname, 'promote.js');

const PACKAGE_LOCK_VIDE = JSON.stringify({
  name: 'fixture',
  version: '1.0.0',
  lockfileVersion: 3,
  requires: true,
  packages: { '': { name: 'fixture', version: '1.0.0' } },
}, null, 2);

/** Construit un dépôt Git jetable minimal, avec un `npm test`/`npm run lint` exécutables et un
 *  `framework/bin/holarch-spawn.js` factice répondant à `--dry-run`. */
function creerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-fixture-'));

  executer('git', ['init', '-q'], { cwd: root, doitReussir: true });
  executer('git', ['config', 'user.email', 'test@example.com'], { cwd: root, doitReussir: true });
  executer('git', ['config', 'user.name', 'Test'], { cwd: root, doitReussir: true });

  fs.writeFileSync(path.join(root, 'cible-marqueur.txt'), 'v1\n');

  fs.mkdirSync(path.join(root, 'framework', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'VERSION'), '1.2.3');
  fs.writeFileSync(
    path.join(root, 'framework', 'CHANGELOG.md'),
    '# CHANGELOG — test\n\nHistorique des changements.\n\n## 1.2.3 — 2026-01-01\n\nEntrée initiale.\n',
  );
  fs.writeFileSync(
    path.join(root, 'framework', 'bin', 'holarch-spawn.js'),
    "#!/usr/bin/env node\n'use strict';\nif (process.argv.includes('--dry-run')) {\n"
      + "  process.stdout.write('PROMPT-FACTICE-DRY-RUN');\n  process.exit(0);\n}\nprocess.exit(0);\n",
  );

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'fixture',
      version: '1.0.0',
      private: true,
      scripts: {
        test: 'node --test test-fixture.js',
        lint: 'node -e "process.exit(0)"',
      },
    }, null, 2),
  );
  fs.writeFileSync(path.join(root, 'package-lock.json'), PACKAGE_LOCK_VIDE);
  fs.writeFileSync(
    path.join(root, 'test-fixture.js'),
    "'use strict';\nconst test = require('node:test');\nconst assert = require('node:assert/strict');\n"
      + "test('fixture ok', () => { assert.equal(1 + 1, 2); });\n",
  );

  executer('git', ['add', '-A'], { cwd: root, doitReussir: true });
  executer('git', ['commit', '-m', 'init'], { cwd: root, doitReussir: true });
  const shaBaseInitial = executer('git', ['rev-parse', 'HEAD'], { cwd: root, doitReussir: true }).stdout.trim();

  return { root, shaBaseInitial };
}

/** Écrit un paquet factice (MANIFEST.json + appliquer.js + fichiers sources des cibles) dans `dir`. */
function creerPaquetFactice(dir, shaBase, cibles) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'MANIFEST.json'),
    JSON.stringify({ shaBase, cibles }, null, 2),
  );
  for (const c of cibles) {
    const cheminSource = path.join(dir, c.depuis);
    fs.mkdirSync(path.dirname(cheminSource), { recursive: true });
    if (!fs.existsSync(cheminSource)) {
      fs.writeFileSync(cheminSource, `contenu factice pour ${c.vers}\n`);
    }
  }
  fs.writeFileSync(
    path.join(dir, 'appliquer.js'),
    "'use strict';\nconst fs = require('fs');\nconst path = require('path');\n"
      + 'const manifest = require(path.join(__dirname, \'MANIFEST.json\'));\n'
      + 'const argv = process.argv.slice(2);\n'
      + "const idxDepot = argv.indexOf('--depot');\n"
      + "const depot = idxDepot !== -1 ? argv[idxDepot + 1] : process.cwd();\n"
      + "const dryRun = argv.includes('--dry-run') || argv.includes('--verifier');\n"
      + 'if (dryRun) { process.exit(0); }\n'
      + 'for (const c of manifest.cibles) {\n'
      + '  const source = path.join(__dirname, c.depuis);\n'
      + '  const cible = path.join(depot, c.vers);\n'
      + '  fs.mkdirSync(path.dirname(cible), { recursive: true });\n'
      + '  fs.copyFileSync(source, cible);\n'
      + '}\n'
      + 'process.exit(0);\n',
  );
}

function nettoyer(...chemins) {
  for (const c of chemins) {
    fs.rmSync(c, { recursive: true, force: true });
  }
}

test('dry-run nominal : rien appliqué sur le réel, copie supprimée', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  const tmpCopie = path.join(os.tmpdir(), `holarch-promote-test-copie-${Date.now()}`);
  try {
    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
      { depuis: 'nouveau-fichier.txt', vers: 'nouveau-fichier.txt', type: 'nouveau' },
    ]);

    const r = executer(
      'node',
      [CHEMIN_PROMOTE, paquetDir, '--copie', tmpCopie],
      { cwd: fixture.root },
    );

    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);
    const statut = executer('git', ['status', '--porcelain'], { cwd: fixture.root });
    assert.equal(statut.stdout.trim(), '', 'le dépôt réel ne doit pas avoir été modifié');
    assert.equal(fs.existsSync(tmpCopie), false, 'la copie doit avoir été supprimée (pas de --garder)');
  } finally {
    nettoyer(fixture.root, paquetDir, tmpCopie);
  }
});

test('refus shaBase inatteignable', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  try {
    const shaInexistant = 'f'.repeat(40);
    creerPaquetFactice(paquetDir, shaInexistant, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
    ]);

    const r = executer('node', [CHEMIN_PROMOTE, paquetDir], { cwd: fixture.root });

    assert.equal(r.code, 1);
    assert.match(r.stderr, /inatteignable/);
  } finally {
    nettoyer(fixture.root, paquetDir);
  }
});

test('refus arbre sale hors mission/ avec --appliquer', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  try {
    fs.writeFileSync(path.join(fixture.root, 'sale.txt'), 'non commité\n');

    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
    ]);

    const r = executer(
      'node',
      [CHEMIN_PROMOTE, paquetDir, '--appliquer'],
      { cwd: fixture.root },
    );

    assert.equal(r.code, 1);
    assert.match(r.stderr, /sale\.txt/);
    const version = fs.readFileSync(path.join(fixture.root, 'framework', 'VERSION'), 'utf8');
    assert.equal(version, '1.2.3');
  } finally {
    nettoyer(fixture.root, paquetDir);
  }
});

test('--version auto : cibles mixtes -> mineure', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  try {
    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
      { depuis: 'doc-nouveau.md', vers: 'docs/quelquechose.md', type: 'nouveau' },
    ]);

    const r = executer(
      'node',
      [CHEMIN_PROMOTE, paquetDir, '--appliquer'],
      { cwd: fixture.root },
    );

    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);
    const version = fs.readFileSync(path.join(fixture.root, 'framework', 'VERSION'), 'utf8');
    assert.equal(version, '1.3.0');
  } finally {
    nettoyer(fixture.root, paquetDir);
  }
});

test('--version auto : cibles 100% tools/ -> patch', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  try {
    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'outil-nouveau.js', vers: 'tools/quelquechose.js', type: 'nouveau' },
    ]);

    const r = executer(
      'node',
      [CHEMIN_PROMOTE, paquetDir, '--appliquer'],
      { cwd: fixture.root },
    );

    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);
    const version = fs.readFileSync(path.join(fixture.root, 'framework', 'VERSION'), 'utf8');
    assert.equal(version, '1.2.4');
  } finally {
    nettoyer(fixture.root, paquetDir);
  }
});

test('dépôt sans package-lock.json : repli sur npm install, cycle non interrompu', () => {
  const fixture = creerFixture();
  fs.rmSync(path.join(fixture.root, 'package-lock.json'));
  executer('git', ['add', '-A'], { cwd: fixture.root, doitReussir: true });
  executer('git', ['commit', '-m', 'retire package-lock.json'], { cwd: fixture.root, doitReussir: true });
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  try {
    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
    ]);

    const r = executer('node', [CHEMIN_PROMOTE, paquetDir], { cwd: fixture.root });

    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);
    assert.match(r.stdout, /repli sur npm install/);
  } finally {
    nettoyer(fixture.root, paquetDir);
  }
});

test('--garder conserve la copie, son absence la supprime', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  const copieAvecGarder = path.join(os.tmpdir(), `holarch-promote-garder-${Date.now()}`);
  const copieSansGarder = path.join(os.tmpdir(), `holarch-promote-sansgarder-${Date.now()}`);
  try {
    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
    ]);

    const rGarder = executer(
      'node',
      [CHEMIN_PROMOTE, paquetDir, '--copie', copieAvecGarder, '--garder'],
      { cwd: fixture.root },
    );
    assert.equal(rGarder.code, 0, `code attendu 0, stderr : ${rGarder.stderr}`);
    assert.equal(fs.existsSync(copieAvecGarder), true, 'la copie doit être conservée avec --garder');

    const rSansGarder = executer(
      'node',
      [CHEMIN_PROMOTE, paquetDir, '--copie', copieSansGarder],
      { cwd: fixture.root },
    );
    assert.equal(rSansGarder.code, 0, `code attendu 0, stderr : ${rSansGarder.stderr}`);
    assert.equal(fs.existsSync(copieSansGarder), false, 'la copie doit être supprimée sans --garder');
  } finally {
    nettoyer(fixture.root, paquetDir, copieAvecGarder, copieSansGarder);
  }
});

test('P2 : refus quand le manifeste et le paquet divergent (fichier sous cible-*/ non déclaré, cible sans fichier)', () => {
  const fixture = creerFixture();
  const paquetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-promote-paquet-'));
  try {
    creerPaquetFactice(paquetDir, fixture.shaBaseInitial, [
      { depuis: 'cible-marqueur.txt', vers: 'cible-marqueur.txt', type: 'remplace' },
    ]);
    // un fichier livré sous cible-framework/ mais oublié dans cibles[]
    fs.mkdirSync(path.join(paquetDir, 'cible-framework', 'tests'), { recursive: true });
    fs.writeFileSync(path.join(paquetDir, 'cible-framework', 'tests', 'oublie.test.js'), '// oublié\n');
    // cible-docs/ est exclu de la réconciliation (fragments insérés à la main)
    fs.mkdirSync(path.join(paquetDir, 'cible-docs'), { recursive: true });
    fs.writeFileSync(path.join(paquetDir, 'cible-docs', 'fragment.md'), '# fragment\n');
    const r = executer('node', [CHEMIN_PROMOTE, paquetDir], { cwd: fixture.root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /désaccordé avec le paquet/);
    assert.match(r.stderr, /cible-framework\/tests\/oublie\.test\.js/);
    assert.doesNotMatch(r.stderr, /cible-docs/);
    // une cible déclarée sans fichier dans le paquet
    fs.unlinkSync(path.join(paquetDir, 'cible-framework', 'tests', 'oublie.test.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(paquetDir, 'MANIFEST.json'), 'utf8'));
    manifest.cibles.push({ depuis: 'cible-framework/tests/absent.test.js', vers: 'framework/tests/absent.test.js', type: 'ajoute' });
    fs.writeFileSync(path.join(paquetDir, 'MANIFEST.json'), JSON.stringify(manifest, null, 2));
    const r2 = executer('node', [CHEMIN_PROMOTE, paquetDir], { cwd: fixture.root });
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /cible\(s\) sans fichier dans le paquet \(cible-framework\/tests\/absent\.test\.js\)/);
  } finally {
    nettoyer(fixture.root, paquetDir);
  }
});
