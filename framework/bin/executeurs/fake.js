'use strict';
/**
 * Exécuteur `fake` — le CLI Claude Code simulé par un script Node (`HOLARCH_FAKE_CLAUDE`).
 *
 * Reformulation en exécuteur de la substitution de binaire qui vivait dans `runOnce`
 * (holarch-spawn.js 1.13.x, lignes 989-990) : `bin = process.execPath` et le script simulé passé en
 * premier argument. Tout le reste (`preparer`, `normaliser`, `limite`) est celui de `claude-code` :
 * ce faux CLI parle exactement le même protocole, et c'est précisément ce qui fait de lui la
 * seconde implémentation qui prouve l'interface, sans réécrire un seul scénario de test.
 */
const claudeCode = require('./claude-code');

const nom = 'fake';

// Mêmes capacités que le CLI simulé : les scénarios de test exercent hooks et sous-agents.
const capacites = Object.assign({}, claudeCode.capacites);

/** Script simulant le CLI : `HOLARCH_FAKE_CLAUDE` (voie historique, tests) ou `launch.fake`. */
function scriptSimule(launch) {
  return process.env.HOLARCH_FAKE_CLAUDE || (launch && launch.fake) || null;
}

function preparer(launch, params) {
  const prep = claudeCode.preparer(launch, params);
  const script = scriptSimule(launch);
  if (!script) {
    if (prep.nettoyer) prep.nettoyer();
    throw new Error("exécuteur fake : aucun script simulé (définir HOLARCH_FAKE_CLAUDE ou launch.fake)");
  }
  return Object.assign({}, prep, { bin: process.execPath, args: [script, ...prep.args] });
}

module.exports = {
  nom,
  capacites,
  preparer,
  executer: claudeCode.executer,
  normaliser: claudeCode.normaliser,
  limite: claudeCode.limite,
  // hors contrat, pour les tests :
  scriptSimule,
};
