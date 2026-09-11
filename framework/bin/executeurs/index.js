'use strict';
/**
 * Sélection et vérification des exécuteurs (chantier 9, volet 1 — `docs/IMPLEMENTATION.md` §11.1).
 *
 * Un **exécuteur** traduit une intention de session HOLARCH en invocation d'un fournisseur de
 * modèles, et sa sortie en un `Resultat` normalisé. Le lanceur ne connaît que ce contrat :
 *
 *   nom         string                       identifiant stable, égal au nom de fichier
 *   capacites   { sous_agents, hooks, prompt_systeme_fichier, transcription }  booléens obligatoires
 *   preparer    (launch, params) → Prep      { bin, args, env, cwd, stdin, nettoyer? }
 *   executer    (prep, { timeoutMs }) → Brut { stdout, stderr, exitCode, signal, error, elapsedMs }
 *   normaliser  (brut) → Resultat            forme commune (ci-dessous)
 *   limite      (resultat) → { texte, repriseIso, attenteMs } | null
 *
 * `Resultat` (tous champs toujours présents) :
 *   session_id  string|null · tours number|null · cout_usd number|null (null ⇒ calculé par le
 *   catalogue, marqué « ≈ ») · tokens { entree, cache_lu, cache_ecrit, sortie } · modeles
 *   [{ id, cout_usd }] · fin 'success'|'erreur'|'limite'|'sans_resultat' · sous_type string|null ·
 *   refus number · statut_http number|null · texte string (≤ 160 car.) · brut object|null.
 *
 * `preparer`, `normaliser` et `limite` sont purs vis-à-vis du dépôt : aucune écriture sous
 * `mission/`. `preparer` peut écrire dans un répertoire temporaire du système, qu'il nettoie par
 * `Prep.nettoyer` (appelé par le lanceur dans un `finally`). Seul `executer` lance un processus.
 *
 * Ajouter un exécuteur (par exemple `api-messages`, hors périmètre du chantier 9 — décision D3) :
 * un fichier `executeurs/<nom>.js` respectant le contrat, une entrée dans `MODULES` ci-dessous.
 * Rien dans `Resultat` ni dans `Prep` ne suppose un processus fils : un exécuteur qui appelle une
 * API HTTP ignore `bin`/`args` et implémente `executer` autrement, `capacites.hooks = false`
 * dégradant proprement `context-watch` et `delegation-intra-session`.
 */

const MODULES = {
  'claude-code': require('./claude-code'),
  fake: require('./fake'),
  passerelle: require('./passerelle'),
};

/** Exécuteur par défaut, et seul nom « en dur » de toute la chaîne de lancement. */
const DEFAUT = 'claude-code';

const MEMBRES = ['preparer', 'executer', 'normaliser', 'limite'];
const CAPACITES = ['sous_agents', 'hooks', 'prompt_systeme_fichier', 'transcription'];

function noms() {
  return Object.keys(MODULES);
}

/** Écarts au contrat d'un module exécuteur : tableau vide ⇒ conforme. */
function verifierContrat(mod, nomAttendu) {
  const ecarts = [];
  if (!mod || typeof mod !== 'object') return ['module absent ou non exportable'];
  if (typeof mod.nom !== 'string' || !mod.nom) ecarts.push('nom manquant');
  else if (nomAttendu && mod.nom !== nomAttendu) ecarts.push(`nom « ${mod.nom} » ≠ « ${nomAttendu} »`);
  if (!mod.capacites || typeof mod.capacites !== 'object') ecarts.push('capacites manquantes');
  else for (const c of CAPACITES) {
    if (typeof mod.capacites[c] !== 'boolean') ecarts.push(`capacite ${c} absente ou non booléenne`);
  }
  for (const m of MEMBRES) if (typeof mod[m] !== 'function') ecarts.push(`${m} n'est pas une fonction`);
  return ecarts;
}

/** Exécuteur nommé. Un nom inconnu **jette** (échec franc au lancement, jamais un repli silencieux
 *  sur l'exécuteur par défaut : une session lancée sur le mauvais fournisseur est indétectable). */
function resoudre(nom) {
  const mod = MODULES[nom];
  if (!mod) throw new Error(`exécuteur inconnu : « ${nom} » (connus : ${noms().join(', ')})`);
  const ecarts = verifierContrat(mod, nom);
  if (ecarts.length) throw new Error(`exécuteur « ${nom} » non conforme au contrat : ${ecarts.join(' ; ')}`);
  return mod;
}

/**
 * Nom de l'exécuteur à employer pour une tentative, par ordre de précédence :
 *   1. `HOLARCH_FAKE_CLAUDE` défini → `fake` (alias historique : les tests restent inchangés) ;
 *   2. fournisseur résolu pour l'instance (table `## Fournisseurs`, volet 2) → sa colonne `Exécuteur` ;
 *   3. `params.executeur` de `CONFIG.md` ;
 *   4. défaut `claude-code`.
 * @param {{env?: object, fournisseur?: {executeur?: string}|null, params?: {executeur?: string}}} ctx
 */
function nomPour(ctx) {
  ctx = ctx || {};
  const env = ctx.env || process.env;
  if (env.HOLARCH_FAKE_CLAUDE) return 'fake';
  if (ctx.fournisseur && ctx.fournisseur.executeur) return ctx.fournisseur.executeur;
  if (ctx.params && ctx.params.executeur) return ctx.params.executeur;
  return DEFAUT;
}

module.exports = { resoudre, noms, verifierContrat, nomPour, DEFAUT, MEMBRES, CAPACITES };
