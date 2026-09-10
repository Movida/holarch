'use strict';
// Point 2 du §2.6 : buildMemoryIndex — tri numérique (U2 avant U10), troncature du critère à 90
// caractères, régénération idempotente.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LANCEUR, makeRoot } = require('./unites-indexees-setup.js');

function uniteFile(id, date, resultat, critere) {
  return `---\nid: ${id}\ndate: ${date}\ncritere: ${critere}\nresultat: ${resultat}\npreuve: —\ncommit: —\n---\n## Ce qui a été fait\nrien de notable.\n\n## Ce qui reste ouvert\nrien\n\n## Pièges rencontrés\naucun\n`;
}

test('buildMemoryIndex : absent de memoire/ → rien, pas d\'écriture', () => {
  const root = makeRoot();
  const r = LANCEUR.buildMemoryIndex(root, 'concepteur');
  assert.deepEqual(r, { lignes: 0, contenu: '' });
  assert.equal(fs.existsSync(path.join(root, 'mission', 'concepteur', 'memoire')), false);
});

test('buildMemoryIndex : tri numérique U2 avant U10, troncature du critère à 90 caractères', () => {
  const root = makeRoot();
  const dir = path.join(root, 'mission', 'concepteur', 'memoire');
  fs.mkdirSync(dir, { recursive: true });
  const longCritere = 'x'.repeat(120);
  fs.writeFileSync(path.join(dir, 'U10-dixieme.md'), uniteFile('U10', '2026-09-10T00:00:00Z', 'PASS', 'critère court'));
  fs.writeFileSync(path.join(dir, 'U2-deuxieme.md'), uniteFile('U2', '2026-09-09T00:00:00Z', 'PASS', longCritere));
  const r = LANCEUR.buildMemoryIndex(root, 'concepteur');
  assert.equal(r.lignes, 2);
  const rows = r.contenu.split('\n').filter((l) => /^\| U\d/.test(l));
  assert.equal(rows.length, 2);
  assert.match(rows[0], /^\| U2 \|/); // U2 avant U10 malgré l'ordre alphabétique inverse des fichiers
  assert.match(rows[1], /^\| U10 \|/);
  const critereCell = rows[0].split('|')[4].trim();
  assert.equal(critereCell.length, 90);
  assert.ok(r.contenu.includes('régénéré par le lanceur, ne pas éditer'));
  assert.equal(fs.readFileSync(path.join(dir, 'INDEX.md'), 'utf8'), r.contenu);
});

test('buildMemoryIndex : idempotente (rappel sans changement produit le même contenu)', () => {
  const root = makeRoot();
  const dir = path.join(root, 'mission', 'concepteur', 'memoire');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'U1-premiere.md'), uniteFile('U1', '2026-09-09T00:00:00Z', 'PASS', 'critère'));
  const r1 = LANCEUR.buildMemoryIndex(root, 'concepteur');
  const r2 = LANCEUR.buildMemoryIndex(root, 'concepteur');
  assert.equal(r1.contenu, r2.contenu);
  // Fiche sans en-tête valide → ignorée silencieusement, pas d'exception.
  fs.writeFileSync(path.join(dir, 'U2-bancale.md'), 'pas de front-matter\n');
  const r3 = LANCEUR.buildMemoryIndex(root, 'concepteur');
  assert.equal(r3.lignes, 1);
});
