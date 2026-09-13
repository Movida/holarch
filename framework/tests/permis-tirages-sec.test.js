'use strict';
// Test à sec (sans clé) du permis de protocole 1.1 — chantier 14, volet 3, U6 (spec : docs/IMPLEMENTATION.md
// §15.3). Exerce mission/shared/concepteur/cible-framework/framework/bin/permis.js — jamais
// framework/bin/permis.js (fragment non promu) — de bout en bout via l'exécuteur `fake`
// (HOLARCH_FAKE_CLAUDE / HOLARCH_FAKE_SCENARIO, framework/tests/fake-claude.js) : aucune clé, aucune
// variable HOLARCH_FOURNISSEUR_*/ANTHROPIC_* n'est lue ni nécessaire.
// Idiome calqué sur framework/tests/permis-sec.test.js (node:test + assert/strict, sortie complète en
// message d'assertion) et sur cible-framework/framework/tests/path-guard.test.js (chemin sous
// cible-framework/, jamais le fichier promu).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PERMIS_BIN = path.join(__dirname, '..', 'bin', 'permis.js'); // fragment sous cible-framework/, jamais le promu
// Racine du dépôt HOLARCH — même fonction que permis.js (trois marqueurs), réutilisée via `_test` plutôt
// que dupliquée : une copie locale à deux marqueurs se tromperait de racine pour la même raison que
// permis.js avant U11b (cible-framework/ porte KERNEL.md et bin/holarch-spawn.js, jamais CONFIG.md).
const ROOT = require(PERMIS_BIN)._test.trouverRacine(__dirname);
const FAKE_CLAUDE = path.join(ROOT, 'framework', 'tests', 'fake-claude.js');
const MODELE = 'sonnet'; // présent au catalogue de framework/CONFIG.md ; l'exécuteur `fake` n'atteint aucun fournisseur réel.
const TIMEOUT_MS = 20 * 60 * 1000;

function scenarioPath(nom) { return path.join(__dirname, 'scenarios', nom); }

/** Lance `permis.js <MODELE> [...extra] --json` avec le scénario fake donné ; renvoie le résultat brut et
 *  la sortie JSON parsée (null si le stdout n'était pas du JSON valide — l'assertion le signalera). */
function jouer(nomScenario, extra) {
  const chemin = scenarioPath(nomScenario);
  const res = spawnSync(process.execPath, [PERMIS_BIN, MODELE, ...(extra || []), '--json'], {
    env: Object.assign({}, process.env, {
      HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE,
      HOLARCH_FAKE_SCENARIO: chemin,
    }),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  let data = null;
  try { data = JSON.parse((res.stdout || '').trim()); } catch (_) { /* laissé null : l'assertion le signalera avec stdout/stderr */ }
  return { res, data };
}

function nettoyerCompteur(nomScenario) {
  try { fs.unlinkSync(`${scenarioPath(nomScenario)}.attempt`); } catch (_) { /* pas encore de compteur */ }
}

// ---------------------------------------------------------------- (a) --tirages par défaut = 3

test('permis.js (1.1) — --tirages par défaut = 3, code de sortie 0', () => {
  const { res, data } = jouer('permis-5-sans-refus.json');
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  assert.equal(data.scores.length, 3, `3 tirages attendus par défaut : ${JSON.stringify(data)}`);
  assert.equal(data.refus_par_tirage.length, 3, `un compte de refus par tirage, 3 tirages : ${JSON.stringify(data)}`);
  assert.match(data.permis, /×3$/, `ligne de catalogue attendue « ×3 » : ${JSON.stringify(data)}`);
});

// -------------------------------------------------- (b) 7 champs, médiane et écart sur scores connus

test('permis.js (1.1) — --tirages 4 : 7 champs attendus, médiane, écart, coût total, tours médian, refus par tirage', () => {
  nettoyerCompteur('permis-5-etapes-mediane.json');
  const { res, data } = jouer('permis-5-etapes-mediane.json', ['--tirages', '4']);
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  for (const champ of ['modele', 'scores', 'mediane', 'ecart', 'cout_total', 'tours_median', 'refus_par_tirage']) {
    assert.ok(Object.prototype.hasOwnProperty.call(data, champ), `champ « ${champ} » attendu dans la sortie : ${JSON.stringify(data)}`);
  }
  // Scénario à étapes : tirage 1 = 5/5, tirage 2 = 4/5 (sans hibernation, non compté ici, e vrai),
  // tirage 3 = 4/5 (e faux), tirage 4 = 3/5 (sans hibernation ni e) — scores triés [3,4,4,5].
  assert.deepEqual(data.scores, ['5/5', '4/5', '4/5', '3/5'], `scores attendus dans l'ordre des tirages : ${JSON.stringify(data)}`);
  assert.equal(data.mediane, 4, `médiane attendue (4+4)/2 = 4 : ${JSON.stringify(data)}`);
  assert.equal(data.ecart, 2, `écart attendu 5-3 = 2 : ${JSON.stringify(data)}`);
  assert.equal(data.cout_total, 0.07, `coût total attendu 0.01+0.02+0.015+0.025 = 0.07 : ${JSON.stringify(data)}`);
  assert.equal(data.tours_median, 3.5, `tours médian attendu (3+4)/2 = 3.5 (tours triés 2,3,4,5) : ${JSON.stringify(data)}`);
  assert.deepEqual(data.refus_par_tirage, [1, 1, 1, 1], `un refus (framework-guard) par tirage : ${JSON.stringify(data)}`);
  nettoyerCompteur('permis-5-etapes-mediane.json');
});

// ------------------------------------------------------------ (c) épreuve (e) : relatif.txt

test('permis.js (1.1) — épreuve (e) notée 1 quand relatif.txt existe, refus de path-guard corrigé', () => {
  const { res, data } = jouer('permis-5-refus-corrige.json', ['--tirages', '1']);
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  assert.equal(data.scores[0], '5/5', `épreuve (e) attendue vraie (refus corrigé) : ${JSON.stringify(data)}`);
});

test('permis.js (1.1) — épreuve (e) notée 1 quand relatif.txt existe, sans aucun refus de path-guard', () => {
  const { res, data } = jouer('permis-5-sans-refus.json', ['--tirages', '1']);
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  assert.equal(data.scores[0], '5/5', `épreuve (e) attendue vraie (aucun refus, écriture d'emblée) : ${JSON.stringify(data)}`);
});

test('permis.js (1.1) — épreuve (e) notée 0 quand relatif.txt n\'existe pas', () => {
  const { res, data } = jouer('permis-5-absent.json', ['--tirages', '1']);
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  assert.equal(data.scores[0], '4/5', `épreuve (e) attendue fausse (relatif.txt absent) : ${JSON.stringify(data)}`);
});

// ------------------------------------------------------------------ (d) MAX_TOURS = 8

// Vérifié directement sur la constante exportée : un run de bout en bout ne peut pas distinguer « 8 tours
// comptant la clôture » de « 7 tours + 1 hors plafond » sans lire le nombre de tours réellement consommés
// par le lanceur (hors périmètre du scénario fake, qui n'en simule pas la mécanique interne).
test('permis.js (1.1) — MAX_TOURS vaut 8 (tour de clôture compté, écart 1 avec la version 1.0)', () => {
  const permis = require(PERMIS_BIN);
  assert.equal(permis.MAX_TOURS, 8, 'MAX_TOURS attendu à 8');
  assert.equal(permis.TIRAGES_DEFAUT, 3, 'TIRAGES_DEFAUT attendu à 3');
});

// -------------------------------------------------------- (e) ligne de catalogue « AAAA-MM-JJ n/5 ×k »

test('permis.js (1.1) — ligne de catalogue au format exact AAAA-MM-JJ n/5 ×k (n = médiane)', () => {
  nettoyerCompteur('permis-5-etapes-mediane.json');
  const { data } = jouer('permis-5-etapes-mediane.json', ['--tirages', '4']);
  assert.match(data.permis, /^\d{4}-\d{2}-\d{2} 4\/5 ×4$/, `ligne de catalogue attendue AAAA-MM-JJ 4/5 ×4 : ${JSON.stringify(data)}`);
  nettoyerCompteur('permis-5-etapes-mediane.json');
});

// -------------------------------------------------------- U11 : --livrable et appliquerLivrable()

test('permis.js (1.1/U11) — parseArgs accepte --livrable <dir> (résolu en absolu), jette si valeur manquante', () => {
  const permis = require(PERMIS_BIN);
  const relatif = path.join('un', 'chemin', 'relatif');
  const opts = permis._test.parseArgs(['sonnet', '--livrable', relatif]);
  assert.equal(opts.livrable, path.resolve(relatif), `--livrable attendu résolu en chemin absolu : ${JSON.stringify(opts)}`);
  assert.throws(
    () => permis._test.parseArgs(['sonnet', '--livrable']),
    /valeur manquante pour --livrable/,
    '--livrable sans valeur doit jeter',
  );
});

test("permis.js (1.1/U11) — appliquerLivrable() écrit le marqueur d'un livrable factice dans la copie jetable", () => {
  const permis = require(PERMIS_BIN);
  const livrable = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-livrable-'));
  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-cible-'));
  try {
    fs.writeFileSync(path.join(livrable, 'appliquer.js'), `
      const fs = require('fs');
      const path = require('path');
      const depot = process.argv[process.argv.indexOf('--depot') + 1];
      fs.writeFileSync(path.join(depot, 'marqueur-livrable.txt'), 'ok');
    `);
    permis.appliquerLivrable(cible, livrable);
    assert.ok(
      fs.existsSync(path.join(cible, 'marqueur-livrable.txt')),
      "marqueur attendu dans la copie jetable après appliquerLivrable()",
    );
  } finally {
    fs.rmSync(livrable, { recursive: true, force: true });
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

test("permis.js (1.1/U11) — appliquerLivrable() jette quand l'appliquer.js factice sort en code non nul", () => {
  const permis = require(PERMIS_BIN);
  const livrable = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-livrable-echec-'));
  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-cible-echec-'));
  try {
    fs.writeFileSync(path.join(livrable, 'appliquer.js'), `
      process.stderr.write('refus : cible impossible\\n');
      process.exit(1);
    `);
    assert.throws(
      () => permis.appliquerLivrable(cible, livrable),
      /refus : cible impossible/,
      "appliquerLivrable doit jeter et reporter le stderr de l'appliquer.js factice",
    );
  } finally {
    fs.rmSync(livrable, { recursive: true, force: true });
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- mediane() — bornes internes

test('permis.js (1.1) — mediane() : impair = valeur centrale, pair = moyenne des deux centrales, vide = null', () => {
  const permis = require(PERMIS_BIN);
  assert.equal(permis._test.mediane([3, 5, 4]), 4, 'médiane de 3 valeurs (triées 3,4,5) attendue 4');
  assert.equal(permis._test.mediane([3, 4]), 3.5, 'médiane de 2 valeurs attendue 3.5');
  assert.equal(permis._test.mediane([]), null, 'médiane de 0 valeur attendue null');
});

// ------------------------------------------------------------------- U11b : non-régression trouverRacine

test("permis.js (U11b) — trouverRacine() ignore un leurre cible-framework/ sans framework/CONFIG.md", () => {
  const permis = require(PERMIS_BIN);
  const faux = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-faux-depot-'));
  try {
    fs.mkdirSync(path.join(faux, 'framework', 'bin'), { recursive: true });
    fs.writeFileSync(path.join(faux, 'framework', 'KERNEL.md'), 'faux dépôt');
    fs.writeFileSync(path.join(faux, 'framework', 'CONFIG.md'), 'faux dépôt');
    fs.writeFileSync(path.join(faux, 'framework', 'bin', 'holarch-spawn.js'), '// faux dépôt');

    const leurre = path.join(faux, 'mission', 'shared', 'x', 'cible-framework', 'framework');
    fs.mkdirSync(path.join(leurre, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(leurre, 'KERNEL.md'), 'leurre');
    fs.writeFileSync(path.join(leurre, 'bin', 'holarch-spawn.js'), '// leurre');
    // Pas de framework/CONFIG.md dans le leurre : c'est ce qui doit l'écarter.

    assert.equal(
      permis._test.trouverRacine(leurre),
      faux,
      "trouverRacine depuis le leurre doit rendre la racine du faux dépôt, pas le leurre",
    );
  } finally {
    fs.rmSync(faux, { recursive: true, force: true });
  }
});
