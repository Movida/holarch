'use strict';
// Point 5 du §2.6 : buildUserPromptDetail avec `unites-indexees` actif — absence des blocs
// JOURNAL/PROGRESS, présence d'un bloc INDEX (régénéré) et d'un bloc <reveil>.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { LANCEUR, makeRoot } = require('./unites-indexees-setup.js');

function fiche(id, critere, resultat) {
  return `---\nid: ${id}\ndate: 2026-09-01\ncritere: ${critere}\nresultat: ${resultat}\npreuve: —\ncommit: abc\ntags: test\n---\n## Ce qui a été fait\nRien de notable.\n`;
}

test('buildUserPromptDetail : unites-indexees actif → INDEX et <reveil> présents, JOURNAL/PROGRESS absents', () => {
  const root = makeRoot();
  const base = path.join(root, 'mission', 'concepteur');
  fs.mkdirSync(path.join(base, 'memoire'), { recursive: true });
  fs.writeFileSync(path.join(base, 'memoire', 'U1-essai.md'), fiche('U1', 'critère de test', 'PASS'));
  // JOURNAL.md/PROGRESS.md présents mais doivent être ignorés en mode unites-indexees.
  fs.writeFileSync(path.join(base, 'JOURNAL.md'), Array.from({ length: 20 }, (_, i) => `ligne ${i}`).join('\n'));
  const cfg = LANCEUR.parseConfig(fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8'));
  assert.equal(LANCEUR.moduleActive(cfg, 'memoire', 'unites-indexees'), true);
  const params = LANCEUR.resolveParams(cfg);
  const meta = { profil: 'execution', modele: 'sonnet', effort: 'medium', depth: 1, origine_effort: 'defaut' };
  const { prompt, blocs } = LANCEUR.buildUserPromptDetail(root, 'concepteur', meta, params, false, cfg);
  const noms = blocs.map((b) => b.nom);
  assert.ok(noms.includes('INDEX'), 'bloc INDEX attendu');
  assert.ok(noms.includes('REVEIL'), 'bloc REVEIL attendu');
  assert.equal(noms.includes('JOURNAL'), false, 'bloc JOURNAL absent en mode unites-indexees');
  assert.equal(noms.includes('PROGRESS'), false, 'bloc PROGRESS absent en mode unites-indexees');
  assert.match(prompt, /<reveil>/);
  assert.match(prompt, /memoire\/INDEX\.md/);
  assert.match(prompt, /U1/); // régénéré par buildMemoryIndex avant assemblage
  assert.doesNotMatch(prompt, /mission\/concepteur\/JOURNAL\.md/);
  assert.doesNotMatch(prompt, /registry\/PROGRESS\.md/);
});
