'use strict';
/**
 * Tests du validateur module-forge — `node --test tools/module-forge/`
 * Sans dépendance externe (node:test), comme les tests du harnais (framework/tests/).
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { validerModule, validerConfig, construireContexte } = require('./validate-module.js');

const RACINE = path.resolve(__dirname, '..', '..');
const ctxReel = () => construireContexte({ extras: [] });

const MODULE_OK = `# Module : essai-forge
> Catégorie : observabilite
> Version : 0.1.0
> Requiert : —
> Incompatible avec : —
> Complète bien : sharded-files

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|
| seuil | 3 | Nombre d'événements avant consignation. |

## Règles injectées

### ⚓ ON_ORIENT
Consigne une ligne de plan de session dans le fichier prévu.

### ⚓ ON_SLEEP
Consigne l'état final de la session avant de mourir.
`;

let tmp;
test.before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-')); });
test.after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function ecrire(nom, contenu) {
  const p = path.join(tmp, nom);
  fs.writeFileSync(p, contenu);
  return p;
}

test('un module conforme mais non catalogué passe, avec un avertissement MANIFEST', () => {
  const r = validerModule(ecrire('essai-forge.md', MODULE_OK), ctxReel());
  assert.deepStrictEqual(r.erreurs, []);
  assert.ok(r.avertissements.some((a) => /MANIFEST/.test(a)), 'absence du MANIFEST attendue en avertissement');
});

test('en-tête incomplète, catégorie inconnue et version non semver sont des erreurs', () => {
  const p = ecrire('bancal.md', `# Module : bancal
> Catégorie : gouvernance
> Version : 1.0

## Paramètres
| Paramètre | Défaut | Description |
|---|---|---|

## Règles injectées
### ⚓ ON_SLEEP
Fais quelque chose.
`);
  const e = validerModule(p, ctxReel()).erreurs.join(' | ');
  assert.match(e, /Requiert/);
  assert.match(e, /Incompatible avec/);
  assert.match(e, /catégorie « gouvernance » inconnue/);
  assert.match(e, /non semver/);
});

test('un hook inexistant est refusé, un hook vide aussi', () => {
  const p = ecrire('faux-hook.md', MODULE_OK.replace('### ⚓ ON_ORIENT\nConsigne une ligne de plan de session dans le fichier prévu.', '### ⚓ ON_COMMIT\n'));
  const e = validerModule(p, ctxReel()).erreurs.join(' | ');
  assert.match(e, /hook « ON_COMMIT » inexistant/);
  assert.match(e, /sans instruction/);
});

test('le nom du module doit suivre le nom de fichier et être kebab-case', () => {
  const p = ecrire('autre-nom.md', MODULE_OK);
  assert.match(validerModule(p, ctxReel()).erreurs.join(' | '), /diffère du nom de fichier/);
  const q = ecrire('Essai_Forge.md', MODULE_OK.replace('essai-forge', 'Essai_Forge'));
  assert.match(validerModule(q, ctxReel()).erreurs.join(' | '), /non kebab-case/);
});

test('une incompatibilité déclarée dans un seul sens est détectée', () => {
  const p = ecrire('solitaire.md', MODULE_OK.replace('solitaire', 'solitaire').replace('# Module : essai-forge', '# Module : solitaire').replace('> Incompatible avec : —', '> Incompatible avec : fork-join'));
  assert.match(validerModule(p, ctxReel()).erreurs.join(' | '), /asymétrique/);
});

test('une référence à un module inconnu du MANIFEST est une erreur', () => {
  const p = ecrire('reveur.md', MODULE_OK.replace('# Module : essai-forge', '# Module : reveur').replace('> Requiert : —', '> Requiert : module-inexistant'));
  assert.match(validerModule(p, ctxReel()).erreurs.join(' | '), /module inconnu du MANIFEST/);
});

test('les formulations qui prétendent lever un invariant sont signalées, sans bloquer', () => {
  const p = ecrire('effronte.md', MODULE_OK.replace('# Module : essai-forge', '# Module : effronte')
    .replace('Consigne l\'état final de la session avant de mourir.', 'Termine ta session sans passer par ON_SLEEP si tu es pressé.'));
  const r = validerModule(p, ctxReel());
  assert.deepStrictEqual(r.erreurs, []);
  assert.match(r.relectures.join(' | '), /ON_SLEEP/);
});

test('le catalogue réel et le CONFIG réel de la mission sont conformes', () => {
  const ctx = ctxReel();
  const dir = path.join(RACINE, 'framework', 'modules');
  const fichiers = [];
  for (const c of fs.readdirSync(dir)) {
    const sous = path.join(dir, c);
    if (!fs.statSync(sous).isDirectory()) continue;
    for (const f of fs.readdirSync(sous)) if (f.endsWith('.md')) fichiers.push(path.join(sous, f));
  }
  assert.ok(fichiers.length >= 12, 'le catalogue doit contenir les modules v1.1');
  for (const f of fichiers) assert.deepStrictEqual(validerModule(f, ctx).erreurs, [], `module non conforme : ${f}`);
  assert.deepStrictEqual(validerConfig(path.join(RACINE, 'framework', 'CONFIG.md'), ctx).erreurs, []);
});

test('T1 rejouable : deux modules incompatibles actifs, catégorie obligatoire manquante, module hors MANIFEST', () => {
  const p = ecrire('CONFIG-invalide.md', `# Configuration — mission : test

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | synchronisation | dependency-graph |
| 4 | memoire | monolithic |
| 5 | recursion | module-fantome |
`);
  const e = validerConfig(p, ctxReel()).erreurs.join(' | ');
  assert.match(e, /fork-join.*dependency-graph.*incompatibles|dependency-graph.*fork-join.*incompatibles/);
  assert.match(e, /catégorie obligatoire « synchronisation » : 2 modules actifs/);
  assert.match(e, /catégorie obligatoire « registre » : aucun module actif/);
  assert.match(e, /« module-fantome » absent du MANIFEST/);
});

test('les presets (bloc CONFIG extrait) sont valides contre le catalogue réel', () => {
  const dir = path.join(RACINE, 'framework', 'presets');
  const presets = fs.readdirSync(dir).filter((n) => n.endsWith('.md'));
  assert.ok(presets.length >= 3, 'au moins trois presets');
  for (const f of presets) {
    const m = fs.readFileSync(path.join(dir, f), 'utf8').match(/```[a-z]*\n(# Configuration[\s\S]*?)\n```/);
    assert.ok(m, `bloc CONFIG introuvable dans ${f}`);
    const p = ecrire(`preset-${f}`, `${m[1]}\n`);
    assert.deepStrictEqual(validerConfig(p, ctxReel()).erreurs, [], `preset non conforme : ${f}`);
  }
});

test('un module candidat passé en --extra rend la configuration qui l\'active valide', () => {
  const mod = ecrire('essai-forge.md', MODULE_OK);
  const cfg = ecrire('CONFIG-candidat.md', `# Configuration — mission : test

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | monolithic |
| 4 | registre | sharded-files |
| 5 | observabilite | essai-forge |
`);
  assert.match(validerConfig(cfg, ctxReel()).erreurs.join(' | '), /« essai-forge » absent du MANIFEST/);
  const ctxExtra = construireContexte({ extras: [mod] });
  assert.deepStrictEqual(validerConfig(cfg, ctxExtra).erreurs, []);
});
