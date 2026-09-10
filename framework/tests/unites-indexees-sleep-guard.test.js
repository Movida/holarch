'use strict';
// Point 6 du §2.6 : sleep-guard étendu (spec §2.4) — les bornes de MEMORY.md (ligne_max_chars,
// memoire_max_lignes) ne bloquent que si `unites-indexees` est actif dans CONFIG.md.
//
// Le `session_id` passé à `sleep-guard` sert de clé à un état persisté sur disque
// (os.tmpdir()/holarch-hooks/<session_id>.json, compteur `stopBlocks` — au-delà de
// STOP_BLOCKS_MAX le garde-fou laisse passer pour ne pas bloquer indéfiniment une vraie session).
// Un `session_id` fixe entre exécutions du fichier de test fait donc fuiter cet état d'une
// exécution de `npm test` à l'autre sur la même machine : après plus de STOP_BLOCKS_MAX lancements
// cumulés, le test cesse silencieusement de vérifier `decision: 'block'` (constaté ici : compteur
// à 4 après plusieurs sessions de développement). D'où un `session_id` unique par exécution.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { makeRoot, runHook, status } = require('./unites-indexees-setup.js');

function uniqueSessionId(base) { return `${base}-${crypto.randomUUID()}`; }

const CONFIG_MONOLITHIC = `# Configuration — mission : test-monolithic
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | monolithic |
| 4 | recursion | max-depth |
| 5 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 3 |
| profondeur_max | 2 |

## Valeurs organisationnelles
- Faire simple.
`;

function prep(root, memoryContent) {
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), status('WORKING', 'hibernation volontaire (contexte)'));
  fs.writeFileSync(path.join(root, 'mission', 'concepteur', 'MEMORY.md'), memoryContent);
}

test('sleep-guard : unites-indexees actif, ligne de MEMORY.md > 200 caractères → bloque', () => {
  const root = makeRoot();
  prep(root, `# Mémoire\n## État courant\n${'x'.repeat(250)}\n`);
  const r = runHook('sleep-guard', { session_id: uniqueSessionId('sg-1') }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' });
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /dépasse 200 caractères/);
});

test('sleep-guard : unites-indexees actif, MEMORY.md > 60 lignes hors titres → bloque', () => {
  const root = makeRoot();
  const corps = Array.from({ length: 61 }, (_, i) => `ligne ${i}`).join('\n');
  prep(root, `# Mémoire\n## État courant\n${corps}\n`);
  const r = runHook('sleep-guard', { session_id: uniqueSessionId('sg-2') }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' });
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /dépasse 60 lignes/);
});

test('sleep-guard : unites-indexees inactif (monolithic) → mêmes MEMORY.md hors-borne ne bloquent pas pour cette raison', () => {
  const root = makeRoot();
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), CONFIG_MONOLITHIC);
  const corps = Array.from({ length: 61 }, (_, i) => `ligne ${i}`).join('\n');
  prep(root, `# Mémoire\n## État courant\n${'x'.repeat(250)}\n${corps}\n`);
  const r = runHook('sleep-guard', { session_id: uniqueSessionId('sg-3') }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' });
  assert.deepEqual(r, {});
});
