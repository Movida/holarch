# holarch-test — lanceur de `npm test`

`npm test` appelle `node tools/holarch-test/run.js <fichiers>` : le lanceur crée `os.tmpdir()/holarch-tests-<aléa>/`,
lance `node --test` avec `TMPDIR` (et `TMP`, `TEMP`) pointés dessus, puis supprime le répertoire, quel que soit le
résultat. Code de sortie : celui de `node --test`.

Pourquoi : les tests créent leurs dépôts jetables par `fs.mkdtempSync(os.tmpdir()…)` et la moitié ne les suppriment
pas — 1 240 répertoires, 361 Mo dans `/tmp` du conteneur le 2026-09-13. `os.tmpdir()` lit `TMPDIR` sous Linux :
aucun test n'a à changer, et un test nouveau est couvert d'office.

- `HOLARCH_GARDER_TMP=1 npm test` conserve le répertoire et affiche son chemin (inspection d'un test).
- Les fichiers de test se listent dans `package.json` (`scripts.test`), comme avant ; le lanceur n'a aucune dépendance.
- Un test lancé seul (`node --test framework/tests/x.test.js`) écrit toujours sous `/tmp` : passer par
  `node tools/holarch-test/run.js framework/tests/x.test.js` pour le même nettoyage.
