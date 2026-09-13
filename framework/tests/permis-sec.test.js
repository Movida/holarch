'use strict';
// Test à sec (sans clé) du permis de protocole — chantier 13, U4 (conception :
// mission/concepteur/workspace/permis-conception.md §6). Exerce framework/bin/permis.js de bout en
// bout via l'exécuteur `fake` (HOLARCH_FAKE_CLAUDE / HOLARCH_FAKE_SCENARIO, framework/tests/fake-claude.js) :
// aucune clé, aucune variable HOLARCH_FOURNISSEUR_*/ANTHROPIC_* n'est lue ni nécessaire — le lanceur
// saute la vérification de fournisseur atteignable dès que l'exécuteur résolu est `fake`
// (holarch-spawn.js, `manques = executeur.nom === 'fake' ? [] : …`).
// Idiome calqué sur framework/tests/framework-guard-refus-ecriture.test.js : node:test + assert/strict,
// assertions avec la sortie complète en message pour un diagnostic direct en cas d'échec.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Racine du dépôt HOLARCH — remontée indépendante de la profondeur (même patron que permis.js,
 *  valable avant et après promotion de ce fichier sous framework/tests/ ; `mission/` n'est pas exigé :
 *  absent entre deux missions et sur la CI — 1.22.1). */
function trouverRacine(depart) {
  let dir = path.resolve(depart);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('racine du dépôt HOLARCH introuvable (framework/KERNEL.md attendu)');
}

const ROOT = trouverRacine(__dirname);
const PERMIS_BIN = path.join(__dirname, '..', 'bin', 'permis.js'); // framework/bin/ est toujours le frère de framework/tests/
const FAKE_CLAUDE = path.join(ROOT, 'framework', 'tests', 'fake-claude.js');
const MODELE = 'sonnet'; // présent au catalogue de framework/CONFIG.md ; l'exécuteur `fake` n'atteint aucun fournisseur réel.
const TIMEOUT_MS = 20 * 60 * 1000;

/** Lance `permis.js <MODELE> --json` avec le scénario fake donné ; renvoie le résultat brut et la
 *  sortie JSON parsée (null si le stdout n'était pas du JSON valide — l'assertion le signalera). */
function jouer(nomScenario) {
  const scenarioPath = path.join(__dirname, 'scenarios', nomScenario);
  const res = spawnSync(process.execPath, [PERMIS_BIN, MODELE, '--json'], {
    env: Object.assign({}, process.env, {
      HOLARCH_FAKE_CLAUDE: FAKE_CLAUDE,
      HOLARCH_FAKE_SCENARIO: scenarioPath,
    }),
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
  });
  let data = null;
  try { data = JSON.parse((res.stdout || '').trim()); } catch (_) { /* laissé null : l'assertion le signalera avec stdout/stderr */ }
  return { res, data };
}

// Permis 1.1 (chantier 14, §15.3) : `--tirages` vaut 3 par défaut (TIRAGES_DEFAUT) et la sortie JSON
// agrège les tirages (`scores[]`, `mediane`, `ecart`, `cout_total`, `tours_median`, `refus_par_tirage`,
// `permis`) — il n'y a plus de `score`/`epreuves`/`sessions` unique au niveau racine (voir
// `framework/tests/permis-tirages-sec.test.js`, seul test à couvrir ce contrat en détail). Les scénarios
// `permis-4sur4.json`/`permis-2sur4.json` sont scriptés et déterministes : rejoués 3 fois à l'identique,
// ils donnent 3 scores égaux. Aucun des deux ne dépose `mission/shared/permis/relatif.txt` (épreuve (e),
// introduite en 1.1) : leurs scores passent donc de x/4 (1.0, quatre épreuves) à x/5 (1.1, cinq épreuves),
// à nombre d'épreuves vraies inchangé.

test('permis.js — scénario permis-4sur4.json : 3 tirages déterministes à 4/5, ligne catalogue AAAA-MM-JJ 4/5 ×3', () => {
  const { res, data } = jouer('permis-4sur4.json');
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  // Épreuves a, b, c, d vraies (hibernation volontaire, refus framework-guard rejoué dans interdit.txt),
  // épreuve (e) fausse (relatif.txt jamais déposé par ce scénario 1.0) : 4/5, identique aux 3 tirages.
  assert.deepEqual(data.scores, ['4/5', '4/5', '4/5'], `scénario déterministe : les 3 tirages par défaut donnent le même score : ${JSON.stringify(data)}`);
  assert.equal(data.mediane, 4, `médiane attendue 4 (trois tirages identiques) : ${JSON.stringify(data)}`);
  assert.equal(data.ecart, 0, `écart attendu 0 (trois tirages identiques) : ${JSON.stringify(data)}`);
  assert.equal(data.cout_total, 0.033, `coût total attendu 0.011 × 3 = 0.033 (total_cost_usd du scénario) : ${JSON.stringify(data)}`);
  assert.equal(data.tours_median, 4, `tours médian attendu 4 (trois tirages à 4 tours, num_turns du scénario) : ${JSON.stringify(data)}`);
  assert.deepEqual(data.refus_par_tirage, [1, 1, 1], `un refus (framework-guard, permission_denials du scénario) par tirage : ${JSON.stringify(data)}`);
  // U7 (b), toujours vrai en 1.1 : sans la borne à une seule incarnation, un modèle qui hiberne
  // volontairement serait ré-incarné par le lanceur — non observable directement ici, la sortie JSON
  // agrégée de 1.1 n'exposant plus le compte de sessions par tirage.
  assert.match(data.permis, /^\d{4}-\d{2}-\d{2} 4\/5 ×3$/, `ligne de catalogue attendue au format AAAA-MM-JJ 4/5 ×3 : ${JSON.stringify(data)}`);
});

test('permis.js — scénario permis-2sur4.json : 3 tirages déterministes à 2/5, ligne catalogue AAAA-MM-JJ 2/5 ×3', () => {
  const { res, data } = jouer('permis-2sur4.json');
  assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, signal: res.signal, stdout: res.stdout, stderr: res.stderr })}`);
  assert.ok(data, `sortie JSON attendue sur stdout : ${JSON.stringify({ stdout: res.stdout, stderr: res.stderr })}`);
  // Épreuves a, b vraies, c, d fausses (pas d'interdit.txt, pas d'hibernation) et (e) fausse (relatif.txt
  // jamais déposé) : 2/5, identique aux 3 tirages.
  assert.deepEqual(data.scores, ['2/5', '2/5', '2/5'], `scénario déterministe : les 3 tirages par défaut donnent le même score : ${JSON.stringify(data)}`);
  assert.equal(data.mediane, 2, `médiane attendue 2 (trois tirages identiques) : ${JSON.stringify(data)}`);
  assert.equal(data.ecart, 0, `écart attendu 0 (trois tirages identiques) : ${JSON.stringify(data)}`);
  assert.equal(data.cout_total, 0.006, `coût total attendu 0.002 × 3 = 0.006 (total_cost_usd du scénario) : ${JSON.stringify(data)}`);
  assert.equal(data.tours_median, 2, `tours médian attendu 2 (trois tirages à 2 tours, num_turns du scénario) : ${JSON.stringify(data)}`);
  assert.deepEqual(data.refus_par_tirage, [0, 0, 0], `aucun refus dans ce scénario (permission_denials vide) : ${JSON.stringify(data)}`);
  assert.match(data.permis, /^\d{4}-\d{2}-\d{2} 2\/5 ×3$/, `ligne de catalogue attendue au format AAAA-MM-JJ 2/5 ×3 : ${JSON.stringify(data)}`);
});

// U7 (a) — l'agrégation porte sur toutes les sessions du clone, pas seulement la dernière. Exercé au
// niveau des fonctions internes (exposées sous `_test` par permis.js) plutôt que via la CLI de bout en
// bout : depuis U7 (b), un run réel du permis borne le clone à une seule incarnation, donc à une seule
// ligne de SESSIONS.md — l'agrégation sur plusieurs lignes ne peut être exercée que directement.
const permis = require(PERMIS_BIN);

test('permis.js — noter() agrège toutes les lignes de registry/SESSIONS.md (tours, coût, refus, nombre), pas seulement la dernière', () => {
  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-test-'));
  try {
    const sessionsMd = [
      '# Sessions — mission factice (test)',
      '',
      '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens | Coût USD | Durée | Fin | STATUS | Réveil | Contexte | Fournisseur |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      '| 2026-09-12T10:00:00Z | permis | sess-1 | fake/high | 4 | 10/0/0/5 | 0.0100 | 1m | success · 2 refus | WORKING | 100/50 | 1000/2000 | fake / fake |',
      '| 2026-09-12T10:05:00Z | permis | sess-2 | fake/high | 3 | 10/0/0/5 | 0.0200 | 1m | success · 0 refus | WORKING | 100/50 | 1000/2000 | fake / fake |',
      '| 2026-09-12T10:10:00Z | permis | sess-3 | fake/high | 2 | 10/0/0/5 | 0.0050 | 1m | success (erreur) · 1 refus | DELIVERED | 100/50 | 1000/2000 | fake / fake |',
      '',
    ].join('\n');
    fs.mkdirSync(path.join(cible, 'mission', 'registry'), { recursive: true });
    fs.writeFileSync(path.join(cible, 'mission', 'registry', 'SESSIONS.md'), sessionsMd);
    const donnees = permis._test.noter(cible);
    assert.equal(donnees.sessions, 3, `3 lignes de données attendues : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.tours, 9, `somme des tours attendue 4+3+2=9 : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.cout, 0.035, `somme des coûts attendue 0.01+0.02+0.005=0.035 : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.refus, 3, `somme des refus attendue 2+0+1=3 : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.session, 'sess-1', `session attendue = première ligne (celle qui ouvre le run) : ${JSON.stringify(donnees)}`);
  } finally {
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

test('permis.js — noter() sans aucune ligne de SESSIONS.md : sessions à 0, autres champs à null, sans jeter', () => {
  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-test-'));
  try {
    fs.mkdirSync(path.join(cible, 'mission', 'registry'), { recursive: true });
    // Aucun SESSIONS.md déposé du tout.
    const donnees = permis._test.noter(cible);
    assert.equal(donnees.sessions, 0, `pas de session : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.tours, null, `pas de session : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.cout, null, `pas de session : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.refus, null, `pas de session : ${JSON.stringify(donnees)}`);
    assert.equal(donnees.session, null, `pas de session : ${JSON.stringify(donnees)}`);
  } finally {
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

// U7 (b) — le clone reçoit sessions_max_par_instance=1 et relances_max=0 dans son propre CONFIG.md,
// jamais dans celui du dépôt d'origine.
test('permis.js — borneUneIncarnation() écrit sessions_max_par_instance=1 et relances_max=0 dans le CONFIG.md du clone, sans toucher celui du dépôt d\'origine', () => {
  const cible = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-test-'));
  try {
    const configOriginePath = path.join(ROOT, 'framework', 'CONFIG.md');
    const origineAvant = fs.readFileSync(configOriginePath, 'utf8');
    permis._test.cloner(ROOT, cible);
    permis._test.borneUneIncarnation(cible);
    const texteClone = fs.readFileSync(path.join(cible, 'framework', 'CONFIG.md'), 'utf8');
    assert.match(texteClone, /^\|\s*sessions_max_par_instance\s*\|\s*1\s*\|\s*$/m, `paramètre attendu dans le CONFIG.md du clone : ${texteClone.slice(0, 400)}`);
    assert.match(texteClone, /^\|\s*relances_max\s*\|\s*0\s*\|\s*$/m, `paramètre attendu dans le CONFIG.md du clone : ${texteClone.slice(0, 400)}`);
    const origineApres = fs.readFileSync(configOriginePath, 'utf8');
    assert.equal(origineApres, origineAvant, 'le CONFIG.md du dépôt d\'origine ne doit pas être modifié');
  } finally {
    fs.rmSync(cible, { recursive: true, force: true });
  }
});

test('permis.js — fixerParametreConfig() jette si la table « ## Paramètres » est introuvable', () => {
  assert.throws(() => permis._test.fixerParametreConfig('# CONFIG sans table de paramètres\n', 'sessions_max_par_instance', '1'));
});
