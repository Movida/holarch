'use strict';
/**
 * policy.js — résolution modèle/effort pour holarch-d, en réutilisant la chaîne de précédence du
 * lanceur HOLARCH plutôt que de la réécrire. `framework/bin/holarch-spawn.js` exporte déjà ses
 * fonctions internes ; le lire depuis `tools/` reste conforme à `CONTRIBUTING.md`, qui interdit
 * aux outils d'*écrire* sous `framework/`, pas de le lire. `parseConfig` n'a aucune dépendance au
 * nom du fichier — elle parse un texte selon ses en-têtes de section (`## Politique de modèle`,
 * `## Paramètres`) — donc réutilisable telle quelle sur `POLICY.md`.
 */

const fs = require('fs');
const path = require('path');
const { parseConfig, resolveProfile } = require('./repo').chargerLanceur();

const POLICY_PATH_DEFAUT = path.join(__dirname, 'POLICY.md');
const PROFILS_CONNUS = ['triage', 'conception', 'execution', 'relecture'];

function chargerPolitique(policyPath) {
  const p = policyPath || process.env.HOLARCH_D_POLICY || POLICY_PATH_DEFAUT;
  const texte = fs.readFileSync(p, 'utf8');
  return Object.assign({ chemin: p, texteBrut: texte }, parseConfig(texte));
}

/**
 * Résout modèle/effort pour un profil explicite en réutilisant `resolveProfile` du lanceur :
 * override appelant > table « Politique de modèle » de POLICY.md > défauts codés dans
 * `holarch-spawn.js` (`DEFAULT_POLICY`) > défauts génériques (`DEFAULTS`).
 */
function resoudreProfil(cfg, profil, overrides = {}) {
  if (!PROFILS_CONNUS.includes(profil)) {
    throw new Error(`profil inconnu : « ${profil} » (attendu : ${PROFILS_CONNUS.join(' | ')})`);
  }
  const meta = resolveProfile(cfg, {}, profil, Object.assign({ profil }, overrides));
  return { profil: meta.profil, modele: meta.modele, effort: meta.effort };
}

function parametre(cfg, nom, defaut) {
  const v = cfg.params && cfg.params[nom];
  return v === undefined || v === '' ? defaut : v;
}

/** Extrait la section « ## Routage » telle quelle (texte brut), pour l'inliner dans un prompt de triage. */
function sectionRoutage(cfg) {
  const lignes = cfg.texteBrut.split('\n');
  const debut = lignes.findIndex((l) => /^##\s*Routage\s*$/.test(l.trim()));
  if (debut === -1) return '';
  const suite = lignes.slice(debut + 1);
  const finRel = suite.findIndex((l) => /^##\s/.test(l));
  const bloc = finRel === -1 ? suite : suite.slice(0, finRel);
  return bloc.join('\n').trim();
}

module.exports = {
  chargerPolitique, resoudreProfil, parametre, sectionRoutage, POLICY_PATH_DEFAUT, PROFILS_CONNUS,
};
