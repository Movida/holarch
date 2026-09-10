'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { validerTriage, devis, construirePromptTriage, SCHEMA_TRIAGE } = require('./router');
const { chargerPolitique } = require('./policy');
const ledger = require('./ledger');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('validerTriage accepte une sortie bien formée telle quelle', () => {
  const { sortie, repli_specialistes: repli } = validerTriage({
    level: 1, specialists: ['generaliste'], profile: 'execution', complexity: 'moyenne',
    rationale: 'simple', questions: [], mission_draft: '',
  });
  assert.strictEqual(sortie.level, 1);
  assert.strictEqual(sortie.profile, 'execution');
  assert.deepStrictEqual(sortie.specialists, ['generaliste']);
  assert.strictEqual(repli, false);
});

test('validerTriage retombe sur des défauts sûrs si le niveau ou le profil sont hors catalogue', () => {
  const { sortie } = validerTriage({ level: 99, profile: 'stagiaire' });
  assert.strictEqual(sortie.level, 1);
  assert.strictEqual(sortie.profile, 'execution');
});

test('validerTriage retombe sur generaliste si le LLM suggère un spécialiste hors catalogue', () => {
  const { sortie, repli_specialistes: repli } = validerTriage({ specialists: ['architecte-imaginaire'] });
  assert.deepStrictEqual(sortie.specialists, ['generaliste']);
  assert.strictEqual(repli, true);
});

test('validerTriage vide mission_draft si le niveau n\'est pas 3', () => {
  const { sortie } = validerTriage({ level: 1, mission_draft: 'un brouillon qui ne devrait pas survivre' });
  assert.strictEqual(sortie.mission_draft, '');
});

test('validerTriage plafonne les questions à 3', () => {
  const { sortie } = validerTriage({ questions: ['a', 'b', 'c', 'd', 'e'] });
  assert.strictEqual(sortie.questions.length, 3);
});

test('validerTriage tolère une sortie complètement absente (JSON invalide côté appelant)', () => {
  const { sortie } = validerTriage(null);
  assert.strictEqual(sortie.level, 1);
  assert.deepStrictEqual(sortie.specialists, ['generaliste']);
});

test('le schéma de triage exige les huit champs', () => {
  assert.deepStrictEqual(
    SCHEMA_TRIAGE.required.sort(),
    ['complexity', 'level', 'mission_draft', 'optimized_prompt', 'profile', 'questions', 'rationale', 'specialists'].sort(),
  );
});

test('validerTriage retombe sur le prompt original si optimized_prompt est vide', () => {
  const { sortie } = validerTriage({ optimized_prompt: '' }, 'la demande brute');
  assert.strictEqual(sortie.optimized_prompt, 'la demande brute');
});

test('construirePromptTriage inclut la demande et la table de routage', () => {
  const cfg = chargerPolitique();
  const p = construirePromptTriage({ prompt: 'comment configurer eslint ?', cfg });
  assert.match(p, /comment configurer eslint/);
  assert.match(p, /Complexité/);
});

function racineTemporaire() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-ledger-'));
  process.env.HOLARCH_HOME = d;
  return d;
}

test('devis retombe sur POLICY.md tant que le ledger est vide', () => {
  racineTemporaire();
  const cfg = chargerPolitique();
  const d = devis({ space: 'default', level: 1, profil: 'execution', cfg });
  assert.match(d.source, /défauts de POLICY/);
  assert.strictEqual(d.cost_usd[1], 1); // budget_usd_niveau1 par défaut
});

test('devis utilise le ledger dès 3 échantillons pour ce niveau/profil', () => {
  racineTemporaire();
  const cfg = chargerPolitique();
  for (const cout of [0.1, 0.2, 0.3]) {
    ledger.enregistrer({
      id: ledger.nouvelId(), space: 'default', task: 't', level: 1, specialist: 'generaliste',
      profil: 'execution', modele: 'sonnet', effort: 'medium',
      resultat: { total_cost_usd: cout, num_turns: 1, usage: {} }, elapsedMs: 1000, exit: 'ok',
    });
  }
  const d = devis({ space: 'default', level: 1, profil: 'execution', cfg });
  assert.match(d.source, /observé/);
  assert.notStrictEqual(d.cost_usd[1], null);
});
