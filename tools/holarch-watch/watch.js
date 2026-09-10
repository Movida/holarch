#!/usr/bin/env node
'use strict';
/**
 * holarch-watch — boucle sans LLM qui évalue périodiquement les conditions de réveil (`Réveil` de
 * STATUS.md, grammaire framework/modules/orchestration/direct-spawn.md § « Réveil par condition »)
 * et relance (détaché) les instances dont la condition est satisfaite, via `wakeWaiters` du lanceur.
 * Nécessaire pour les termes `date:` et `fichier:` : aucun lanceur d'enfant ne les déclenche de
 * lui-même (docs/IMPLEMENTATION.md §3.6).
 *
 * Usage : node tools/holarch-watch/watch.js [--intervalle <secondes>] [--une-fois]
 */
const path = require('path');

function parseArgs(argv) {
  const opts = { intervalle: 30, uneFois: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--intervalle') { opts.intervalle = Number(argv[++i]) || opts.intervalle; continue; }
    if (a === '--une-fois') { opts.uneFois = true; continue; }
  }
  return opts;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const lanceur = require(path.join(__dirname, '..', '..', 'framework', 'bin', 'holarch-spawn.js'));
  const root = lanceur.findRoot(__dirname);
  if (!root) {
    process.stderr.write('holarch-watch : racine HOLARCH introuvable (framework/KERNEL.md + mission/ attendus).\n');
    process.exit(1);
  }

  function passe() {
    const reveils = lanceur.wakeWaiters(root, 'holarch-watch');
    const horodatage = new Date().toISOString();
    if (reveils.length) {
      for (const r of reveils) process.stdout.write(`[${horodatage}] holarch-watch ▸ réveil ${r.chemin} (tâche ${r.tache}) — ${r.condition}\n`);
    } else {
      process.stdout.write(`[${horodatage}] holarch-watch ▸ aucun réveil\n`);
    }
  }

  passe();
  if (opts.uneFois) return;

  const timer = setInterval(passe, opts.intervalle * 1000);
  process.on('SIGINT', () => {
    clearInterval(timer);
    process.stdout.write('holarch-watch ▸ arrêt (SIGINT)\n');
    process.exit(0);
  });
}

if (require.main === module) main();
module.exports = { parseArgs };
