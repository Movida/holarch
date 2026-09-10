'use strict';
/**
 * fixtures.js — faux `launch` partagé par les tests (daemon-core, daemon-http, mcp-door) : aucun
 * sous-processus `claude` réel, aucun coût. Volontairement nommé sans le préfixe `test-` pour ne
 * pas être ramassé comme fichier de test par `node --test tools/holarch-d/test-*.js`.
 */

function fauxLanceur({
  triageSortie, delaiMs = 15, resultatPatch, echoue,
  memoire = 'x', memoireEchoue = false, digest = '## À quoi sert ce dépôt\nun dépôt de test',
  digestEchoue = false, appels,
} = {}) {
  const tracer = (nom, appel) => { if (appels) appels.push(Object.assign({ nom }, appel)); return appel; };
  return {
    // Passe mémoire (D9) et cartographie (§13.1) : mêmes signatures que launch.js, aucun
    // sous-processus. `appels` (facultatif) collecte les appels préparés, pour que les tests
    // puissent vérifier *ce qui aurait été lancé* sans rien lancer.
    preparerPasseMemoire: ({ mode, sessionId, space, specialist, memoireActuelle, resultMd }) => tracer('memoire', {
      mode: mode === 'resume' && sessionId ? 'resume' : 'neuf',
      profil: 'execution', modele: 'sonnet', effort: 'medium', budget: 0.15, timeoutS: 90,
      args: [], space, specialist, memoireActuelle, resultMd, sessionId,
    }),
    executerPasseMemoire: async () => (memoireEchoue
      ? { res: null, elapsedMs: 5, exitCode: 1, signal: null }
      : {
        res: {
          is_error: false, result: memoire, total_cost_usd: 0.01, num_turns: 1, usage: {},
        },
        elapsedMs: 5,
      }),
    preparerDigest: ({ racines }) => {
      if (!racines || !racines.length) throw new Error("l'espace n'a aucune racine déclarée : rien à cartographier");
      return tracer('digest', {
        profil: 'execution', modele: 'sonnet', effort: 'medium', budget: 2, tours: 40,
        timeoutS: 600, args: [], cwd: racines[0], racines,
      });
    },
    executerDigest: async () => (digestEchoue
      ? { res: null, elapsedMs: 5, exitCode: 1, signal: null }
      : {
        res: {
          is_error: false, result: digest, total_cost_usd: 0.4, num_turns: 7, usage: {},
        },
        elapsedMs: 5,
      }),
    preparerTriage: () => ({ profil: 'triage', modele: 'haiku', effort: 'low', args: [], timeoutS: 15 }),
    executerTriage: async () => ({
      res: {
        is_error: false,
        structured_output: triageSortie === undefined ? null : triageSortie,
        total_cost_usd: 0.005,
        num_turns: 1,
        usage: {},
      },
      elapsedMs: 30,
    }),
    preparerTacheNiveau1: ({
      profile, model, effort, timeoutS, space, specialist, contexte,
    }) => {
      if (profile === 'inconnu-pour-test') throw new Error('profil inconnu : « inconnu-pour-test »');
      return tracer('niveau1', {
        profil: profile,
        modele: model || 'sonnet',
        effort: effort || 'medium',
        args: [],
        timeoutS: timeoutS || 180,
        charte: 'x',
        systeme: 'x',
        space,
        specialist,
        contexte,
      });
    },
    executerTacheNiveau1: (appel, { onPartial, cancelable } = {}) => new Promise((resolve) => {
      if (onPartial) onPartial('brouillon en cours...');
      const minuteur = setTimeout(() => {
        if (echoue) { resolve({ res: null, elapsedMs: delaiMs, exitCode: 1, signal: null }); return; }
        resolve({
          res: Object.assign(
            {
              is_error: false, result: 'réponse de test', total_cost_usd: 0.02, num_turns: 1,
              usage: {}, session_id: 'session-de-test',
            },
            resultatPatch,
          ),
          elapsedMs: delaiMs,
        });
      }, delaiMs);
      if (cancelable) {
        cancelable.kill = () => { clearTimeout(minuteur); resolve({ res: null, elapsedMs: 1, exitCode: null, signal: 'SIGTERM' }); };
      }
    }),
  };
}

module.exports = { fauxLanceur };
