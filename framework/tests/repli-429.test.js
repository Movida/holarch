'use strict';
/**
 * Repli sur limite de sessions de l'API — chantier 9, volet 3 (`docs/IMPLEMENTATION.md` §11.3).
 *
 * Ce que ces tests mesurent, et pourquoi c'est mesurable sans clé ni réseau : le lanceur est conduit
 * par `launchWithRelaunches` avec le seam `HOLARCH_FAKE_CLAUDE` (exécuteur `fake`, volet 1), qui rend
 * un 429 puis une réussite. Le catalogue, lui, est réel : c'est la table `## Fournisseurs` du CONFIG.md
 * de test qui déclare le `Secours`, et la table `## Catalogue de modèles` qui déclare l'`Équivalent`.
 *
 * La preuve qu'il n'y a **pas d'attente** ne se lit pas dans un message mais dans l'horloge :
 * `HOLARCH_ATTENTE_429_MS` est posée à 30 s, et les tests de repli terminent en moins d'une seconde.
 * Si la branche de repli disparaissait, ils dureraient une demi-minute puis échoueraient sur le budget
 * de temps — un test qui se contenterait de lire `sessions.length` ne verrait pas la différence.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { launchWithRelaunches } = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));
const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const SCENARIOS = path.join(__dirname, 'scenarios');

/** `anthropic` a un secours ; `opus` a un équivalent chez lui, `sonnet` n'en a pas. C'est toute la
 *  matière du volet 3 : le repli existe pour un modèle donné, pas pour un fournisseur en bloc. */
const CONFIG = `# Configuration — mission : test-repli
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| profondeur_max | 2 |
| isolation | aucune |
| commit_par_session | non |
| relances_max | 2 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | sonnet | medium |

## Fournisseurs
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | secours-test |
| secours-test | passerelle | HOLARCH_FOURNISSEUR_SECOURS_URL | HOLARCH_FOURNISSEUR_SECOURS_JETON | — |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| opus | anthropic | claude-opus-5 | low…max | 15 / 75 | conception | opus@secours |
| sonnet | anthropic | claude-sonnet-5 | low…high | 3 / 15 | execution | — |
| opus@secours | secours-test | anthropic/claude-opus-5 | — | 20 / 80 | conception | — |
`;

function fiche(profil) {
  return `# x\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | — |\n| Statut | READY |\n`
    + `| Budget alloué / consommé | 3 / 0 |\n| Dépend de | — |\n| Profil | ${profil} |\n| Livrables | — |\n`
    + '| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n';
}

/** Racine jetable, sur le modèle de `B4-scenarios.test.js` : Git initialisé (le lanceur mesure le
 *  progrès par l'historique), SESSIONS.md volontairement absent — c'est `ensureSessionsFile` qui doit
 *  écrire l'en-tête à treize colonnes, colonne « Fournisseur / modèle réel » comprise. */
function makeRoot(profil) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-repli-'));
  const w = (rel, contenu) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, contenu);
  };
  w('framework/KERNEL.md', '# KERNEL\n(stub de test — présence seule requise par findRoot)\n');
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
  w('mission/registry/instances/x.md', fiche(profil));
  w('mission/registry/ORG.md', '# Organisation\n- x (READY)\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

/** Lignes de session (hors en-tête et légende) de SESSIONS.md. */
function lignes(root) {
  const txt = fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8');
  return txt.split('\n').filter((l) => /^\| 2\d{3}-/.test(l));
}

/** Pose le seam `fake`, le scénario et l'attente forcée, puis restaure l'environnement. */
function avecScenario(nom, attenteMs, fn) {
  const cles = {
    HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE,
    HOLARCH_FAKE_SCENARIO: path.join(SCENARIOS, `${nom}.json`),
    HOLARCH_ATTENTE_429_MS: String(attenteMs),
  };
  const avant = {};
  for (const [k, v] of Object.entries(cles)) { avant[k] = process.env[k]; process.env[k] = v; }
  const compteur = `${cles.HOLARCH_FAKE_SCENARIO}.attempt`;
  try { fs.unlinkSync(compteur); } catch (_) { /* premier appel */ }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { fs.unlinkSync(compteur); } catch (_) { /* rien à nettoyer */ }
  }
}

test('429 avec un équivalent chez le secours : relance immédiate, sans attente, ligne marquée « repli depuis »', () => {
  const root = makeRoot('conception'); // politique : opus @ anthropic, équivalent opus@secours
  const t0 = Date.now();
  const sessions = avecScenario('repli-429', 30000, () => launchWithRelaunches(root, 'x', {}));
  const ecoule = Date.now() - t0;

  assert.equal(sessions.length, 2, 'une session refusée (429) puis une session de repli');
  assert.ok(ecoule < 5000, `aucune attente attendue, ${ecoule} ms écoulés pour HOLARCH_ATTENTE_429_MS=30000`);

  const l = lignes(root);
  assert.equal(l.length, 2);
  // Session 1 : chez le fournisseur principal, refusée, sans marque de repli.
  assert.match(l[0], /\| opus\/high \|/);
  assert.match(l[0], /\| anthropic \/ claude-opus-5 \|/);
  assert.doesNotMatch(l[0], /repli depuis/);
  // Session 2 : le repli lui-même — modèle équivalent, fournisseur de secours, marque dans « Fin ».
  assert.match(l[1], /\| opus@secours\/high \|/);
  assert.match(l[1], /\| secours-test \/ anthropic\/claude-opus-5 \|/);
  assert.match(l[1], /repli depuis anthropic/);
  // La session de repli a bien eu lieu : elle a livré, et elle n'est comptée ni comme relance ni comme
  // arrêt — `launchWithRelaunches` rend la main sur un STATUS final, pas sur un motif d'arrêt.
  assert.equal(sessions[1].status.etat, 'DELIVERED');
  assert.equal(sessions[1].arret, undefined);
  fs.rmSync(root, { recursive: true, force: true });
});

test('429 sans équivalent au catalogue : comportement d\'attente inchangé (au plus 3 reprises)', () => {
  const root = makeRoot('execution'); // politique : sonnet @ anthropic, colonne Équivalent vide
  const sessions = avecScenario('repli-429-partout', 0, () => launchWithRelaunches(root, 'x', {}));

  assert.equal(sessions.length, 4, '3 reprises après attente, puis arrêt à la 4ᵉ');
  assert.equal(sessions[3].arret.motif, 'limite-api');
  for (const l of lignes(root)) {
    assert.match(l, /\| anthropic \/ claude-sonnet-5 \|/);
    assert.doesNotMatch(l, /repli depuis/, 'sans équivalent déclaré, aucune session ne part chez le secours');
  }
  fs.rmSync(root, { recursive: true, force: true });
});

test('un seul repli par invocation : le secours qui refuse à son tour retombe sur l\'attente', () => {
  const root = makeRoot('conception');
  const sessions = avecScenario('repli-429-partout', 0, () => launchWithRelaunches(root, 'x', {}));

  // 1 session chez anthropic, 1 repli immédiat, puis 3 reprises après attente chez le secours et arrêt.
  assert.equal(sessions.length, 5);
  assert.equal(sessions[4].arret.motif, 'limite-api');
  const l = lignes(root);
  assert.doesNotMatch(l[0], /repli depuis/);
  // Le repli vaut pour le reste de l'invocation : rien n'est réécrit sur disque, mais le lanceur ne
  // renvoie pas l'instance chez le fournisseur qui vient de la refuser au seul motif qu'une tentative
  // de plus a eu lieu. Un nouvel appel au lanceur, lui, repartira bien d'`anthropic` (pas d'état).
  for (const ligne of l.slice(1)) {
    assert.match(ligne, /\| secours-test \/ anthropic\/claude-opus-5 \|/);
    assert.match(ligne, /repli depuis anthropic/);
  }
  fs.rmSync(root, { recursive: true, force: true });
});

// -- Bootstrap refusé par 429 : la tentative de repli reste un bootstrap ----------------------------
// holarch-passerelle, 2026-09-11 23:14 UTC : premier 429 réel au --bootstrap, repli vers OpenRouter décidé,
// puis plantage « ROLE.md introuvable » — la tentative suivante repartait comme instance ordinaire alors que
// la racine n'existait pas encore (aucune session n'avait eu lieu). Ici sans exécuteur factice : un runner
// direct rend le 429 puis un succès, et c'est le prompt de la seconde tentative qui prouve le bootstrap.
test('--bootstrap refusé par 429 : la tentative de repli est encore un bootstrap (pas de ROLE.md exigé)', () => {
  const root = makeRoot('conception');
  fs.rmSync(path.join(root, 'mission', 'x'), { recursive: true, force: true }); // aucune racine incarnée
  fs.writeFileSync(path.join(root, 'framework', 'BOOTSTRAP.md'), '# BOOTSTRAP de test\n');
  const RES_429 = { type: 'result', subtype: 'success', session_id: 'boot-429', total_cost_usd: 0, num_turns: 1,
    usage: {}, is_error: true, api_error_status: 429, result: "You've hit your session limit · resets 1am (UTC)" };
  const RES_OK = { type: 'result', subtype: 'success', session_id: 'boot-ok', total_cost_usd: 0.2, num_turns: 3,
    usage: {}, is_error: false };
  let n = 0;
  const runner = () => { n += 1; return { res: n === 1 ? RES_429 : RES_OK, elapsedMs: 10 }; };
  // Runner direct (pas le seam `fake`) ; l'attente 429 est bornée par sécurité, le repli ne doit pas l'atteindre.
  // Variables du secours posées : depuis 1.16.3 un secours atteignable sans elles est refusé avant toute session.
  const envAvant = {};
  for (const [k, v] of Object.entries({ HOLARCH_ATTENTE_429_MS: '30000', HOLARCH_FOURNISSEUR_SECOURS_URL: 'https://secours.invalid', HOLARCH_FOURNISSEUR_SECOURS_JETON: 'jeton-de-test' })) { envAvant[k] = process.env[k]; process.env[k] = v; }
  let sessions;
  try { sessions = launchWithRelaunches(root, 'concepteur', { bootstrap: true }, runner); }
  finally { for (const [k, v] of Object.entries(envAvant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
  assert.equal(n, 2, `le 429 puis la session de repli (runner appelé ${n} fois)`);
  assert.equal(sessions.length, 2);
  for (const s of sessions) {
    assert.match(s.launch.prompt, /première session de cette mission/, 'les deux tentatives sont des bootstraps');
    assert.match(s.launch.systemPrompt, /BOOTSTRAP de test/);
  }
  assert.equal(sessions[0].launch.meta.fournisseur, 'anthropic');
  assert.equal(sessions[1].launch.meta.fournisseur, 'secours-test');
  assert.match(lignes(root)[1], /repli depuis anthropic/);
  fs.rmSync(root, { recursive: true, force: true });
});

// -- 1.19.1 : le lanceur détaché reçoit les options de la ligne de commande ----------------------------
// holarch-modeles, 2026-09-12 : `--bootstrap --detach` relançait `[chemin]` nu → « ROLE.md introuvable ».
test('argsRelance : --bootstrap et les options de session sont transmis, jamais --detach/--dry-run', () => {
  const { argsRelance, detachLaunch } = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));
  assert.deepEqual(argsRelance({ bootstrap: true, detach: true, dryRun: true }), ['--bootstrap']);
  assert.deepEqual(argsRelance({ modele: 'sonnet', effort: 'low', budget: '2', maxTours: 30, forcer: true, addDir: ['/x'] }),
    ['--forcer', '--modele', 'sonnet', '--effort', 'low', '--budget-usd', '2', '--max-tours', '30', '--add-dir', '/x']);
  assert.deepEqual(argsRelance({}), []);
  // La fiche de tâche garde les arguments transmis (lecture par --taches et par l'observation).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-detach-'));
  const { id, pid } = detachLaunch(root, 'concepteur', { args: ['--bootstrap'] });
  assert.ok(pid > 0);
  const fiche = JSON.parse(fs.readFileSync(path.join(root, 'mission', '.holarch', 'tasks', `${id}.json`), 'utf8'));
  assert.deepEqual(fiche.args, ['--bootstrap']);
  try { process.kill(pid, 'SIGKILL'); } catch (_) { /* déjà mort : racine sans framework */ }
  fs.rmSync(root, { recursive: true, force: true });
});

// -- 1.19.4 : jamais deux lanceurs pour la même instance ------------------------------------------------------
test('tacheVivantePour + refus de lancement : une tâche « running » au pid vivant bloque un second lanceur, sauf --forcer', () => {
  const { tacheVivantePour } = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));
  const root = makeRoot('execution');
  const dir = path.join(root, 'mission', '.holarch', 'tasks');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'x-1.json'), JSON.stringify({ id: 'x-1', chemin: 'x', pid: process.pid, state: 'running' }));
  fs.writeFileSync(path.join(dir, 'x-0.json'), JSON.stringify({ id: 'x-0', chemin: 'x', pid: 999999999, state: 'running' }));
  assert.equal(tacheVivantePour(root, 'x').id, 'x-1', 'la fiche au pid vivant, pas celle au pid mort');
  assert.equal(tacheVivantePour(root, 'autre'), null);
  const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'), 'x', '--detach'], { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /déjà lancée \(tâche x-1, pid \d+ vivant\)/);
  assert.equal(fs.readdirSync(dir).filter((f) => f.endsWith('.json')).length, 2, 'aucune fiche de tâche créée');
  fs.rmSync(root, { recursive: true, force: true });
});

