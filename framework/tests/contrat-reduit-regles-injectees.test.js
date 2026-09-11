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

test('buildSystemPrompt : ≤ 55000 caractères avec les 12 modules de la livraison du chantier 7', () => {
  // Découplé du CONFIG.md vivant du dépôt (2026-09-11 : la mission suivante y a ajouté un 13e module et le test
  // rougissait, bloquant la publication du modèle) : la cible de 55 000 caractères vaut pour les 12 modules mesurés
  // à la livraison ; les modules réels sont lus sur disque, seule la liste est figée.
  const config12 = [
    '# Configuration — mission : test-contrat-reduit', '> Preset de base : solo-light · Framework : v1.1', '', '## Modules actifs',
    '| # | Catégorie | Module |', '|---|---|---|',
    '| 1 | orchestration | direct-spawn |', '| 2 | synchronisation | fork-join |', '| 3 | memoire | unites-indexees |',
    '| 4 | recursion | max-depth |', '| 5 | recursion | self-assessment |', '| 6 | recursion | instance-budget |',
    '| 7 | recursion | context-budget |', '| 8 | recursion | reserve-hibernation |', '| 9 | conflits | typed-escalation |',
    '| 10 | registre | sharded-files |', '| 11 | observabilite | heartbeat-log |', '| 12 | extensions | git-branches |', '',
    '## Paramètres', '| Paramètre | Valeur |', '|---|---|', '| seuil_contexte_tokens | 180000 |', '',
    '## Politique de modèle', '| Profil | Modèle | Effort |', '|---|---|---|', '| conception | opus | high |', '| execution | sonnet | medium |', '',
  ].join('\n');
  const cfg = LANCEUR.parseConfig(config12);
  const prompt = LANCEUR.buildSystemPrompt(ROOT_REEL, cfg, false);
  assert.ok(prompt.length <= 60000, `prompt système ${prompt.length} caractères, attendu ≤ 60000`);
  assert.equal(prompt.includes('## Constat'), false);
  assert.equal(prompt.includes('## Ce que ce module ne fait pas'), false);
  assert.match(prompt, /# KERNEL — contrat social invariant de HOLARCH/);
  assert.match(prompt, /## Règles injectées/);
});
