'use strict';

/**
 * test-lecture-openrouter.js
 *
 * Tests de lecture-openrouter.js — aucun appel reseau : la fixture locale est
 * lue par le module lui-meme.
 */

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const mod = require('./lecture-openrouter.js');

const FIXTURE = path.join(__dirname, 'exemples', 'openrouter-models.json');
const donnees = mod.lireFichier(FIXTURE);
const entrees = donnees.data;

/** Colonne des couts d'une ligne de catalogue. */
function coutsDe(entree) {
  const champs = mod.ligneCatalogue(entree).split(' | ');
  return champs[4];
}

test('filtrage par motif sur le champ id', function () {
  const retenues = mod.filtrerEntrees(entrees, '^deepseek/');
  assert.strictEqual(retenues.length, 1);
  assert.strictEqual(retenues[0].id, 'deepseek/deepseek-v4.1-flash');
});

test('conversion USD par token vers USD par million', function () {
  assert.strictEqual(mod.versMillions('0.000002'), 2);
  assert.strictEqual(mod.versMillions('0.00000015'), 0.15);
  assert.strictEqual(mod.formaterCout(mod.versMillions('0.0000025')), '2,5');
  assert.strictEqual(mod.formaterCout(mod.versMillions('0.0000000475')), '0,0475');
});

test('entree sans aucun champ de cache : deux couts seulement', function () {
  const qwen = entrees.find(function (e) { return e.id === 'qwen/qwen3-235b-a22b'; });
  assert.strictEqual(coutsDe(qwen), '0,2 / 0,8');
});

test('entree entierement gratuite', function () {
  const gratuit = entrees.find(function (e) { return e.id === 'mistralai/mixtral-8x22b-instruct'; });
  assert.strictEqual(coutsDe(gratuit), '0 / 0 / 0 / 0');
});

test('ligne d en-tete avec date fixee', function () {
  assert.strictEqual(
    mod.ligneEnTete('x.json', '2026-01-02'),
    '<!-- source : x.json · lu le 2026-01-02 -->',
  );
});

test('ligne exacte attendue pour deepseek', function () {
  const d = entrees.find(function (e) { return e.id === 'deepseek/deepseek-v4.1-flash'; });
  assert.strictEqual(
    mod.ligneCatalogue(d),
    '| deepseek-v4.1-flash@openrouter | openrouter | deepseek/deepseek-v4.1-flash | low…high | 0,15 / 0,6 / — / 0,003 | — | — | 200000 |',
  );
});

test('rendu complet : en-tete puis une ligne par entree', function () {
  const source = 'fiche.json';
  const date = '2026-09-12';
  const options = { source: source, motif: null, date: date };
  const sortie = mod.rendreCatalogue(donnees, options);
  const lignes = sortie.split('\n').filter(function (l) { return l !== ''; });
  assert.strictEqual(lignes.length, 9);
  assert.strictEqual(lignes[0], '<!-- source : fiche.json · lu le 2026-09-12 -->');
});
