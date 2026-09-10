'use strict';
/**
 * router.js — triage (`refine_prompt`, niveau 0) : prompt + schéma JSON strict envoyés à
 * `--json-schema` (structured output du CLI Claude Code — validé empiriquement le 2026-09-04 :
 * `structured_output` revient déjà parsé dans le résultat, pas de JSON à extraire d'un texte
 * libre), et calcul du devis à partir du ledger (§8 de la spec : médiane/p90 observés, pas une
 * estimation du LLM). Catalogue de spécialistes réduit à `generaliste` à cette étape (Étape 1,
 * §14) — un repli mécanique s'applique si le triage en suggère un autre.
 */

const { sectionRoutage, parametre } = require('./policy');
const { statsPour } = require('./ledger');

const SPECIALISTES_CONNUS = ['generaliste'];
const NIVEAUX_VALIDES = [1, 2, 3];
const PROFILS_VALIDES = ['conception', 'execution', 'relecture'];

const SCHEMA_TRIAGE = {
  type: 'object',
  properties: {
    level: { type: 'integer' },
    specialists: { type: 'array', items: { type: 'string' } },
    profile: { type: 'string' },
    complexity: { type: 'string' },
    rationale: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    mission_draft: { type: 'string' },
    optimized_prompt: { type: 'string' },
  },
  required: [
    'level', 'specialists', 'profile', 'complexity', 'rationale', 'questions', 'mission_draft', 'optimized_prompt',
  ],
};

function construirePromptTriage({ prompt, cfg }) {
  const routage = sectionRoutage(cfg);
  return [
    "Tu es le routeur de holarch-d. Détermine, pour la demande utilisateur ci-dessous, quel niveau",
    "d'appareil HOLARCH convient :",
    '1 = spécialiste (un seul avis, ponctuel) ; 2 = panel (plusieurs avis + arbitrage, pas encore',
    "implémenté à ce stade du projet) ; 3 = mission HOLARCH complète (décomposition récursive, pas",
    'encore implémenté à ce stade). Le catalogue de spécialistes ne contient pour le moment qu\'un',
    'seul nom utilisable : « generaliste ».',
    '',
    'Table de routage complexité/nature → profil (POLICY.md) :',
    routage || '(aucune table de routage déclarée dans POLICY.md)',
    '',
    'Réponds strictement selon le schéma JSON fourni. `optimized_prompt` : reformule la demande de',
    "façon plus précise et actionnable pour le spécialiste qui la recevra (même intention, plus",
    "clair) — jamais vide, recopie la demande telle quelle si elle est déjà limpide. `mission_draft`",
    ": chaîne vide si le niveau n'est pas 3, sinon un court brouillon d'OBJECTIVE.md. `questions` :",
    '0 à 3 questions de clarification, liste vide si la demande est déjà claire. Ne choisis jamais',
    'un niveau plus élevé juste pour « mieux répondre » : le niveau 1 suffit à la grande majorité',
    'des demandes ponctuelles — c\'est un routeur économe, pas un maximisateur de qualité perçue.',
    '',
    `Demande utilisateur : ${prompt}`,
  ].join('\n');
}

/** Valide/corrige la sortie du triage — jamais confiance aveugle dans un JSON, même structuré. */
function validerTriage(sortieBrute, promptOriginal) {
  const s = Object.assign(
    {
      level: 1, specialists: [], profile: 'execution', complexity: 'moyenne', rationale: '',
      questions: [], mission_draft: '', optimized_prompt: '',
    },
    sortieBrute || {},
  );
  s.level = NIVEAUX_VALIDES.includes(Number(s.level)) ? Number(s.level) : 1;
  s.profile = PROFILS_VALIDES.includes(s.profile) ? s.profile : 'execution';
  const demandes = Array.isArray(s.specialists) ? s.specialists : [];
  const connus = demandes.filter((n) => SPECIALISTES_CONNUS.includes(n));
  const repliSpecialistes = connus.length === 0;
  s.specialists = repliSpecialistes ? ['generaliste'] : connus;
  s.questions = Array.isArray(s.questions) ? s.questions.slice(0, 3).map(String) : [];
  s.rationale = String(s.rationale || '');
  s.mission_draft = s.level === 3 ? String(s.mission_draft || '') : '';
  s.optimized_prompt = String(s.optimized_prompt || '').trim() || String(promptOriginal || '');
  return { sortie: s, repli_specialistes: repliSpecialistes };
}

function arrondi(n) {
  return n === null || n === undefined ? null : Math.round(n * 10000) / 10000;
}

/**
 * Devis pour (niveau, profil[, espace]) : à partir du ledger si assez d'échantillons (≥ 3),
 * sinon défauts de POLICY.md — jamais une estimation demandée au LLM lui-même (§8).
 */
function devis({ space, level, profil, cfg }) {
  const stats = statsPour({ space, level, profil });
  if (stats.echantillon >= 3) {
    return {
      cost_usd: [arrondi(stats.cout_usd_median * 0.7), arrondi(stats.cout_usd_p90)],
      duration_s: [arrondi(stats.duree_s_mediane * 0.7), arrondi(stats.duree_s_p90)],
      source: `observé (${stats.echantillon} appel(s), niveau ${level}/${profil})`,
    };
  }
  const budgetDefaut = Number(parametre(cfg, `budget_usd_niveau${level}`, level === 1 ? 1 : 0.05));
  const timeoutDefaut = Number(parametre(cfg, `timeout_s_niveau${level}`, level === 1 ? 180 : 15));
  return {
    cost_usd: [arrondi(budgetDefaut * 0.1), arrondi(budgetDefaut)],
    duration_s: [5, timeoutDefaut],
    source: 'défauts de POLICY.md (échantillon de ledger insuffisant, < 3)',
  };
}

module.exports = {
  SCHEMA_TRIAGE, SPECIALISTES_CONNUS, NIVEAUX_VALIDES, PROFILS_VALIDES,
  construirePromptTriage, validerTriage, devis,
};
