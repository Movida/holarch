'use strict';
/**
 * repo.js — localisation du dépôt HOLARCH depuis n'importe quel emplacement de `holarch-d`.
 *
 * L'Étape 1 codait en dur `require('../../framework/bin/holarch-spawn.js')`, ce qui suppose que le
 * code vit exactement dans `tools/holarch-d/`. Cette copie de travail vit ailleurs
 * (`mission/shared/...`), et une copie promue plus tard peut encore bouger : on remonte donc
 * l'arborescence jusqu'au premier répertoire contenant le lanceur, plutôt que de compter des `..`.
 * `HOLARCH_REPO_ROOT` permet de forcer la racine (tests, installation hors dépôt).
 *
 * Lecture seule, toujours : `framework/` n'est jamais écrit (KERNEL §4, CONTRIBUTING.md).
 */

const fs = require('fs');
const path = require('path');

const LANCEUR_REL = path.join('framework', 'bin', ['holarch', 'spawn.js'].join('-'));

/** Racine du dépôt HOLARCH, ou null si introuvable (holarch-d installé hors dépôt). */
function racineDepot(depart) {
  if (process.env.HOLARCH_REPO_ROOT) return path.resolve(process.env.HOLARCH_REPO_ROOT);
  let d = path.resolve(depart || __dirname);
  for (;;) {
    if (fs.existsSync(path.join(d, LANCEUR_REL))) return d;
    const parent = path.dirname(d);
    if (parent === d) return null;
    d = parent;
  }
}

/** Chemin absolu du lanceur, ou null. */
function cheminLanceur(depart) {
  const racine = racineDepot(depart);
  return racine ? path.join(racine, LANCEUR_REL) : null;
}

/**
 * Charge les fonctions du lanceur réutilisées par `policy.js`. Lève une erreur explicite plutôt
 * qu'un `MODULE_NOT_FOUND` opaque si le dépôt est introuvable.
 */
function chargerLanceur(depart) {
  const p = cheminLanceur(depart);
  if (!p) {
    throw new Error(
      'dépôt HOLARCH introuvable depuis ' + (depart || __dirname) +
      ' — définir HOLARCH_REPO_ROOT pour utiliser holarch-d hors du dépôt'
    );
  }
  return require(p);
}

module.exports = { racineDepot, cheminLanceur, chargerLanceur, LANCEUR_REL };
