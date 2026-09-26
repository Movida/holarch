'use strict';
/**
 * attente-limite.js — attente interruptible d'une limite 429 (chantier 16, `docs/IMPLEMENTATION.md`
 * §18.3). Remplace l'`Atomics.wait` d'un seul bloc de `attendre()` (`holarch-spawn.js`) par une
 * attente par tranches d'au plus `HOLARCH_ATTENTE_TRANCHE_MS` (ou 5 s à défaut), qui regarde un
 * fichier stop **entre deux tranches** — un lanceur en attente longue (jusqu'à 6 h, §11.3) sort donc
 * sur `--arret` en une tranche, pas à la fin de l'attente entière.
 *
 * Pendant l'attente, `attenteFile` (convention `mission/.holarch/live/<chemin-tirets>.attente.json`,
 * même répertoire que `liveLockPath`/`contexteLivePath`) porte `{pid, jusqua, motif, tentative}` —
 * `demanderArret` (`holarch-spawn.js`) le lit pour compter un lanceur en attente comme vivant. Il est
 * supprimé à la fin de l'attente, quelle qu'en soit l'issue (`'fini'` ou `'arret'`), y compris si
 * l'appelant lève avant d'appeler cette fonction (rien à nettoyer alors) — jamais laissé sur disque
 * après le retour de `attendreInterruptible`.
 *
 * Module autonome, sans dépendance à holarch-spawn.js : testable depuis ce paquet promouvable
 * (`require('../bin/attente-limite.js')`), chemin identique une fois promu sous `framework/bin/`.
 */

const fs = require('fs');
const path = require('path');

const TRANCHE_DEFAUT_MS = 5000;
const MOTIF_MAX = 80;

/** Champ 22 (starttime) de /proc/<pid>/stat, compté après la dernière ')' — même lecture que `jobs.js`
 *  (CONCEPTION-JOBS.md §1), recopiée pour garder ce module autonome. `null` si /proc indisponible. */
function starttimeDe(pid) {
  try {
    const contenu = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const champs = contenu.slice(contenu.lastIndexOf(')') + 2).split(' ');
    return champs[19] || null;
  } catch (_) { return null; }
}

/** Contenu d'`attenteFile` si son lanceur vit encore — pid vivant **et** même starttime quand il est noté
 *  (MSG-utilisateur-004 point 6 : un pid réutilisé par un processus étranger n'est pas le lanceur) ; sinon `null`. */
function attenteVivante(attenteFile) {
  let data;
  try { data = JSON.parse(fs.readFileSync(attenteFile, 'utf8')); } catch (_) { return null; }
  if (!data || !data.pid) return null;
  return processusVivant(data.pid, data.starttime) ? data : null;
}

/** Processus `pid` vivant : kill(pid, 0) réussit, il n'est pas zombie (état `Z` de /proc, fini mais pas encore
 *  récolté par son parent) et, si `starttime` est donné et lisible, c'est bien le même processus. */
function processusVivant(pid, starttime) {
  try { process.kill(pid, 0); } catch (e) { if (!e || e.code !== 'EPERM') return false; }
  try {
    const contenu = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    if (contenu.slice(contenu.lastIndexOf(')') + 2).split(' ')[0] === 'Z') return false;
  } catch (_) { /* /proc indisponible : kill(pid, 0) fait foi */ }
  if (starttime) {
    const actuel = starttimeDe(pid);
    if (actuel !== null && actuel !== starttime) return false;
  }
  return true;
}

/** Supprime `attenteFile` seulement s'il appartient encore à (`pid`, `starttime`) — un second lanceur qui l'a
 *  réécrit entre-temps reste visible de `--arret` (point 6). Rend `true` si le fichier a été supprimé. */
function supprimerSiProprietaire(attenteFile, pid, starttime) {
  let data;
  try { data = JSON.parse(fs.readFileSync(attenteFile, 'utf8')); } catch (_) { return false; }
  if (!data || data.pid !== pid || (data.starttime || null) !== (starttime || null)) return false;
  try { fs.unlinkSync(attenteFile); return true; } catch (_) { return false; }
}

/** Une tranche d'attente bloquante (≤ `ms`), sans effet si `ms <= 0`. */
function attendreTranche(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Motif borné pour la colonne « Fin » de `registry/SESSIONS.md` : retours ligne réduits à un espace,
 *  `|` remplacé par `/` (un `\|` échappé décale les colonnes de parseSessions, MSG-utilisateur-004 point 7), puis coupé à 80 caractères au plus
 *  — dans cet ordre, pour que le résultat final ne dépasse jamais 80 caractères même après échappement. */
function motifFin(texte) {
  const brut = texte === null || texte === undefined ? '' : String(texte);
  const sansRetours = brut.replace(/\r?\n+/g, ' ');
  const echappe = sansRetours.replace(/\|/g, '/');
  return echappe.slice(0, MOTIF_MAX);
}

/** Attente interruptible : `{ms, trancheMs, stopFile, attenteFile, info}` →
 *  `'fini'` (durée `ms` écoulée sans fichier stop) ou `'arret'` (fichier stop constaté entre deux
 *  tranches). `ms <= 0` rend `'fini'` immédiatement, sans écrire `attenteFile` (rien n'a été attendu).
 *  `trancheMs` : taille de chaque tranche bloquante, au plus `HOLARCH_ATTENTE_TRANCHE_MS` (variable
 *  d'environnement, commodité de test) ou `TRANCHE_DEFAUT_MS` (5000) à défaut de l'un et l'autre.
 *  `attenteFile` (facultatif) : chemin où écrire `{pid: process.pid, starttime, jusqua: <ISO>, ...info}` pour
 *  toute la durée de l'attente — supprimé avant de rendre la main, `'fini'` ou `'arret'`, s'il est encore le
 *  sien (un second lanceur qui l'a réécrit le garde, point 6). `stopFile`
 *  (facultatif) : chemin regardé après chaque tranche ; absent de disque ⇒ jamais `'arret'`. */
function attendreInterruptible(opts) {
  const { ms, trancheMs, stopFile, attenteFile, info } = opts || {};
  const total = Number(ms) || 0;
  if (total <= 0) return 'fini';
  const tranche = Math.max(
    1,
    Number(trancheMs) || Number(process.env.HOLARCH_ATTENTE_TRANCHE_MS) || TRANCHE_DEFAUT_MS,
  );
  const starttime = starttimeDe(process.pid);
  if (attenteFile) {
    const donnees = Object.assign(
      { pid: process.pid, starttime, jusqua: new Date(Date.now() + total).toISOString() },
      info || {},
    );
    fs.mkdirSync(path.dirname(attenteFile), { recursive: true });
    fs.writeFileSync(attenteFile, JSON.stringify(donnees));
  }
  try {
    let restant = total;
    while (restant > 0) {
      const pas = Math.min(tranche, restant);
      attendreTranche(pas);
      restant -= pas;
      if (stopFile && fs.existsSync(stopFile)) return 'arret';
    }
    return 'fini';
  } finally {
    if (attenteFile) supprimerSiProprietaire(attenteFile, process.pid, starttime);
  }
}

module.exports = {
  attendreInterruptible, motifFin, attenteVivante, processusVivant, supprimerSiProprietaire, starttimeDe, TRANCHE_DEFAUT_MS, MOTIF_MAX,
};
