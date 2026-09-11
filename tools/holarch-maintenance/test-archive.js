'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { executer } = require('./lib/commun.js');

const CHEMIN_ARCHIVE = path.join(__dirname, 'archive.js');

const TRANSVERSES = [
  // Fixtures structurellement fidèles au dépôt réel (ancres structurelles d'archive.js, maintenance 1.12.0).
  ['docs/archive/README.md', '## `mission-precedente/` — chantier 0'],
  ['docs/ENVIRONNEMENT.md', '- `/home/vscode/archive-precedente-residus/.holarch/` : résidus'],
  ['docs/ROADMAP.md', '| `test-mission` (**en cours**) | Chantier 8 | — |'],
  ['docs/IMPLEMENTATION.md', '**État : en cours** (mission `test-mission`)'],
  ['README.md', '- **Missions** : `precedente`, puis `test-mission`'],
  ['CLAUDE.md', '- `docs/archive/` est l\'histoire (missions), jamais une source normative.'],
];

/** Construit un dépôt Git jetable minimal : mission/concepteur/STATUS.md (état paramétrable),
 *  framework/CONFIG.md (nom de mission paramétrable), mission/registry/, 6 fichiers transverses
 *  factices avec ancre connue, et un .gitignore excluant mission/.holarch/ (comme le .gitignore racine
 *  du vrai dépôt : journaux bruts du lanceur, jamais versionnés — nécessaire pour que les tests
 *  « tâche vivante » et « résidus » ne salissent pas l'arbre avant d'atteindre la précondition ou le
 *  comportement qu'ils visent). */
function creerFixture(opts = {}) {
  const etatStatus = opts.etatStatus !== undefined ? opts.etatStatus : 'DELIVERED';
  const nomMission = opts.nomMission || 'test-mission';
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-archive-fixture-'));

  executer('git', ['init', '-q'], { cwd: root, doitReussir: true });
  executer('git', ['config', 'user.email', 'test@example.com'], { cwd: root, doitReussir: true });
  executer('git', ['config', 'user.name', 'Test'], { cwd: root, doitReussir: true });

  fs.writeFileSync(path.join(root, '.gitignore'), 'mission/.holarch/\n');

  fs.mkdirSync(path.join(root, 'mission', 'concepteur'), { recursive: true });
  const lignesStatus = etatStatus === null
    ? ['# STATUS', '', 'pas de ligne État ici.', '']
    : ['# STATUS', '', '| Champ | Valeur |', '| --- | --- |', `| État | ${etatStatus} |`, ''];
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), lignesStatus.join('\n'));

  fs.mkdirSync(path.join(root, 'framework'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'framework', 'CONFIG.md'),
    [`# Configuration — mission : ${nomMission}`, '> Preset de base : solo-light', '', '| Champ | Valeur |', '| --- | --- |', '| seuil_contexte_tokens | 180000 |', ''].join('\n'),
  );

  fs.mkdirSync(path.join(root, 'mission', 'registry'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), '# SESSIONS\n\ninitial\n');
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'REVEILS.md'), '# REVEILS\n\ninitial\n');

  for (const [rel, ancre] of TRANSVERSES) {
    const cheminAbs = path.join(root, rel);
    fs.mkdirSync(path.dirname(cheminAbs), { recursive: true });
    fs.writeFileSync(cheminAbs, `# fichier factice\n\n${ancre}\n`);
  }

  executer('git', ['add', '-A'], { cwd: root, doitReussir: true });
  executer('git', ['commit', '-m', 'init'], { cwd: root, doitReussir: true });

  return { root, nomMission };
}

test('refus : arbre sale hors mission/registry/', () => {
  const { root } = creerFixture();
  try {
    fs.writeFileSync(path.join(root, 'sale.txt'), 'non commité\n');
    const r = executer('node', [CHEMIN_ARCHIVE, '--sans-commit'], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /sale\.txt/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refus : STATUS.md racine absent d\'état DELIVERED', () => {
  const { root } = creerFixture({ etatStatus: 'EN_COURS' });
  try {
    const r = executer('node', [CHEMIN_ARCHIVE], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /DELIVERED/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refus : STATUS.md racine sans ligne État (absence)', () => {
  const { root } = creerFixture({ etatStatus: null });
  try {
    const r = executer('node', [CHEMIN_ARCHIVE], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /absent/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refus : tâche détachée vivante', () => {
  const { root } = creerFixture();
  try {
    const dirTasks = path.join(root, 'mission', '.holarch', 'tasks');
    fs.mkdirSync(dirTasks, { recursive: true });
    fs.writeFileSync(
      path.join(dirTasks, 'tache-test.json'),
      JSON.stringify({ state: 'running', pid: process.pid }),
    );
    const r = executer('node', [CHEMIN_ARCHIVE], { cwd: root });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /[Tt]âche/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('refus : processus de mission vivant (injection de test)', () => {
  const { root } = creerFixture();
  try {
    const r = executer('node', [CHEMIN_ARCHIVE], {
      cwd: root,
      env: {
        ...process.env,
        HOLARCH_PS_TEXT_TEST: `${process.pid} node framework/bin/holarch-spawn.js concepteur`,
      },
    });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /[Pp]rocessus/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scénario nominal : archivage complet', () => {
  const { root, nomMission } = creerFixture();
  const dirResidus = path.join(os.tmpdir(), `holarch-archive-residus-${Date.now()}`);
  try {
    // HOLARCH_PS_TEXT_TEST vide : force processusMissionVivant() à ne rien trouver, sans appel `ps`
    // réel (déterministe, indépendant de l'état de la machine hôte).
    const r = executer('node', [CHEMIN_ARCHIVE, '--residus', dirResidus], {
      cwd: root,
      env: { ...process.env, HOLARCH_PS_TEXT_TEST: '' },
    });
    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);

    const tagList = executer('git', ['tag', '-l', `mission-${nomMission}-final`], { cwd: root });
    assert.match(tagList.stdout, new RegExp(`mission-${nomMission}-final`));

    assert.equal(fs.existsSync(path.join(root, 'mission')), false, 'mission/ ne doit plus exister à la racine');
    const dirArchive = path.join(root, 'docs', 'archive', `mission-${nomMission}`);
    assert.equal(fs.existsSync(dirArchive), true, 'docs/archive/mission-<nom>/ doit exister');
    assert.equal(fs.existsSync(path.join(dirArchive, 'concepteur', 'STATUS.md')), true);

    for (const [rel] of TRANSVERSES) {
      const contenu = fs.readFileSync(path.join(root, rel), 'utf8');
      assert.match(contenu, /<!-- à relire -->/, `squelette manquant dans ${rel}`);
    }

    const statut = executer('git', ['status', '--porcelain'], { cwd: root });
    assert.equal(statut.stdout.trim(), '', 'le commit final doit laisser un arbre propre');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dirResidus, { recursive: true, force: true });
  }
});

test('mission/.holarch/ est déplacé vers les résidus (contenu réel, non tracké)', () => {
  const { root, nomMission } = creerFixture();
  const dirResidus = path.join(os.tmpdir(), `holarch-archive-residus-holarch-${Date.now()}`);
  try {
    // mission/.holarch/ non tracké par Git (comme dans le vrai dépôt, .gitignore racine) : on ne
    // l'ajoute jamais avec `git add`, seulement sur le disque, après le commit initial de la fixture.
    const dirHolarch = path.join(root, 'mission', '.holarch');
    fs.mkdirSync(path.join(dirHolarch, 'tasks'), { recursive: true });
    fs.writeFileSync(path.join(dirHolarch, 'tasks', 'exemple.json'), '{"state":"done"}\n');
    fs.writeFileSync(path.join(dirHolarch, 'SESSIONS.md'), '# journal brut\n');

    const r = executer('node', [CHEMIN_ARCHIVE, '--residus', dirResidus], {
      cwd: root,
      env: { ...process.env, HOLARCH_PS_TEXT_TEST: '' },
    });
    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);

    assert.equal(fs.existsSync(dirHolarch), false, 'mission/.holarch/ ne doit plus exister après archivage');
    assert.equal(
      fs.existsSync(path.join(dirResidus, '.holarch', 'tasks', 'exemple.json')),
      true,
      'le contenu de mission/.holarch/ doit être recopié dans le répertoire résidus',
    );
    assert.equal(fs.existsSync(path.join(dirResidus, '.holarch', 'SESSIONS.md')), true);

    const dirArchive = path.join(root, 'docs', 'archive', `mission-${nomMission}`);
    assert.equal(fs.existsSync(dirArchive), true, 'le git mv doit avoir eu lieu malgré la présence de .holarch/');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dirResidus, { recursive: true, force: true });
  }
});

test('--sans-commit laisse les modifications non committées', () => {
  const { root, nomMission } = creerFixture();
  const dirResidus = path.join(os.tmpdir(), `holarch-archive-residus-sc-${Date.now()}`);
  try {
    const r = executer('node', [CHEMIN_ARCHIVE, '--residus', dirResidus, '--sans-commit'], {
      cwd: root,
      env: { ...process.env, HOLARCH_PS_TEXT_TEST: '' },
    });
    assert.equal(r.code, 0, `code attendu 0, stderr : ${r.stderr}`);

    const statut = executer('git', ['status', '--porcelain'], { cwd: root });
    assert.notEqual(statut.stdout.trim(), '', 'les modifications doivent rester non committées');

    const dirArchive = path.join(root, 'docs', 'archive', `mission-${nomMission}`);
    assert.equal(fs.existsSync(dirArchive), true, 'le git mv doit avoir eu lieu malgré --sans-commit');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(dirResidus, { recursive: true, force: true });
  }
});

test('transactionnel : ancre manquante → refus avant tag et git mv ; tag existant → refus explicite', () => {
  const { root, nomMission } = creerFixture();
  try {
    fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# sans ancre\n');
    executer('git', ['add', '-A'], { cwd: root, doitReussir: true });
    executer('git', ['commit', '-q', '-m', 'ancre retirée'], { cwd: root, doitReussir: true });
    const r = executer('node', [CHEMIN_ARCHIVE, '--sans-commit'], { cwd: root, env: { ...process.env, HOLARCH_PS_TEXT_TEST: '' } });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Ancre\(s\) introuvable\(s\), rien n'a été écrit/);
    assert.equal(executer('git', ['tag', '-l'], { cwd: root }).stdout.trim(), '', 'aucun tag ne doit avoir été posé');
    assert.equal(fs.existsSync(path.join(root, 'mission', 'concepteur', 'STATUS.md')), true, 'mission/ ne doit pas avoir bougé');
    executer('git', ['tag', `mission-${nomMission}-final`], { cwd: root, doitReussir: true });
    const r2 = executer('node', [CHEMIN_ARCHIVE, '--sans-commit'], { cwd: root, env: { ...process.env, HOLARCH_PS_TEXT_TEST: '' } });
    assert.equal(r2.code, 1);
    assert.match(r2.stderr, /existe déjà/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('processusMissionVivant restreint au dépôt : verrou live/ au pid vivant → refus ; verrou mort → rien', () => {
  const { root } = creerFixture();
  try {
    const live = path.join(root, 'mission', '.holarch', 'live');
    fs.mkdirSync(live, { recursive: true });
    fs.writeFileSync(path.join(live, 'concepteur.json'), JSON.stringify({ pid: process.pid }));
    const r = executer('node', [CHEMIN_ARCHIVE, '--sans-commit'], { cwd: root }); // pas d'injection : lecture réelle des verrous
    assert.equal(r.code, 1);
    assert.match(r.stderr, /Processus de mission vivant/);
    fs.writeFileSync(path.join(live, 'concepteur.json'), JSON.stringify({ pid: 999999999 }));
    const r2 = executer('node', [CHEMIN_ARCHIVE, '--sans-commit', '--residus', path.join(os.tmpdir(), `holarch-archive-res-${Date.now()}`)], { cwd: root });
    assert.equal(r2.code, 0, r2.stderr);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
