'use strict';
/**
 * specialists.js — accès au catalogue de spécialistes (§7, §8) pour le reste du démon. Couche
 * mince au-dessus de `validate-specialists.js`, qui reste la seule autorité sur ce qu'est une
 * fiche valide : ce module ne revalide rien, il charge, résout et résume.
 *
 * Trois usages, trois formes :
 *   - `texteFiche(nom)`  → le markdown brut, injecté tel quel dans le prompt système (§6) ;
 *   - `resumes()`        → une ligne par spécialiste, servie par l'outil MCP `list_specialists` ;
 *   - `resoudre(nom)`    → la garantie qu'on ne route jamais vers un nom qui n'existe pas (§8).
 *
 * Le catalogue est **livré avec le code** (`./specialists/*.md`), pas dans `HOLARCH_HOME` : c'est un
 * artefact versionné du dépôt, pas de l'état utilisateur. La mémoire, elle, est par espace et vit
 * dans `HOLARCH_HOME` (spaces.js) — c'est la distinction D8 entre « qui je suis » et « ce que j'ai
 * appris ici ».
 */

const fs = require('fs');
const path = require('path');
const { chargerCatalogue } = require('./validate-specialists');
const ledger = require('./ledger');

const REPERTOIRE = path.join(__dirname, 'specialists');
const REPLI = 'generaliste';

let cache = null;

/** Charge (une seule fois) les fiches valides du catalogue. Les fiches invalides sont ignorées et
 *  leurs erreurs conservées : le démon doit démarrer même si une fiche est cassée — il retombera
 *  sur `generaliste` — mais la panne ne doit pas être silencieuse (`erreurs` est exposé et servi
 *  par `list_specialists`). */
function catalogue({ recharger = false, repertoire = REPERTOIRE } = {}) {
  if (cache && !recharger && cache.repertoire === repertoire) return cache;
  const { fiches, erreurs } = chargerCatalogue(repertoire);
  const parNom = new Map();
  for (const f of fiches.values()) {
    const chemin = path.join(repertoire, `${f.nom}.md`);
    parNom.set(f.nom, Object.assign({}, f, { chemin, texte: fs.readFileSync(chemin, 'utf8') }));
  }
  cache = { repertoire, fiches: parNom, erreurs };
  return cache;
}

function noms() {
  return Array.from(catalogue().fiches.keys()).sort();
}

function fiche(nom) {
  return catalogue().fiches.get(String(nom || '')) || null;
}

function texteFiche(nom) {
  const f = fiche(nom);
  return f ? f.texte : null;
}

/**
 * Résolution d'un nom de spécialiste (§8) : un nom hors catalogue **retombe sur `generaliste`**
 * plutôt que d'échouer. Un routeur qui hallucine un nom de spécialiste est un cas attendu, pas une
 * erreur d'utilisateur : la demande doit aboutir, en le signalant (`repli: true`).
 */
function resoudre(nom) {
  const demande = String(nom || '').trim();
  if (demande && catalogue().fiches.has(demande)) return { nom: demande, repli: false, demande };
  return { nom: REPLI, repli: true, demande: demande || null };
}

/** Nombre de tâches déjà exécutées par un spécialiste dans un espace — l'information qui rend
 *  `list_specialists` utile à un LLM appelant : savoir lequel connaît déjà le terrain. */
function nbTaches(space, nom) {
  // Compte des **tâches distinctes**, pas des lignes de ledger : depuis l'Étape 2, une même tâche
  // en produit plusieurs (l'avis, puis la passe mémoire, puis la notation `rate_result`). Compter
  // les lignes annoncerait une expérience gonflée d'un facteur 2 à 3.
  const taches = new Set();
  for (const l of ledger.lireLignes()) {
    if (l.level !== 1 || l.specialist !== nom || !l.task) continue;
    if (space !== undefined && (l.space || 'default') !== space) continue;
    taches.add(l.task);
  }
  return taches.size;
}

/**
 * Résumés servis par `list_specialists` : nom, phrase de sollicitation, profil par défaut, outils,
 * affinités de panel, et le nombre de tâches déjà faites dans l'espace. Volontairement **sans** le
 * corps des fiches : le but est de choisir, pas de lire six personas (§9 — un outil MCP répond en
 * quelques centaines de tokens, pas en quelques milliers).
 */
function resumes({ space } = {}) {
  return noms().map((nom) => {
    const f = fiche(nom);
    return {
      name: nom,
      when_to_use: (f.sections['Quand me solliciter'] || '').trim(),
      specialty: (f.sections['Spécialité'] || '').split('\n')[0].trim(),
      profile_default: f.meta.profile_default || null,
      tools: f.meta.tools || 'none',
      panel_affinity: Array.isArray(f.meta.panel_affinity) ? f.meta.panel_affinity : [],
      tasks_done: nbTaches(space, nom),
    };
  });
}

/** Le spécialiste a-t-il droit aux outils de lecture (D17) ? La fiche seule ne suffit pas : il
 *  faut aussi que l'espace ait des racines déclarées — décidé dans `launch.js`, pas ici. */
function veutLecture(nom) {
  const f = fiche(nom);
  return !!f && f.meta.tools === 'read';
}

module.exports = {
  REPERTOIRE, REPLI, catalogue, noms, fiche, texteFiche, resoudre, resumes, nbTaches, veutLecture,
};
