'use strict';
/**
 * Tests de cli.js — les deux morceaux purs : `parseFlags` (argv → drapeaux) et `chargeAsk`
 * (drapeaux → charge utile `submit_task`). `executer()` lui-même dépend du démon, testé ailleurs.
 *
 * `chargeAsk` n'existait pas à l'Étape 2 initiale : l'assemblage était en ligne dans `executer`
 * et n'était donc couvert par aucun test — ni par ceux de `parseFlags`, ni par ceux du démon qui
 * partent d'une charge utile déjà formée. L'appel réel de validation a montré que `--space` et
 * `--specialist` étaient silencieusement perdus. Les tests ci-dessous ferment ce trou.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { parseFlags, chargeAsk, usage } = require('./cli');

test('parseFlags sépare positionnels et options --clé valeur', () => {
  const { positionnels, options } = parseFlags(['refine', '--space', 'projet-x']);
  assert.deepStrictEqual(positionnels, ['refine']);
  assert.strictEqual(options.space, 'projet-x');
});

test('parseFlags traite un --drapeau sans valeur suivante comme un booléen', () => {
  const { options } = parseFlags(['--review']);
  assert.strictEqual(options.review, true);
});

test('parseFlags gère plusieurs options mêlées à des positionnels', () => {
  const { positionnels, options } = parseFlags(['ask', 'une question', '--profile', 'execution', '--max-turns', '5']);
  assert.deepStrictEqual(positionnels, ['ask', 'une question']);
  assert.strictEqual(options.profile, 'execution');
  assert.strictEqual(options['max-turns'], '5');
});

// --- chargeAsk : tout drapeau documenté dans usage() doit atteindre le démon ---

function charge(argv) {
  const { positionnels, options } = parseFlags(argv);
  return chargeAsk(positionnels, options);
}

test('chargeAsk transmet --space au démon (régression : perdu silencieusement)', () => {
  const c = charge(['ask', 'une question', '--profile', 'execution', '--space', 'projet-x']);
  assert.strictEqual(c.space, 'projet-x');
});

test('chargeAsk traduit --specialist (singulier) en specialists (tableau, contrat MCP)', () => {
  const c = charge(['ask', 'q', '--profile', 'execution', '--specialist', 'architecte-logiciel']);
  assert.deepStrictEqual(c.specialists, ['architecte-logiciel']);
});

test('chargeAsk sans --space ni --specialist laisse le démon appliquer ses défauts', () => {
  const c = charge(['ask', 'q', '--profile', 'execution']);
  assert.strictEqual(c.space, undefined);
  assert.deepStrictEqual(c.specialists, []);
});

test('chargeAsk exige --profile', () => {
  assert.throws(() => charge(['ask', 'q']), /--profile est obligatoire/);
});

test('chargeAsk convertit en nombres les drapeaux numériques', () => {
  const c = charge(['ask', 'q', '--profile', 'execution', '--level', '1',
    '--max-budget-usd', '2.5', '--max-turns', '8', '--timeout-s', '60']);
  assert.strictEqual(c.level, 1);
  assert.strictEqual(c.max_budget_usd, 2.5);
  assert.strictEqual(c.max_turns, 8);
  assert.strictEqual(c.timeout_s, 60);
});

test('chargeAsk relaie modèle, effort et instructions tels quels', () => {
  const c = charge(['ask', 'q', '--profile', 'relecture', '--model', 'opus',
    '--effort', 'high', '--instructions', 'sois bref']);
  assert.strictEqual(c.profile, 'relecture');
  assert.strictEqual(c.model, 'opus');
  assert.strictEqual(c.effort, 'high');
  assert.strictEqual(c.instructions, 'sois bref');
});

test('tout drapeau optionnel annoncé par usage() pour ask est bien porté par chargeAsk', () => {
  // Garde-fou contre la récidive : usage() documentait --space et --specialist alors que
  // l'assemblage les ignorait. On vérifie ici que l'aide et le code ne divergent plus.
  const ligneAsk = usage().split('\n').filter((l) => /^\s*(ask |\s+\[--)/.test(l)).join(' ');
  const annonces = [...ligneAsk.matchAll(/--([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(annonces.includes('space') && annonces.includes('specialist'), 'aide inattendue');
  const c = charge(['ask', 'q', '--profile', 'execution', '--space', 's', '--specialist', 'generaliste']);
  const porte = { space: c.space, specialist: c.specialists[0] };
  assert.deepStrictEqual(porte, { space: 's', specialist: 'generaliste' });
});
