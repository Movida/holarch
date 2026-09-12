'use strict';
/**
 * Exécuteur `passerelle` — le CLI Claude Code pointé sur un fournisseur compatible API Messages.
 *
 * Chantier 9, volet 1 (`docs/IMPLEMENTATION.md` §11.1) : même binaire, mêmes arguments, mêmes hooks
 * que `claude-code` ; seules changent deux choses, toutes deux portées par l'entrée de catalogue que
 * le lanceur pose dans `launch.fournisseur` (volet 2) :
 *   1. l'URL et le jeton du fournisseur, ajoutés à l'environnement du processus fils ;
 *   2. le modèle, remplacé par le `Modèle réel` du catalogue (l'identifiant HOLARCH du modèle n'a
 *      aucune raison d'être compris par un fournisseur tiers).
 *
 * Aucune clé n'est requise pour que la suite de tests passe : sans `launch.fournisseur`, cet
 * exécuteur se comporte exactement comme `claude-code` (mêmes arguments, environnement inchangé).
 */
const claudeCode = require('./claude-code');

const nom = 'passerelle';

// Même CLI, donc mêmes capacités : hooks, sous-agents et transcription restent disponibles.
const capacites = Object.assign({}, claudeCode.capacites);

/** Variables d'environnement d'un fournisseur. `url`/`jeton` sont lues par le lanceur dans
 *  `HOLARCH_FOURNISSEUR_<NOM>_URL` / `_JETON` (geste du mainteneur, jamais committées) ; `env`
 *  permet à une entrée de catalogue d'en ajouter d'autres sans toucher à ce fichier.
 *
 *  `ANTHROPIC_API_KEY` est explicitement vidée dès qu'un fournisseur est posé : constaté en réel
 *  (chantier 11, §12.6, sonde du 2026-09-12) une clé Anthropic laissée dans l'environnement à côté
 *  du jeton de passerelle ne produit pas un 401 franc — le CLI se pend (aucun JSON, tué au bout de
 *  187 s) au lieu d'échouer proprement. La vider garantit que seul le jeton du fournisseur est
 *  utilisé, sans changer le comportement quand aucun fournisseur n'est posé (§12.6, garantie
 *  « aucune clé requise pour que la suite passe » de l'en-tête ci-dessus). */
function envFournisseur(f) {
  const out = {};
  if (!f) return out;
  out.ANTHROPIC_API_KEY = '';
  if (f.url) out.ANTHROPIC_BASE_URL = f.url;
  if (f.jeton) out.ANTHROPIC_AUTH_TOKEN = f.jeton;
  if (f.env && typeof f.env === 'object') Object.assign(out, f.env);
  return out;
}

/** Modèle réellement envoyé au fournisseur : `Modèle réel` du catalogue, à défaut celui du régime. */
function modeleReel(launch) {
  const f = launch.fournisseur || {};
  return f.modele_reel || (launch.meta && launch.meta.modele);
}

function preparer(launch, params) {
  params = params || launch.params || {};
  const { sysFile, nettoyer } = claudeCode.fichierPromptSysteme(launch.systemPrompt);
  return {
    bin: 'claude',
    args: claudeCode.construireArgs(launch, params, sysFile, modeleReel(launch)),
    env: Object.assign({}, launch.env || process.env, envFournisseur(launch.fournisseur)),
    cwd: launch.cwd,
    stdin: launch.prompt || '',
    nettoyer,
  };
}

module.exports = {
  nom,
  capacites,
  preparer,
  executer: claudeCode.executer,
  normaliser: claudeCode.normaliser,
  limite: claudeCode.limite,
  // hors contrat, pour les tests :
  envFournisseur, modeleReel,
};
