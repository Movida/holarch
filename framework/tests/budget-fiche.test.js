'use strict';
/**
 * budget-fiche.test.js — chantier 16, §18.2 (docs/IMPLEMENTATION.md). Module autonome
 * (`framework/bin/budget-session.js`), testé depuis ce paquet (`require('../bin/budget-session.js')`,
 * chemin identique une fois promu sous `framework/bin/`). Les tests qui exigent le lanceur patché
 * (dry-run, .budget.json consommé par appendSessionLine, estimation_budget) sont `skip` hors clone
 * promu — même détection que `budget-watch.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const budgetSession = require(path.join(__dirname, '..', 'bin', 'budget-session.js'));

// -- lireBudgetFiche / refusBudgetFiche / plafondEffectif : vérifications directes -----------------

test('lireBudgetFiche : ligne absente, nombre, valeur illisible', () => {
  assert.equal(budgetSession.lireBudgetFiche('| Profil | conception |'), null);
  assert.deepEqual(budgetSession.lireBudgetFiche('| Budget USD / session | `12` |'), { brut: '12', usd: 12 });
  assert.ok(Number.isNaN(budgetSession.lireBudgetFiche('| Budget USD / session | beaucoup |').usd));
});

test('plafondEffectif : valeur CONFIG valide, sinon défaut 20', () => {
  assert.equal(budgetSession.plafondEffectif({ budget_usd_session_max: '15' }), 15);
  assert.equal(budgetSession.plafondEffectif({ budget_usd_session_max: '' }), 20);
  assert.equal(budgetSession.plafondEffectif({}), 20);
  assert.equal(budgetSession.plafondEffectif({ budget_usd_session_max: '-3' }), 20);
});

test('point 11 : plafond effectif jamais sous budget_usd_par_session (25 relevé → fiche à 22 acceptée)', () => {
  assert.equal(budgetSession.plafondEffectif({ budget_usd_par_session: '25' }), 25);
  assert.equal(budgetSession.plafondEffectif({ budget_usd_session_max: '30', budget_usd_par_session: '25' }), 30);
  const r = budgetSession.resoudreBudget('| Budget USD / session | 22 |', null, { budget_usd_par_session: '25' });
  assert.deepEqual([r.usd, r.source, r.refus], [22, 'fiche', null]);
});

test('point 12 : virgule décimale lue pareil partout (fiche, CONFIG, --budget-usd), illisible refusé explicitement', () => {
  assert.equal(budgetSession.lireNombre('16,5'), 16.5);
  assert.equal(budgetSession.lireNombre(''), undefined);
  assert.equal(budgetSession.lireBudgetFiche('| Budget USD / session | 12,5 |').usd, 12.5);
  assert.equal(budgetSession.plafondEffectif({ budget_usd_session_max: '16,5' }), 16.5);
  assert.equal(budgetSession.resoudreBudget(null, null, { budget_usd_par_session: '9,5' }).usd, 9.5);
  assert.equal(budgetSession.resoudreBudget(null, '16,5', {}).usd, 16.5);
  const illisible = budgetSession.resoudreBudget(null, 'seize', {});
  assert.match(illisible.refus || '', /--budget-usd illisible/);
});

test('refusBudgetFiche : ligne absente jamais refusée, au-delà du plafond et non numérique refusés', () => {
  assert.equal(budgetSession.refusBudgetFiche(null, 20), null);
  assert.equal(budgetSession.refusBudgetFiche(budgetSession.lireBudgetFiche('| Budget USD / session | 12 |'), 20), null);
  assert.match(budgetSession.refusBudgetFiche(budgetSession.lireBudgetFiche('| Budget USD / session | 25 |'), 20), /> plafond/);
  assert.match(budgetSession.refusBudgetFiche(budgetSession.lireBudgetFiche('| Budget USD / session | abc |'), 20), /illisible/);
  assert.match(budgetSession.refusBudgetFiche(budgetSession.lireBudgetFiche('| Budget USD / session | 0 |'), 20), /illisible/);
});

// -- resoudreBudget : les trois sources, précédence, refus, CLI au-delà du plafond accepté ---------

test('resoudreBudget : source CONFIG (budget_usd_par_session) sans fiche ni CLI', () => {
  const r = budgetSession.resoudreBudget(null, null, { budget_usd_par_session: '8' });
  assert.deepEqual(r, { usd: 8, source: 'CONFIG', refus: null });
});

test('resoudreBudget : source fiche, ligne valide sous le plafond', () => {
  const r = budgetSession.resoudreBudget('| Budget USD / session | 12 |', null, { budget_usd_par_session: '8' });
  assert.deepEqual(r, { usd: 12, source: 'fiche', refus: null });
});

test('resoudreBudget : source CLI, précédence sur la fiche', () => {
  const r = budgetSession.resoudreBudget('| Budget USD / session | 12 |', '5', { budget_usd_par_session: '8' });
  assert.equal(r.usd, 5);
  assert.equal(r.source, 'CLI');
});

test('resoudreBudget : refus fiche au-delà du plafond (défaut 20)', () => {
  const r = budgetSession.resoudreBudget('| Budget USD / session | 25 |', null, { budget_usd_par_session: '8' });
  assert.match(r.refus, /25 USD > plafond budget_usd_session_max \(20 USD/);
});

test('resoudreBudget : refus fiche non numérique', () => {
  const r = budgetSession.resoudreBudget('| Budget USD / session | beaucoup |', null, { budget_usd_par_session: '8' });
  assert.match(r.refus, /illisible/);
});

test('resoudreBudget : une valeur CLI au-delà du plafond est acceptée (geste explicite du mainteneur)', () => {
  const r = budgetSession.resoudreBudget(null, '999', { budget_usd_par_session: '8', budget_usd_session_max: '20' });
  assert.deepEqual(r, { usd: 999, source: 'CLI', refus: null });
});

test('resoudreBudget : plafond configurable (budget_usd_session_max)', () => {
  const r = budgetSession.resoudreBudget('| Budget USD / session | 12 |', null, { budget_usd_par_session: '8', budget_usd_session_max: '10' });
  assert.match(r.refus, /> plafond budget_usd_session_max \(10 USD/);
});

// -- Lanceur patché : dry-run, appendSessionLine, estimation_budget --------------------------------
// Ne tournent qu'après promotion (le paquet ne porte pas framework/bin/holarch-spawn.js à côté de ce
// test) : c'est mission/shared/concepteur/verificateurs/integration.js qui les exerce, dans son clone.
const SPAWN_JS = path.join(__dirname, '..', 'bin', 'holarch-spawn.js');
const HAS_SPAWN = fs.existsSync(SPAWN_JS);
const SKIP = HAS_SPAWN ? false : 'holarch-spawn.js absent à côté de ce test (paquet non appliqué)';

function ecrire(root, relatif, texte) {
  const p = path.join(root, relatif);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texte, 'utf8');
}

function construireRacine(chemin, lignesFiche) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-fiche-'));
  ecrire(root, path.join('mission', chemin, 'ROLE.md'), '# Rôle\nInstance de test (fixture budget-fiche.test.js).\n');
  ecrire(root, path.join('mission', chemin, 'STATUS.md'), '| Champ | Valeur |\n|---|---|\n| État | READY |\n');
  ecrire(
    root,
    path.join('mission', 'registry', 'instances', `${chemin.replace(/\//g, '-')}.md`),
    `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Statut | INIT |\n| Budget alloué / consommé | 0 / 0 |\n${lignesFiche.join('\n')}\n`,
  );
  return root;
}

test(
  '--dry-run : ligne « Budget USD / session » de la fiche → « budget : 12 USD (source fiche) »',
  { skip: SKIP },
  () => {
    const { spawnSync } = require('child_process');
    const root = construireRacine('budgete', ['| Profil | execution |', '| Budget USD / session | 12 |']);
    try {
      const r = spawnSync(process.execPath, [SPAWN_JS, 'budgete', '--dry-run', '--root', root], { encoding: 'utf8', cwd: root });
      assert.equal(r.status, 0, `dry-run : code ${r.status}\nstderr=${r.stderr}`);
      assert.match(r.stderr, /budget : 12 USD \(source fiche\)/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
);

test(
  'troisième revue n° 76 : sans ligne budget_usd_par_session, plafond 5 → défaut 5 pour le lanceur, le dry-run et le réveil ; fiche à 8 refusée',
  { skip: SKIP },
  () => {
    const { spawnSync } = require('child_process');
    const config = '# Configuration\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| budget_usd_session_max | 5 |\n';
    const lanceur = require(SPAWN_JS);
    const params = lanceur.resolveParams(lanceur.parseConfig(config));
    assert.equal(Number(params.budget_usd_par_session), 5, 'resolveParams (lanceur, dry-run) : min(8, 5)');
    assert.equal(budgetSession.plafondEffectif(params), 5, 'plafond du réveil (plafondEffectif ∘ resolveParams) : 5, pas 8');
    assert.equal(Number(lanceur.resolveParams(lanceur.parseConfig(config.replace('| 5 |', '| 30 |'))).budget_usd_par_session), 8, 'plafond 30 : défaut 8');
    for (const [nom, lignes, attendu] of [['sans-ligne', [], /budget : 5 USD \(source CONFIG\)/], ['fiche-8', ['| Budget USD / session | 8 |'], /plafond budget_usd_session_max \(5 USD.*un lancement réel serait refusé/]]) {
      const root = construireRacine(nom, ['| Profil | execution |', ...lignes]);
      try {
        ecrire(root, path.join('framework', 'CONFIG.md'), config);
        const r = spawnSync(process.execPath, [SPAWN_JS, nom, '--dry-run', '--root', root], { encoding: 'utf8', cwd: root });
        assert.equal(r.status, 0, `dry-run : code ${r.status}\nstderr=${r.stderr}`);
        assert.match(r.stderr, attendu);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  },
);

test(
  '--dry-run : fiche au-delà du plafond → avertissement « un lancement réel serait refusé »',
  { skip: SKIP },
  () => {
    const { spawnSync } = require('child_process');
    const root = construireRacine('trop-cher', ['| Profil | execution |', '| Budget USD / session | 999 |']);
    try {
      const r = spawnSync(process.execPath, [SPAWN_JS, 'trop-cher', '--dry-run', '--root', root], { encoding: 'utf8', cwd: root });
      assert.equal(r.status, 0, `dry-run : code ${r.status}\nstderr=${r.stderr}`);
      assert.match(r.stderr, /plafond budget_usd_session_max.*un lancement réel serait refusé/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  },
);

test(
  'troisième revue n° 82 : --budget-usd sans valeur ou vide → refus explicite, jamais le budget CONFIG en silence',
  { skip: SKIP },
  () => {
    const { spawnSync } = require('child_process');
    for (const fin of [['--budget-usd'], ['--budget-usd', ''], ['--budget-usd', '  ']]) {
      const root = construireRacine('sans-valeur', ['| Profil | execution |']);
      try {
        const r = spawnSync(process.execPath, [SPAWN_JS, 'sans-valeur', '--dry-run', '--root', root, ...fin], { encoding: 'utf8', cwd: root });
        assert.equal(r.status, 0, `dry-run : code ${r.status}\nstderr=${r.stderr}`);
        assert.match(r.stderr, /--budget-usd illisible.*un lancement réel serait refusé/, `argv ${JSON.stringify(fin)}`);
        assert.doesNotMatch(r.stderr, /source CONFIG/, `argv ${JSON.stringify(fin)} : budget CONFIG pris en silence`);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }
  },
);

test(
  '.budget.json consommé par appendSessionLine, estimation_budget dans le .result.json',
  { skip: SKIP },
  () => {
    const { launchWithRelaunches } = require(SPAWN_JS);
    const budgetWatch = require(path.join(__dirname, '..', 'hooks', 'budget-watch.js'));
    const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
    // Scénario existant du banc de mesure (framework/tests/scenarios/) : session_id fixe
    // « sess-livraison-simple », repris ici pour fabriquer un .budget.json au même session_id.
    const SCENARIO = path.join(__dirname, 'scenarios', 'livraison-simple.json');
    if (!fs.existsSync(FAKE_CLAUDE) || !fs.existsSync(SCENARIO)) {
      assert.ok(true, 'fixtures fake-claude absentes : vérifié seulement par le vérificateur d\'intégration');
      return;
    }
    const SESSION_ID = JSON.parse(fs.readFileSync(SCENARIO, 'utf8')).result.session_id;
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-live-'));
    const { execFileSync } = require('child_process');
    const CONFIG = `# Configuration — mission : test-budget-fiche\n> Preset de base : solo-light · Framework : v1.1\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|\n| 1 | orchestration | direct-spawn |\n| 2 | registre | sharded-files |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| profondeur_max | 2 |\n| isolation | aucune |\n| commit_par_session | non |\n| relances_max | 2 |\n\n## Politique de modèle\n| Profil | Modèle | Effort |\n|---|---|---|\n| execution | sonnet | medium |\n`;
    const fiche = '# x\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | — |\n| Statut | READY |\n'
      + '| Budget alloué / consommé | 3 / 0 |\n| Dépend de | — |\n| Profil | execution |\n| Livrables | — |\n'
      + '| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n';
    const w = (rel, contenu) => {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, contenu);
    };
    w('framework/KERNEL.md', '# KERNEL\n(stub de test)\n');
    w('framework/CONFIG.md', CONFIG);
    w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
    w('framework/modules/registre/sharded-files.md', '# Module : sharded-files\n');
    w('mission/OBJECTIVE.md', 'Objectif de test.\n');
    w('mission/x/ROLE.md', '# ROLE\nTest.\n');
    w('mission/x/MEMORY.md', '# Mémoire\n(vide)\n');
    w('mission/x/INBOX.md', '# Inbox\n');
    w('mission/x/OUTBOX.md', '# Outbox\n');
    w('mission/x/JOURNAL.md', '# Journal\n');
    w('mission/x/STATUS.md', '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | — |\n');
    w('mission/registry/instances/x.md', fiche);
    w('mission/registry/ORG.md', '# Organisation\n- x (READY)\n');
    execFileSync('git', ['init', '-q'], { cwd: root });
    execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
    // Fabrique un .budget.json AVANT le lancement, comme le ferait budget-watch.js en cours de session
    // (ici le fake CLI n'invoque aucun hook réel) : vérifie que appendSessionLine le lit puis le
    // supprime, et que le .result.json de la session porte estimation_budget.
    const budgetFile = budgetWatch.budgetLivePath(root, 'x');
    const budgetData = {
      session_id: SESSION_ID, plafond: 8, depense: 6, ratio: 0.75, source: 'cli', ordre_a: null,
    };
    fs.mkdirSync(path.dirname(budgetFile), { recursive: true });
    fs.writeFileSync(budgetFile, JSON.stringify(budgetData));
    const cles = { HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO };
    const avant = {};
    for (const [k, v] of Object.entries(cles)) { avant[k] = process.env[k]; process.env[k] = v; }
    let sessions;
    try {
      sessions = launchWithRelaunches(root, 'x', {});
    } finally {
      for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
    assert.ok(sessions.length >= 1);
    const last = sessions[sessions.length - 1];
    assert.equal(fs.existsSync(budgetFile), false, '.budget.json consommé (supprimé) par appendSessionLine');
    assert.ok(last.logBase && fs.existsSync(`${last.logBase}.result.json`), `.result.json attendu à ${last.logBase}`);
    const rjson = JSON.parse(fs.readFileSync(`${last.logBase}.result.json`, 'utf8'));
    assert.deepEqual(rjson.estimation_budget, budgetData, '.result.json porte estimation_budget = contenu lu de .budget.json');
    fs.rmSync(root, { recursive: true, force: true });
  },
);

// -- Revue du J1 (MSG-utilisateur-004) : point 4 (refus à une ré-incarnation), point 5 pièces 2-3 ---------------

/** Racine minimale suffisante pour prepareLaunch : enfant `concepteur/enfant`, parent muni d'une INBOX. */
function racineRelance(lignesFiche) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-relance-'));
  ecrire(root, 'framework/KERNEL.md', '# KERNEL de test\n');
  ecrire(root, 'framework/CONFIG.md', '# Configuration — mission : test\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| relances_max | 2 |\n');
  ecrire(root, 'framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\n');
  ecrire(root, 'framework/claude/instance-settings.json', '{}');
  ecrire(root, 'mission/concepteur/INBOX.md', '# INBOX — concepteur\n');
  for (const f of ['ROLE.md', 'MEMORY.md', 'INBOX.md']) ecrire(root, `mission/concepteur/enfant/${f}`, `# ${f}\n`);
  ecrire(root, 'mission/concepteur/enfant/STATUS.md', '| Champ | Valeur |\n|---|---|\n| État | READY |\n| Note |  |\n');
  ecrire(root, 'mission/registry/instances/concepteur-enfant.md', `# concepteur/enfant\n| Champ | Valeur |\n|---|---|\n| Statut | READY |\n| Budget alloué / consommé | 0 / 0 |\n| Profil | execution |\n${lignesFiche.join('\n')}\n`);
  ecrire(root, 'mission/registry/PROGRESS.md', '# Avancement\n');
  return root;
}

test(
  'point 4 : fiche passée au-delà du plafond pendant la session → ré-incarnation refusée, ALERT au parent, tâche failed',
  { skip: SKIP },
  () => {
    const launcher = require(SPAWN_JS);
    const root = racineRelance([]);
    const idTache = 'tache-relance-refusee';
    ecrire(root, `mission/.holarch/tasks/${idTache}.json`, JSON.stringify({ id: idTache, chemin: 'concepteur/enfant', state: 'running' }));
    let n = 0;
    const runner = () => {
      n += 1;
      // La session hiberne (contexte) avec progrès, après avoir porté sa fiche à 999 USD.
      ecrire(root, 'mission/concepteur/enfant/STATUS.md', '| Champ | Valeur |\n|---|---|\n| État | WORKING |\n| Note | hibernation volontaire (contexte) |\n');
      ecrire(root, `mission/concepteur/enfant/memoire/U${n}-x.md`, '# U\n');
      ecrire(root, 'mission/registry/instances/concepteur-enfant.md', '# concepteur/enfant\n| Champ | Valeur |\n|---|---|\n| Profil | execution |\n| Budget USD / session | 999 |\n');
      return { res: { session_id: 'relance-1111', tours: 1, cout_usd: 0.1, tokens: {}, modeles: [], fin: 'success', sous_type: 'success', refus: 0, statut_http: null, texte: '', brut: null }, elapsedMs: 5 };
    };
    const avant = process.env.HOLARCH_TASK_ID;
    try {
      const sessions = launcher.launchWithRelaunches(root, 'concepteur/enfant', {}, runner);
      assert.equal(n, 1, 'aucune seconde session lancée');
      const last = sessions[sessions.length - 1];
      assert.equal(last.arret && last.arret.motif, 'relance-refusee');
      assert.match(last.arret.texte, /budget_usd_session_max/);
      const inbox = fs.readFileSync(path.join(root, 'mission/concepteur/INBOX.md'), 'utf8');
      assert.match(inbox, /type: ALERT[\s\S]*ré-incarnation refusée/);
      const { text, code } = launcher.summarize(last.launch, sessions);
      assert.equal(code, 1);
      assert.match(text, /ré-incarnation refusée/);
      process.env.HOLARCH_TASK_ID = idTache;
      process.env.HOLARCH_TASK_CHEMIN = 'concepteur/enfant';
      launcher.finishLaunch(root, 'concepteur/enfant', code, sessions);
      const tache = JSON.parse(fs.readFileSync(path.join(root, `mission/.holarch/tasks/${idTache}.json`), 'utf8'));
      assert.equal(tache.state, 'failed');
    } finally {
      if (avant === undefined) delete process.env.HOLARCH_TASK_ID; else process.env.HOLARCH_TASK_ID = avant;
      delete process.env.HOLARCH_TASK_CHEMIN;
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test('D : --budget-usd repris par --reprendre et au réveil (surcharges de la dernière tâche, jamais --bootstrap)', { skip: SKIP }, () => {
  const { argsDerniereTache } = require(SPAWN_JS);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-args-'));
  try {
    assert.deepEqual(argsDerniereTache(root, 'x'), [], 'aucune tâche : aucune surcharge');
    ecrire(root, 'mission/.holarch/tasks/a.json', JSON.stringify({ id: 'a', chemin: 'x', startedAt: '2026-01-01T00:00:00Z', args: ['--budget-usd', '9'] }));
    ecrire(root, 'mission/.holarch/tasks/b.json', JSON.stringify({ id: 'b', chemin: 'x', startedAt: '2026-01-02T00:00:00Z', args: ['--bootstrap', '--budget-usd', '12', '--effort', 'low', '--forcer'] }));
    ecrire(root, 'mission/.holarch/tasks/c.json', JSON.stringify({ id: 'c', chemin: 'y', startedAt: '2026-01-03T00:00:00Z', args: ['--budget-usd', '3'] }));
    assert.deepEqual(argsDerniereTache(root, 'x'), ['--budget-usd', '12', '--effort', 'low']);
    const src = fs.readFileSync(SPAWN_JS, 'utf8');
    assert.match(src, /detachLaunch\(root, w\.chemin, \{ args: argsDerniereTache\(root, w\.chemin, \{ reveil: true, plafond: plafondReveil \}\) \}\)/, 'réveil câblé');
    assert.match(src, /detachLaunch\(root, t\.chemin, \{ parent: 'reprise', args: argsDerniereTache\(root, t\.chemin\) \}\)/, 'reprise câblée');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('revue n° 9 : au réveil, seul --budget-usd sous le plafond est repris ; --reprendre reprend tout', { skip: SKIP }, () => {
  const { argsDerniereTache } = require(SPAWN_JS);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-args-'));
  try {
    const essai = ['--effort', 'low', '--permission-mode', 'bypassPermissions', '--budget-usd', '40', '--profil', 'execution'];
    ecrire(root, 'mission/.holarch/tasks/e.json', JSON.stringify({ id: 'e', chemin: 'p/c', startedAt: '2026-01-01T00:00:00Z', args: essai }));
    assert.deepEqual(argsDerniereTache(root, 'p/c', { reveil: true, plafond: 20 }), [], 'essai ponctuel : rien de permanent, 40 > plafond 20');
    assert.deepEqual(argsDerniereTache(root, 'p/c'), essai, '--reprendre : même tâche, surcharges intactes');
    ecrire(root, 'mission/.holarch/tasks/f.json', JSON.stringify({ id: 'f', chemin: 'p/c', startedAt: '2026-01-02T00:00:00Z', args: ['--effort', 'low', '--budget-usd', '12'] }));
    assert.deepEqual(argsDerniereTache(root, 'p/c', { reveil: true, plafond: 20 }), ['--budget-usd', '12'], 'MSG-004 D : le budget sous plafond survit');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

const HOOKS_JS = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js');
const SKIP_HOOKS = fs.existsSync(HOOKS_JS) ? false : 'holarch-hooks.js absent à côté de ce test (paquet non appliqué)';

test('point 5 (pièce 2) : spawn-guard refuse d\'incarner un enfant dont la fiche porte 999 USD, laisse passer 12', { skip: SKIP_HOOKS }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-guard-'));
  try {
    const appel = (enfant, lignes) => {
      for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) ecrire(root, path.join('mission', 'concepteur', enfant, f), 'x');
      ecrire(root, path.join('mission', 'registry', 'instances', `concepteur-${enfant}.md`), `# concepteur/${enfant}\n| Champ | Valeur |\n|---|---|\n${lignes.join('\n')}\n`);
      const input = { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: `node framework/bin/holarch-spawn.js concepteur/${enfant}` } };
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.execPath, [HOOKS_JS, 'spawn-guard'], { input: JSON.stringify(input), encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' }) });
      assert.equal(r.status, 0, `hook : code ${r.status} ${r.stderr}`);
      const o = JSON.parse(r.stdout || '{}').hookSpecificOutput || {};
      return { decision: o.permissionDecision, motif: o.permissionDecisionReason || '' };
    };
    const refus = appel('cher', ['| Profil | execution |', '| Budget USD / session | 999 |']);
    assert.equal(refus.decision, 'deny');
    assert.match(refus.motif, /budget_usd_session_max/);
    assert.equal(appel('sobre', ['| Profil | execution |', '| Budget USD / session | 12 |']).decision, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('revue n° 50 : spawn-guard refuse --budget-usd au-delà du plafond ou illisible, laisse passer 12', { skip: SKIP_HOOKS }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-guard-cli-'));
  const { spawnSync } = require('child_process');
  try {
    for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) ecrire(root, path.join('mission', 'concepteur', 'x', f), 'x');
    ecrire(root, path.join('mission', 'registry', 'instances', 'concepteur-x.md'), '# concepteur/x\n| Champ | Valeur |\n|---|---|\n| Profil | execution |\n');
    const decision = (opts) => {
      const input = { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: `node framework/bin/holarch-spawn.js concepteur/x --detach ${opts}` } };
      const r = spawnSync(process.execPath, [HOOKS_JS, 'spawn-guard'], { input: JSON.stringify(input), encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' }) });
      return (JSON.parse(r.stdout || '{}').hookSpecificOutput || {}).permissionDecision;
    };
    assert.equal(decision('--budget-usd 999'), 'deny');
    assert.equal(decision('--budget-usd=999'), 'deny');
    assert.equal(decision('--budget-usd abc'), 'deny');
    assert.equal(decision('--budget-usd 12'), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('point 5 (pièce 3) : lancement réel refusé (fiche à 999) sous HOLARCH_FAKE_CLAUDE — code 1, aucune session', { skip: SKIP }, () => {
  const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
  const SCENARIO = path.join(__dirname, 'scenarios', 'livraison-simple.json');
  const root = racineRelance(['| Budget USD / session | 999 |']);
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [SPAWN_JS, 'concepteur/enfant', '--root', root], { encoding: 'utf8', cwd: root, timeout: 60000,
      env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO }) });
    assert.equal(r.status, 1, `code ${r.status}\nstderr=${r.stderr}`);
    assert.match(r.stderr, /budget_usd_session_max/);
    assert.equal(fs.existsSync(path.join(root, 'mission/registry/SESSIONS.md')), false, 'aucune session jouée');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('revue n° 6 : lanceur détaché (tâche) refusé dès la première session → tâche failed, ALERT au parent', { skip: SKIP }, () => {
  const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
  const SCENARIO = path.join(__dirname, 'scenarios', 'livraison-simple.json');
  const root = racineRelance(['| Budget USD / session | 999 |']);
  const idTache = 'tache-detache-refusee';
  ecrire(root, `mission/.holarch/tasks/${idTache}.json`, JSON.stringify({ id: idTache, chemin: 'concepteur/enfant', state: 'running' }));
  try {
    const { spawnSync } = require('child_process');
    const r = spawnSync(process.execPath, [SPAWN_JS, 'concepteur/enfant', '--root', root], { encoding: 'utf8', cwd: root, timeout: 60000,
      env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_TASK_ID: idTache, HOLARCH_TASK_CHEMIN: 'concepteur/enfant' }) });
    assert.equal(r.status, 1, `code ${r.status}\nstderr=${r.stderr}`);
    const tache = JSON.parse(fs.readFileSync(path.join(root, `mission/.holarch/tasks/${idTache}.json`), 'utf8'));
    assert.equal(tache.state, 'failed', 'tâche close, pas « running » au pid mort');
    const inbox = fs.readFileSync(path.join(root, 'mission/concepteur/INBOX.md'), 'utf8');
    assert.match(inbox, /type: ALERT[\s\S]*non lancé[\s\S]*budget_usd_session_max/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// -- Revue finale, n° 35 et 45 ----------------------------------------------------------------------

test('revue n° 35 : budget_usd_par_session illisible refusé, jamais 20 en silence ; défaut borné au plafond', () => {
  const r = budgetSession.resoudreBudget(null, null, { budget_usd_par_session: '8 USD', budget_usd_session_max: '10' });
  assert.match(r.refus || '', /budget_usd_par_session illisible/);
  assert.ok(r.usd <= 10, 'jamais au-delà du plafond déclaré');
  assert.equal(budgetSession.resoudreBudget(null, null, { budget_usd_session_max: '10' }).usd, 8, 'seconde revue n° 60 : défaut 8, borné au plafond');
  assert.equal(budgetSession.resoudreBudget(null, null, { budget_usd_par_session: '8' }).refus, null);
});

test('revue n° 45 : ligne optionnelle vide, « — » ou texte du gabarit = absente, jamais un refus', () => {
  for (const v of ['', '—', '-', '<optionnel : nombre positif ≤ budget_usd_session_max>']) {
    const r = budgetSession.resoudreBudget('| Budget USD / session | ' + v + ' |', null, { budget_usd_par_session: '8' });
    assert.deepEqual(r, { usd: 8, source: 'CONFIG', refus: null }, JSON.stringify(v));
  }
  assert.match(budgetSession.resoudreBudget('| Budget USD / session | beaucoup |', null, {}).refus, /illisible/);
});

// -- Seconde revue, n° 50 et 59 ---------------------------------------------------------------------

test('seconde revue n° 50 : option répétée et commande chaînée (&&, saut de ligne) refusées par spawn-guard', { skip: SKIP_HOOKS }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-guard-chaine-'));
  const { spawnSync } = require('child_process');
  try {
    for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) ecrire(root, path.join('mission', 'concepteur', 'x', f), 'x');
    ecrire(root, path.join('mission', 'registry', 'instances', 'concepteur-x.md'), '# concepteur/x\n| Champ | Valeur |\n|---|---|\n| Profil | execution |\n');
    const decision = (command) => {
      const input = { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command } };
      const r = spawnSync(process.execPath, [HOOKS_JS, 'spawn-guard'], { input: JSON.stringify(input), encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' }) });
      return (JSON.parse(r.stdout || '{}').hookSpecificOutput || {}).permissionDecision;
    };
    const lanceur = 'node framework/bin/holarch-spawn.js concepteur/x';
    assert.equal(decision(`${lanceur} --detach --budget-usd 5 --budget-usd 999`), 'deny', 'option répétée : la dernière compte');
    assert.equal(decision(`${lanceur} --detach --budget-usd 12 --budget-usd=999`), 'deny');
    assert.equal(decision(`${lanceur} --dry-run && ${lanceur} --detach --budget-usd 999`), 'deny', 'second segment contrôlé');
    assert.equal(decision(`${lanceur} --dry-run\n${lanceur} --detach --budget-usd 999`), 'deny', 'saut de ligne = séparateur');
    assert.equal(decision(`echo go\n${lanceur} --detach --budget-usd 999`), 'deny', 'invocation après un saut de ligne vue');
    assert.equal(decision(`${lanceur} --detach --budget-usd 5 --budget-usd 12`), undefined, 'deux valeurs sous le plafond : acceptées');
    assert.equal(decision(`${lanceur} --dry-run`), undefined);
    // Seconde revue n° 63 : --reprendre rejoue les surcharges du mainteneur (--budget-usd 40 > plafond 20).
    assert.equal(decision(`${lanceur} --reprendre`), 'deny', '--reprendre depuis une instance');
    assert.equal(decision('node framework/bin/holarch-spawn.js --reprendre concepteur/x'), 'deny');
    assert.equal(decision(`${lanceur} --reprendre --dry-run`), 'deny', 'le --dry-run ne rouvre pas --reprendre');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('seconde revue n° 59 : HOLARCH_TASK_ID hérité (sans HOLARCH_TASK_CHEMIN de l\'instance) ne clôt pas la tâche du parent', { skip: SKIP }, () => {
  const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
  const SCENARIO = path.join(__dirname, 'scenarios', 'livraison-simple.json');
  const root = racineRelance(['| Budget USD / session | 999 |']);
  const idParent = 'concepteur-111';
  ecrire(root, `mission/.holarch/tasks/${idParent}.json`, JSON.stringify({ id: idParent, chemin: 'concepteur', pid: process.pid, state: 'running' }));
  try {
    const { spawnSync } = require('child_process');
    for (const extra of [{}, { HOLARCH_TASK_CHEMIN: 'concepteur' }]) {
      const r = spawnSync(process.execPath, [SPAWN_JS, 'concepteur/enfant', '--root', root], { encoding: 'utf8', cwd: root, timeout: 60000,
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_TASK_ID: idParent }, extra) });
      assert.equal(r.status, 1, `code ${r.status}\nstderr=${r.stderr}`);
      const tache = JSON.parse(fs.readFileSync(path.join(root, `mission/.holarch/tasks/${idParent}.json`), 'utf8'));
      assert.equal(tache.state, 'running', `tâche du parent intacte (${JSON.stringify(extra)})`);
      const inbox = fs.readFileSync(path.join(root, 'mission/concepteur/INBOX.md'), 'utf8');
      assert.doesNotMatch(inbox, /type: ALERT/, 'aucune ALERT « lancement détaché refusé » pour un lancement synchrone');
      assert.deepEqual(fs.readdirSync(path.join(root, 'mission/.holarch/tasks')), [`${idParent}.json`], 'aucune tâche créée par un réveil');
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('seconde revue n° 59 : la session d\'un lanceur détaché n\'hérite ni de HOLARCH_TASK_ID ni de HOLARCH_TASK_CHEMIN', { skip: SKIP }, () => {
  const launcher = require(SPAWN_JS);
  const root = racineRelance([]);
  const avant = { id: process.env.HOLARCH_TASK_ID, ch: process.env.HOLARCH_TASK_CHEMIN, fake: process.env.HOLARCH_FAKE_CLAUDE };
  try {
    process.env.HOLARCH_FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
    process.env.HOLARCH_TASK_ID = 'concepteur-enfant-1';
    process.env.HOLARCH_TASK_CHEMIN = 'concepteur/enfant';
    const launch = launcher.prepareLaunch(root, 'concepteur/enfant', {});
    assert.equal(launch.env.HOLARCH_TASK_ID, undefined);
    assert.equal(launch.env.HOLARCH_TASK_CHEMIN, undefined);
    assert.equal(launch.env.HOLARCH_INSTANCE, 'concepteur/enfant');
  } finally {
    for (const [k, v] of [['HOLARCH_TASK_ID', avant.id], ['HOLARCH_TASK_CHEMIN', avant.ch], ['HOLARCH_FAKE_CLAUDE', avant.fake]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -- Seconde revue, n° 60, 61, 62 -----------------------------------------------------------------------

test('seconde revue n° 60 : budget_usd_par_session absent ou vide → défaut documenté 8 (borné au plafond), jamais 20', () => {
  for (const p of [{}, { budget_usd_par_session: '' }, { budget_usd_par_session: '  ' }]) {
    assert.deepEqual(budgetSession.resoudreBudget(null, null, p), { usd: 8, source: 'CONFIG', refus: null }, JSON.stringify(p));
  }
  assert.equal(budgetSession.resoudreBudget(null, null, { budget_usd_par_session: '', budget_usd_session_max: '5' }).usd, 5);
});

test('seconde revue n° 61 : budget_usd_session_max illisible → refus, jamais le plafond 20 en silence', () => {
  for (const v of ['10 USD', 'dix', '-3', '0']) {
    const r = budgetSession.resoudreBudget('| Budget USD / session | 18 |', null, { budget_usd_session_max: v });
    assert.match(r.refus || '', /budget_usd_session_max illisible/, v);
    assert.match(budgetSession.resoudreBudget(null, '5', { budget_usd_session_max: v }).refus || '', /budget_usd_session_max/, `CLI, ${v}`);
  }
  assert.equal(budgetSession.resoudreBudget(null, null, { budget_usd_session_max: '' }).refus, null, 'vide = absent');
  assert.equal(budgetSession.resoudreBudget(null, null, { budget_usd_session_max: '10,5' }).refus, null);
});

test('seconde revue n° 61 : spawn-guard refuse tout lancement d\'enfant sous un budget_usd_session_max illisible', { skip: SKIP_HOOKS }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-guard-max-'));
  const { spawnSync } = require('child_process');
  try {
    for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) ecrire(root, path.join('mission', 'concepteur', 'x', f), 'x');
    ecrire(root, path.join('mission', 'registry', 'instances', 'concepteur-x.md'), '# concepteur/x\n| Champ | Valeur |\n|---|---|\n| Profil | execution |\n| Budget USD / session | 18 |\n');
    const decision = (max) => {
      ecrire(root, path.join('framework', 'CONFIG.md'), `# Configuration\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| budget_usd_session_max | ${max} |\n`);
      const input = { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'node framework/bin/holarch-spawn.js concepteur/x --detach' } };
      const r = spawnSync(process.execPath, [HOOKS_JS, 'spawn-guard'], { input: JSON.stringify(input), encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' }) });
      return (JSON.parse(r.stdout || '{}').hookSpecificOutput || {}).permissionDecision;
    };
    assert.equal(decision('10 USD'), 'deny', 'fiche 18 passée sous un plafond illisible');
    assert.equal(decision('20'), undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('seconde revue n° 62 : --budget-usd 16,5 accepté au lancement est repris au réveil (même lecture que le lanceur)', { skip: SKIP }, () => {
  const { argsDerniereTache } = require(SPAWN_JS);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-budget-args-virgule-'));
  try {
    ecrire(root, 'mission/.holarch/tasks/a.json', JSON.stringify({ id: 'a', chemin: 'x', startedAt: '2026-01-01T00:00:00Z', args: ['--budget-usd', '16,5'] }));
    assert.deepEqual(argsDerniereTache(root, 'x', { reveil: true, plafond: 20 }), ['--budget-usd', '16,5']);
    assert.deepEqual(argsDerniereTache(root, 'x', { reveil: true, plafond: 16 }), [], 'au-delà du plafond : non repris');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
