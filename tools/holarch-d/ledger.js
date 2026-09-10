'use strict';
/**
 * ledger.js — journal append-only des appels LLM de holarch-d, hors dépôt (D7 : la facturation est
 * par compte Claude et par machine, pas par clone du dépôt). `~/.holarch/ledger.jsonl` par défaut,
 * `HOLARCH_HOME` pour surcharger (tests, plusieurs comptes). Sert aussi de base au devis (§8 : le
 * démon calcule médiane/p90 observés plutôt que de les faire deviner par le LLM) et aux quotas
 * (§11 : `quota_usd_jour`).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

function racineHolarch() {
  return process.env.HOLARCH_HOME || path.join(os.homedir(), '.holarch');
}

function cheminLedger() {
  return path.join(racineHolarch(), 'ledger.jsonl');
}

function commitFramework(depotRacine) {
  try {
    return execFileSync('git', ['-C', depotRacine, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'], // échec attendu hors d'un dépôt Git : ne pas polluer stderr
    }).trim();
  } catch (_e) {
    return null;
  }
}

function nouvelId() {
  return crypto.randomUUID();
}

/** Écrit une ligne de ledger (append-only, jamais réécrite). Retourne la ligne écrite. */
function enregistrer({
  id, space, task, level, specialist, profil, modele, effort, resultat, elapsedMs, exit, depotRacine,
}) {
  const racine = racineHolarch();
  fs.mkdirSync(racine, { recursive: true });
  const u = (resultat && resultat.usage) || {};
  const ligne = {
    id,
    date: new Date().toISOString(),
    space: space || 'default',
    task: task || null,
    level,
    specialist: specialist || null,
    profil: profil || null,
    modele: (resultat && resultat.modelUsage && Object.keys(resultat.modelUsage).join('+')) || modele || null,
    effort: effort || null,
    cout_usd: resultat && typeof resultat.total_cost_usd === 'number' ? resultat.total_cost_usd : null,
    tokens_entree: u.input_tokens ?? null,
    tokens_cache_lu: u.cache_read_input_tokens ?? null,
    tokens_cache_ecrit: u.cache_creation_input_tokens ?? null,
    tokens_sortie: u.output_tokens ?? null,
    tours: resultat ? resultat.num_turns : null,
    duree_ms: elapsedMs,
    exit: exit || (resultat ? (resultat.is_error ? 'erreur' : 'ok') : 'sans_resultat'),
    repo_commit: depotRacine ? commitFramework(depotRacine) : null,
  };
  fs.appendFileSync(cheminLedger(), `${JSON.stringify(ligne)}\n`);
  return ligne;
}

function lireLignes() {
  const p = cheminLedger();
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch (_e) { return null; }
  }).filter(Boolean);
}

function mediane(valeurs) {
  if (!valeurs.length) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const m = Math.floor(tri.length / 2);
  return tri.length % 2 ? tri[m] : (tri[m - 1] + tri[m]) / 2;
}

function percentile(valeurs, p) {
  if (!valeurs.length) return null;
  const tri = [...valeurs].sort((a, b) => a - b);
  const idx = Math.min(tri.length - 1, Math.ceil((p / 100) * tri.length) - 1);
  return tri[Math.max(0, idx)];
}

/**
 * Statistiques observées pour un (niveau, profil[, espace]) donné — base du devis (§8). `null`
 * pour chaque valeur tant que le ledger est vide sur ce filtre : à l'appelant de retomber sur les
 * défauts de POLICY.md dans ce cas.
 */
function statsPour({ space, level, profil }) {
  const lignes = lireLignes().filter((l) => (
    l.level === level
    && (profil === undefined || l.profil === profil)
    && (space === undefined || l.space === space)
    && l.cout_usd !== null
  ));
  const couts = lignes.map((l) => l.cout_usd);
  const durees = lignes.map((l) => l.duree_ms).filter((d) => typeof d === 'number');
  return {
    echantillon: lignes.length,
    cout_usd_median: mediane(couts),
    cout_usd_p90: percentile(couts, 90),
    duree_s_mediane: durees.length ? mediane(durees) / 1000 : null,
    duree_s_p90: durees.length ? percentile(durees, 90) / 1000 : null,
  };
}

/** Dépense cumulée du jour courant (UTC), tous niveaux confondus, pour un espace ou globale. */
function depenseAujourdhui({ space } = {}) {
  const aujourdhui = new Date().toISOString().slice(0, 10);
  return lireLignes()
    .filter((l) => l.date.slice(0, 10) === aujourdhui && (space === undefined || l.space === space) && typeof l.cout_usd === 'number')
    .reduce((somme, l) => somme + l.cout_usd, 0);
}

module.exports = {
  enregistrer, lireLignes, statsPour, depenseAujourdhui, racineHolarch, cheminLedger, commitFramework, nouvelId,
};
