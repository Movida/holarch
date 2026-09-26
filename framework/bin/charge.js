'use strict';
/**
 * charge.js — charge machine des jobs `--lourd` (chantier 16, docs/IMPLEMENTATION.md §18.5,
 * conception mission/shared/concepteur/CONCEPTION-JOBS.md §3, amendements V1 5 et 6, unité U10).
 * Module Node autonome (modules natifs seulement), require-able par `jobs.js` et par les tests.
 * Aucun appel réseau.
 *
 * Ce module ne connaît pas `jobs.js` (aucun require en retour) : les petites fonctions de vivacité
 * pid+starttime sont dupliquées ici à dessein (voir `starttimeDe`/`vivantJeton` plus bas) pour éviter
 * tout risque de dépendance circulaire entre les deux modules — `jobs.js`, lui, dépend de `charge.js`.
 *
 * Seams de test (à documenter, cf. rapport d'unité) :
 *   - HOLARCH_CHARGE_DIR   : répertoire des jetons/file, sinon `~/.cache/holarch/charge/`.
 *   - HOLARCH_MEMINFO      : fichier à lire au lieu de `/proc/meminfo` (format identique).
 *   - HOLARCH_CHARGE_TICK_MS            : intervalle de sondage de la file / tick de suspension
 *     (défaut 5000 ms, CONCEPTION-JOBS.md §3).
 *   - HOLARCH_CHARGE_SUSPENSION_MIN_MS  : délai minimal entre deux suspensions machine (défaut
 *     15000 ms, CONCEPTION-JOBS.md §3).
 *
 * Paramètres de mission (table « Paramètres » de `<racine>/framework/CONFIG.md`) :
 *   - jobs_lourds_max (défaut 2), memoire_libre_min_mo (défaut 3000). Lus par un mini-parseur local
 *     (`lireParametresCharge`) plutôt que par `require('./holarch-spawn').parseConfig` : ce dernier
 *     entraînerait au chargement tout le graphe de `holarch-spawn.js` (reveil.js, executeurs/,
 *     catalogue.js, gardes/git.js) pour la seule lecture de deux clés d'un tableau markdown — surface
 *     et risque disproportionnés pour ce module de bas niveau, chargé par chaque superviseur de job
 *     lourd. La règle de lecture du tableau (section « param... », colonnes `| clé | valeur |`,
 *     valeur dépouillée de ses backticks) reste identique à celle de `parseConfig`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// --- Répertoires et chemins -------------------------------------------------------------------

function chargeDir(env) {
  const e = env || process.env;
  if (e.HOLARCH_CHARGE_DIR) return e.HOLARCH_CHARGE_DIR;
  return path.join(os.homedir(), '.cache', 'holarch', 'charge');
}
function fileDir(dir) { return path.join(dir, 'file'); }
function jetonPath(dir, n) { return path.join(dir, `jeton-${n}`); }
function derniereSuspensionPath(dir) { return path.join(dir, 'derniere-suspension'); }

function tickMs(env) {
  const e = env || process.env;
  const n = Number(e.HOLARCH_CHARGE_TICK_MS);
  return Number.isFinite(n) && n > 0 ? n : 5000;
}
function suspensionMinMs(env) {
  const e = env || process.env;
  const n = Number(e.HOLARCH_CHARGE_SUSPENSION_MIN_MS);
  return Number.isFinite(n) && n > 0 ? n : 15000;
}

// --- Mémoire disponible ------------------------------------------------------------------------

/** Mo disponibles (MemAvailable de /proc/meminfo ou HOLARCH_MEMINFO, converti kB → Mo). `null` si le
 *  fichier est absent ou le champ introuvable : aucune contrainte n'est alors appliquée (noté par
 *  l'appelant, qui ne doit jamais traiter `null` comme « sous le plancher »). */
function memoireDisponibleMo(env) {
  const e = env || process.env;
  const p = e.HOLARCH_MEMINFO || '/proc/meminfo';
  let texte;
  try { texte = fs.readFileSync(p, 'utf8'); } catch (_err) { return null; }
  const m = texte.match(/^MemAvailable:\s*(\d+)\s*kB/m);
  if (!m) return null;
  return Math.floor(Number(m[1]) / 1024);
}

/** Mo de mémoire totale (MemTotal, même source), `null` si non mesurable (seconde revue n° 55). */
function memoireTotaleMo(env) {
  const e = env || process.env;
  let texte;
  try { texte = fs.readFileSync(e.HOLARCH_MEMINFO || '/proc/meminfo', 'utf8'); } catch (_err) { return null; }
  const m = texte.match(/^MemTotal:\s*(\d+)\s*kB/m);
  return m ? Math.floor(Number(m[1]) / 1024) : null;
}

/** Seconde revue n° 56 : plancher de décision machine = le plus haut des planchers inscrits dans les jetons vivants
 *  et du sien — chaque superviseur, quelle que soit sa mission, décide ainsi avec la même valeur (jamais personne
 *  sous le plancher d'une autre mission). Un jeton sans `plancher_mo` (écrit avant) ne compte pas. */
function plancherEffectif(jetons, propre) {
  let p = propre;
  for (const j of jetons) if (Number.isInteger(j.plancher) && j.plancher > p) p = j.plancher;
  return p;
}

// --- Paramètres de mission (mini-parseur local, cf. en-tête) --------------------------------------

function lireParametresCharge(root) {
  const defaut = { jobsLourdsMax: 2, memoireLibreMinMo: 3000 };
  let texte;
  try { texte = fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8'); } catch (_err) { return defaut; }
  let section = '';
  const params = {};
  for (const raw of texte.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) { section = line.replace(/^#+\s*/, '').toLowerCase(); continue; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (section.startsWith('param') && cells.length >= 2 && /^[a-z][a-z0-9_]*$/.test(cells[0])) {
      params[cells[0]] = cells[1].replace(/^`|`$/g, '');
    }
  }
  const jobsLourdsMax = Number(params.jobs_lourds_max);
  // Revue n° 18 : 0 est une valeur légitime (aucun plancher), validée par config-lint (entier ≥ 0).
  const memoireLibreMinMo = /^\d+$/.test(params.memoire_libre_min_mo || '') ? Number(params.memoire_libre_min_mo) : NaN;
  return {
    jobsLourdsMax: Number.isFinite(jobsLourdsMax) && jobsLourdsMax > 0 ? jobsLourdsMax : defaut.jobsLourdsMax,
    memoireLibreMinMo: Number.isFinite(memoireLibreMinMo) ? memoireLibreMinMo : defaut.memoireLibreMinMo,
  };
}

// --- Vivacité (dupliquée de jobs.js, cf. en-tête) -------------------------------------------------

function starttimeDe(pid) {
  try {
    const contenu = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const idx = contenu.lastIndexOf(')');
    if (idx === -1) return null;
    const champs = contenu.slice(idx + 2).trim().split(/\s+/);
    return champs[19] || null;
  } catch (_err) {
    return null;
  }
}

/** Vivacité du détenteur (superviseur) : pid vivant et, si `starttime` noté, même starttime (repli : pid seul). */
function superviseurVivant(data) {
  if (!data || !data.pid) return false;
  try { process.kill(data.pid, 0); } catch (_err) { return false; }
  // Seconde revue n° 41 : un superviseur tué mais pas encore récolté (zombie) est mort.
  try {
    const s = fs.readFileSync(`/proc/${data.pid}/stat`, 'utf8');
    if (s.slice(s.lastIndexOf(')') + 2).split(' ')[0] === 'Z') return false;
  } catch (_err) { /* /proc indisponible : kill(pid, 0) fait foi */ }
  if (!data.starttime) return true;
  const actuel = starttimeDe(data.pid);
  if (actuel === null) return true; // /proc devenu indisponible : pas de faux mort
  return actuel === data.starttime;
}

/** Seconde revue n° 41 : le groupe de commande noté au jeton (`pgid`, `starttime_commande`) a-t-il encore un
 *  membre non zombie ? Chef présent : même starttime exigé (sinon pgid réutilisé). Un pgid n'est jamais réattribué
 *  tant qu'un membre du groupe vit : un chef mort n'empêche pas les autres membres de compter. */
function groupeVivant(pgid, starttime) {
  if (!pgid) return false;
  try { process.kill(-pgid, 0); } catch (_err) { return false; }
  const chef = starttimeDe(pgid);
  if (chef !== null && starttime && chef !== starttime) return false;
  let entrees;
  try { entrees = fs.readdirSync('/proc'); } catch (_err) { return true; } // sans /proc : kill(-pgid, 0) seul
  for (const e of entrees) {
    if (!/^\d+$/.test(e)) continue;
    try {
      const s = fs.readFileSync(`/proc/${e}/stat`, 'utf8');
      const champs = s.slice(s.lastIndexOf(')') + 2).split(' ');
      if (Number(champs[2]) === pgid && champs[0] !== 'Z') return true;
    } catch (_err) { /* processus disparu pendant la lecture */ }
  }
  return false;
}

/** Vivacité d'un jeton : son superviseur vit, ou le groupe de commande qu'il a noté vit encore — un groupe orphelin
 *  (arrêté par SIGSTOP, sa mémoire gardée) occupe toujours sa place : jamais `jobs_lourds_max` + 1 (revue n° 41). */
function vivantJeton(data) {
  return superviseurVivant(data) || (!!data && groupeVivant(data.pgid, data.starttime_commande));
}

/** Le superviseur note au jeton le groupe de la commande qu'il vient de lancer (seulement si le jeton est à lui). */
function noterGroupeJeton(dir, n, pid, pgid, starttimeCommande) {
  const p = jetonPath(dir, n);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!data || data.pid !== pid) return false;
    data.pgid = pgid;
    data.starttime_commande = starttimeCommande || null;
    reecrireEnPlace(p, JSON.stringify(data));
    return true;
  } catch (_err) { return false; }
}

/** Groupe orphelin (superviseur mort, groupe vivant) : réveillé puis tué — sa sortie ne sera jamais validée ni
 *  publiée. Le jeton n'est repris qu'une fois le groupe réellement mort (admission suivante). */
function tuerGroupeOrphelin(data) {
  try { process.kill(-data.pgid, 'SIGCONT'); } catch (_err) { /* déjà mort */ }
  try { process.kill(-data.pgid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
}

/** Troisième revue n° 84 : un jeton vivant se réécrit par un temporaire renommé (rename atomique) — un lecteur
 *  concurrent (jetonsVivants) voit l'ancien ou le nouveau contenu, jamais un fichier vide ou tronqué. */
function reecrireEnPlace(fichier, texte) {
  const tmp = `${fichier}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, texte);
  try { fs.renameSync(tmp, fichier); } catch (err) { try { fs.unlinkSync(tmp); } catch (_e) { /* déjà retiré */ } throw err; }
}

// --- Jetons (jeton-0 … jeton-<max-1>) --------------------------------------------------------------

// Seconde revue n° 57 : un fichier de coordination (jeton, marque) naît plein, par `link` d'un temporaire — jamais vide,
// et `link` échoue (EEXIST) si un autre l'a créé : un seul créateur.
function creerParLien(fichier, texte) {
  const tmp = `${fichier}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, texte);
  try {
    fs.linkSync(tmp, fichier);
    return true;
  } catch (err) {
    if (err.code === 'EEXIST') return false;
    throw err;
  } finally {
    try { fs.unlinkSync(tmp); } catch (_err) { /* déjà retiré */ }
  }
}
function lireBrut(fichier) { try { return fs.readFileSync(fichier, 'utf8'); } catch (_err) { return null; } }
function sha16(texte) { return crypto.createHash('sha256').update(texte).digest('hex').slice(0, 16); }

/** Seconde revue n° 57 : marque de reprise `<fichier>.reprise-<sha16 du contenu mort>`, même schéma que les verrous de
 *  lots (revue finale n° 43, `lots.js` acquerirVerrou) : seul son détenteur retire le contenu mort ; une marque au
 *  détenteur mort se reprend sous une marque de marque (profondeur bornée). */
function prendreMarque(marque, profondeur) {
  const texte = JSON.stringify({ pid: process.pid, starttime: starttimeDe(process.pid) });
  if (creerParLien(marque, texte)) return true;
  const brut = lireBrut(marque);
  if (brut === null || profondeur >= 2) return false; // libérée à l'instant (un concurrent a repris) : on passe
  let d = null;
  try { d = JSON.parse(brut); } catch (_err) { d = null; }
  if (d && superviseurVivant(d)) return false;
  const mm = `${marque}.reprise-${sha16(brut)}`;
  if (!prendreMarque(mm, profondeur + 1)) return false;
  try {
    if (lireBrut(marque) === brut) fs.unlinkSync(marque);
    return creerParLien(marque, texte);
  } finally {
    try { fs.unlinkSync(mm); } catch (_err) { /* déjà retirée */ }
  }
}

/** Prend le premier jeton libre (ou au détenteur mort, repris). Seconde revue n° 57 : la reprise se fait sous la marque
 *  du contenu mort, et le jeton n'est retiré que s'il porte encore ce contenu — deux repreneurs : un seul gagne.
 *  Retourne `{ n, repris, ancienProprietaire?, ancienJob? }` ou `null` si tous les jetons sont pris par
 *  des détenteurs vivants. */
const JETON_ILLISIBLE_MS = 10000;

function prendreJeton(dir, max, info) {
  fs.mkdirSync(dir, { recursive: true });
  const contenu = JSON.stringify(Object.assign({}, info, { suspendu: false }));
  for (let n = 0; n < max; n += 1) {
    const p = jetonPath(dir, n);
    if (creerParLien(p, contenu)) return { n, repris: false };
    const brut = lireBrut(p);
    if (brut === null) { // libéré entre-temps
      if (creerParLien(p, contenu)) return { n, repris: false };
      continue;
    }
    let data = null;
    try { data = JSON.parse(brut); } catch (_err) { data = null; }
    // Revue n° 42 : un jeton vide ou illisible (écrit avant n° 57, disque plein) est repris passé JETON_ILLISIBLE_MS.
    let illisiblePerime = false;
    if (!data) { try { illisiblePerime = Date.now() - fs.statSync(p).mtimeMs > JETON_ILLISIBLE_MS; } catch (_err) { /* disparu */ } }
    if (data && !superviseurVivant(data) && groupeVivant(data.pgid, data.starttime_commande)) {
      tuerGroupeOrphelin(data);
      continue;
    }
    if (!((data && !vivantJeton(data)) || illisiblePerime)) continue;
    const marque = `${p}.reprise-${sha16(brut)}`;
    if (!prendreMarque(marque, 0)) continue; // un concurrent reprend ce jeton : numéro suivant
    try {
      if (lireBrut(p) !== brut) continue; // déjà repris (contenu vivant) : jamais retiré
      fs.unlinkSync(p);
      if (creerParLien(p, contenu)) {
        return {
          n, repris: true, ancienProprietaire: data ? data.proprietaire : '(jeton illisible)', ancienJob: data ? data.job : null,
        };
      }
    } finally {
      try { fs.unlinkSync(marque); } catch (_err) { /* déjà retirée */ }
    }
  }
  return null;
}

/** Libère le jeton `n` s'il appartient bien à `pid` (jamais celui d'un repreneur plus rapide). */
function libererJeton(dir, n, pid) {
  const p = jetonPath(dir, n);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (data && data.pid === pid) fs.unlinkSync(p);
  } catch (_err) { /* déjà absent */ }
}

/** Écrit `suspendu` dans le jeton `n` (le détenteur met à jour son propre jeton). Vrai si c'est écrit. */
function ecrireSuspenduJeton(dir, n, suspendu) {
  const p = jetonPath(dir, n);
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    data.suspendu = !!suspendu;
    reecrireEnPlace(p, JSON.stringify(data));
    return true;
  } catch (_err) { return false; /* jeton disparu ou non inscriptible */ }
}

/** Jetons vivants actuellement détenus, `{ n, debut, suspendu }`, dead filtrés (non supprimés : la
 *  suppression d'un jeton mort n'a lieu qu'à la reprise, cf. `prendreJeton`). Revue n° 15 : vue de la
 *  machine entière (tous les `jeton-<n>` du répertoire), jamais bornée au `max` de l'appelant — deux
 *  missions de `jobs_lourds_max` différents désignent ainsi la même cible de suspension. */
function jetonsVivants(dir, _max) {
  const resultats = [];
  let numeros = [];
  try {
    numeros = fs.readdirSync(dir).map((f) => f.match(/^jeton-(\d+)$/)).filter(Boolean).map((m) => Number(m[1]));
  } catch (_err) { return resultats; }
  numeros.sort((a, b) => a - b);
  for (const n of numeros) {
    let data;
    try { data = JSON.parse(fs.readFileSync(jetonPath(dir, n), 'utf8')); } catch (_err) { continue; }
    if (!vivantJeton(data)) continue;
    resultats.push({
      n, debut: data.debut, suspendu: !!data.suspendu, orphelin: !superviseurVivant(data),
      plancher: Number.isInteger(data.plancher_mo) ? data.plancher_mo : null,
    });
  }
  return resultats;
}

// --- File d'attente (tickets) ----------------------------------------------------------------------

/** Ticket `file/<hrtime ns zéro-paddé>-<pid>` — `process.hrtime.bigint()` est monotone et comparable
 *  entre processus sur une même machine (CLOCK_MONOTONIC), ce qui suffit à un ordre d'arrivée sans
 *  horloge de calendrier. */
function creerTicket(dir, pid, max) {
  const fdir = fileDir(dir);
  fs.mkdirSync(fdir, { recursive: true });
  const ns = process.hrtime.bigint().toString().padStart(20, '0');
  const fichier = `${ns}-${pid}`;
  // Revue n° 17 : starttime noté, pour qu'un pid réutilisé (redémarrage du conteneur) ne tienne pas la file à vie.
  // Seconde revue n° 58 : écrit par temporaire (nom hors motif de ticket) puis renommage — jamais un ticket vide, et
  // rien de laissé dans la file si l'écriture lève.
  const tmp = path.join(fdir, `.${fichier}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ pid, starttime: starttimeDe(pid), max: max || null }));
    fs.renameSync(tmp, path.join(fdir, fichier));
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_err) { /* jamais créé */ }
    throw err;
  }
  return fichier;
}

function supprimerTicket(dir, fichier) {
  try { fs.unlinkSync(path.join(fileDir(dir), fichier)); } catch (_err) { /* déjà absent */ }
}

/** Tickets vivants (kill(pid,0)), triés du plus ancien au plus récent ; les tickets morts sont
 *  supprimés au passage (CONCEPTION-JOBS.md §3). */
function ticketsVivants(dir) {
  const fdir = fileDir(dir);
  let fichiers = [];
  try { fichiers = fs.readdirSync(fdir); } catch (_err) { return []; }
  const vivants = [];
  for (const f of fichiers) {
    const m = f.match(/^(\d+)-(\d+)$/);
    if (!m) continue;
    const pid = Number(m[2]);
    let starttime = null;
    let max = null;
    let illisiblePerime = false;
    try {
      const d = JSON.parse(fs.readFileSync(path.join(fdir, f), 'utf8'));
      starttime = d.starttime || null;
      max = Number.isInteger(d.max) && d.max > 0 ? d.max : null;
    } catch (_err) {
      // Seconde revue n° 58 : ticket vide ou illisible (écrit avant, disque plein) : pid seul s'il est récent, mort
      // passé JETON_ILLISIBLE_MS — sinon un pid réutilisé tiendrait la file (le n° 17 par un autre chemin).
      try { illisiblePerime = Date.now() - fs.statSync(path.join(fdir, f)).mtimeMs > JETON_ILLISIBLE_MS; } catch (_e) { /* disparu */ }
    }
    const vivant = !illisiblePerime && vivantJeton({ pid, starttime });
    if (!vivant) { try { fs.unlinkSync(path.join(fdir, f)); } catch (_err) { /* déjà supprimé */ } continue; }
    vivants.push({ fichier: f, ns: m[1], pid, max });
  }
  vivants.sort((a, b) => (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0));
  return vivants;
}

/** Mon tour est venu si chaque ticket plus ancien que le mien est saturé : tous les jetons `0 … max-1` de
 *  son propre `max` sont tenus par des vivants (revue n° 16 : la file est commune aux missions, un ticket
 *  en tête au petit `max` ne bloque plus une mission qui a des jetons libres). Un ticket sans `max`
 *  connu n'est jamais saturé : ordre d'arrivée strict. */
function monTicketEstLePremier(dir, monFichier) {
  const vivants = ticketsVivants(dir);
  const i = vivants.findIndex((t) => t.fichier === monFichier);
  if (i < 0) return false;
  if (i === 0) return true;
  const tenus = new Set(jetonsVivants(dir).map((j) => j.n));
  return vivants.slice(0, i).every((t) => {
    if (!t.max) return false;
    for (let n = 0; n < t.max; n += 1) if (!tenus.has(n)) return false;
    return true;
  });
}

function attendre(ms) { return new Promise((resolve) => { setTimeout(resolve, ms); }); }

/** Admission d'un job lourd : dépose un ticket, sonde toutes les `opts.tickMs`, ne tente un jeton que
 *  si son ticket est le plus ancien vivant et que la mémoire disponible est suffisante (ou non
 *  mesurable). `opts.verifierArret()` : si vrai, abandonne (ticket supprimé), pour honorer un
 *  `arreter` reçu pendant `en-file`. Retourne `{ ok: true, n, dir }` ou `{ ok: false, arrete: true }`. */
async function admettreLourd(dir, opts) {
  const pid = opts.info.pid;
  const ticket = creerTicket(dir, pid, opts.max);
  try {
    for (;;) {
      if (opts.verifierArret && opts.verifierArret()) {
        return { ok: false, arrete: true };
      }
      if (monTicketEstLePremier(dir, ticket)) {
        const mem = memoireDisponibleMo(process.env);
        // Seconde revue n° 56 : admis seulement au-dessus du plus haut plancher vivant ; le sien est inscrit au jeton.
        if (mem === null || mem >= plancherEffectif(jetonsVivants(dir), opts.memoireLibreMinMo)) {
          const info = Object.assign({}, opts.info, { debut: new Date().toISOString(), plancher_mo: opts.memoireLibreMinMo });
          const r = prendreJeton(dir, opts.max, info);
          if (r) {
            if (r.repris && opts.journal) {
              opts.journal(`jeton ${r.n} repris (ancien détenteur mort : ${r.ancienProprietaire || '?'} / ${r.ancienJob || '?'})`);
            }
            return { ok: true, n: r.n, dir };
          }
        }
      }
      await attendre(opts.tickMs);
    }
  } finally {
    supprimerTicket(dir, ticket);
  }
}

// --- Suspension --------------------------------------------------------------------------------

function derniereSuspensionMs(dir) {
  try {
    const t = fs.readFileSync(derniereSuspensionPath(dir), 'utf8').trim();
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  } catch (_err) { return null; }
}

function noterSuspension(dir, whenMs) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(derniereSuspensionPath(dir), String(whenMs));
}

/** Fonction pure (testable indépendamment de tout accès disque/process) : décide, à partir des
 *  jetons vivants (`{ n, debut, suspendu }`), de la mémoire disponible et de la date de la dernière
 *  suspension, s'il faut suspendre ou reprendre un jeton, et lequel. Règles CONCEPTION-JOBS.md §3 :
 *  sous le plancher, seul le détenteur non suspendu le plus récent (`debut`, puis `n`) est ciblé, et
 *  jamais s'il n'y a qu'un seul job en cours (le plus ancien en cours n'est jamais suspendu) ; au plus
 *  une suspension par fenêtre `suspensionMinMs` ; au-dessus de `memoireLibreMinMo + 1500`, seul le
 *  suspendu le plus ancien est repris. `memoireMo === null` (mesure indisponible) ⇒ aucune décision. */
function decisionSuspension(jetonsAlive, memoireMo, memoireLibreMinMo, derniereSuspMs, nowMs, suspMinMs) {
  if (memoireMo === null || memoireMo === undefined) return null;
  const tri = (a, b) => (a.debut < b.debut ? -1 : a.debut > b.debut ? 1 : a.n - b.n);
  // Revue finale n° 14 : aucun job en cours et des suspendus (le seul en cours a fini) — un processus
  // arrêté garde sa mémoire, le seuil de reprise peut ne jamais revenir : le plus ancien reprend, quelle
  // que soit la mémoire (même règle que « le seul en cours n'est jamais suspendu »).
  const suspendusTous = jetonsAlive.filter((j) => j.suspendu);
  if (suspendusTous.length && suspendusTous.length === jetonsAlive.length) {
    return { action: 'reprendre', cible: suspendusTous.slice().sort(tri)[0].n };
  }
  if (memoireMo < memoireLibreMinMo) {
    const candidats = jetonsAlive.filter((j) => !j.suspendu);
    if (candidats.length < 2) return null; // seul en cours : jamais suspendu
    if (derniereSuspMs !== null && derniereSuspMs !== undefined && (nowMs - derniereSuspMs) < suspMinMs) return null;
    const tries = candidats.slice().sort(tri);
    return { action: 'suspendre', cible: tries[tries.length - 1].n };
  }
  if (memoireMo >= memoireLibreMinMo + 1500) {
    const suspendus = jetonsAlive.filter((j) => j.suspendu);
    if (!suspendus.length) return null;
    const tries = suspendus.slice().sort(tri);
    return { action: 'reprendre', cible: tries[0].n };
  }
  return null;
}

/** Tick appelé périodiquement par le superviseur d'un job lourd en cours/suspendu. Calcule la
 *  décision machine (mêmes données pour tous les superviseurs qui sondent) et n'agit que si la cible
 *  désignée est `opts.monJetonN` (chacun n'agit que sur son propre groupe : SIGSTOP/SIGCONT à
 *  `-opts.monPgid`). Retourne le nouvel état (`'suspendu'` | `'en-cours'`) ou `null` si aucune action. */
function tickSuspension(dir, opts) {
  // Seconde revue n° 41 : un groupe orphelin (superviseur mort) est tué par tout superviseur qui sonde et sort de
  // la décision — personne ne le reprendrait ni ne le suspendrait, il bloquerait la reprise des autres.
  const jetons = [];
  for (const j of jetonsVivants(dir, opts.max)) {
    if (!j.orphelin) { jetons.push(j); continue; }
    try { tuerGroupeOrphelin(JSON.parse(fs.readFileSync(jetonPath(dir, j.n), 'utf8'))); } catch (_err) { /* disparu */ }
  }
  const mem = memoireDisponibleMo(process.env);
  const now = Date.now();
  const plancher = plancherEffectif(jetons, opts.memoireLibreMinMo);
  const decision = decisionSuspension(
    jetons, mem, plancher, derniereSuspensionMs(dir), now, suspensionMinMs(),
  );
  if (!decision || decision.cible !== opts.monJetonN) return null;
  if (decision.action === 'suspendre') {
    try { process.kill(-opts.monPgid, 'SIGSTOP'); } catch (_err) { return null; /* groupe déjà mort */ }
    // Seconde revue n° 41 : suspension notée (jeton + date) ou annulée — un groupe arrêté sans trace ne serait
    // jamais repris ; échec d'écriture (disque plein, EACCES) ⇒ SIGCONT, aucune suspension.
    try {
      if (!ecrireSuspenduJeton(dir, opts.monJetonN, true)) throw new Error('jeton non inscriptible');
      noterSuspension(dir, now);
    } catch (err) {
      try { process.kill(-opts.monPgid, 'SIGCONT'); } catch (_err) { /* groupe déjà mort */ }
      ecrireSuspenduJeton(dir, opts.monJetonN, false);
      if (opts.journal) opts.journal(`suspension annulée (${err.message})`);
      return null;
    }
    if (opts.majEtat) opts.majEtat('suspendu');
    if (opts.journal) opts.journal(`suspendu (mémoire ${mem} Mo < plancher ${plancher} Mo)`);
    return 'suspendu';
  }
  try { process.kill(-opts.monPgid, 'SIGCONT'); } catch (_err) { /* groupe déjà mort */ }
  ecrireSuspenduJeton(dir, opts.monJetonN, false);
  if (opts.majEtat) opts.majEtat('en-cours');
  if (opts.journal) opts.journal(`repris (mémoire ${mem} Mo ≥ plancher + 1500)`);
  return 'en-cours';
}

module.exports = {
  chargeDir,
  memoireTotaleMo,
  plancherEffectif,
  fileDir,
  jetonPath,
  tickMs,
  suspensionMinMs,
  memoireDisponibleMo,
  lireParametresCharge,
  starttimeDe,
  vivantJeton,
  superviseurVivant,
  groupeVivant,
  tuerGroupeOrphelin,
  noterGroupeJeton,
  prendreJeton,
  libererJeton,
  ecrireSuspenduJeton,
  jetonsVivants,
  creerTicket,
  supprimerTicket,
  ticketsVivants,
  monTicketEstLePremier,
  admettreLourd,
  derniereSuspensionMs,
  noterSuspension,
  decisionSuspension,
  tickSuspension,
};
