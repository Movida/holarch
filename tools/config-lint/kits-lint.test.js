'use strict';
// Test de `config-lint --kits` (chantier 17, docs/IMPLEMENTATION.md §17.2). Tourne dans le paquet promouvable
// (cible-tools/tools/config-lint/) comme après promotion (tools/config-lint/) : tout est relatif à __dirname.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { lintKit, lintKits } = require('./kits-lint');
const CONFIG_LINT = path.join(__dirname, 'config-lint.js');

function ecrire(racine, rel, contenu) {
  const p = path.join(racine, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenu);
}

const VERIF = [
  "'use strict';",
  '// Garantit : rien, fixture de test. Vérifier : --a-sec rend 0.',
  "if (process.argv.includes('--help')) { console.log('usage : v.js <fichier> | --a-sec'); process.exit(0); }",
  "if (process.argv.includes('--a-sec')) { console.log('ok'); process.exit(0); }",
  'process.exit(2);',
].join('\n');

/** Kit conforme : INDEX + une référence, un vérificateur, un prompt. */
function kitConforme(nom = 'demo') {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'kits-lint-'));
  const k = `kits/${nom}`;
  ecrire(racine, `${k}/INDEX.md`, [
    '# Kit demo', 'Domaine de démonstration.', '## Quand attacher', 'Jamais en vrai.', '## Pièces',
    '- `references/limites.md` — limites du service', '- `verificateurs/v.js` — contrôle', '- `prompts/base.md` — bloc de base', '',
  ].join('\n'));
  ecrire(racine, `${k}/references/limites.md`, '# Limites\n> Garantit : les limites connues.\n> Vérifier : relire la date.\n');
  ecrire(racine, `${k}/prompts/base.md`, '# Base\n> Garantit : un bloc court.\n> Vérifier : compter les caractères.\n');
  ecrire(racine, `${k}/verificateurs/v.js`, VERIF);
  return { racine, dir: path.join(racine, k), kits: path.join(racine, 'kits') };
}

test('kit conforme : aucune erreur, --help et --a-sec exécutés', () => {
  const { dir } = kitConforme();
  const r = lintKit(dir);
  assert.deepEqual(r.erreurs, []);
});

test('INDEX.md absent, trop long, sans « Quand attacher » -> erreurs', () => {
  const a = kitConforme();
  fs.rmSync(path.join(a.dir, 'INDEX.md'));
  assert.match(lintKit(a.dir).erreurs.join('\n'), /INDEX\.md absent/);
  const b = kitConforme();
  const idx = fs.readFileSync(path.join(b.dir, 'INDEX.md'), 'utf8');
  fs.writeFileSync(path.join(b.dir, 'INDEX.md'), idx.replace('## Quand attacher', '## Usage') + 'x\n'.repeat(60));
  const e = lintKit(b.dir).erreurs.join('\n');
  assert.match(e, /lignes \(borne 60\)/);
  assert.match(e, /Quand attacher/);
});

test('pièce non listée, sans Garantit/Vérifier, citée mais absente -> erreurs', () => {
  const { dir } = kitConforme();
  ecrire(dir, 'references/orpheline.md', '# Sans en-tête\n');
  fs.appendFileSync(path.join(dir, 'INDEX.md'), '- `prompts/fantome.md` — absent\n');
  const e = lintKit(dir).erreurs.join('\n');
  assert.match(e, /references\/orpheline\.md n'est pas listé/);
  assert.match(e, /orpheline\.md : « Garantit : » et « Vérifier : »/);
  assert.match(e, /cite prompts\/fantome\.md, absent/);
});

test('vérificateur sans --a-sec, ou dont --a-sec échoue -> erreur', () => {
  const { dir } = kitConforme();
  fs.writeFileSync(path.join(dir, 'verificateurs/v.js'), VERIF.replace("console.log('ok'); process.exit(0)", 'process.exit(3)'));
  assert.match(lintKit(dir).erreurs.join('\n'), /--a-sec : code 3/);
  fs.writeFileSync(path.join(dir, 'verificateurs/v.js'), '// Garantit : x. Vérifier : y.\nprocess.exit(0);\n');
  assert.match(lintKit(dir).erreurs.join('\n'), /pas d'option --a-sec/);
});

test('adresse électronique ou motif de clé -> erreur (rien de nominatif)', () => {
  const { dir } = kitConforme();
  fs.appendFileSync(path.join(dir, 'references/limites.md'), 'contact : quelqu.un@exemple.org\n');
  fs.appendFileSync(path.join(dir, 'prompts/base.md'), `clé ${'sk-'}abcdefghijkl\n`);
  const e = lintKit(dir).erreurs.join('\n');
  assert.match(e, /adresse électronique/);
  assert.match(e, /clé d'API/);
});

test('nom de kit hors kebab-case -> erreur ; répertoire de kits absent ou vide -> erreur (jamais un 0 à vide)', () => {
  const { kits } = kitConforme('Mauvais_Nom');
  assert.match(lintKits(kits).erreurs.join('\n'), /nom de kit invalide/);
  assert.match(lintKits(path.join(os.tmpdir(), 'kits-inexistants-xyz')).erreurs.join('\n'), /répertoire absent/);
  assert.match(lintKits(fs.mkdtempSync(path.join(os.tmpdir(), 'kits-vide-'))).erreurs.join('\n'), /aucun kit/);
});

test('config-lint --kits <dir> : code 0 si conforme, 1 sinon ; --json', () => {
  const ok = kitConforme();
  const r0 = spawnSync(process.execPath, [CONFIG_LINT, '--kits', ok.kits], { encoding: 'utf8' });
  assert.equal(r0.status, 0, r0.stdout + r0.stderr);
  assert.match(r0.stdout, /1 kit\(s\) : demo/);
  fs.rmSync(path.join(ok.dir, 'prompts/base.md'));
  const r1 = spawnSync(process.execPath, [CONFIG_LINT, '--kits', ok.kits, '--json'], { encoding: 'utf8' });
  assert.equal(r1.status, 1);
  assert.ok(JSON.parse(r1.stdout).erreurs.length >= 1);
});
