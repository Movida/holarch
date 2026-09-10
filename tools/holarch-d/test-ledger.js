'use strict';
/** Tests de ledger.js, isolés du vrai `~/.holarch/` via HOLARCH_HOME. */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ledger = require('./ledger');

function racineTemporaire() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-ledger-'));
  process.env.HOLARCH_HOME = d;
  return d;
}

test('enregistrer écrit une ligne JSONL exploitable avec les champs de §12', () => {
  const racine = racineTemporaire();
  const id = ledger.nouvelId();
  const ligne = ledger.enregistrer({
    id, space: 'default', task: 'tache-1', level: 1, specialist: 'generaliste',
    profil: 'execution', modele: 'sonnet', effort: 'medium',
    resultat: { total_cost_usd: 0.12, num_turns: 2, usage: { input_tokens: 100, output_tokens: 50 } },
    elapsedMs: 4200, exit: 'ok',
  });
  assert.strictEqual(ligne.id, id);
  assert.strictEqual(ligne.cout_usd, 0.12);
  assert.strictEqual(ligne.space, 'default');
  assert.strictEqual(ligne.level, 1);

  const contenu = fs.readFileSync(path.join(racine, 'ledger.jsonl'), 'utf8').trim().split('\n');
  assert.strictEqual(contenu.length, 1);
  assert.strictEqual(JSON.parse(contenu[0]).task, 'tache-1');
});

test('deux appels successifs s\'ajoutent (append-only), jamais réécrits', () => {
  racineTemporaire();
  ledger.enregistrer({ id: 'a', space: 'default', level: 1, resultat: null, elapsedMs: 1, exit: 'sans_resultat' });
  ledger.enregistrer({ id: 'b', space: 'default', level: 1, resultat: null, elapsedMs: 2, exit: 'sans_resultat' });
  const lignes = ledger.lireLignes();
  assert.deepStrictEqual(lignes.map((l) => l.id), ['a', 'b']);
});

test('statsPour filtre par niveau/profil/espace et calcule médiane et p90', () => {
  racineTemporaire();
  for (const cout of [0.1, 0.2, 0.3, 0.4]) {
    ledger.enregistrer({
      id: ledger.nouvelId(), space: 'default', level: 1, profil: 'execution',
      resultat: { total_cost_usd: cout, num_turns: 1, usage: {} }, elapsedMs: cout * 10000, exit: 'ok',
    });
  }
  ledger.enregistrer({
    id: ledger.nouvelId(), space: 'autre-espace', level: 1, profil: 'execution',
    resultat: { total_cost_usd: 99, num_turns: 1, usage: {} }, elapsedMs: 1, exit: 'ok',
  });
  const stats = ledger.statsPour({ space: 'default', level: 1, profil: 'execution' });
  assert.strictEqual(stats.echantillon, 4);
  assert.strictEqual(stats.cout_usd_median, 0.25);
  assert.notStrictEqual(stats.cout_usd_p90, null);
});

test('depenseAujourdhui somme le coût du jour courant pour un espace donné', () => {
  racineTemporaire();
  ledger.enregistrer({ id: 'x', space: 'default', level: 1, resultat: { total_cost_usd: 1.5, num_turns: 1, usage: {} }, elapsedMs: 1, exit: 'ok' });
  ledger.enregistrer({ id: 'y', space: 'default', level: 1, resultat: { total_cost_usd: 2.5, num_turns: 1, usage: {} }, elapsedMs: 1, exit: 'ok' });
  ledger.enregistrer({ id: 'z', space: 'autre', level: 1, resultat: { total_cost_usd: 100, num_turns: 1, usage: {} }, elapsedMs: 1, exit: 'ok' });
  assert.strictEqual(ledger.depenseAujourdhui({ space: 'default' }), 4);
});

test('commitFramework renvoie le commit court du dépôt HOLARCH réel, null hors dépôt', () => {
  const c = ledger.commitFramework(require('./repo').racineDepot());
  assert.match(c, /^[0-9a-f]{7,}$/);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pas-un-depot-'));
  assert.strictEqual(ledger.commitFramework(d), null);
});

test('racineHolarch respecte HOLARCH_HOME', () => {
  process.env.HOLARCH_HOME = '/tmp/exemple-holarch-home';
  assert.strictEqual(ledger.racineHolarch(), '/tmp/exemple-holarch-home');
});
