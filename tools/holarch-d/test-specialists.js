'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  NOMS_CATALOGUE,
  PROFILS,
  validerFiche,
  chargerCatalogue,
  validerCatalogue,
} = require('./validate-specialists.js');

const CATALOGUE_REEL = path.join(__dirname, 'specialists');

function ficheValide(nom, extra = {}) {
  const meta = Object.assign(
    {
      name: nom,
      profile_default: 'execution',
      tools: 'none',
      panel_affinity: '[architecte-logiciel, relecteur-code]',
    },
    extra,
  );
  return [
    '---',
    `name: ${meta.name}`,
    `profile_default: ${meta.profile_default}`,
    `tools: ${meta.tools}`,
    `panel_affinity: ${meta.panel_affinity}`,
    '---',
    '',
    '## Spécialité',
    'Ligne une.',
    'Ligne deux.',
    'Ligne trois.',
    '',
    '## Quand me solliciter',
    'Une phrase courte et unique.',
    '',
    '## Posture',
    'Ligne une.',
    'Ligne deux.',
    'Ligne trois.',
    '',
    '## Méthode',
    'Ligne une.',
    'Ligne deux.',
    'Ligne trois.',
    '',
    '## Format de réponse',
    'Ligne une.',
    'Ligne deux.',
    'Ligne trois.',
    '',
    '## Hors périmètre',
    'Ligne une.',
    'Ligne deux.',
    'Ligne trois.',
    '',
  ].join('\n');
}

test('le catalogue réel passe validerCatalogue', () => {
  const resultat = validerCatalogue(CATALOGUE_REEL);
  assert.strictEqual(resultat.ok, true, `erreurs : ${resultat.erreurs.join(' | ')}`);
  assert.strictEqual(resultat.fiches.length, 6);
  const noms = resultat.fiches.map((f) => f.nom).sort();
  assert.deepStrictEqual(noms, [...NOMS_CATALOGUE].sort());
});

test('cas invalide : section manquante', () => {
  const texte = ficheValide('generaliste').replace(/## Posture\nLigne une\.\nLigne deux\.\nLigne trois\.\n\n/, '');
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('Posture')), resultat.erreurs.join(' | '));
});

test('cas invalide : sections dans le désordre', () => {
  const base = ficheValide('generaliste');
  const texte = base.replace(
    '## Spécialité\nLigne une.\nLigne deux.\nLigne trois.\n\n## Quand me solliciter',
    '## Quand me solliciter\nUne phrase courte et unique.\n\n## Spécialité\nLigne une.\nLigne deux.\nLigne trois.',
  ).replace('## Quand me solliciter\nUne phrase courte et unique.\n\n## Posture', '## Posture');
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('ordre')), resultat.erreurs.join(' | '));
});

test('cas invalide : name différent du nom de fichier', () => {
  const texte = ficheValide('generaliste');
  const resultat = validerFiche(texte, 'architecte-logiciel.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('"name"')), resultat.erreurs.join(' | '));
});

test('cas invalide : profile_default inconnu', () => {
  const texte = ficheValide('generaliste', { profile_default: 'expert-supreme' });
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('profile_default')), resultat.erreurs.join(' | '));
  for (const p of PROFILS) assert.notStrictEqual(p, 'expert-supreme');
});

test('cas invalide : tools: write', () => {
  const texte = ficheValide('generaliste', { tools: 'write' });
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('"tools"')), resultat.erreurs.join(' | '));
});

test('cas invalide : panel_affinity cite un nom hors catalogue', () => {
  const texte = ficheValide('generaliste', { panel_affinity: '[architecte-logiciel, sorcier-devops]' });
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('sorcier-devops')), resultat.erreurs.join(' | '));
});

test('cas invalide : panel_affinity se cite elle-même', () => {
  const texte = ficheValide('generaliste', { panel_affinity: '[generaliste, architecte-logiciel]' });
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('elle-même')), resultat.erreurs.join(' | '));
});

test('cas invalide : "Quand me solliciter" sur plusieurs lignes', () => {
  const texte = ficheValide('generaliste').replace(
    '## Quand me solliciter\nUne phrase courte et unique.',
    '## Quand me solliciter\nUne phrase.\nEt une seconde ligne.',
  );
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('une seule phrase')), resultat.erreurs.join(' | '));
});

test('cas invalide : "Quand me solliciter" dépasse 200 caractères', () => {
  const phraseLongue = 'x'.repeat(201);
  const texte = ficheValide('generaliste').replace(
    'Une phrase courte et unique.',
    phraseLongue,
  );
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.some((e) => e.includes('200 caractères')), resultat.erreurs.join(' | '));
});

test('validerFiche accumule plusieurs erreurs en un seul appel', () => {
  const texte = ficheValide('autre-nom', { profile_default: 'inconnu', tools: 'write' });
  const resultat = validerFiche(texte, 'generaliste.md');
  assert.ok(resultat.erreurs.length >= 3, `attendu >= 3 erreurs, trouvé ${resultat.erreurs.length} : ${resultat.erreurs.join(' | ')}`);
});

test('chargerCatalogue exclut une fiche cassée sans planter', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalogue-test-'));
  try {
    fs.writeFileSync(path.join(dir, 'generaliste.md'), ficheValide('generaliste'));
    fs.writeFileSync(path.join(dir, 'architecte-logiciel.md'), ficheValide('generaliste'));

    assert.doesNotThrow(() => {
      const { fiches, erreurs } = chargerCatalogue(dir);
      assert.strictEqual(fiches.has('architecte-logiciel'), false);
      assert.strictEqual(fiches.has('generaliste'), true);
      assert.ok(erreurs.length > 0);
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
