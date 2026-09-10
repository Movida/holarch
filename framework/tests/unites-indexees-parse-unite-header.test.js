'use strict';
// Point 1 du §2.6 : parseUniteHeader — en-tête valide, fichier sans en-tête → null, clés manquantes tolérées.
const test = require('node:test');
const assert = require('node:assert/strict');
const { LANCEUR } = require('./unites-indexees-setup.js');

const FICHE_OK = `<!-- Fiche d'unité de travail -->
---
id: U3
date: 2026-09-10T05:20:00Z
critere: fonctions ajoutées, exportées, vérifiées ; commit
resultat: PASS
preuve: extraits de sortie Node
commit: abc1234
tags: hooks, sleep-guard
---
## Ce qui a été fait
Étendu sleepGuard.

## Ce qui reste ouvert
rien

## Pièges rencontrés
aucun
`;

test('parseUniteHeader : en-tête valide → tous les champs', () => {
  const h = LANCEUR.parseUniteHeader(FICHE_OK);
  assert.deepEqual(h, {
    id: 'U3', date: '2026-09-10T05:20:00Z',
    critere: 'fonctions ajoutées, exportées, vérifiées ; commit',
    resultat: 'PASS', preuve: 'extraits de sortie Node', commit: 'abc1234', tags: 'hooks, sleep-guard',
  });
});

test('parseUniteHeader : fichier sans deux lignes "---" → null', () => {
  assert.equal(LANCEUR.parseUniteHeader('# Pas une fiche\ncontenu quelconque\n'), null);
  assert.equal(LANCEUR.parseUniteHeader('---\nid: U1\n'), null); // une seule ligne "---"
  assert.equal(LANCEUR.parseUniteHeader(''), null);
  assert.equal(LANCEUR.parseUniteHeader(undefined), null);
});

test('parseUniteHeader : clés manquantes tolérées (chaîne vide, pas d\'exception)', () => {
  const h = LANCEUR.parseUniteHeader('---\nid: U9\nresultat: PARTIEL\n---\ncorps\n');
  assert.equal(h.id, 'U9');
  assert.equal(h.resultat, 'PARTIEL');
  assert.equal(h.date, '');
  assert.equal(h.critere, '');
  assert.equal(h.preuve, '');
  assert.equal(h.commit, '');
  assert.equal(h.tags, '');
});
