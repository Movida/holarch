'use strict';
// Tests U5 (chantier 7, §9.2/§9.5) : le prompt système n'injecte plus que KERNEL/CONFIG entiers et,
// par module actif, l'en-tête (`>`) + `## Règles injectées` — jamais `## Constat` ni `## Ce que ce
// module ne fait pas`. Cible chiffrée : ≤ 55 000 caractères avec le CONFIG.md réel du dépôt (12 modules).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CIBLE = path.resolve(__dirname, '..');
const ROOT_REEL = path.resolve(CIBLE, '..');
const LANCEUR = require(path.join(CIBLE, 'bin', 'holarch-spawn.js'));

test('extraireEnTeteEtReglesInjectees : garde en-tête + Règles injectées, retire Constat et Ce que ce module ne fait pas', () => {
  const source = [
    '# Module : exemple',
    '> Catégorie : test',
    '> Version : 1.0.0',
    '',
    '## Constat',
    'Texte de constat, ne doit pas apparaître dans le résultat.',
    '',
    '## Paramètres',
    '| Paramètre | Défaut |',
    '',
    '## Règles injectées',
    '### ⚓ ON_PLAN',
    'Règle à conserver.',
    '',
    '## Ce que ce module ne fait pas',
    'Texte final, ne doit pas apparaître non plus.',
    '',
  ].join('\n');
  const r = LANCEUR.extraireEnTeteEtReglesInjectees(source);
  assert.match(r, /# Module : exemple/);
  assert.match(r, /> Version : 1\.0\.0/);
  assert.match(r, /## Règles injectées/);
  assert.match(r, /Règle à conserver\./);
  assert.equal(r.includes('## Constat'), false);
  assert.equal(r.includes('Texte de constat'), false);
  assert.equal(r.includes('## Ce que ce module ne fait pas'), false);
  assert.equal(r.includes('Texte final'), false);
  assert.equal(r.includes('## Paramètres'), false);
});

test('extraireEnTeteEtReglesInjectees : repli fail-open (texte entier) si Règles injectées est absent', () => {
  const source = '# Module : minimal\n';
  assert.equal(LANCEUR.extraireEnTeteEtReglesInjectees(source), source);
});

test('buildSystemPrompt : ≤ 55000 caractères avec le CONFIG.md réel du dépôt (12 modules actifs)', () => {
  const cfg = LANCEUR.parseConfig(fs.readFileSync(path.join(CIBLE, 'CONFIG.md'), 'utf8'));
  const prompt = LANCEUR.buildSystemPrompt(ROOT_REEL, cfg, false);
  assert.ok(prompt.length <= 55000, `prompt système ${prompt.length} caractères, attendu ≤ 55000`);
  assert.equal(prompt.includes('## Constat'), false);
  assert.equal(prompt.includes('## Ce que ce module ne fait pas'), false);
  assert.match(prompt, /# KERNEL — contrat social invariant de HOLARCH/);
  assert.match(prompt, /## Règles injectées/);
});
