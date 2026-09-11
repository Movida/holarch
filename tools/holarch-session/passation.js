#!/usr/bin/env node
'use strict';
/**
 * passation.js — hook PreCompact d'une session de maintenance HOLARCH.
 *
 * Une compaction résume le contexte de la session ; ce qui n'est pas dans le résumé est perdu pour la suite. Ce hook
 * dicte au résumeur ce qu'il doit conserver et donne la consigne de reprise (skill holarch-session §5). Inerte dans
 * une session d'instance (HOLARCH_INSTANCE posée) : une instance a sa propre mémoire (MEMORY.md) et ses hooks.
 *
 * Usage : node tools/holarch-session/passation.js --hook-precompact   # JSON hookSpecificOutput.additionalContext
 *         node tools/holarch-session/passation.js                     # le texte seul
 */
function consigne() {
  return [
    '[HOLARCH · passation avant compaction — tools/holarch-session/passation.js]',
    'Le résumé de ce contexte doit conserver, mot pour mot quand ce sont des commandes ou des identifiants :',
    '1. l\'état de la mission en cours (instances, états effectifs, unités closes, sessions et coût, ce que le harnais fait ensuite tout seul) ;',
    '2. les gestes réservés au mainteneur en attente, chacun avec sa commande prête (push, publication du modèle, réponse à un message, fusion) ;',
    '3. les commits locaux non poussés et les fichiers modifiés non committés, avec ce qu\'il reste à faire dessus ;',
    '4. les moniteurs et tâches de fond armés dans cette session (identifiants, ce qu\'ils surveillent) ;',
    '5. les décisions et préférences exprimées par l\'utilisateur dans cette session, et les questions restées sans réponse ;',
    '6. les idées d\'amélioration entrevues et non encore inscrites dans docs/IDEES.md.',
    'Après la compaction : relancer `npm run etat`, relire la mémoire « HOLARCH current state », puis reprendre selon le skill holarch-session ; écrire la passation en mémoire (skill §3) avant tout geste long.',
  ].join('\n');
}
function main(argv) {
  if (argv.includes('--hook-precompact')) {
    if (process.env.HOLARCH_INSTANCE) { process.stdout.write('{}'); return; }
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreCompact', additionalContext: consigne() } }));
    return;
  }
  process.stdout.write(`${consigne()}\n`);
}
module.exports = { consigne };
if (require.main === module) main(process.argv.slice(2));
