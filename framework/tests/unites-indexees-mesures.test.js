'use strict';
// Critères chiffrés du §2.7 (docs/IMPLEMENTATION.md, chantier 1) gardés en non-régression — réserve
// n° 2 de la promotion : ils étaient mesurés par un script, pas testés.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { mesureCorpusArchive, mesureFixtureDev } = require('./unites-indexees-mesures.js');

const ARCHIVE_V2 = path.resolve(__dirname, '..', '..', 'docs', 'archive', 'mission-holon-v2');

test('mesure (a) : corpus archivé (module monolithic) — prompt utilisateur < 60 000 caractères', { skip: !fs.existsSync(ARCHIVE_V2) && 'docs/archive/ absent (modèle publié, sans archive)' }, () => {
  const a = mesureCorpusArchive();
  assert.ok(a.chars < 60000, `${a.chars} caractères`);
});

test('mesure (b) : fixture unites-indexees (MEMORY 60 lignes, 20 fiches, INBOX 48 messages dont 3 non traités) — prompt utilisateur < 40 000 caractères', () => {
  const b = mesureFixtureDev();
  assert.ok(b.chars < 40000, `${b.chars} caractères`);
});
