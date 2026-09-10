'use strict';
/**
 * tasks.js — état des tâches sur disque, `~/.holarch/tasks/<id>/` (§5 de la spec). Une tâche =
 * `TASK.json` (état complet), `RESULT.md` une fois terminée, `transcripts/*.jsonl` (sortie brute
 * `stream-json`). Fonctions pures vis-à-vis du réseau/des sous-processus — testables sans rien
 * dépenser.
 */

const fs = require('fs');
const path = require('path');
const { racineHolarch } = require('./ledger');

const ETATS = ['queued', 'running', 'done', 'failed', 'cancelled'];

function racineTaches() {
  return path.join(racineHolarch(), 'tasks');
}

function dossierTache(id) {
  return path.join(racineTaches(), id);
}

function creer(tache) {
  const dossier = dossierTache(tache.id);
  fs.mkdirSync(path.join(dossier, 'transcripts'), { recursive: true });
  const complet = Object.assign({
    state: 'queued',
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    cost_usd: null,
    turns: null,
    duration_ms: null,
    error: null,
    partial: null,
  }, tache);
  ecrire(complet);
  return complet;
}

function ecrire(tache) {
  fs.writeFileSync(path.join(dossierTache(tache.id), 'TASK.json'), JSON.stringify(tache, null, 2));
  return tache;
}

function lire(id) {
  const p = path.join(dossierTache(id), 'TASK.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return null; }
}

/** Fusionne des champs dans une tâche existante et réécrit TASK.json. */
function patch(id, champs) {
  const actuelle = lire(id);
  if (!actuelle) throw new Error(`tâche introuvable : ${id}`);
  const fusionnee = Object.assign({}, actuelle, champs);
  ecrire(fusionnee);
  return fusionnee;
}

function lister({ space, state, limit } = {}) {
  const racine = racineTaches();
  if (!fs.existsSync(racine)) return [];
  const ids = fs.readdirSync(racine, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  let taches = ids.map(lire).filter(Boolean);
  if (space !== undefined) taches = taches.filter((t) => (t.space || 'default') === space);
  if (state !== undefined) taches = taches.filter((t) => t.state === state);
  taches.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // plus récentes d'abord
  if (limit) taches = taches.slice(0, limit);
  return taches;
}

function cheminResultat(id) {
  return path.join(dossierTache(id), 'RESULT.md');
}

function ecrireResultat(id, markdown) {
  fs.writeFileSync(cheminResultat(id), markdown);
}

function lireResultat(id) {
  const p = cheminResultat(id);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function cheminTranscript(id) {
  return path.join(dossierTache(id), 'transcripts', `${id}.jsonl`);
}

function ajouterLigneTranscript(id, ligneBrute) {
  fs.appendFileSync(cheminTranscript(id), `${ligneBrute}\n`);
}

module.exports = {
  ETATS, racineTaches, dossierTache, creer, ecrire, lire, patch, lister,
  cheminResultat, ecrireResultat, lireResultat, cheminTranscript, ajouterLigneTranscript,
};
