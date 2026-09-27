'use strict';
/**
 * attente-429.test.js — chantier 16, §18.3 (docs/IMPLEMENTATION.md). Module autonome
 * (`framework/bin/attente-limite.js`), testé directement (`require('../bin/attente-limite.js')`,
 * chemin identique une fois promu sous `framework/bin/`) : `attendreInterruptible` et `motifFin`.
 * Les tests de scénario, eux, exigent le lanceur patché (`holarch-spawn.js` à côté de ce test) : ils
 * lancent un vrai sous-processus (`spawn`), seule façon de poser un fichier stop pendant que le
 * processus visé est bloqué dans `Atomics.wait` — `skip` hors clone, même détection que
 * `budget-watch.test.js`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync, execFileSync } = require('child_process');

const attenteLimite = require(path.join(__dirname, '..', 'bin', 'attente-limite.js'));
// Troisième revue n° 77 : ces tests jouent le lanceur du mainteneur ; lancés depuis la session d'une instance, ils
// hériteraient de sa HOLARCH_INSTANCE et le lanceur appliquerait les refus faits aux instances (refusInstance).
delete process.env.HOLARCH_INSTANCE;

// -- attendreInterruptible / motifFin : vérifications directes -------------------------------------

test('attendreInterruptible : ms <= 0 rend « fini » immédiatement, sans écrire attenteFile', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
  const attenteFile = path.join(dir, 'x.attente.json');
  assert.equal(attenteLimite.attendreInterruptible({ ms: 0, attenteFile }), 'fini');
  assert.equal(fs.existsSync(attenteFile), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('attendreInterruptible : attente complète sans fichier stop → « fini », attenteFile écrit puis supprimé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
  const attenteFile = path.join(dir, 'sous', 'x.attente.json');
  let vuPendant = null;
  // Une tranche plus longue que `ms` : une seule tranche suffit, on vérifie le fichier juste après coup
  // (le process est mono-thread : impossible de lire pendant l'Atomics.wait lui-même).
  const t0 = Date.now();
  const issue = attenteLimite.attendreInterruptible({
    ms: 120, trancheMs: 50, attenteFile, info: { motif: 'test', tentative: 1 },
  });
  const elapsed = Date.now() - t0;
  assert.equal(issue, 'fini');
  assert.ok(elapsed >= 100, `au moins ~120 ms écoulées (mesuré ${elapsed})`);
  assert.equal(fs.existsSync(attenteFile), false, 'supprimé après coup');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('attendreInterruptible : {pid, jusqua, motif, tentative} au bon format pendant l\'attente', () => {
  // On rend l'attente assez longue pour lire le fichier une fois la première tranche passée, en
  // relançant l'appel dans un sous-processus détaché du test (Atomics.wait bloque tout le thread) :
  // c'est exactement le rôle des tests de scénario ci-dessous. Ici on vérifie seulement le contenu
  // écrit juste avant l'attente, sans dépendre d'un accès concurrent : `ms` très court, lu après coup
  // n'est plus possible (fichier supprimé) — donc vérification du format via un `stopFile` déjà
  // présent, qui interrompt après la première tranche mais laisse le temps d'observer l'écriture par
  // une inspection synchrone n'est pas non plus possible en un seul thread. On vérifie donc le format
  // via le sous-processus des tests de scénario (assertion complète là-bas) ; ici seulement l'absence
  // de plantage sur `info` incomplet ou absent.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
  const attenteFile = path.join(dir, 'x.attente.json');
  assert.doesNotThrow(() => attenteLimite.attendreInterruptible({ ms: 10, attenteFile }));
  assert.doesNotThrow(() => attenteLimite.attendreInterruptible({ ms: 10, attenteFile, info: { motif: 'm', tentative: 2 } }));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('attendreInterruptible : fichier stop déjà présent avant la première tranche → « arret » avant la fin de ms', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
  const stopFile = path.join(dir, 'stop');
  const attenteFile = path.join(dir, 'x.attente.json');
  fs.writeFileSync(stopFile, 'stop\n');
  const t0 = Date.now();
  const issue = attenteLimite.attendreInterruptible({
    ms: 5000, trancheMs: 20, stopFile, attenteFile,
  });
  const elapsed = Date.now() - t0;
  assert.equal(issue, 'arret');
  assert.ok(elapsed < 500, `interrompu bien avant les 5000 ms demandées (mesuré ${elapsed} ms, tranche 20 ms)`);
  assert.equal(fs.existsSync(attenteFile), false, 'attenteFile supprimé quelle que soit l\'issue');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('attendreInterruptible : sans stopFile, jamais « arret » (attente complète)', () => {
  const issue = attenteLimite.attendreInterruptible({ ms: 30, trancheMs: 10 });
  assert.equal(issue, 'fini');
});

test('attendreInterruptible : tranche par défaut 5000 ms, HOLARCH_ATTENTE_TRANCHE_MS honorée si trancheMs omis', () => {
  assert.equal(attenteLimite.TRANCHE_DEFAUT_MS, 5000);
  const avant = process.env.HOLARCH_ATTENTE_TRANCHE_MS;
  process.env.HOLARCH_ATTENTE_TRANCHE_MS = '15';
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
    const stopFile = path.join(dir, 'stop');
    fs.writeFileSync(stopFile, 'stop\n');
    const t0 = Date.now();
    const issue = attenteLimite.attendreInterruptible({ ms: 5000, stopFile });
    const elapsed = Date.now() - t0;
    assert.equal(issue, 'arret');
    assert.ok(elapsed < 500, `tranche de 15 ms (variable d'env) honorée sans trancheMs explicite (mesuré ${elapsed} ms)`);
    fs.rmSync(dir, { recursive: true, force: true });
  } finally {
    if (avant === undefined) delete process.env.HOLARCH_ATTENTE_TRANCHE_MS; else process.env.HOLARCH_ATTENTE_TRANCHE_MS = avant;
  }
});

test('motifFin : borné à 80 caractères, | remplacé par /, retours ligne réduits à un espace', () => {
  assert.equal(attenteLimite.motifFin('court'), 'court');
  assert.equal(attenteLimite.motifFin(null), '');
  assert.equal(attenteLimite.motifFin(undefined), '');
  // MSG-utilisateur-004, point 7 : un `\|` échappé décale les colonnes de parseSessions ; aucun | ne subsiste.
  assert.equal(attenteLimite.motifFin('a|b'), 'a/b');
  assert.equal(attenteLimite.motifFin('ligne 1\nligne 2\r\nligne 3'), 'ligne 1 ligne 2 ligne 3');
  const long = 'x'.repeat(200);
  assert.equal(attenteLimite.motifFin(long).length, 80);
  const pleinDePipes = '|'.repeat(100);
  const motif = attenteLimite.motifFin(pleinDePipes);
  assert.equal(motif, '/'.repeat(80));
  assert.ok(!motif.includes('|'), 'aucun | dans la colonne Fin');
});

// -- Scénario lanceur : sous-processus réel, HOLARCH_FAKE_CLAUDE + 429 ------------------------------
// Ne tournent qu'après promotion (le paquet ne porte pas framework/bin/holarch-spawn.js à côté de ce
// test) : c'est mission/shared/concepteur/verificateurs/integration.js qui les exerce, dans son clone.
const SPAWN_JS = path.join(__dirname, '..', 'bin', 'holarch-spawn.js');
const FAKE_CLAUDE = path.join(__dirname, 'fake-claude.js');
const SCENARIO = path.join(__dirname, 'scenarios', 'repli-429-partout.json');
const HAS_SPAWN = fs.existsSync(SPAWN_JS) && fs.existsSync(FAKE_CLAUDE) && fs.existsSync(SCENARIO);
const SKIP = HAS_SPAWN ? false : 'holarch-spawn.js (ou ses fixtures fake-claude) absent à côté de ce test (paquet non appliqué)';

const CONFIG = `# Configuration — mission : test-attente-429
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
| execution | sonnet | medium |
`;

function fiche() {
  return '# x\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | — |\n| Statut | READY |\n'
    + '| Budget alloué / consommé | 3 / 0 |\n| Dépend de | — |\n| Profil | execution |\n| Livrables | — |\n'
    + '| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n';
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente429-'));
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
  w('mission/registry/instances/x.md', fiche());
  w('mission/registry/ORG.md', '# Organisation\n- x (READY)\n');
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'test@test.test'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: root });
  return root;
}

function attendreFichier(p, timeoutMs) {
  return new Promise((resolve, reject) => {
    const fin = Date.now() + timeoutMs;
    const tick = () => {
      if (fs.existsSync(p)) return resolve();
      if (Date.now() > fin) return reject(new Error(`fichier absent après ${timeoutMs} ms : ${p}`));
      setTimeout(tick, 50);
    };
    tick();
  });
}

/** Tue le sous-processus (et attend sa fin) sans laisser de zombie même si le test échoue avant. */
function tuerEtAttendre(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try { child.kill('SIGKILL'); } catch (_) { resolve(); }
  });
}

test(
  '429 à attente longue : fichier stop posé pendant l\'attente → sortie < 10 s, code 0, motif dans SESSIONS.md',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* premier appel */ }
    const stopFile = path.join(root, 'mission', '.holarch', 'stop', 'x');
    const env = Object.assign({}, process.env, {
      HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_ATTENTE_429_MS: '20000',
    });
    const child = spawn(process.execPath, [SPAWN_JS, 'x', '--root', root], { cwd: root, env });
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    const exit = new Promise((resolve) => child.on('exit', (c) => resolve(c)));
    try {
      // MSG-utilisateur-004 D : le stop est posé une fois l'attente commencée (verrou .attente.json écrit), jamais
      // après un délai fixe — sinon, sur une machine lente, prepareLaunch (qui efface un stop résiduel au premier
      // lancement) passe après lui et le test attend 20 s.
      await attendreFichier(path.join(root, 'mission', '.holarch', 'live', 'x.attente.json'), 8000);
      const t0 = Date.now();
      fs.mkdirSync(path.dirname(stopFile), { recursive: true });
      fs.writeFileSync(stopFile, `${new Date().toISOString()}\n`);
      const code = await exit;
      const elapsed = Date.now() - t0;
      assert.ok(elapsed < 10000, `sortie en ${elapsed} ms (attendu < 10000)`);
      assert.equal(code, 0, `code 0 attendu (arrêt propre) ; stderr=${stderr}`);
      assert.match(stderr, /arrêt demandé \(--arret\) reçu pendant l'attente d'une limite 429/);
      const sessionsTxt = fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8');
      assert.ok(
        sessionsTxt.includes('limite 429 : Claude AI usage limit reached/resets 5pm'),
        `motif attendu dans SESSIONS.md :\n${sessionsTxt}`,
      );
      // Point 7 : la ligne garde le nombre de colonnes de l'en-tête (aucun | ajouté par le motif).
      const lignesTableau = sessionsTxt.split('\n').filter((l) => l.startsWith('| '));
      const colonnes = (l) => l.split('|').length;
      assert.equal(colonnes(lignesTableau[lignesTableau.length - 1]), colonnes(lignesTableau[0]));
    } finally {
      await tuerEtAttendre(child);
      try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* rien à nettoyer */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  '--arret pendant l\'attente d\'une limite 429 : demanderArret la compte comme vivante, fichier stop écrit',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* premier appel */ }
    const attenteFile = path.join(root, 'mission', '.holarch', 'live', 'x.attente.json');
    const stopFile = path.join(root, 'mission', '.holarch', 'stop', 'x');
    const env = Object.assign({}, process.env, {
      HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_ATTENTE_429_MS: '20000',
    });
    const child = spawn(process.execPath, [SPAWN_JS, 'x', '--root', root], { cwd: root, env });
    try {
      await attendreFichier(attenteFile, 8000); // le lanceur a atteint l'attente 429 (verrou écrit)
      const attente = JSON.parse(fs.readFileSync(attenteFile, 'utf8'));
      assert.ok(attente.pid > 0 && attente.jusqua && attente.motif !== undefined && attente.tentative === 1,
        `format {pid, jusqua, motif, tentative} attendu : ${JSON.stringify(attente)}`);
      const r = spawnSync(process.execPath, [SPAWN_JS, '--arret', 'x', '--root', root], { encoding: 'utf8' });
      assert.match(r.stdout, /arrêt demandé/, `pas de « rien à arrêter » pendant l'attente : ${r.stdout}`);
      assert.doesNotMatch(r.stdout, /rien à arrêter/);
      assert.ok(fs.existsSync(stopFile), 'fichier stop écrit par --arret pendant l\'attente');
      const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c)));
      assert.equal(code, 0, 'le lanceur en attente sort proprement une fois le fichier stop consommé');
    } finally {
      await tuerEtAttendre(child);
      try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* rien à nettoyer */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'point 3 : --arret --immediat pendant l\'attente → le lanceur sort de lui-même, verrou et stop retirés, tâche close, --reprendre ne relance rien',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* premier appel */ }
    const attenteFile = path.join(root, 'mission', '.holarch', 'live', 'x.attente.json');
    const stopFile = path.join(root, 'mission', '.holarch', 'stop', 'x');
    const tacheFile = path.join(root, 'mission', '.holarch', 'tasks', 't-attente.json');
    const env = Object.assign({}, process.env, {
      HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_ATTENTE_429_MS: '20000',
      HOLARCH_TASK_ID: 't-attente', HOLARCH_TASK_CHEMIN: 'x',
    });
    const child = spawn(process.execPath, [SPAWN_JS, 'x', '--root', root], { cwd: root, env });
    fs.mkdirSync(path.dirname(tacheFile), { recursive: true });
    fs.writeFileSync(tacheFile, JSON.stringify({ id: 't-attente', chemin: 'x', pid: child.pid, state: 'running' }));
    try {
      await attendreFichier(attenteFile, 8000);
      const attente = JSON.parse(fs.readFileSync(attenteFile, 'utf8'));
      assert.equal(attente.pid, child.pid, 'le pid du verrou .attente.json est bien celui du lanceur');
      if (fs.existsSync('/proc/self/stat')) assert.ok(attente.starttime, 'point 6 : starttime noté avec le pid');
      const exit = new Promise((resolve) => child.on('exit', (c, s) => resolve([c, s])));
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [SPAWN_JS, '--arret', 'x', '--immediat', '--root', root], { encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root }) });
      assert.ok(Date.now() - t0 < 14000, `--immediat rend la main en moins de 14 s (${Date.now() - t0} ms)`);
      assert.match(r.stdout, /sorti de lui-même sur le fichier stop/, `sortie propre attendue : ${r.stdout}${r.stderr}`);
      const [code, signal] = await exit;
      assert.equal(signal, null, 'aucun signal : le lanceur est sorti de lui-même');
      assert.equal(code, 0);
      assert.equal(fs.existsSync(attenteFile), false, 'verrou .attente.json retiré');
      // Revue n° 38 : le fichier stop reste — c'est lui qui empêche le réveil suivant de relancer l'instance arrêtée.
      assert.equal(fs.existsSync(stopFile), true, 'fichier stop laissé en place (revue n° 38)');
      assert.notEqual(JSON.parse(fs.readFileSync(tacheFile, 'utf8')).state, 'running', 'tâche close');
      const rep = spawnSync(process.execPath, [SPAWN_JS, '--reprendre', '--root', root], { encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root }) });
      assert.doesNotMatch(`${rep.stdout}${rep.stderr}`, /relancée/, 'aucune relance de l\'instance arrêtée');
    } finally {
      await tuerEtAttendre(child);
      try { fs.unlinkSync(`${SCENARIO}.attempt`); } catch (_) { /* rien à nettoyer */ }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

// -- Point 6 : .attente.json porte pid + starttime, supprimé par son seul propriétaire ---------------------------

/** Processus « dormeur » (ignore le fichier stop) : sert de lanceur bloqué ou de processus étranger. */
function dormeur() {
  return spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
}

test('point 6 : attenteVivante — pid vivant au starttime différent (pid réutilisé) → null ; même starttime → données', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
  const f = path.join(dir, 'x.attente.json');
  try {
    const st = attenteLimite.starttimeDe(process.pid);
    fs.writeFileSync(f, JSON.stringify({ pid: process.pid, starttime: st, jusqua: 'z' }));
    assert.equal(attenteLimite.attenteVivante(f).pid, process.pid);
    if (st !== null) {
      fs.writeFileSync(f, JSON.stringify({ pid: process.pid, starttime: 'autre-processus', jusqua: 'z' }));
      assert.equal(attenteLimite.attenteVivante(f), null, 'pid réutilisé : pas le lanceur');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('point 6 : supprimerSiProprietaire — un fichier réécrit par un second lanceur n\'est pas supprimé', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-attente-'));
  const f = path.join(dir, 'x.attente.json');
  try {
    fs.writeFileSync(f, JSON.stringify({ pid: 424242, starttime: '99', jusqua: 'z' }));
    assert.equal(attenteLimite.supprimerSiProprietaire(f, process.pid, attenteLimite.starttimeDe(process.pid)), false);
    assert.ok(fs.existsSync(f), 'le verrou du second lanceur reste');
    assert.equal(attenteLimite.supprimerSiProprietaire(f, 424242, '99'), true);
    assert.equal(fs.existsSync(f), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test(
  'point 6 : --arret --immediat sur un .attente.json périmé dont le pid est réutilisé → rien à arrêter, processus étranger intact',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    const etranger = dormeur();
    try {
      const f = path.join(root, 'mission', '.holarch', 'live', 'x.attente.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ pid: etranger.pid, starttime: 'lanceur-mort-depuis', jusqua: 'z', motif: '429', tentative: 1 }));
      const r = spawnSync(process.execPath, [SPAWN_JS, '--arret', 'x', '--immediat', '--root', root], { encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root }) });
      assert.match(r.stdout, /rien à arrêter/, r.stdout + r.stderr);
      assert.equal(etranger.exitCode, null);
      assert.equal(etranger.signalCode, null, 'le processus étranger n\'a reçu aucun signal');
      process.kill(etranger.pid, 0);
    } finally {
      await tuerEtAttendre(etranger);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'point 3 (repli) : lanceur en attente qui ne sort pas sur le stop → tué, puis verrou retiré et tâche close failed par demanderArret',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    const bloque = dormeur();
    try {
      const { demanderArret, reprendreTaches } = require(SPAWN_JS);
      const f = path.join(root, 'mission', '.holarch', 'live', 'x.attente.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ pid: bloque.pid, starttime: attenteLimite.starttimeDe(bloque.pid), jusqua: 'z', motif: '429', tentative: 1 }));
      const tache = path.join(root, 'mission', '.holarch', 'tasks', 't-bloque.json');
      fs.mkdirSync(path.dirname(tache), { recursive: true });
      fs.writeFileSync(tache, JSON.stringify({ id: 't-bloque', chemin: 'x', pid: bloque.pid, state: 'running' }));
      const res = demanderArret(root, 'x', { immediat: true, attenteSortieMs: 300, attenteMs: 500 });
      assert.equal(res.mode, 'immediat');
      assert.match(res.message, /session tuée/);
      assert.equal(fs.existsSync(f), false, 'verrou du lanceur tué retiré');
      const t = JSON.parse(fs.readFileSync(tache, 'utf8'));
      assert.equal(t.state, 'failed');
      assert.match(t.note, /--arret --immediat/);
      assert.deepEqual(reprendreTaches(root).relancees, [], '--reprendre ne relance pas une instance arrêtée');
    } finally {
      await tuerEtAttendre(bloque);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

// -- Revue n° 8 : wakeWaiters ne relance pas une instance dont le lanceur attend une limite 429 ----------------
test(
  'revue n° 8 : instance READY à la condition satisfaite mais lanceur en attente 429 → wakeWaiters ne lance rien',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    const attente = dormeur();
    const envAvant = { ...process.env };
    try {
      const { wakeWaiters } = require(SPAWN_JS);
      const reveil = require(path.join(__dirname, '..', 'bin', 'reveil.js'));
      fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n'
        + '| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | fichier:mission/go |\n');
      fs.writeFileSync(path.join(root, 'mission', 'go'), 'go\n');
      execFileSync('git', ['add', '-A'], { cwd: root });
      execFileSync('git', ['commit', '-q', '-m', 'reveil'], { cwd: root });
      // Témoin : la condition est bien satisfaite — sans le verrou d'attente, wakeWaiters lancerait x.
      const w = reveil.listWaiters(root).find((v) => v.chemin === 'x');
      assert.ok(w, 'x est un guetteur');
      assert.equal(reveil.evalReveil(w.ast, { root, chemin: 'x', now: new Date(), readStatus: () => null, readInbox: () => '' }).satisfied, true);
      const f = path.join(root, 'mission', '.holarch', 'live', 'x.attente.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ pid: attente.pid, starttime: attenteLimite.starttimeDe(attente.pid), jusqua: 'z', motif: '429', tentative: 1 }));
      // Garde : si la correction manque, le lanceur détaché tourne sur le faux claude, jamais sur le vrai.
      Object.assign(process.env, { HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO });
      assert.deepEqual(wakeWaiters(root, '--reveil'), [], 'aucun second lanceur pendant l\'attente 429');
      assert.equal(fs.existsSync(path.join(root, 'mission', '.holarch', 'tasks')), false, 'aucune tâche détachée créée');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in envAvant)) delete process.env[k];
      Object.assign(process.env, envAvant);
      const tasks = path.join(root, 'mission', '.holarch', 'tasks');
      for (const n of fs.existsSync(tasks) ? fs.readdirSync(tasks) : []) {
        let pid = null;
        try { pid = JSON.parse(fs.readFileSync(path.join(tasks, n), 'utf8')).pid; } catch (_) { /* illisible */ }
        if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* mort */ } } }
      }
      await tuerEtAttendre(attente);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'revue n° 38 : instance READY à la condition satisfaite, arrêtée pendant une attente 429 (fichier stop) → wakeWaiters ne la relance pas',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    const envAvant = { ...process.env };
    try {
      const { wakeWaiters } = require(SPAWN_JS);
      fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n'
        + '| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | fichier:mission/go |\n');
      fs.writeFileSync(path.join(root, 'mission', 'go'), 'go\n');
      execFileSync('git', ['add', '-A'], { cwd: root });
      execFileSync('git', ['commit', '-q', '-m', 'reveil'], { cwd: root });
      const stopFile = path.join(root, 'mission', '.holarch', 'stop', 'x');
      fs.mkdirSync(path.dirname(stopFile), { recursive: true });
      fs.writeFileSync(stopFile, `${new Date().toISOString()}\n`);
      Object.assign(process.env, { HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO });
      assert.deepEqual(wakeWaiters(root, '--reveil'), [], 'aucune relance d\'une instance arrêtée');
      assert.equal(fs.existsSync(path.join(root, 'mission', '.holarch', 'tasks')), false, 'aucune tâche détachée créée');
    } finally {
      for (const k of Object.keys(process.env)) if (!(k in envAvant)) delete process.env[k];
      Object.assign(process.env, envAvant);
      const tasks = path.join(root, 'mission', '.holarch', 'tasks');
      for (const n of fs.existsSync(tasks) ? fs.readdirSync(tasks) : []) {
        let pid = null;
        try { pid = JSON.parse(fs.readFileSync(path.join(tasks, n), 'utf8')).pid; } catch (_) { /* illisible */ }
        if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* mort */ } } }
      }
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

// -- Revue n° 33 : câblage du J2 dans le lanceur (chaque pièce retirée fait rougir un test) ------------------
function ecrireJob(root, id, etat) {
  const p = path.join(root, 'mission', '.holarch', 'jobs', `${id}.json`);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(Object.assign({ id, nom: id, proprietaire: 'x', sorties: [], debut: '2026-01-01T00:00:00Z' }, etat)));
  return p;
}

test('revue n° 33 (1) : --reprendre (reprendreTaches) passe un job au superviseur mort à interrompu', { skip: SKIP }, () => {
  const root = makeRoot();
  try {
    const { reprendreTaches } = require(SPAWN_JS);
    const p = ecrireJob(root, 'j-orphelin', { etat: 'en-cours', pid_superviseur: 2 ** 22 - 5, pgid: 2 ** 22 - 5 });
    const res = reprendreTaches(root);
    assert.equal(JSON.parse(fs.readFileSync(p, 'utf8')).etat, 'interrompu');
    assert.ok(res.lignes.some((l) => /job j-orphelin .*interrompu/.test(l)), res.lignes.join('\n'));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('revue n° 33 (2) : --nettoyer-worktree (removeWorktree) refuse un worktree où un job vit encore (V1-5)', { skip: SKIP }, () => {
  const root = makeRoot();
  try {
    const { removeWorktree } = require(SPAWN_JS);
    const wt = path.join(root, 'mission', '.holarch', 'worktrees', 'x');
    fs.mkdirSync(wt, { recursive: true });
    ecrireJob(root, 'j-vivant', { etat: 'en-cours', pid_superviseur: process.pid, cwd: wt });
    const r = removeWorktree(root, 'x');
    assert.equal(r.removed, false);
    assert.match(r.reason, /job vivant dans ce worktree : j-vivant/);
    assert.equal(fs.existsSync(wt), true);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('revue n° 33 (3) : wakeWaiters(…, pour) ne réveille que le propriétaire du job (V1-3)', { skip: SKIP }, async () => {
  const root = makeRoot();
  const attente = dormeur();
  const envAvant = { ...process.env };
  try {
    const { wakeWaiters } = require(SPAWN_JS);
    const statut = '# Statut — i\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | fichier:mission/go |\n';
    for (const f of ['ROLE.md', 'MEMORY.md', 'INBOX.md', 'OUTBOX.md', 'JOURNAL.md']) {
      fs.mkdirSync(path.join(root, 'mission', 'y'), { recursive: true });
      fs.copyFileSync(path.join(root, 'mission', 'x', f), path.join(root, 'mission', 'y', f));
    }
    fs.writeFileSync(path.join(root, 'mission', 'registry', 'instances', 'y.md'), fiche().replace(/^# x$/m, '# y'));
    fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), statut);
    fs.writeFileSync(path.join(root, 'mission', 'y', 'STATUS.md'), statut);
    fs.writeFileSync(path.join(root, 'mission', 'go'), 'go\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'reveil'], { cwd: root });
    // x (le propriétaire) est en attente 429 : il n'est pas relancé ; y n'est pas le propriétaire : filtré.
    const f = path.join(root, 'mission', '.holarch', 'live', 'x.attente.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ pid: attente.pid, starttime: attenteLimite.starttimeDe(attente.pid), jusqua: 'z', motif: '429', tentative: 1 }));
    Object.assign(process.env, { HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO });
    assert.deepEqual(wakeWaiters(root, 'job:j1', 'x'), [], 'y n\'est pas réveillé par la fin du job de x');
    assert.equal(fs.existsSync(path.join(root, 'mission', '.holarch', 'tasks')), false, 'aucune tâche détachée créée');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in envAvant)) delete process.env[k];
    Object.assign(process.env, envAvant);
    const tasks = path.join(root, 'mission', '.holarch', 'tasks');
    for (const n of fs.existsSync(tasks) ? fs.readdirSync(tasks) : []) {
      let pid = null;
      try { pid = JSON.parse(fs.readFileSync(path.join(tasks, n), 'utf8')).pid; } catch (_) { /* illisible */ }
      if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* mort */ } } }
    }
    await tuerEtAttendre(attente);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -- Seconde revue n° 51 : N `--reveil --pour x` simultanés (processus réels) → une seule session de x -------------
/** Fiches de tâche détachée de `chemin` et lignes de REVEILS.md qui le nomment. */
function reveilsDe(root, chemin) {
  const tasks = path.join(root, 'mission', '.holarch', 'tasks');
  const taches = (fs.existsSync(tasks) ? fs.readdirSync(tasks) : []).filter((n) => n.endsWith('.json'))
    .map((n) => { try { return JSON.parse(fs.readFileSync(path.join(tasks, n), 'utf8')); } catch (_) { return null; } })
    .filter((t) => t && t.chemin === chemin);
  let lignes = 0;
  try {
    lignes = fs.readFileSync(path.join(root, 'mission', 'registry', 'REVEILS.md'), 'utf8').split('\n')
      .filter((l) => /^\| \d{4}-/.test(l) && l.split('|')[2].trim() === chemin).length;
  } catch (_) { /* aucun réveil */ }
  return { taches, lignes };
}

/** Tue le groupe de chaque lanceur détaché de `root` (aucun processus survivant au test). */
function tuerTaches(root) {
  const tasks = path.join(root, 'mission', '.holarch', 'tasks');
  for (const n of fs.existsSync(tasks) ? fs.readdirSync(tasks) : []) {
    let pid = null;
    try { pid = JSON.parse(fs.readFileSync(path.join(tasks, n), 'utf8')).pid; } catch (_) { /* illisible */ }
    if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch (_) { try { process.kill(pid, 'SIGKILL'); } catch (_) { /* mort */ } } }
  }
}

function lancerReveils(root, n, extra) {
  const env = { ...process.env, HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO };
  delete env.HOLARCH_TASK_ID;
  delete env.HOLARCH_INSTANCE; // troisième revue n° 77 : ces --reveil sont ceux du mainteneur, pas d'une instance
  const procs = [];
  for (let i = 0; i < n; i += 1) {
    procs.push(spawn(process.execPath, [SPAWN_JS, '--reveil', '--pour', 'x', '--declencheur', `job:j${i}`, '--root', root, ...(extra || [])],
      { cwd: root, env, stdio: 'ignore' }));
  }
  return Promise.all(procs.map((p) => new Promise((r) => { if (p.exitCode !== null) r(p.exitCode); else p.once('exit', (c) => r(c)); })));
}

test(
  'seconde revue n° 51 : 8 `--reveil --pour x` simultanés (processus réels), 5 tours → une seule session de x par tour',
  { skip: SKIP },
  async () => {
    const TOURS = 5;
    const bilan = [];
    for (let tour = 0; tour < TOURS; tour += 1) {
      const root = makeRoot();
      try {
        fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n'
          + '| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | fichier:mission/go |\n');
        fs.writeFileSync(path.join(root, 'mission', 'go'), 'go\n');
        execFileSync('git', ['add', '-A'], { cwd: root });
        execFileSync('git', ['commit', '-q', '-m', 'reveil'], { cwd: root });
        await lancerReveils(root, 8);
        const r = reveilsDe(root, 'x');
        bilan.push(`${r.taches.length} tâche(s) / ${r.lignes} ligne(s)`);
      } finally {
        tuerTaches(root);
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    assert.deepEqual(bilan, Array(TOURS).fill('1 tâche(s) / 1 ligne(s)'), 'x réveillée plusieurs fois par des réveils concurrents');
  },
);

function statutReveilX(root) {
  fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n'
    + '| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | fichier:mission/go |\n');
  fs.writeFileSync(path.join(root, 'mission', 'go'), 'go\n');
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'reveil'], { cwd: root });
}

test(
  'seconde revue n° 8 : lanceur détaché de x vivant entre deux sessions (tâche running, sans verrou live/) → aucun second lanceur, `--reveil --pour x` sort en 3',
  { skip: SKIP },
  async () => {
    const root = makeRoot();
    const lanceur = dormeur();
    try {
      statutReveilX(root);
      const tasks = path.join(root, 'mission', '.holarch', 'tasks');
      fs.mkdirSync(tasks, { recursive: true });
      fs.writeFileSync(path.join(tasks, 'x-1.json'), JSON.stringify({ id: 'x-1', chemin: 'x', pid: lanceur.pid, state: 'running' }));
      const codes = await lancerReveils(root, 1);
      assert.deepEqual(codes, [3], 'propriétaire occupé : code 3 (le guetteur se ré-arme)');
      assert.equal(reveilsDe(root, 'x').taches.length, 1, 'aucune tâche de plus que celle du lanceur vivant');
    } finally {
      tuerTaches(root);
      await tuerEtAttendre(lanceur);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'seconde revue n° 51 (--reprendre) : 2 tâches mortes de x + 2 `--reprendre` et 4 `--reveil --pour x` simultanés, 4 tours → une seule relance par tour',
  { skip: SKIP },
  async () => {
    const bilan = [];
    for (let tour = 0; tour < 4; tour += 1) {
      const root = makeRoot();
      try {
        statutReveilX(root);
        const tasks = path.join(root, 'mission', '.holarch', 'tasks');
        fs.mkdirSync(tasks, { recursive: true });
        for (const n of ['x-mort-1', 'x-mort-2']) fs.writeFileSync(path.join(tasks, `${n}.json`), JSON.stringify({ id: n, chemin: 'x', pid: 999999999, state: 'running' }));
        const env = { ...process.env, HOLARCH_ROOT: root, HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO };
        delete env.HOLARCH_TASK_ID;
        const reprises = [0, 1].map(() => spawn(process.execPath, [SPAWN_JS, '--reprendre', '--root', root], { cwd: root, env, stdio: 'ignore' }));
        const fins = reprises.map((p) => new Promise((r) => { if (p.exitCode !== null) r(); else p.once('exit', r); }));
        await Promise.all([lancerReveils(root, 4), ...fins]);
        bilan.push(reveilsDe(root, 'x').taches.filter((t) => t.state === 'running').length);
      } finally {
        tuerTaches(root);
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    assert.deepEqual(bilan, [1, 1, 1, 1], `lanceurs vivants de x par tour : ${bilan.join(', ')}`);
  },
);

// -- Troisième revue (test 51) : la réservation figée aussi côté holarch-job (guetteur réel → vrai lanceur) ----------
test(
  'troisième revue (test 51) : guetteur de job réel (reprendre, 6 orphelins de x) en course avec 8 `--reveil --pour x` échelonnés, 4 tours → un seul lanceur vivant de x',
  { skip: SKIP },
  async () => {
    const JOBS_JS = path.join(__dirname, '..', 'bin', 'jobs.js');
    const bilan = [];
    for (let tour = 0; tour < 4; tour += 1) {
      const root = makeRoot();
      try {
        statutReveilX(root);
        for (let i = 0; i < 6; i += 1) ecrireJob(root, `orph-${i}`, { etat: 'en-cours', pid_superviseur: 2 ** 22 - 5, pgid: 2 ** 22 - 5 });
        // Scénario 429 partout : le premier lanceur de x reste en attente (vivant) ; tout réveil suivant doit le voir.
        const env = envPropre(root, {
          HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_ATTENTE_429_MS: '20000',
          HOLARCH_JOB_REVEIL: SPAWN_JS, HOLARCH_JOB_REVEIL_ATTENTE_MAX_MS: '20000',
        });
        const lancer = (argv) => finDe(spawn(process.execPath, argv, { cwd: root, env, stdio: 'ignore' }));
        const reprise = lancer(['-e', 'require(process.argv[1]).reprendre(process.argv[2])', JOBS_JS, root]);
        const vagues = [0, 1, 2, 3].map((k) => new Promise((r) => { setTimeout(r, k * 350); })
          .then(() => Promise.all([0, 1].map((i) => lancer([SPAWN_JS, '--reveil', '--pour', 'x', '--declencheur', `job:v${k}-${i}`, '--root', root])))));
        await Promise.all([reprise, ...vagues]);
        await new Promise((r) => { setTimeout(r, 1500); }); // le guetteur a tenté au moins une fois (pas 1000 ms)
        bilan.push(reveilsDe(root, 'x').taches.filter((t) => t.state === 'running').length);
      } finally {
        try { process.kill(JSON.parse(fs.readFileSync(path.join(root, 'mission', '.holarch', 'live', 'x.guetteur'), 'utf8')).pid, 'SIGKILL'); } catch (_) { /* aucun guetteur */ }
        tuerTaches(root);
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    assert.deepEqual(bilan, [1, 1, 1, 1], `lanceurs vivants de x par tour : ${bilan.join(', ')}`);
  },
);

// -- Troisième revue n° 72, 73, 74 : occupation d'une instance, un seul prédicat ------------------------------------
/** Horloge monotone en ms, commune à tous les processus de la machine (CLOCK_MONOTONIC, `process.hrtime`) : l'horloge
 *  murale peut reculer — sous WSL2, d'environ 1,4 s toutes les 28 s (resynchronisation de la VM, mesuré le 2026-09-27) —,
 *  et des horodatages muraux pris dans des processus différents faisaient voir deux sessions successives comme
 *  superposées, ou une session d'après la livraison comme antérieure (le test échouait une fois sur deux sans défaut du
 *  lanceur). */
function mono() { return Number(process.hrtime.bigint() / 1000000n); }

/** Environnement d'un processus de test : sans aucune variable HOLARCH_* héritée de la session qui lance les tests. */
function envPropre(root, extra) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('HOLARCH_')) env[k] = v;
  return Object.assign(env, { HOLARCH_ROOT: root }, extra || {});
}

/** Session simulée de x : note son début et sa fin (pid, ms) dans sessions.log, dure T_SESSION_MS, puis hiberne sur
 *  `fichier:mission/go` — ce qu'une vraie session fait à ON_SLEEP avant la traîne de son lanceur. */
const FAKE_SESSION = `const fs = require('fs'); const path = require('path'); const root = process.cwd();
const log = path.join(root, 'sessions.log');
fs.appendFileSync(log, 'start ' + process.pid + ' ' + Number(process.hrtime.bigint() / 1000000n) + '\\n');
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.env.T_SESSION_MS || 300));
fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\\n\\n| Champ | Valeur |\\n|---|---|\\n| État | WAITING_CHILDREN |\\n| Depuis | ' + new Date().toISOString() + ' |\\n| Posé par | soi |\\n| Note |  |\\n| Réveil | fichier:mission/go |\\n');
fs.appendFileSync(log, 'end ' + process.pid + ' ' + Number(process.hrtime.bigint() / 1000000n) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', session_id: 's-' + process.pid, total_cost_usd: 0.001, num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 }, is_error: false }));
`;

function sessionsDe(root) {
  const debut = {}; const out = [];
  let txt = ''; try { txt = fs.readFileSync(path.join(root, 'sessions.log'), 'utf8'); } catch (_) { /* aucune */ }
  for (const l of txt.split('\n').filter(Boolean)) {
    const [k, pid, t] = l.split(' ');
    if (k === 'start') debut[pid] = Number(t); else out.push([debut[pid], Number(t)]);
  }
  for (const pid of Object.keys(debut)) if (!out.some((s) => s[0] === debut[pid])) out.push([debut[pid], Infinity]);
  return out.sort((a, b) => a[0] - b[0]);
}

function finDe(p) { return new Promise((r) => { if (p.exitCode !== null || p.signalCode !== null) r(p.exitCode); else p.once('exit', (c) => r(c)); }); }

/** Attend qu'aucun lanceur de x ne vive plus (tâches closes ou mortes, verrou live/ absent ou mort), au plus ms. */
async function attendreCalme(root, ms) {
  const { isLive, tacheVivantePour } = require(SPAWN_JS);
  const fin = mono() + ms;
  while (mono() < fin) {
    if (!isLive(root, 'x') && !tacheVivantePour(root, 'x')) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

/** Un tour : lanceur synchrone de x ; à `debutMs + decalage` après son départ, la livraison (mission/go) et le
 *  réveil qu'aurait déclenché la fin du lanceur de l'enfant (`--reveil --declencheur x/c`, 3 à la fois). */
async function tourLivraison(decalage, dureeLanceur) {
  const root = makeRoot();
  try {
    fs.writeFileSync(path.join(root, 'fake-sessions.js'), FAKE_SESSION);
    fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n'
      + '| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | fichier:mission/go |\n');
    execFileSync('git', ['add', '-A'], { cwd: root });
    execFileSync('git', ['commit', '-q', '-m', 'x'], { cwd: root });
    const env = envPropre(root, { HOLARCH_FAKE_CLAUDE: path.join(root, 'fake-sessions.js'), T_SESSION_MS: '300' });
    const t0 = mono();
    const lanceur = spawn(process.execPath, [SPAWN_JS, 'x', '--root', root], { cwd: root, env, stdio: 'ignore' });
    const finLanceur = finDe(lanceur).then(() => mono());
    if (decalage === null) await finLanceur; // étalonnage : livraison après la fin du lanceur
    else await new Promise((r) => setTimeout(r, Math.max(0, dureeLanceur + decalage)));
    const tLivraison = mono();
    fs.writeFileSync(path.join(root, 'mission', 'go'), 'go\n');
    const reveils = [0, 1, 2].map(() => spawn(process.execPath, [SPAWN_JS, '--reveil', '--declencheur', 'x/c', '--root', root], { cwd: root, env, stdio: 'ignore' }));
    const tFin = await finLanceur;
    await Promise.all(reveils.map(finDe));
    const calme = await attendreCalme(root, 15000);
    const s = sessionsDe(root);
    const chevauchement = s.some((a, i) => i > 0 && a[0] < s[i - 1][1]);
    const vue = s.some((a) => a[0] >= tLivraison);
    return { decalage, reel: tLivraison - tFin, duree: tFin - t0, sessions: s.length, chevauchement, vue, calme };
  } finally {
    tuerTaches(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test(
  'troisième revue n° 72 + 74 : livraison balayée de −300 à +200 ms autour de la fin du lanceur de x (processus réels, 3 réveils) → jamais deux sessions de x, jamais un réveil perdu',
  { skip: SKIP, timeout: 240000 },
  async () => {
    // Étalonnage : durée d'un lanceur de x sans livraison (session de 300 ms), relevée sur deux tours.
    const etalon = [];
    for (let i = 0; i < 2; i += 1) etalon.push((await tourLivraison(null, 0)).duree);
    const duree = Math.min(...etalon);
    const bilan = [];
    for (const d of [-duree, -300, -200, -120, -80, -60, -40, -20, 0, 20, 40, 80, 120, 200]) {
      const r = await tourLivraison(d, duree);
      bilan.push(r);
    }
    const fautes = bilan.filter((r) => r.chevauchement || !r.vue || !r.calme);
    assert.deepEqual(fautes, [], `tours fautifs (chevauchement = deux sessions, !vue = réveil perdu) : ${JSON.stringify(fautes)}`);
  },
);

test('troisième revue n° 73 : tâche « running » au pid vivant mais au starttime différent (pid réutilisé) → instance libre, `--reprendre` la ferme', { skip: SKIP }, async () => {
  const root = makeRoot();
  const autre = dormeur();
  try {
    await new Promise((r) => setTimeout(r, 100));
    const st = attenteLimite.starttimeDe(autre.pid);
    assert.notEqual(st, null, '/proc lisible : le test a un sens');
    const tasks = path.join(root, 'mission', '.holarch', 'tasks');
    fs.mkdirSync(tasks, { recursive: true });
    const ecrire = (s) => fs.writeFileSync(path.join(tasks, 'x-1.json'), JSON.stringify({ id: 'x-1', chemin: 'x', pid: autre.pid, starttime: s, state: 'running' }));
    // DELIVERED : --reprendre ne relance rien (aucune session, aucun CLI réel), il ne fait que fermer la fiche.
    fs.writeFileSync(path.join(root, 'mission', 'x', 'STATUS.md'), '# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | DELIVERED |\n| Note |  |\n| Réveil | — |\n');
    const { tacheVivantePour, reprendreTaches } = require(SPAWN_JS);
    ecrire(st);
    assert.equal(tacheVivantePour(root, 'x') && tacheVivantePour(root, 'x').id, 'x-1', 'même processus : tâche vivante');
    ecrire(`${st}0`);
    assert.equal(tacheVivantePour(root, 'x'), null, 'pid réutilisé : la tâche ne tient plus l\'instance');
    reprendreTaches(root);
    assert.equal(JSON.parse(fs.readFileSync(path.join(tasks, 'x-1.json'), 'utf8')).state, 'failed', '--reprendre ferme la tâche au pid réutilisé');
  } finally {
    tuerTaches(root);
    await tuerEtAttendre(autre);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// -- Troisième revue n° 77, 78 : refus aux instances tenus par le lanceur, pas par la lecture du texte ---------------
/** Racine de test avec une instance p, son enfant direct p/c et un frère q (fichiers de spawn et fiches présents). */
function makeRootPcq() {
  const root = makeRoot();
  for (const i of ['p', 'p/c', 'q']) {
    const d = path.join(root, 'mission', i);
    fs.mkdirSync(d, { recursive: true });
    for (const f of ['ROLE.md', 'MEMORY.md', 'INBOX.md', 'OUTBOX.md', 'JOURNAL.md']) fs.writeFileSync(path.join(d, f), `# ${f}\n`);
    fs.writeFileSync(path.join(d, 'STATUS.md'), `# Statut — ${i}\n\n| Champ | Valeur |\n|---|---|\n| État | READY |\n| Depuis | 2026-01-01T00:00:00Z |\n| Posé par | soi |\n| Note |  |\n| Réveil | — |\n`);
    fs.writeFileSync(path.join(root, 'mission', 'registry', 'instances', `${i.replace(/\//g, '-')}.md`), fiche());
  }
  execFileSync('git', ['add', '-A'], { cwd: root });
  execFileSync('git', ['commit', '-q', '-m', 'p, p/c, q'], { cwd: root });
  return root;
}

test(
  'troisième revue n° 77, 78 : la matrice sg.js du relecteur, exécutée par bash et le lanceur depuis la session de p → chaque forme refusée par le lanceur, rien lancé ; les formes permises passent',
  { skip: SKIP },
  () => {
    const root = makeRootPcq();
    const env = envPropre(root, { HOLARCH_INSTANCE: 'p', HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_ATTENTE_429_MS: '20000' });
    const L = `node '${SPAWN_JS}'`;
    const bash = (cmd) => spawnSync('bash', ['-c', cmd], { cwd: root, env, encoding: 'utf8', timeout: 20000 });
    try {
      const refusees = [
        `${L} p/c --detach --budget-usd 5 --budget-usd 999`,
        `${L} p/c --reprendre`,
        `${L} p/c '--reprendre'`,
        `${L} p/c "--reveil" --pour q`,
        `${L} p/c --detach --budget""-usd 999`,
        `${L} p/c --detach --bud\\get-usd 999`,
        `${L} p/c --detach --budget-usd 5 "--budget-usd" 999`,
        `${L} {--budget-usd,999} p/c --detach`,
        `node -e "require('child_process').execFileSync('node',[process.argv[1],'p/c','--detach','--budget-usd','999'],{stdio:'inherit'})" '${SPAWN_JS}'`,
        `${L} --add-dir p/c q --detach`,
        `${L} p/c --detach --forcer`,
        `${L} q --detach`,
        `${L} p/c/d --detach`,
        `${L} --arret p/c`,
        `${L} --controle q`,
        `${L} --nettoyer-worktree q --dry-run`,
        `${L} --bootstrap --dry-run`,
      ];
      const acceptes = refusees.map((c) => ({ c, r: bash(c) })).filter(({ r }) => r.status === 0 || !/refus du lanceur/.test(r.stderr));
      assert.deepEqual(acceptes.map(({ c, r }) => `${c} → ${r.status} ${String(r.stderr).slice(0, 80)}`), []);
      assert.equal(reveilsDe(root, 'p/c').taches.length + reveilsDe(root, 'q').taches.length, 0, 'aucune tâche lancée');
      assert.equal(fs.existsSync(path.join(root, 'mission', 'registry', 'REVEILS.md')), false, 'aucun réveil');
      // Permis : dry-run (même au-delà du plafond, ne lance rien), liste des tâches, enfant direct au budget permis.
      for (const c of [`${L} p/c --dry-run --budget-usd 999`, `${L} --taches`]) {
        const r = bash(c);
        assert.equal(r.status, 0, `${c} → ${r.status} ${r.stderr}`);
      }
      const r = bash(`${L} p/c --detach --budget-usd 5`);
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /p\/c ▸ détaché · tâche/);
    } finally {
      tuerTaches(root);
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  'troisième revue n° 77 : les appelants internes qui héritent de HOLARCH_INSTANCE (wakeWaiters → detachLaunch, guetteur de job) ne sont pas refusés — le réveil de x a lieu',
  { skip: SKIP },
  async () => {
    const JOBS_JS = path.join(__dirname, '..', 'bin', 'jobs.js');
    const cas = {
      // Un lanceur de p/c lancé depuis la session de p (HOLARCH_INSTANCE=p) réveille x en fin de session (finishLaunch).
      wakeWaiters: ['-e', "require(process.argv[1]).wakeWaiters(process.argv[2], 'p/c')", SPAWN_JS],
      // Un job lancé depuis la session de p : son guetteur lance `--reveil --pour x`.
      guetteur: ['-e', 'require(process.argv[1]).reprendre(process.argv[2])', JOBS_JS],
    };
    const bilan = {};
    for (const [nom, argv] of Object.entries(cas)) {
      const root = makeRoot();
      try {
        statutReveilX(root);
        if (nom === 'guetteur') ecrireJob(root, 'orph', { etat: 'en-cours', pid_superviseur: 2 ** 22 - 5, pgid: 2 ** 22 - 5 });
        const env = envPropre(root, {
          HOLARCH_INSTANCE: 'p', HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE, HOLARCH_FAKE_SCENARIO: SCENARIO, HOLARCH_ATTENTE_429_MS: '20000',
          HOLARCH_JOB_REVEIL: SPAWN_JS, HOLARCH_JOB_REVEIL_ATTENTE_MAX_MS: '20000',
        });
        await finDe(spawn(process.execPath, [...argv, root], { cwd: root, env, stdio: 'ignore' }));
        await new Promise((res) => { setTimeout(res, 2500); }); // guetteur (pas 1000 ms) puis démarrage du lanceur de x
        const taches = reveilsDe(root, 'x').taches;
        const logs = taches.map((t) => { try { return fs.readFileSync(path.join(root, 'mission', '.holarch', 'tasks', `${t.id}.log`), 'utf8'); } catch (_) { return ''; } }).join('\n');
        const vivants = taches.filter((t) => { try { process.kill(t.pid, 0); return true; } catch (_) { return false; } }).length;
        bilan[nom] = `${vivants} vivant(s)${/refus du lanceur/.test(logs) ? ', REFUSÉ' : ''}`;
      } finally {
        try { process.kill(JSON.parse(fs.readFileSync(path.join(root, 'mission', '.holarch', 'live', 'x.guetteur'), 'utf8')).pid, 'SIGKILL'); } catch (_) { /* aucun guetteur */ }
        tuerTaches(root);
        fs.rmSync(root, { recursive: true, force: true });
      }
    }
    assert.deepEqual(bilan, { wakeWaiters: '1 vivant(s)', guetteur: '1 vivant(s)' });
  },
);

test(
  'troisième revue n° 77 : refus tenus sur le dépôt de la session — depuis son worktree vers l\'arbre principal (`--root`) refusé ; un banc de test sur une racine jetable ne l\'est pas',
  { skip: SKIP },
  () => {
    const root = makeRootPcq();
    const wt = `${root}-wt`;
    const autre = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-autre-depot-'));
    try {
      execFileSync('git', ['worktree', 'add', '-q', '-b', 'holarch/p', wt], { cwd: root });
      const reprendre = (rootSession) => spawnSync(process.execPath, [SPAWN_JS, '--reprendre', '--root', root],
        { cwd: rootSession, env: envPropre(rootSession, { HOLARCH_INSTANCE: 'p' }), encoding: 'utf8', timeout: 20000 });
      const depuisWorktree = reprendre(wt);
      assert.notEqual(depuisWorktree.status, 0);
      assert.match(depuisWorktree.stderr, /refus du lanceur \(instance p\) : --reprendre/);
      const banc = reprendre(autre);
      assert.equal(banc.status, 0, banc.stderr);
      assert.match(banc.stdout, /aucune tâche à reprendre/);
    } finally {
      try { execFileSync('git', ['worktree', 'remove', '--force', wt], { cwd: root }); } catch (_) { /* déjà retiré */ }
      fs.rmSync(wt, { recursive: true, force: true });
      fs.rmSync(autre, { recursive: true, force: true });
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
