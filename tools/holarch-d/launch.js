'use strict';
/**
 * launch.js — assemblage et exécution des appels `claude -p` de holarch-d, pour les deux formes
 * utilisées à l'Étape 1 :
 *   - le triage (niveau 0, `refine_prompt`) : synchrone, `--output-format json`, court (§6 : 15 s,
 *     0,05 USD) — pas de streaming utile pour un appel que personne n'interroge pendant qu'il tourne.
 *   - un avis niveau 1 (`ask_specialist`/`submit_task`) : asynchrone, `--output-format stream-json
 *     --include-partial-messages --verbose` (flags vérifiés le 2026-09-04, `claude --help` +
 *     appel réel — voir README « Résultats mesurés ») pour que `get_task` puisse exposer un
 *     brouillon partiel pendant que la tâche tourne en tâche de fond.
 *
 * Comme `holarch-spawn.js` et l'ancien `holon-oracle`, la fonction qui lance réellement le
 * sous-processus n'est jamais exercée par `npm test` (aucun appel réseau, `CONTRIBUTING.md`) —
 * seul l'assemblage (`preparer*`) est pur et testé.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chargerPolitique, resoudreProfil, parametre } = require('./policy');
const { SCHEMA_TRIAGE, construirePromptTriage } = require('./router');

const CHARTE_PATH = path.join(__dirname, 'charte.md');

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Lance `claude` en sous-processus, journalise chaque ligne NDJSON reçue (via `onLine`, pour les
 * transcripts et le brouillon partiel) et résout une fois le processus terminé. Ne bloque jamais
 * l'événementiel Node : plusieurs appels peuvent tourner en parallèle (§11, `concurrence_max`).
 */
function spawnClaude(args, {
  timeoutMs, onLine, cancelable, cwd,
} = {}) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let resultat = null;
    let resteStdout = '';
    let stderr = '';
    let termine = false;
    let minuteur = null;

    const finir = (info) => {
      if (termine) return;
      termine = true;
      if (minuteur) clearTimeout(minuteur);
      resolve(Object.assign({ elapsedMs: Date.now() - t0, res: resultat, stderr }, info));
    };

    let enfant;
    try {
      enfant = spawn('claude', args, Object.assign({ stdio: ['ignore', 'pipe', 'pipe'] }, cwd ? { cwd } : {}));
    } catch (e) {
      finir({ exitCode: null, signal: null, error: e });
      return;
    }

    if (cancelable) {
      cancelable.kill = (signal) => { try { enfant.kill(signal || 'SIGTERM'); } catch (_e) { /* déjà mort */ } };
    }

    if (timeoutMs) {
      minuteur = setTimeout(() => {
        try { enfant.kill('SIGTERM'); } catch (_e) { /* déjà mort */ }
        setTimeout(() => { try { enfant.kill('SIGKILL'); } catch (_e) { /* déjà mort */ } }, 5000);
      }, timeoutMs);
    }

    enfant.stdout.on('data', (chunk) => {
      resteStdout += chunk.toString('utf8');
      let idx = resteStdout.indexOf('\n');
      while (idx !== -1) {
        const ligne = resteStdout.slice(0, idx);
        resteStdout = resteStdout.slice(idx + 1);
        idx = resteStdout.indexOf('\n');
        if (!ligne.trim()) continue;
        let d;
        try { d = JSON.parse(ligne); } catch (_e) { continue; }
        if (d.type === 'result') resultat = d;
        if (onLine) onLine(d, ligne);
      }
    });
    enfant.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    enfant.on('error', (e) => finir({ exitCode: null, signal: null, error: e }));
    enfant.on('close', (code, signal) => finir({ exitCode: code, signal, error: null }));
  });
}

/** Accumule le texte d'assistant depuis les événements `stream_event`/`content_block_delta`. */
function accumulateurTexte() {
  const parIndex = new Map();
  const ordre = [];
  return {
    ingerer(d) {
      if (d.type !== 'stream_event' || !d.event) return;
      const ev = d.event;
      if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'text') {
        if (!parIndex.has(ev.index)) { parIndex.set(ev.index, ''); ordre.push(ev.index); }
      } else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        parIndex.set(ev.index, (parIndex.get(ev.index) || '') + ev.delta.text);
      }
    },
    texte() {
      return ordre.map((i) => parIndex.get(i) || '').join('');
    },
  };
}

/** Fonction pure : assemble l'appel de triage (niveau 0). */
function preparerTriage({ prompt, policyPath, timeoutS, budgetUsd, maxTours }) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt requis');
  const cfg = chargerPolitique(policyPath);
  const meta = resoudreProfil(cfg, 'triage', {});
  const timeout = clamp(Number(timeoutS) || Number(parametre(cfg, 'timeout_s_niveau0', 15)), 3, 60);
  const budget = clamp(Number(budgetUsd) || Number(parametre(cfg, 'budget_usd_niveau0', 0.05)), 0.01, 0.5);
  const tours = clamp(Number(maxTours) || Number(parametre(cfg, 'max_tours_niveau0', 10)), 1, 15);
  const permissionMode = parametre(cfg, 'permission_mode', 'default');

  const args = [
    '-p', construirePromptTriage({ prompt, cfg }),
    '--model', meta.modele,
    '--effort', meta.effort,
    '--permission-mode', permissionMode,
    '--output-format', 'json',
    '--json-schema', JSON.stringify(SCHEMA_TRIAGE),
    '--max-turns', String(tours),
    '--max-budget-usd', String(budget),
    '--tools', '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '-n', 'holarch-d:refine_prompt',
  ];
  return { profil: meta.profil, modele: meta.modele, effort: meta.effort, tours, budget, timeoutS: timeout, args };
}

/** Exécute réellement le triage (synchrone du point de vue de l'appelant HTTP). */
async function executerTriage(appel) {
  return spawnClaude(appel.args, { timeoutMs: appel.timeoutS * 1000 });
}

/** Plafond d'injection de `DECISIONS.md` : le fichier est append-only et grossit indéfiniment
 *  (§13.2), alors que le prompt système, lui, est refacturé à chaque appel. On injecte la **fin**
 *  du fichier (les décisions récentes), pas le début. */
const MAX_CARACTERES_DECISIONS = 4000;

function queueDecisions(texte) {
  const t = String(texte || '').trim();
  if (t.length <= MAX_CARACTERES_DECISIONS) return t;
  const coupe = t.slice(t.length - MAX_CARACTERES_DECISIONS);
  const debutEntree = coupe.indexOf('\n## ');
  return `_(décisions antérieures omises)_\n${coupe.slice(debutEntree === -1 ? 0 : debutEntree + 1)}`;
}

/**
 * Compose le prompt système d'un avis niveau 1 (§6) : charte + fiche du spécialiste + mémoire de
 * l'espace + carte du dépôt + décisions déjà prises. Chaque bloc est **facultatif** — un espace
 * neuf n'a ni mémoire, ni digest, ni décisions, et l'appel doit rester valide.
 *
 * Fonction pure : elle ne lit rien sur disque hors la charte, tout le contexte lui est passé. Ce
 * qui la rend testable sans `HOLARCH_HOME` et sans dépenser un centime.
 */
function composerPromptSysteme({
  charte, fiche, memoire, digest, decisions, space, specialist,
} = {}) {
  const blocs = [String(charte || '').trim()];
  if (fiche) {
    blocs.push(`---\n\n# Ton rôle pour cette demande : ${specialist || 'spécialiste'}\n\n${String(fiche).trim()}`);
  }
  if (memoire) {
    blocs.push(`---\n\n# Ce que tu as retenu de l'espace « ${space} » (ta mémoire)\n\n`
      + `Écrite par toi à la fin de tes tâches précédentes dans cet espace. Elle peut être datée : `
      + `si elle contredit ce que tu observes, ce que tu observes gagne.\n\n${String(memoire).trim()}`);
  }
  if (digest) {
    blocs.push(`---\n\n# Carte de l'espace « ${space} » (DIGEST.md)\n\n`
      + `Vue d'ensemble du dépôt, établie par une passe de cartographie. Indicative, pas exhaustive.\n\n${String(digest).trim()}`);
  }
  if (decisions) {
    blocs.push(`---\n\n# Décisions déjà prises dans cet espace (DECISIONS.md)\n\n`
      + `Verdicts rendus par l'utilisateur sur des avis précédents. Ne les recontredis pas sans le `
      + `dire explicitement.\n\n${queueDecisions(decisions)}`);
  }
  return blocs.join('\n\n');
}

/**
 * Fonction pure : assemble un appel de spécialiste niveau 1.
 *
 * `contexte` porte tout ce qui vient de l'espace et du catalogue ({fiche, memoire, digest,
 * decisions, racines, outilsFiche}) — assemblé par `daemon-core.js`, jamais lu ici : `launch.js`
 * reste sans état et testable sans `HOLARCH_HOME`.
 *
 * **Outils (D17)** : `Read,Glob,Grep` accordés seulement si *deux* conditions sont réunies — la
 * fiche du spécialiste déclare `tools: read` **et** l'espace a des racines déclarées. Sinon
 * `--tools ''`. Jamais d'écriture, jamais de Bash, jamais de MCP, à aucune condition : ce sont des
 * absences par construction (la liste est close), pas des interdictions demandées au modèle.
 */
function preparerTacheNiveau1({
  prompt, profile, model, effort, instructions, maxTurns, maxBudgetUsd, timeoutS, policyPath,
  space, specialist, contexte,
}) {
  if (!prompt || !String(prompt).trim()) throw new Error('prompt requis');
  const cfg = chargerPolitique(policyPath);
  const meta = resoudreProfil(cfg, profile, { modele: model, effort });

  const tours = clamp(Number(maxTurns) || Number(parametre(cfg, 'max_tours_niveau1', 3)), 1, 8);
  const budget = clamp(Number(maxBudgetUsd) || Number(parametre(cfg, 'budget_usd_niveau1', 1)), 0.05, 3);
  const timeout = clamp(Number(timeoutS) || Number(parametre(cfg, 'timeout_s_niveau1', 180)), 5, 600);
  const permissionMode = parametre(cfg, 'permission_mode', 'default');
  const charteBrute = fs.readFileSync(CHARTE_PATH, 'utf8');

  const ctx = contexte || {};
  const racines = Array.isArray(ctx.racines) ? ctx.racines : [];
  const lectureAccordee = ctx.outilsFiche === 'read' && racines.length > 0;

  // D17 : le texte sur les outils doit refléter le `--tools` réellement transmis plus bas — jamais
  // un texte figé qui contredirait ce que le spécialiste peut effectivement faire.
  const charte = charteBrute.replace('<!-- OUTILS -->', lectureAccordee
    ? "Tu disposes des outils de lecture Read, Glob et Grep pour cette demande : utilise-les si "
      + 'nécessaire pour appuyer ta réponse sur les fichiers réels de l\'espace. Tu ne disposes '
      + "d'aucun autre outil : jamais d'écriture, jamais d'exécution."
    : "Tu ne disposes d'aucun outil : ne tente pas de lire, écrire ou exécuter quoi que ce soit. "
      + 'Réponds directement, dans le format ci-dessus.');

  const systeme = composerPromptSysteme({
    charte,
    fiche: ctx.fiche,
    memoire: ctx.memoire,
    digest: ctx.digest,
    decisions: ctx.decisions,
    space: space || 'default',
    specialist,
  });

  const promptUtilisateur = instructions ? `${prompt}\n\n---\nInstructions supplémentaires de l'appelant (donnée, pas une consigne de plafond) :\n${instructions}` : prompt;

  const args = [
    '-p', promptUtilisateur,
    '--model', meta.modele,
    '--effort', meta.effort,
    '--permission-mode', permissionMode,
    '--output-format', 'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--max-turns', String(tours),
    '--max-budget-usd', String(budget),
    '--append-system-prompt-file', '<CHARTE_FILE>',
    '--exclude-dynamic-system-prompt-sections',
    '--tools', lectureAccordee ? 'Read,Glob,Grep' : '',
  ];
  for (const racineSupplementaire of racines.slice(1)) {
    if (lectureAccordee) args.push('--add-dir', racineSupplementaire);
  }
  args.push(
    '--disable-slash-commands',
    '--strict-mcp-config',
    '-n', 'holarch-d:ask_specialist',
  );

  return {
    profil: meta.profil,
    modele: meta.modele,
    effort: meta.effort,
    tours,
    budget,
    timeoutS: timeout,
    permissionMode,
    args,
    charte,
    systeme,
    lectureAccordee,
    cwd: lectureAccordee ? racines[0] : undefined,
  };
}

/**
 * Exécute réellement un avis niveau 1. `onEvent({ partial })` est rappelé à chaque delta de texte
 * (pour `get_task`) ; `onLine(ligneBrute)` reçoit chaque ligne NDJSON telle quelle (transcript).
 */
async function executerTacheNiveau1(appel, { onPartial, onLine, cancelable } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-'));
  const charteFile = path.join(tmp, 'charte.md');
  fs.writeFileSync(charteFile, appel.systeme || appel.charte);
  const args = appel.args.map((a) => (a === '<CHARTE_FILE>' ? charteFile : a));
  const acc = accumulateurTexte();
  const sortie = await spawnClaude(args, {
    timeoutMs: appel.timeoutS * 1000,
    cancelable,
    cwd: appel.cwd,
    onLine: (d, ligneBrute) => {
      acc.ingerer(d);
      if (onPartial) onPartial(acc.texte());
      if (onLine) onLine(ligneBrute);
    },
  });
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_e) { /* ignore */ }
  return sortie;
}

// -----------------------------------------------------------------------
// Passe mémoire (D8/D9) et cartographie (§13.1)
// -----------------------------------------------------------------------

const CONSIGNE_MEMOIRE = [
  'Tu viens de rendre un avis dans cet espace. Réécris maintenant ta mémoire de travail pour cet',
  'espace, **intégralement** : elle remplace la précédente, elle ne s\'y ajoute pas.',
  '',
  'Contraintes strictes :',
  '- exactement ces quatre sections de niveau 2, dans cet ordre, aucune autre :',
  '  "## Ce que je sais du projet", "## Ce que j\'ai déjà recommandé",',
  '  "## Ce qui a été retenu ou écarté", "## Points ouverts" ;',
  '- 1500 tokens maximum au total (vise nettement moins) : ce texte est refacturé à chaque appel',
  '  futur, sa concision est son utilité ;',
  '- des faits durables et réutilisables, pas le récit de la conversation : ce qui te ferait gagner',
  '  du temps la prochaine fois, pas ce qui vient de se passer ;',
  '- pas de préambule, pas de conclusion : réponds par le markdown de la mémoire et rien d\'autre.',
].join('\n');

/**
 * Fonction pure : assemble la passe de réécriture de mémoire (D9).
 *
 * Deux modes, parce que le point était **laissé non résolu par la spec** (§16) et a été tranché
 * par la mesure (voir README, « Résultats mesurés ») :
 *   - `resume` (**mode effectif du démon** : `MODE_MEMOIRE` de `daemon-core.js`, surchargeable par
 *     `HOLARCH_MEMOIRE_MODE`) : reprise de la session de la tâche (`--resume <session_id>
 *     --fork-session`) — le modèle a déjà tout le contexte, on ne repaie pas le prompt système ;
 *   - `neuf` (repli) : appel neuf avec le `RESULT.md` en entrée, quelques centimes de plus, aucune
 *     dépendance à la persistance des sessions du CLI.
 * Le mode `resume` exige un `sessionId` ; à défaut il retombe sur `neuf` de lui-même — et c'est
 * pour la même raison que `neuf` reste la valeur par défaut du **paramètre** ci-dessous, alors que
 * le démon passe toujours `resume` explicitement : un appelant qui oublie le mode obtient celui qui
 * ne dépend de rien, jamais un `--resume` sans session.
 */
function preparerPasseMemoire({
  mode = 'neuf', sessionId = null, resultMd = null, memoireActuelle = null,
  space, specialist, policyPath, maxBudgetUsd,
}) {
  const cfg = chargerPolitique(policyPath);
  const meta = resoudreProfil(cfg, 'execution', {});
  const budget = clamp(Number(maxBudgetUsd) || Number(parametre(cfg, 'budget_usd_memoire', 0.15)), 0.02, 1);
  const timeout = clamp(Number(parametre(cfg, 'timeout_s_memoire', 90)), 5, 300);
  const modeEffectif = mode === 'resume' && sessionId ? 'resume' : 'neuf';

  const contexte = modeEffectif === 'resume' ? '' : [
    `Espace : ${space}. Spécialiste : ${specialist}.`,
    '',
    memoireActuelle ? `Ta mémoire actuelle de cet espace :\n\n${memoireActuelle}\n` : '(Aucune mémoire antérieure pour cet espace : tu écris la première.)\n',
    '',
    `L'avis que tu viens de rendre :\n\n${String(resultMd || '(avis indisponible)').trim()}`,
    '',
    '---',
    '',
  ].join('\n');

  const args = [
    '-p', `${contexte}${CONSIGNE_MEMOIRE}`,
    '--model', meta.modele,
    '--effort', meta.effort,
    '--output-format', 'json',
    '--max-turns', '1',
    '--max-budget-usd', String(budget),
    '--tools', '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '-n', 'holarch-d:memory',
  ];
  if (modeEffectif === 'resume') args.push('--resume', sessionId, '--fork-session');

  return {
    mode: modeEffectif, profil: meta.profil, modele: meta.modele, effort: meta.effort,
    budget, timeoutS: timeout, args,
  };
}

async function executerPasseMemoire(appel) {
  return spawnClaude(appel.args, { timeoutMs: appel.timeoutS * 1000 });
}

const CONSIGNE_DIGEST = [
  'Tu es en mission de cartographie. Explore le dépôt depuis le répertoire courant (outils de',
  'lecture seulement) et produis une **carte** qui permette à un autre modèle, qui ne verra jamais',
  'ce dépôt, de savoir où regarder.',
  '',
  'Contraintes strictes :',
  '- 2000 tokens maximum : c\'est une carte, pas un inventaire ; ce texte sera injecté dans tous les',
  '  appels futurs sur cet espace, chaque ligne inutile est refacturée indéfiniment ;',
  '- structure imposée : "## À quoi sert ce dépôt" (3 lignes max), "## Structure" (les répertoires',
  '  qui comptent, une ligne chacun, ceux qu\'on peut ignorer signalés comme tels), "## Points',
  '  d\'entrée" (par quels fichiers commencer à lire, et pour quelle question), "## Conventions"',
  '  (langue, style, tests, outillage), "## Pièges" (ce qui surprend un nouvel arrivant) ;',
  '- des chemins réels, vérifiés en les lisant — n\'invente aucun fichier ;',
  '- pas de préambule : réponds par le markdown de la carte et rien d\'autre.',
].join('\n');

/**
 * Fonction pure : assemble la session cartographe qui produit `DIGEST.md` (§13.1). Profil
 * `execution`, lecture seule, budget serré (2 USD par défaut) et cwd sur la première racine de
 * l'espace — c'est le seul appel de holarch-d qui explore librement un dépôt, il est donc le plus
 * étroitement borné.
 */
function preparerDigest({ racines = [], maxBudgetUsd, maxTurns, timeoutS, policyPath }) {
  if (!racines.length) throw new Error("l'espace n'a aucune racine déclarée : rien à cartographier");
  const cfg = chargerPolitique(policyPath);
  const meta = resoudreProfil(cfg, 'execution', {});
  const budget = clamp(Number(maxBudgetUsd) || Number(parametre(cfg, 'budget_usd_digest', 2)), 0.1, 5);
  const tours = clamp(Number(maxTurns) || Number(parametre(cfg, 'max_tours_digest', 40)), 5, 60);
  const timeout = clamp(Number(timeoutS) || Number(parametre(cfg, 'timeout_s_digest', 600)), 30, 1800);

  const args = [
    '-p', CONSIGNE_DIGEST,
    '--model', meta.modele,
    '--effort', meta.effort,
    '--output-format', 'json',
    '--max-turns', String(tours),
    '--max-budget-usd', String(budget),
    '--tools', 'Read,Glob,Grep',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '-n', 'holarch-d:digest',
  ];
  for (const r of racines.slice(1)) args.push('--add-dir', r);

  return {
    profil: meta.profil, modele: meta.modele, effort: meta.effort, budget, tours,
    timeoutS: timeout, args, cwd: racines[0],
  };
}

async function executerDigest(appel) {
  return spawnClaude(appel.args, { timeoutMs: appel.timeoutS * 1000, cwd: appel.cwd });
}

module.exports = {
  clamp, spawnClaude, accumulateurTexte, composerPromptSysteme, queueDecisions,
  preparerTriage, executerTriage,
  preparerTacheNiveau1, executerTacheNiveau1,
  preparerPasseMemoire, executerPasseMemoire,
  preparerDigest, executerDigest,
  MAX_CARACTERES_DECISIONS,
};
