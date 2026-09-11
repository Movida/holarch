'use strict';
/**
 * B4-scenarios.test.js — chantier 5 (banc de mesure), étage à sec.
 * Joue les 7 scénarios nommés (docs/IMPLEMENTATION.md §6.1) sur le vrai seam HOLARCH_FAKE_CLAUDE
 * (fake-claude.js de ce même répertoire, copie étendue avec `etapes`/`crash`), à travers les vraies
 * fonctions exportées par holarch-spawn.js (`launchWithRelaunches`, `summarize`) — jamais de doublure
 * de `runOnce` : on veut vérifier le harnais réel, pas une simulation de son comportement.
 *
 * Ce fichier est prévu pour être installé par `appliquer.js` à `framework/tests/B4-scenarios.test.js`,
 * aux côtés de la copie de `fake-claude.js` (qui remplace l'original, `etapes`/`crash` en plus du
 * format déjà existant) et des scénarios sous `framework/tests/scenarios/`. Pour le vérifier depuis ce
 * répertoire de staging avant application, copier `cible-framework/{bin,tests}` dans un dossier
 * scratch imitant la racine du dépôt puis lancer `node --test` dessus (voir README du paquet).
 *
 * `launchWithRelaunches(root, chemin, opts, runner)` est **synchrone** (spawnSync) et retourne
 * directement le tableau `sessions` — jamais `{launch, sessions}`. `summarize(launch, sessions)`
 * attend en premier argument le `launch` de la **dernière** tentative (`sessions[sessions.length-1]
 * .launch`, jamais un `launch` isolé) et retourne `{text, code}` (anglais, pas `texte`) — usage exact
 * calqué sur `main()` (holarch-spawn.js, fin de fichier).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const spawnMod = require('../bin/holarch-spawn.js');
const { launchWithRelaunches, summarize, detachLaunch, isLive, wakeWaiters, parseFiche } = spawnMod;

const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const SCENARIOS_DIR = path.join(__dirname, 'scenarios');

const CONFIG_MD = (overrides = {}) => `# Configuration — mission : banc-test
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | unites-indexees |
| 4 | recursion | max-depth |
| 5 | recursion | instance-budget |
| 6 | recursion | context-budget |
| 7 | conflits | typed-escalation |
| 8 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 8 |
| profondeur_max | 3 |
| commit_par_session | non |
| budget_usd_par_session | 5 |
| max_tours_par_session | 200 |
| seuil_contexte_tokens | 120000 |
| sessions_max_par_instance | ${overrides.sessions_max_par_instance || 24} |
| relances_max | ${overrides.relances_max === undefined ? 2 : overrides.relances_max} |
| mode_attente | ${overrides.mode_attente || 'synchrone'} |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| execution | sonnet | medium |
| exploration | fable | xhigh |
`;

function makeRoot(overrides) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-b4-'));
  fs.mkdirSync(path.join(root, 'framework'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'KERNEL.md'), '# KERNEL\n(stub de test — présence seule requise par findRoot)\n');
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), CONFIG_MD(overrides));
  fs.mkdirSync(path.join(root, 'mission', 'x'), { recursive: true });
  fs.mkdirSync(path.join(root, 'mission', 'registry', 'instances'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', 'x', 'ROLE.md'), '# ROLE\nTest.\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'MEMORY.md'), '# Mémoire\n(vide)\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'INBOX.md'), '# Inbox\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'OUTBOX.md'), '# Outbox\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'JOURNAL.md'), '# Journal\n');
  fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), status('READY'));
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'instances', 'x.md'), fiche('x', { alloue: 3, consomme: 0 }));
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'ORG.md'), '# Organisation\n- x (READY)\n');
  fs.writeFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), sessionsHeader());
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

function status(etat, note, reveilTxt) {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note | ${note || ''} |\n| Réveil | ${reveilTxt || '—'} |\n`;
}

function fiche(chemin, { alloue = 3, consomme = 0, profil = 'execution', effort } = {}) {
  const effortLigne = effort ? `| Effort | ${effort} |\n` : '';
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | — |\n| Statut | READY |\n| Budget alloué / consommé | ${alloue} / ${consomme} |\n| Dépend de | — |\n| Profil | ${profil} |\n${effortLigne}| Livrables | — |\n| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n`;
}

function sessionsHeader() {
  return '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée / cache lu / cache écrit / sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) | Contexte (départ / max) |\n'
    + '|---|---|---|---|---|---|---|---|---|---|---|---|\n';
}

function readStatus(root) {
  return fs.readFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), 'utf8');
}

function readSessions(root) {
  return fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8');
}

function scenarioPath(nom) {
  return path.join(SCENARIOS_DIR, `${nom}.json`);
}

// Doit rester `async` et `await fn()` (pas `return fn()`) : le scénario enfant-detache-reveil suspend
// réellement (waitFor/wakeWaiters différé) — un simple `return fn()` rendrait la main dès la première
// suspension interne et exécuterait le `finally` (retrait des variables HOLARCH_FAKE_*) avant la fin
// réelle du scénario, cassant l'appel différé au seam (le second wakeWaiters tenterait le vrai `claude`).
async function withFakeClaude(nom, fn) {
  const before = { HOLARCH_FAKE_CLAUDE: process.env.HOLARCH_FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: process.env.HOLARCH_FAKE_SCENARIO };
  process.env.HOLARCH_FAKE_CLAUDE = FAKE_CLAUDE;
  process.env.HOLARCH_FAKE_SCENARIO = scenarioPath(nom);
  const attempt = `${scenarioPath(nom)}.attempt`;
  try { fs.unlinkSync(attempt); } catch (_) { /* pas encore de compteur */ }
  try {
    return await fn();
  } finally {
    if (before.HOLARCH_FAKE_CLAUDE === undefined) delete process.env.HOLARCH_FAKE_CLAUDE; else process.env.HOLARCH_FAKE_CLAUDE = before.HOLARCH_FAKE_CLAUDE;
    if (before.HOLARCH_FAKE_SCENARIO === undefined) delete process.env.HOLARCH_FAKE_SCENARIO; else process.env.HOLARCH_FAKE_SCENARIO = before.HOLARCH_FAKE_SCENARIO;
    try { fs.unlinkSync(attempt); } catch (_) { /* rien à nettoyer */ }
  }
}

async function waitFor(pred, { timeoutMs = 4000, stepMs = 25 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (await pred()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

test('livraison-simple : une session, code 0, DELIVERED, ligne SESSIONS.md complète', async () => {
  const root = makeRoot();
  await withFakeClaude('livraison-simple', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 0);
    assert.equal(sessions.length, 1);
    assert.match(readStatus(root), /\| État \| DELIVERED \|/);
    const lignes = readSessions(root).trim().split('\n');
    assert.equal(lignes.length, 3);
    assert.match(lignes[2], /sess-livraison-simple|x/);
  });
});

test('hibernation-puis-livraison : deux sessions, marqueur MEMORY.md propagé au prompt', async () => {
  const root = makeRoot();
  await withFakeClaude('hibernation-puis-livraison', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 0);
    assert.equal(sessions.length, 2);
    assert.equal(fs.readFileSync(path.join(root, 'mission', 'x', 'MEMORY.md'), 'utf8').includes('MARQUEUR-U-HIBERNATION-42'), true);
    const promptSecondeSession = JSON.stringify(sessions[1].launch || sessions[1]);
    assert.match(promptSecondeSession, /MARQUEUR-U-HIBERNATION-42|MEMORY/);
    assert.match(readStatus(root), /\| État \| DELIVERED \|/);
  });
});

test('contexte-instantane : cellule SESSIONS.md remplie depuis le fichier live, fichier supprimé', async () => {
  const root = makeRoot();
  await withFakeClaude('contexte-instantane', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 0);
    assert.match(readSessions(root), /45000 \/ 98000/);
    assert.equal(fs.existsSync(path.join(root, 'mission', '.holarch', 'live', 'x.contexte.json')), false);
  });
});

test('changement-de-regime : deux régimes distincts, compteur relances non consommé', async () => {
  const root = makeRoot({ relances_max: 0 });
  await withFakeClaude('changement-de-regime', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 0);
    assert.equal(sessions.length, 2);
    const fiche1 = parseFiche(fs.readFileSync(path.join(root, 'mission', 'registry', 'instances', 'x.md'), 'utf8'));
    assert.equal(fiche1.profil || fiche1.Profil, 'exploration');
    assert.match(readStatus(root), /\| État \| DELIVERED \|/);
  });
});

test('crash-sans-json : res=null, code 2, ligne SESSIONS.md quand même écrite', async () => {
  const root = makeRoot({ relances_max: 0 });
  await withFakeClaude('crash-sans-json', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 2);
    assert.equal(sessions.length >= 1, true);
    const lignes = readSessions(root).trim().split('\n');
    assert.equal(lignes.length >= 3, true);
  });
});

test('budget-epuise : is_error=true, code 2, texte lisible', async () => {
  const root = makeRoot({ relances_max: 0 });
  await withFakeClaude('budget-epuise', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code, text } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 2);
    assert.equal(typeof text === 'string' && text.length > 0, true);
  });
});

test("enfant-detache-reveil : wakeWaiters ne lance qu'une fois la condition satisfaite", async () => {
  const root = makeRoot({ mode_attente: 'detache' });
  await withFakeClaude('enfant-detache-reveil', async () => {
    fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), status('WAITING_CHILDREN', '', 'fichier:mission/x/.pret'));
    // Condition non satisfaite : wakeWaiters ne doit rien déclencher (déclencheur '--reveil', jamais
    // 'x' elle-même — wakeWaiters(root, declencheur) saute toujours w.chemin === declencheur).
    const avant = wakeWaiters(root, '--reveil');
    assert.equal(avant.length, 0);
    assert.equal(isLive(root, 'x'), false);
    assert.match(readStatus(root), /\| État \| WAITING_CHILDREN \|/);
    // Condition satisfaite : wakeWaiters déclenche detachLaunch en interne, qui va jusqu'à DELIVERED.
    fs.writeFileSync(path.join(root, 'mission', 'x', '.pret'), 'ok');
    const reveilles = wakeWaiters(root, '--reveil');
    assert.equal(reveilles.length, 1);
    assert.equal(reveilles[0].chemin, 'x');
    const devenuDelivered = await waitFor(() => readStatus(root).includes('| État | DELIVERED |'), { timeoutMs: 8000 });
    assert.equal(devenuDelivered, true);
  });
});

test('arret-demande : une session, hibernation volontaire (arrêt demandé), code 0', async () => {
  const root = makeRoot();
  await withFakeClaude('arret-demande', () => {
    const sessions = launchWithRelaunches(root, 'x', {});
    const { code } = summarize(sessions[sessions.length - 1].launch, sessions);
    assert.equal(code, 0);
    assert.equal(sessions.length, 1);
    assert.match(readStatus(root), /hibernation volontaire \(arrêt demandé\)/);
  });
});
