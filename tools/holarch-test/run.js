#!/usr/bin/env node
'use strict';
// Lanceur de `npm test` : exécute `node --test <fichiers>` dans un TMPDIR jetable, détruit à la fin.
//
// Pourquoi : une cinquantaine de fichiers de test créent des répertoires par `fs.mkdtempSync(os.tmpdir()…)`
// et la moitié ne les suppriment pas (constat du 2026-09-13 : 1 240 répertoires `holarch-*` et `bench-*`,
// 361 Mo dans /tmp du conteneur). Plutôt que corriger chaque test un à un — et le refaire à chaque test
// nouveau —, tout ce que les tests écrivent sous `os.tmpdir()` va dans un seul répertoire, supprimé ici,
// quel que soit le résultat. `os.tmpdir()` lit `TMPDIR` sous Linux, donc aucun test n'a à changer.
//
// Usage : node tools/holarch-test/run.js <fichiers de test…>   (les motifs sont développés par le shell de npm)
//   HOLARCH_GARDER_TMP=1   garde le répertoire (pour inspecter ce qu'un test a écrit) et affiche son chemin.
// Code de sortie : celui de `node --test`. Aucune dépendance.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function main(argv) {
  const fichiers = argv.filter((a) => !a.startsWith('--'));
  const options = argv.filter((a) => a.startsWith('--'));
  if (fichiers.length === 0) {
    process.stderr.write('usage : node tools/holarch-test/run.js <fichiers de test…>\n');
    return 2;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-tests-'));
  const env = Object.assign({}, process.env, { TMPDIR: tmp, TMP: tmp, TEMP: tmp });
  let code = 1;
  try {
    const res = spawnSync(process.execPath, ['--test', ...options, ...fichiers], { stdio: 'inherit', env });
    code = res.status === null ? 1 : res.status;
  } finally {
    if (process.env.HOLARCH_GARDER_TMP === '1') {
      process.stderr.write(`TMPDIR des tests conservé : ${tmp}\n`);
    } else {
      try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* déjà parti */ }
    }
  }
  return code;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { main };
