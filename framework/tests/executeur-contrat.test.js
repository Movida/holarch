'use strict';
// Chantier 9, volet 1 (docs/IMPLEMENTATION.md §11.1, workspace/interface-executeur.md) : contrat
// commun des trois exécuteurs (claude-code, fake, passerelle). Sans dépendance externe, sans clé de
// fournisseur, sans accès réseau — mêmes garanties que framework/tests/unites-indexees-setup.js pour
// résoudre le chemin de framework/bin/ depuis un test (CIBLE = .., puis bin/...).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const CIBLE = path.resolve(__dirname, '..');
const index = require(path.join(CIBLE, 'bin', 'executeurs', 'index.js'));

// -- 1. Contrat { nom, capacites, preparer, executer, normaliser, limite } -------------------------

test('chaque exécuteur connu respecte le contrat (verifierContrat rend [])', () => {
  const noms = index.noms();
  assert.deepEqual(noms.slice().sort(), ['claude-code', 'fake', 'passerelle'].slice().sort());
  for (const n of noms) {
    const mod = index.resoudre(n);
    assert.deepEqual(index.verifierContrat(mod, n), [], `contrat ${n}`);
    assert.equal(mod.nom, n);
    assert.equal(typeof mod.capacites, 'object');
    for (const c of ['sous_agents', 'hooks', 'prompt_systeme_fichier', 'transcription']) {
      assert.equal(typeof mod.capacites[c], 'boolean', `capacite ${c} de ${n}`);
    }
    for (const m of ['preparer', 'executer', 'normaliser', 'limite']) {
      assert.equal(typeof mod[m], 'function', `${m} de ${n}`);
    }
  }
});

test('verifierContrat détecte un module non conforme (nom, capacites, membres manquants)', () => {
  assert.deepEqual(index.verifierContrat(null), ['module absent ou non exportable']);
  const ecartsNom = index.verifierContrat({ nom: 'autre', capacites: {}, preparer: () => {}, executer: () => {}, normaliser: () => {}, limite: () => {} }, 'claude-code');
  assert.ok(ecartsNom.some((e) => /nom/.test(e)));
  const ecartsVide = index.verifierContrat({});
  assert.ok(ecartsVide.length > 0);
});

// -- 2. Sélection par nom via l'API d'index.js ------------------------------------------------------

test('resoudre : nom connu rend le module, nom inconnu jette avec la liste des noms connus', () => {
  for (const n of index.noms()) {
    assert.equal(index.resoudre(n).nom, n);
  }
  assert.throws(() => index.resoudre('inexistant'), /exécuteur inconnu/);
  assert.throws(() => index.resoudre('inexistant'), /claude-code/);
});

test('nomPour : ordre de précédence fake > fournisseur > params > défaut', () => {
  assert.equal(index.nomPour({ env: {} }), 'claude-code');
  assert.equal(index.nomPour(), 'claude-code');
  assert.equal(index.nomPour({ env: { HOLARCH_FAKE_CLAUDE: '/x.js' }, params: { executeur: 'passerelle' } }), 'fake');
  assert.equal(index.nomPour({ env: {}, fournisseur: { executeur: 'passerelle' }, params: { executeur: 'claude-code' } }), 'passerelle');
  assert.equal(index.nomPour({ env: {}, params: { executeur: 'passerelle' } }), 'passerelle');
  assert.equal(index.DEFAUT, 'claude-code');
});

// -- 3. Normalisation : même Resultat pour les trois exécuteurs, coût absent → null -----------------

const BRUT_SUCCES = {
  stdout: JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, session_id: 'abc', num_turns: 12,
    total_cost_usd: 1.2345,
    usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30, output_tokens: 40 },
    modelUsage: { 'claude-opus-5': { costUSD: 1.0 }, 'claude-haiku-4-5': { costUSD: 0.01 } },
    permission_denials: [1, 2],
    result: 'fini',
  }),
  stderr: '', exitCode: 0,
};

const BRUT_SANS_COUT = {
  stdout: JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, session_id: 'sans-cout', num_turns: 3,
    result: 'ok',
  }),
  stderr: '', exitCode: 0,
};

test('normaliser rend le même Resultat, quel que soit l\'exécuteur, sur le même brut', () => {
  const attendu = index.resoudre('claude-code').normaliser(BRUT_SUCCES);
  for (const n of index.noms()) {
    const r = index.resoudre(n).normaliser(BRUT_SUCCES);
    assert.deepEqual(r, attendu, `normaliser(${n}) diverge de claude-code`);
  }
  assert.equal(attendu.session_id, 'abc');
  assert.equal(attendu.fin, 'success');
  assert.equal(attendu.cout_usd, 1.2345);
  assert.deepEqual(attendu.tokens, { entree: 10, cache_lu: 20, cache_ecrit: 30, sortie: 40 });
  // haiku filtré (bruit d'appels internes) : un seul modèle retenu.
  assert.deepEqual(attendu.modeles, [{ id: 'claude-opus-5', cout_usd: 1.0 }]);
  assert.equal(attendu.refus, 2);
});

test('normaliser : coût absent du JSON brut → cout_usd = null, identique pour les trois exécuteurs', () => {
  for (const n of index.noms()) {
    const r = index.resoudre(n).normaliser(BRUT_SANS_COUT);
    assert.equal(r.cout_usd, null, `cout_usd(${n})`);
    assert.equal(r.session_id, 'sans-cout');
    assert.equal(r.fin, 'success');
  }
});

test('normaliser : sortie sans JSON de résultat → fin = sans_resultat, tous champs présents, identique pour les trois', () => {
  const brut = { stdout: 'bruit sans JSON exploitable', stderr: 'boum', exitCode: 1 };
  const attendu = index.resoudre('claude-code').normaliser(brut);
  assert.equal(attendu.fin, 'sans_resultat');
  assert.equal(attendu.brut, null);
  assert.equal(attendu.cout_usd, null);
  for (const n of index.noms()) {
    assert.deepEqual(index.resoudre(n).normaliser(brut), attendu, `normaliser(${n}) diverge de claude-code`);
  }
});

// -- 4. limite() : reconnaît un résultat 429, pas un résultat ordinaire ------------------------------

test('limite : un résultat 429 est reconnu, identiquement pour les trois exécuteurs', () => {
  const brut429 = { stdout: JSON.stringify({
    type: 'result', subtype: 'error_during_execution', is_error: true, api_error_status: 429,
    result: "You've hit your session limit · resets 11:30pm (UTC)", session_id: 'z', num_turns: 0,
  }) };
  for (const n of index.noms()) {
    const mod = index.resoudre(n);
    const r429 = mod.normaliser(brut429);
    assert.equal(r429.fin, 'limite');
    assert.equal(r429.statut_http, 429);
    const lim = mod.limite(r429);
    assert.ok(lim, `limite(${n}) devrait reconnaître un 429`);
    assert.match(lim.texte, /resets 11:30pm/);
    assert.ok('repriseIso' in lim && 'attenteMs' in lim);
  }
});

test('limite : un résultat ordinaire (success ou erreur non-429) n\'est pas reconnu comme une limite', () => {
  const brutErreur = { stdout: JSON.stringify({
    type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's', num_turns: 200,
  }) };
  for (const n of index.noms()) {
    const mod = index.resoudre(n);
    assert.equal(mod.limite(mod.normaliser(BRUT_SUCCES)), null, `limite(${n}) sur success`);
    const rErr = mod.normaliser(brutErreur);
    assert.equal(rErr.fin, 'erreur');
    assert.equal(mod.limite(rErr), null, `limite(${n}) sur erreur non-429`);
  }
});
