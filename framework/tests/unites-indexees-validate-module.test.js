'use strict';
// Point 7 du §2.6 (docs/IMPLEMENTATION.md, chantier 1) : le module `unites-indexees.md` passe
// module-forge contre le catalogue réel — avec les défauts du dépôt et avec des chemins explicites.
// Couvre la réserve n° 1 de la promotion (validation du catalogue réel, module promu inclus).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { validerModule, construireContexte } = require('../../tools/module-forge/validate-module.js');
const { CIBLE } = require('./unites-indexees-setup.js');

const MODULE = path.join(CIBLE, 'modules', 'memoire', 'unites-indexees.md');

test('validate-module : unites-indexees.md est conforme contre le manifest et le modules-dir explicites', () => {
  const ctx = construireContexte({ manifest: path.join(CIBLE, 'MANIFEST.md'), modulesDir: path.join(CIBLE, 'modules'), extras: [] });
  assert.deepEqual(validerModule(MODULE, ctx).erreurs, []);
});

test('validate-module : avec les défauts du dépôt réel, le module promu est conforme (incompatibilités réciproques déclarées)', () => {
  const ctx = construireContexte({ extras: [] });
  assert.deepEqual(validerModule(MODULE, ctx).erreurs, []);
});
