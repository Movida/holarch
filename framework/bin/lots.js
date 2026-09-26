'use strict';
/**
 * lots.js — lots payants du harnais HOLARCH (chantier 16, docs/IMPLEMENTATION.md §18.6, conception
 * mission/shared/concepteur/CONCEPTION-JOBS.md §4, amendements §7). Module Node autonome (modules
 * natifs seulement, aucun appel réseau), require-able par `holarch-job.js` et par les tests.
 * Réutilise `jobs.js` pour la racine, la vivacité pid+starttime et le lancement de job (§18.4).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const jobsMod = require('./jobs');
const charge = require('./charge');

// --- Chemins ----------------------------------------------------------------------------------

function lotsDir(racine) { return path.join(racine, 'mission', '.holarch', 'lots'); }
function elementsDir(racine) { return path.join(lotsDir(racine), 'elements'); }
function reservationsDir(racine) { return path.join(lotsDir(racine), 'reservations'); }
function coutsJsonlPath(racine) { return path.join(lotsDir(racine), 'couts.jsonl'); }
function budgetLockPath(racine) { return path.join(lotsDir(racine), 'budget.lock'); }
function coutsServicesPath(arbre) { return path.join(arbre, 'mission', 'registry', 'COUTS-SERVICES.md'); }
function verrouLotPath(racine, cle) { return path.join(lotsDir(racine), `${cle}.lock`); }
function verrouElementPath(racine, empreinte) { return path.join(elementsDir(racine), `${empreinte}.lock`); }
function reservationPath(racine, cle) { return path.join(reservationsDir(racine), `${cle}.json`); }

/** Arbre courant (§4, amendement 1) : HOLARCH_ARBRE sinon `git rev-parse --show-toplevel` depuis
 *  cwd, sinon racine (repli identique à `jobs.racine`). */
function arbreCourant(cwd, racine) {
  if (process.env.HOLARCH_ARBRE) return process.env.HOLARCH_ARBRE;
  try {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' });
    if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim();
  } catch (_err) { /* pas un dépôt git, ou git absent */ }
  return racine;
}

// --- Empreintes ---------------------------------------------------------------------------------

function sha256Texte(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function sha256Fichier(p) { return sha256Texte(fs.readFileSync(p)); }

/** JSON canonique : clés triées récursivement, tableaux dans l'ordre donné. */
function jsonCanonique(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(jsonCanonique).join(',')}]`;
  const cles = Object.keys(v).sort();
  return `{${cles.map((k) => `${JSON.stringify(k)}:${jsonCanonique(v[k])}`).join(',')}}`;
}

/** Empreinte = sha256( sha256 de chaque entrée dans l'ordre ‖ JSON canonique des paramètres ‖ JSON
 *  de `commande` ‖ `service` ). Ni date, ni sortie, ni id (§4). */
function empreinteElement(lot, element, dir) {
  const hachesEntrees = (element.entrees || []).map((e) => sha256Fichier(path.resolve(dir, e)));
  const base = hachesEntrees.join('') + jsonCanonique(element.parametres || {}) + JSON.stringify(lot.commande) + lot.service;
  return sha256Texte(base);
}

function calculerEmpreintesLot(lot, dir) {
  return lot.elements.map((el) => ({ id: el.id, element: el, empreinte: empreinteElement(lot, el, dir) }));
}

/** `cle` = sha256 des empreintes triées (identifie le lot dans son ensemble, sans dépendre de
 *  l'ordre de déclaration des éléments). */
function cleLot(empreintes) {
  const tri = [...empreintes].sort();
  return sha256Texte(tri.join(''));
}

// --- Validation du format --------------------------------------------------------------------

const RE_PARAM = /^\{param:([a-zA-Z0-9_]+)\}$/;
const RE_ENTREE = /^\{entree:(\d+)\}$/;

/** Valide la forme d'un lot ; refuse avant tout devis si `{param:k}` référencé sans que `k` figure
 *  dans les `parametres` de chaque élément (§4). `dir` : répertoire du lot, base des sorties (défaut : cwd). */
function validerFormatLot(lot, dir) {
  if (!lot || typeof lot !== 'object' || Array.isArray(lot)) return { ok: false, motif: 'le lot doit être un objet JSON' };
  if (typeof lot.nom !== 'string' || !lot.nom) return { ok: false, motif: 'nom requis' };
  if (typeof lot.service !== 'string' || !lot.service) return { ok: false, motif: 'service requis' };
  if (!Array.isArray(lot.commande) || !lot.commande.length || !lot.commande.every((a) => typeof a === 'string')) {
    return { ok: false, motif: 'commande doit être un tableau non vide de chaînes (jamais un shell)' };
  }
  if (lot.valider !== undefined && lot.valider !== null) {
    if (!Array.isArray(lot.valider) || !lot.valider.every((a) => typeof a === 'string')) {
      return { ok: false, motif: 'valider doit être un tableau de chaînes (jamais un shell)' };
    }
  }
  if (!Array.isArray(lot.elements) || !lot.elements.length) {
    return { ok: false, motif: 'elements doit être un tableau non vide' };
  }
  const clesParam = new Set();
  let entreeMax = -1;
  for (const a of lot.commande.concat(lot.valider || [])) {
    const m = RE_PARAM.exec(a);
    if (m) clesParam.add(m[1]);
    const e = RE_ENTREE.exec(a);
    if (e) entreeMax = Math.max(entreeMax, Number(e[1]));
  }
  // Seconde revue n° 27 : chaque gabarit doit avoir une valeur au moment de l'appel — `{fichier}` n'existe que pour
  // valider, `{sortie}` que pour la commande (sinon passés tels quels au service payant ou au vérificateur).
  if (lot.commande.includes('{fichier}')) return { ok: false, motif: 'commande : {fichier} réservé à valider (utilise {sortie})' };
  if ((lot.valider || []).includes('{sortie}')) return { ok: false, motif: 'valider : {sortie} réservé à la commande (utilise {fichier})' };
  const vus = new Set();
  // Seconde revue n° 67 : deux éléments ne partagent jamais une sortie (ni la sortie de l'un = `.partiel` de l'autre) :
  // chacun écraserait la preuve (sha) de l'autre et toute relance repaierait les deux.
  const sorties = new Map();
  for (const el of lot.elements) {
    if (!el || typeof el.sortie !== 'string' || !el.sortie) continue;
    const abs = cheminReel(path.resolve(dir || '.', el.sortie)); // troisième revue n° 79 : liens symboliques résolus
    const autre = sorties.get(abs) || sorties.get(`${abs}.partiel`) || (abs.endsWith('.partiel') && sorties.get(abs.slice(0, -8)));
    if (autre) return { ok: false, motif: `elements ${autre} et ${el.id} : même sortie (${el.sortie}) — une sortie par élément` };
    sorties.set(abs, el.id);
  }
  for (const el of lot.elements) {
    if (!el || typeof el.id !== 'string' || !el.id) return { ok: false, motif: 'element.id (chaîne non vide) requis' };
    if (vus.has(el.id)) return { ok: false, motif: `id d'élément dupliqué : ${el.id}` };
    vus.add(el.id);
    if (!Array.isArray(el.entrees) || !el.entrees.every((e) => typeof e === 'string')) {
      return { ok: false, motif: `element ${el.id} : entrees doit être un tableau de chemins` };
    }
    if (typeof el.sortie !== 'string' || !el.sortie) return { ok: false, motif: `element ${el.id} : sortie requise` };
    if (typeof el.cout_estime_usd !== 'number' || !Number.isFinite(el.cout_estime_usd) || el.cout_estime_usd < 0) {
      return { ok: false, motif: `element ${el.id} : cout_estime_usd numérique (>= 0) requis` };
    }
    const params = el.parametres || {};
    if (typeof params !== 'object' || Array.isArray(params)) return { ok: false, motif: `element ${el.id} : parametres doit être un objet` };
    for (const k of clesParam) {
      if (!(k in params)) return { ok: false, motif: `element ${el.id} : {param:${k}} référencé mais absent de parametres` };
      if (!['string', 'number', 'boolean'].includes(typeof params[k])) {
        return { ok: false, motif: `element ${el.id} : parametres.${k} doit être une chaîne, un nombre ou un booléen` };
      }
    }
    if (entreeMax >= el.entrees.length) {
      return { ok: false, motif: `element ${el.id} : {entree:${entreeMax}} référencé mais l'élément n'a que ${el.entrees.length} entrée(s)` };
    }
  }
  return { ok: true };
}

/** Résout `{entree:n}`, `{sortie}`, `{param:k}`, `{fichier}` dans un argv (tableau, jamais un
 *  shell). Tout autre argument est repris tel quel. */
function resoudreArgv(argv, ctx) {
  // Seconde revue n° 27 : résolution stricte — un gabarit sans valeur lève (avant l'appel payant, cf. jouerLot),
  // jamais la chaîne « undefined » passée au service.
  const valeur = (v, gabarit) => {
    if (v === undefined || v === null) throw new Error(`gabarit sans valeur : ${gabarit}`);
    return String(v);
  };
  return (argv || []).map((a) => {
    if (a === '{sortie}') return valeur(ctx.sortie, a);
    if (a === '{fichier}') return valeur(ctx.fichier, a);
    const mEntree = RE_ENTREE.exec(a);
    if (mEntree) return valeur((ctx.entrees || [])[Number(mEntree[1])], a);
    const mParam = RE_PARAM.exec(a);
    if (mParam) return valeur((ctx.parametres || {})[mParam[1]], a);
    return a;
  });
}

// --- Petits utilitaires disque ------------------------------------------------------------------

function ecrireAtomique(fichier, contenuTexte) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = `${fichier}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tmp, contenuTexte);
  fs.renameSync(tmp, fichier);
}

function lireJsonSiExiste(fichier) {
  try { return JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch (_err) { return null; }
}

/** Sommeil synchrone (attente d'un verrou déjà pris par un autre processus) — Node autorise
 *  `Atomics.wait` sur le thread principal (contrairement aux navigateurs). */
function sleepSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_err) { /* meilleur effort */ }
}

function vivaciteDe(data) {
  return data && data.starttime ? 'pid+starttime' : 'pid';
}

/** Troisième revue n° 75 : le détenteur d'un verrou ou d'une réservation vit tant que son pid vit (starttime) ou,
 *  s'il a noté `groupe` (jouer-lot, chef du groupe du job), tant qu'un membre de ce groupe vit — le service qui paie
 *  est dans ce groupe et survit à un kill -9 de jouer-lot seul. */
function detenteurVivant(d) {
  if (!d) return false;
  if (jobsMod.estVivantSelon(d.pid, d.starttime, vivaciteDe(d))) return true;
  return !!d.groupe && !!d.starttime && charge.groupeVivant(d.groupe, d.starttime);
}

/** `{ groupe: pid }` si ce processus est chef de son groupe (champ 5 de /proc/self/stat), sinon `{}`. */
function groupeDeMoi() {
  try {
    const s = fs.readFileSync('/proc/self/stat', 'utf8');
    return Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[2]) === process.pid ? { groupe: process.pid } : {};
  } catch (_err) { return {}; }
}

/** Création exclusive d'un fichier au contenu complet dès son apparition (revue finale n° 25) :
 *  écrit dans un temporaire unique puis `link` (échoue en EEXIST si le fichier existe) — jamais de
 *  fenêtre où un concurrent lit un verrou vide. */
/** Troisième revue n° 79 : chemin réel (liens symboliques résolus) d'un fichier qui peut ne pas exister encore —
 *  realpath du plus proche ancêtre existant, puis le reste tel quel. */
function cheminReel(p) {
  const reste = [];
  let base = p;
  for (;;) {
    try { return path.join(fs.realpathSync(base), ...reste); } catch (_err) {
      const parent = path.dirname(base);
      if (parent === base) return p;
      reste.unshift(path.basename(base));
      base = parent;
    }
  }
}

function creerExclusif(fichier, texte) {
  const tmp = `${fichier}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
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

function lireBrutSiExiste(fichier) {
  try { return fs.readFileSync(fichier, 'utf8'); } catch (_err) { return null; }
}

/** Verrou exclusif, avec reprise si le détenteur noté est mort (pid+starttime) — §4, §5.
 *  Reprise atomique (revue finale n° 43) : seul le détenteur de la marque `<fichier>.reprise-<sha du
 *  contenu mort>` (elle-même un verrou de ce type, d'où la récursion bornée) retire le verrou mort.
 *  Retourne `{ acquis: true, repris }` (`repris` = données du détenteur mort, ou `null`) ou
 *  `{ acquis: false, detenteur }` si un autre est vivant. */
function acquerirVerrou(fichier, donnees, profondeur = 0) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const texte = JSON.stringify(Object.assign({ jeton: crypto.randomBytes(6).toString('hex') }, donnees));
  for (let essai = 0; essai < 20; essai += 1) {
    if (creerExclusif(fichier, texte)) return { acquis: true, repris: null };
    const brut = lireBrutSiExiste(fichier);
    if (brut === null) continue; // libéré entre-temps : on retente
    let existant = null;
    try { existant = JSON.parse(brut); } catch (_err) { existant = null; }
    if (existant && detenteurVivant(existant)) {
      return { acquis: false, detenteur: existant };
    }
    if (profondeur >= 3) return { acquis: false, detenteur: existant };
    const marque = `${fichier}.reprise-${sha256Texte(brut).slice(0, 16)}`;
    const vivMoi = jobsMod.capturerVivacite(process.pid);
    const m = acquerirVerrou(marque, { pid: process.pid, starttime: vivMoi.starttime }, profondeur + 1);
    if (!m.acquis) { sleepSync(10); continue; } // un concurrent reprend : on relit ensuite
    try {
      // Sous la marque, personne d'autre ne retire ce contenu mort ; `link` exclut tout créateur.
      if (lireBrutSiExiste(fichier) === brut) fs.unlinkSync(fichier);
      if (creerExclusif(fichier, texte)) return { acquis: true, repris: existant || { illisible: brut } };
    } finally {
      libererVerrou(marque);
    }
  }
  const brut = lireBrutSiExiste(fichier);
  let detenteur = null;
  try { detenteur = brut ? JSON.parse(brut) : null; } catch (_err) { detenteur = null; }
  return { acquis: false, detenteur };
}

/** Trace durable d'une reprise de verrou au détenteur mort (§18.6, revue finale n° 43 et 48). */
function journaliserReprise(racine, quoi, detenteur) { tracerReprise(lotsDir(racine), quoi, detenteur); }
function tracerReprise(dir, quoi, detenteur) {
  const ligne = JSON.stringify({
    date: jobsMod.nowIso(), quoi, par: process.pid, detenteur_mort: detenteur,
  });
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'reprises.jsonl'), `${ligne}\n`);
  } catch (_err) { /* meilleur effort */ }
  // Seconde revue n° 70 : stderr, jamais stdout — `holarch-job lot` n'imprime sur stdout que l'id du job
  // (`id=$(holarch-job lot …)`) ; dans un job, stderr va au même journal que stdout (jobs.js, stdio fdLog).
  try { process.stderr.write(`[lot] ${jobsMod.nowIso()} verrou repris (${quoi}) — détenteur mort : ${JSON.stringify(detenteur)}\n`); } catch (_err) { /* ignore */ }
}

function libererVerrou(fichier) {
  try { fs.unlinkSync(fichier); } catch (_err) { /* déjà absent */ }
}

/** Mutex bloquant (`budget.lock`) : attend que le détenteur se libère, ou reprend si mort. */
function acquerirMutex(fichier, { timeoutMs = 10000, pasMs = 20 } = {}) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const debut = Date.now();
  for (;;) {
    // Même primitive que les verrous de lot (revue finale n° 25) : création atomique, reprise sous marque.
    const r = acquerirVerrou(fichier, { pid: process.pid, starttime: jobsMod.starttimeDe(process.pid) });
    // Seconde revue n° 70 : la reprise de `budget.lock` au détenteur mort est tracée comme celle d'un lot.
    if (r.acquis && r.repris) tracerReprise(path.dirname(fichier), path.basename(fichier), r.repris);
    if (r.acquis) return;
    if (Date.now() - debut > timeoutMs) throw new Error(`délai dépassé en attente de ${fichier}`);
    sleepSync(pasMs);
  }
}
function libererMutex(fichier) { libererVerrou(fichier); }

// --- Verrous de lot vivants (exporté pour le sleep-guard, §4) -----------------------------------

function verrousLotVivants(racine) {
  const dir = lotsDir(racine);
  let fichiers = [];
  try { fichiers = fs.readdirSync(dir).filter((f) => f.endsWith('.lock') && f !== 'budget.lock'); } catch (_err) { return []; }
  const out = [];
  for (const f of fichiers) {
    const data = lireJsonSiExiste(path.join(dir, f));
    if (!data) continue;
    if (detenteurVivant(data)) {
      out.push({
        proprietaire: data.proprietaire, pid: data.pid, job: data.job, cle: f.slice(0, -'.lock'.length),
      });
    }
  }
  return out;
}

function verrouElementVivantAilleurs(racine, empreinte) {
  const data = lireJsonSiExiste(verrouElementPath(racine, empreinte));
  if (!data) return null;
  if (detenteurVivant(data)) return data;
  return null;
}

// --- Registre COUTS-SERVICES.md ------------------------------------------------------------------

const ENTETE_REGISTRE = '# Coûts des services — append-only, écrit par holarch-job\n\n'
  + '| Date | Lot | Élément | Service | Empreinte (12) | Coût | Source | Propriétaire | État |\n'
  + '|---|---|---|---|---|---|---|---|---|\n';

/** Parse les lignes de tableau de `COUTS-SERVICES.md` (en-tête et séparateur ignorés). */
function parserTableCouts(md) {
  const out = [];
  for (const raw of (md || '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) continue;
    // Revue n° 21 : « | » échappé (\|) dans une cellule ne décale plus les colonnes.
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length < 9) continue;
    if (cells[0] === 'Date') continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    const coutUsd = Number(cells[5].replace(/[^0-9.\-]/g, ''));
    out.push({
      date: cells[0],
      lot: cells[1],
      element: cells[2],
      service: cells[3],
      empreinte12: cells[4],
      coutUsd: Number.isFinite(coutUsd) ? coutUsd : 0,
      source: cells[6],
      proprietaire: cells[7],
      etat: cells[8],
    });
  }
  return out;
}

function ligneCout(o) {
  return {
    date: jobsMod.nowIso(),
    lot: o.lot,
    element: o.element,
    service: o.service,
    empreinte: o.empreinte,
    cout_usd: o.cout_usd,
    source: o.source,
    proprietaire: o.proprietaire,
    etat: o.etat,
    sha_sortie: o.sha_sortie || null,
    sortie: o.sortie || null,
  };
}

/** Écrit d'abord `couts.jsonl` (vérité machine, racine principale), puis l'ajoute à
 *  `COUTS-SERVICES.md` de l'arbre courant (§4). */
function ecrireLigneCouts(racine, arbre, o) {
  fs.mkdirSync(lotsDir(racine), { recursive: true });
  fs.appendFileSync(coutsJsonlPath(racine), `${JSON.stringify(o)}\n`);
  const p = coutsServicesPath(arbre);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Seconde revue n° 69 : en-tête créé par lien (jamais tronqué) — `writeFileSync` après `existsSync` effaçait les
  // lignes qu'un écrivain concurrent venait d'ajouter.
  if (!fs.existsSync(p)) creerExclusif(p, ENTETE_REGISTRE);
  const coutCell = `${o.source === 'estime' ? '≈' : ''}${o.cout_usd}`;
  const c = (v) => String(v).replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
  const ligne = `| ${o.date} | ${c(o.lot)} | ${c(o.element)} | ${c(o.service)} | ${String(o.empreinte).slice(0, 12)} | ${coutCell} | ${o.source} | ${c(o.proprietaire)} | ${o.etat} |\n`;
  fs.appendFileSync(p, ligne);
}

/** Revue n° 28 : vrai si les lignes non committées de COUTS-SERVICES.md (arbre courant) comptent au
 *  moins une ligne de `instance` — sleep-guard exige alors leur commit, même quand un lot d'autrui
 *  tourne et écrit dans le même fichier. Doute (git illisible) : vrai, le commit reste exigé. */
function coutsNonCommitesDe(arbre, instance) {
  const rel = path.join('mission', 'registry', 'COUTS-SERVICES.md');
  try {
    const suivi = spawnSync('git', ['ls-files', '--', rel], { cwd: arbre, encoding: 'utf8' });
    if (suivi.status !== 0) return true;
    let texte;
    if (!suivi.stdout.trim()) {
      if (!fs.existsSync(path.join(arbre, rel))) return false;
      texte = fs.readFileSync(path.join(arbre, rel), 'utf8');
    } else {
      const d = spawnSync('git', ['diff', 'HEAD', '--', rel], { cwd: arbre, encoding: 'utf8' });
      if (d.status !== 0) return true;
      texte = d.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');
    }
    return parserTableCouts(texte).some((row) => row.proprietaire === instance);
  } catch (_err) { return true; }
}

// --- Fait / cumul ---------------------------------------------------------------------------------

/** Lignes `fait`/`repris` de cette empreinte, `couts.jsonl` d'abord (portent le sha_sortie et le
 *  chemin de sortie ; revue n° 19 : toutes, de la plus récente à la plus ancienne), sinon un simple
 *  signal `COUTS-SERVICES.md` (aucun chemin/sha : n'autorise jamais une copie, seulement une confiance
 *  si la sortie de CE lot existe déjà). */
function derniereLignePublication(racine, arbre, empreinte) {
  let texte = '';
  try { texte = fs.readFileSync(coutsJsonlPath(racine), 'utf8'); } catch (_err) { /* absent */ }
  const publications = [];
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue;
    let obj;
    try { obj = JSON.parse(ligne); } catch (_err) { continue; }
    if (obj.empreinte === empreinte && (obj.etat === 'fait' || obj.etat === 'repris')) {
      publications.unshift({ sortie: obj.sortie || null, shaSortie: obj.sha_sortie || null });
    }
  }
  if (publications.length) return { source: 'journal', publications };

  let md = '';
  try { md = fs.readFileSync(coutsServicesPath(arbre), 'utf8'); } catch (_err) { /* absent */ }
  const prefixe = empreinte.slice(0, 12);
  const trouve = parserTableCouts(md).some((row) => row.empreinte12 === prefixe && (row.etat === 'fait' || row.etat === 'repris'));
  return trouve ? { source: 'registre', sortie: null, shaSortie: null } : null;
}

/** Statut d'un élément : `fait` (rien à faire), `repris` (à copier depuis `sourceSortie`, coût 0),
 *  `a-jouer` (aucune preuve exploitable). */
function statutElement(racine, arbre, empreinte, sortieAbs) {
  const pub = derniereLignePublication(racine, arbre, empreinte);
  if (!pub) return { statut: 'a-jouer' };
  if (pub.source === 'journal') {
    const intactes = pub.publications.filter((x) => x.sortie && x.shaSortie && fs.existsSync(x.sortie)
      && sha256Fichier(x.sortie) === x.shaSortie);
    if (intactes.some((x) => path.resolve(x.sortie) === path.resolve(sortieAbs))) return { statut: 'fait' };
    if (intactes.length) return { statut: 'repris', sourceSortie: intactes[0].sortie, shaSortie: intactes[0].shaSortie };
    return { statut: 'a-jouer' }; // lignes journalisées mais toutes les preuves (sorties) disparues : rejoué
  }
  // registre seul : confiance uniquement si la sortie de ce lot est déjà là.
  return fs.existsSync(sortieAbs) ? { statut: 'fait' } : { statut: 'a-jouer' };
}

/** Classe chaque élément d'empreinte connue : `fait`, `en-cours-ailleurs` (verrou d'élément vivant
 *  détenu par un autre) ou `a-jouer`. Lecture seule (aucun verrou pris) — utilisé pour le devis. */
function trierElements(racine, arbre, dir, lot, empreintesInfo) {
  return empreintesInfo.map((info) => {
    const sortieAbs = path.resolve(dir, info.element.sortie);
    const detenteur = verrouElementVivantAilleurs(racine, info.empreinte);
    if (detenteur) return { ...info, sortieAbs, statut: 'en-cours-ailleurs', detenteur };
    const st = statutElement(racine, arbre, info.empreinte, sortieAbs);
    return {
      ...info, sortieAbs, statut: st.statut === 'repris' ? 'fait' : st.statut,
    };
  });
}

/** Montant USD écrit par un humain : point ou virgule décimale (revue n° 23/29, comme config-lint et
 *  budget-session.js). NaN si vide ou illisible — jamais 0 par défaut silencieux. */
function nombreUsd(v) {
  const t = String(v === undefined || v === null ? '' : v).trim();
  if (!/^-?\d+([.,]\d+)?$/.test(t)) return NaN;
  return Number(t.replace(',', '.'));
}

function lireBudgetServices(racine) {
  let texte;
  try { texte = fs.readFileSync(path.join(racine, 'framework', 'CONFIG.md'), 'utf8'); } catch (_err) { return 0; }
  let section = '';
  let valeur = null;
  for (const raw of texte.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) { section = line.replace(/^#+\s*/, '').toLowerCase(); continue; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (!cells.length || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (section.startsWith('param') && cells.length >= 2 && cells[0] === 'budget_services_usd') {
      valeur = cells[1].replace(/^`|`$/g, '');
    }
  }
  const n = nombreUsd(valeur);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/** Cumul (amendement 1) : `couts.jsonl` (racine principale, commun aux worktrees) fait foi ;
 *  `COUTS-SERVICES.md` (arbre courant) n'ajoute que ses lignes absentes du journal (par empreinte,
 *  préfixe 12) ; + réservations vivantes. */
function cumulActuel(racine, arbre) {
  let total = 0;
  // Revue finale n° 22 : une ligne du registre n'est écartée que si CETTE ligne est au journal (même
  // date, empreinte, état) — jamais parce qu'une autre ligne de même empreinte y figure.
  const clesJournal = new Set();
  const cleLigne = (date, empreinte12, etat) => `${date}|${empreinte12}|${etat}`;
  let texte = '';
  try { texte = fs.readFileSync(coutsJsonlPath(racine), 'utf8'); } catch (_err) { /* absent */ }
  for (const ligne of texte.split('\n')) {
    if (!ligne.trim()) continue;
    let obj;
    try { obj = JSON.parse(ligne); } catch (_err) { continue; }
    if (typeof obj.cout_usd === 'number') total += obj.cout_usd;
    if (obj.empreinte) clesJournal.add(cleLigne(obj.date, String(obj.empreinte).slice(0, 12), obj.etat));
  }
  let md = '';
  try { md = fs.readFileSync(coutsServicesPath(arbre), 'utf8'); } catch (_err) { /* absent */ }
  for (const row of parserTableCouts(md)) {
    if (clesJournal.has(cleLigne(row.date, row.empreinte12, row.etat))) continue;
    total += row.coutUsd;
  }
  let fichiers = [];
  try { fichiers = fs.readdirSync(reservationsDir(racine)); } catch (_err) { fichiers = []; }
  for (const f of fichiers) {
    const data = lireJsonSiExiste(path.join(reservationsDir(racine), f));
    if (!data) continue;
    if (detenteurVivant(data)) total += Number(data.montant) || 0;
  }
  return total;
}

// --- Exécution des éléments -----------------------------------------------------------------------

const STDOUT_GARDE = 64 * 1024;

function executerCommande(argv, opts) {
  return new Promise((resolve) => {
    let sortie = '';
    let enfant;
    try {
      enfant = spawn(argv[0], argv.slice(1), { cwd: opts.cwd, env: opts.env });
    } catch (_err) {
      resolve({ code: 1, stdout: '' });
      return;
    }
    // Revue n° 24 : seule la fin du stdout est gardée (la ligne de coût est la dernière) — un journal de
    // plusieurs centaines de Mo ne fait plus planter jouer-lot avant l'écriture du coût.
    // Seconde revue n° 65 : la dernière ligne de coût vue au fil du flux est retenue même si plus de STDOUT_GARDE de
    // journal la suivent (service hors contrat) ; replacée devant la fin gardée, une ligne de coût plus tardive gagne.
    let coutVu = '';
    let ligneEnCours = '';
    const noter = (l) => {
      if (!l.includes('cout_usd')) return;
      try { if (typeof JSON.parse(l.trim()).cout_usd === 'number') coutVu = l.trim(); } catch (_err) { /* pas du JSON */ }
    };
    if (enfant.stdout) enfant.stdout.on('data', (d) => {
      const texte = d.toString();
      sortie = (sortie + texte).slice(-STDOUT_GARDE);
      const morceaux = (ligneEnCours + texte).split('\n');
      ligneEnCours = morceaux.pop();
      if (ligneEnCours.length > STDOUT_GARDE) ligneEnCours = ''; // ligne démesurée : pas une ligne de coût
      for (const l of morceaux) noter(l);
    });
    if (enfant.stderr) enfant.stderr.on('data', () => { /* ignoré, seul stdout porte le coût */ });
    const rendu = () => {
      noter(ligneEnCours);
      if (!coutVu) return sortie;
      return `${coutVu}\n${sortie.slice(sortie.length - Math.max(0, STDOUT_GARDE - coutVu.length - 1))}`; // toujours ≤ STDOUT_GARDE
    };
    enfant.on('exit', (code) => resolve({ code: code === null ? 1 : code, stdout: rendu() }));
    enfant.on('error', () => resolve({ code: 1, stdout: rendu() }));
  });
}

/** Dernière ligne JSON `{"cout_usd": x}` du stdout capturé, ou `null`. */
function dernierCoutDeclare(stdout) {
  const lignes = (stdout || '').split('\n');
  for (let i = lignes.length - 1; i >= 0; i -= 1) {
    const l = lignes[i].trim();
    if (!l) continue;
    let obj;
    try { obj = JSON.parse(l); } catch (_err) { continue; }
    // Revue n° 24 : un coût négatif ou infini (1e400) n'est pas un coût déclaré — l'estimation s'applique.
    if (obj && typeof obj.cout_usd === 'number') return Number.isFinite(obj.cout_usd) && obj.cout_usd >= 0 ? obj.cout_usd : null;
  }
  return null;
}

/** Petit bassin de concurrence (paralleles à la fois), sans dépendance. */
async function executerParLots(items, n, fn) {
  let idx = 0;
  async function travailleur() {
    while (idx < items.length) {
      const i = idx;
      idx += 1;
      await fn(items[i], i);
    }
  }
  const nb = Math.max(1, Math.min(n, items.length) || 1);
  await Promise.all(Array.from({ length: nb }, travailleur));
}

// --- `lot <f> [--devis] [--plafond <usd>]` ---------------------------------------------------------

function preparerLot(fichierLot, cwd) {
  const fichierAbs = path.resolve(cwd, fichierLot);
  const dir = path.dirname(fichierAbs);
  const lot = JSON.parse(fs.readFileSync(fichierAbs, 'utf8'));
  return { fichierAbs, dir, lot };
}

/** `lot(fichierLot, opts)` — opts : { devis, plafond, racine, arbre, proprietaire, cwd }. Toutes les
 *  options racine/arbre/proprietaire sont injectables pour les tests (§4, options injectables). */
function lot(fichierLot, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const racine = opts.racine || jobsMod.racine(cwd);
  const arbre = opts.arbre || arbreCourant(cwd, racine);
  const proprietaire = opts.proprietaire || jobsMod.proprietaireActuel();

  let fichierAbs;
  let dir;
  let lotObj;
  try {
    ({ fichierAbs, dir, lot: lotObj } = preparerLot(fichierLot, cwd));
  } catch (err) {
    return { ok: false, code: 1, message: `lot illisible : ${err.message}` };
  }
  const validation = validerFormatLot(lotObj, dir);
  if (!validation.ok) return { ok: false, code: 1, message: `format de lot invalide : ${validation.motif}` };

  const empreintesInfo = calculerEmpreintesLot(lotObj, dir);
  const cle = cleLot(empreintesInfo.map((e) => e.empreinte));

  if (opts.devis) {
    const tries = trierElements(racine, arbre, dir, lotObj, empreintesInfo);
    const devisMontant = tries.filter((t) => t.statut === 'a-jouer').reduce((s, t) => s + Number(t.element.cout_estime_usd || 0), 0);
    const cumul = cumulActuel(racine, arbre);
    const budget = lireBudgetServices(racine);
    if (typeof opts.plafond === 'number' && devisMontant > opts.plafond) {
      return {
        ok: false, code: 1, message: `refus : devis ${devisMontant} USD > plafond ${opts.plafond} USD (cumul ${cumul} USD)`, devis: devisMontant, cumul, budget,
      };
    }
    if (cumul + devisMontant > budget) {
      return {
        ok: false, code: 1, message: `refus : devis ${devisMontant} USD + cumul ${cumul} USD > budget_services_usd ${budget} USD`, devis: devisMontant, cumul, budget,
      };
    }
    return {
      ok: true, code: 0, devis: devisMontant, cumul, budget,
    };
  }

  const verrouPath = verrouLotPath(racine, cle);
  const debutIso = jobsMod.nowIso();
  const vivMoi = jobsMod.capturerVivacite(process.pid);
  const acquisition = acquerirVerrou(verrouPath, {
    proprietaire, pid: process.pid, starttime: vivMoi.starttime, job: null, debut: debutIso,
  });
  if (!acquisition.acquis) {
    const d = acquisition.detenteur;
    const heure = d && d.debut ? new Date(d.debut).toISOString().slice(11, 16) : '??:??';
    return {
      ok: false, code: 1, message: `lot détenu par ${d ? d.proprietaire : '?'}, job ${d ? d.job : '?'}, depuis ${heure}`,
    };
  }
  if (acquisition.repris) journaliserReprise(racine, `lot ${cle}`, acquisition.repris);

  const tries = trierElements(racine, arbre, dir, lotObj, empreintesInfo);
  const devisMontant = tries.filter((t) => t.statut === 'a-jouer').reduce((s, t) => s + Number(t.element.cout_estime_usd || 0), 0);

  const budgetLock = budgetLockPath(racine);
  acquerirMutex(budgetLock);
  let cumul;
  let budget;
  try {
    cumul = cumulActuel(racine, arbre);
    budget = lireBudgetServices(racine);
    const depassePlafond = typeof opts.plafond === 'number' && devisMontant > opts.plafond;
    const depasseBudget = cumul + devisMontant > budget;
    if (depassePlafond || depasseBudget) {
      libererVerrou(verrouPath);
      const message = depassePlafond
        ? `refus : devis ${devisMontant} USD > plafond ${opts.plafond} USD (cumul ${cumul} USD)`
        : `refus : devis ${devisMontant} USD + cumul ${cumul} USD > budget_services_usd ${budget} USD`;
      return {
        ok: false, code: 1, message, devis: devisMontant, cumul, budget,
      };
    }
    // Seconde revue n° 64 : plafond et éléments du devis notés — jouer-lot recontrôle tout élément hors devis.
    ecrireAtomique(reservationPath(racine, cle), JSON.stringify({
      proprietaire, pid: process.pid, starttime: vivMoi.starttime, montant: devisMontant, job: null,
      plafond: typeof opts.plafond === 'number' ? opts.plafond : null,
      empreintes: tries.filter((t) => t.statut === 'a-jouer').map((t) => t.empreinte),
    }));
  } finally {
    libererMutex(budgetLock);
  }

  const holarchJobJs = path.join(__dirname, 'holarch-job.js');
  const { id, pid } = jobsMod.lancer({
    nom: `lot-${lotObj.nom}`,
    commande: [process.execPath, holarchJobJs, 'jouer-lot', fichierAbs, '--cle', cle],
    cwd,
    root: racine,
    proprietaire,
  });

  const vivSuperviseur = jobsMod.capturerVivacite(pid);
  ecrireAtomique(verrouPath, JSON.stringify({
    proprietaire, pid, starttime: vivSuperviseur.starttime, job: id, debut: debutIso,
  }));
  const resPath = reservationPath(racine, cle);
  const resActuelle = lireJsonSiExiste(resPath) || {};
  ecrireAtomique(resPath, JSON.stringify(Object.assign({}, resActuelle, { pid, starttime: vivSuperviseur.starttime, job: id })));

  return {
    ok: true, code: 0, id, pid, cle, devis: devisMontant, cumul, budget,
  };
}

// --- `jouer-lot <f> --cle <cle>` (sous-commande interne, jouée par le superviseur de jobs.js) ------

async function jouerLot(fichierLot, cle, opts = {}) {
  const cwd = opts.cwd || process.cwd();
  const racine = opts.racine || jobsMod.racine(cwd);
  const arbre = opts.arbre || arbreCourant(cwd, racine);
  const proprietaire = opts.proprietaire || jobsMod.proprietaireActuel();

  let dir;
  let lotObj;
  try {
    ({ dir, lot: lotObj } = preparerLot(fichierLot, cwd));
  } catch (err) {
    process.stderr.write(`lot illisible : ${err.message}\n`);
    return 1;
  }
  const validation = validerFormatLot(lotObj, dir);
  if (!validation.ok) {
    process.stderr.write(`format de lot invalide : ${validation.motif}\n`);
    return 1;
  }

  const empreintesInfo = calculerEmpreintesLot(lotObj, dir);
  const cleReelle = cle || cleLot(empreintesInfo.map((e) => e.empreinte));
  // Le véritable id de job (§18.4) n'est pas accessible depuis ce sous-processus (jobs.js ne le
  // transmet pas en variable d'environnement) : `cleReelle` sert d'identifiant de repli, unique par
  // lot joué, pour les verrous d'élément (usage informatif seulement — jamais comparé à un id de job).
  const job = opts.job || cleReelle;
  const paralleles = Number(lotObj.paralleles) > 0 ? Number(lotObj.paralleles) : 2;

  // Seconde revue n° 68 : verrou de lot et réservation passent au nom de jouer-lot, qui paie — ils suivaient la vie du
  // superviseur (kill -9 : jouer-lot payait hors réservation pendant qu'un autre lot passait).
  const prise = prendreEnCharge(racine, cleReelle, proprietaire);
  if (!prise.ok) {
    process.stderr.write(`${prise.message}\n`);
    return 1;
  }
  const rp = reservationPath(racine, cleReelle);
  const budgetLock = budgetLockPath(racine);
  const avecDevis = Array.isArray(prise.reservation.empreintes);
  const dansDevis = new Set(avecDevis ? prise.reservation.empreintes : []);
  let refuses = 0;
  /** Seconde revue n° 64 : un élément absent du devis (en cours ailleurs au devis, libéré depuis) n'est payé qu'après
   *  recontrôle, sous le mutex de budget, du plafond du lot et de `budget_services_usd` ; sa part est ajoutée à la
   *  réservation. Retourne le motif du refus, ou null. */
  const autoriserHorsDevis = (info) => {
    if (!avecDevis || dansDevis.has(info.empreinte)) return null;
    const cout = Number(info.element.cout_estime_usd || 0);
    acquerirMutex(budgetLock);
    try {
      const actuelle = lireJsonSiExiste(rp) || prise.reservation;
      const montant = Number(actuelle.montant) || 0;
      const plafond = prise.reservation.plafond;
      if (typeof plafond === 'number' && montant + cout > plafond) return `hors devis : réservé ${montant} + ${cout} USD > plafond ${plafond} USD`;
      const cumul = cumulActuel(racine, arbre);
      const budget = lireBudgetServices(racine);
      if (cumul + cout > budget) return `hors devis : cumul ${cumul} + ${cout} USD > budget_services_usd ${budget} USD`;
      ecrireAtomique(rp, JSON.stringify(Object.assign({}, actuelle, {
        pid: process.pid, starttime: prise.moi.starttime, groupe: prise.moi.groupe, montant: montant + cout, empreintes: [...(actuelle.empreintes || []), info.empreinte],
      })));
      dansDevis.add(info.empreinte);
      return null;
    } finally {
      libererMutex(budgetLock);
    }
  };

  const traiterElement = async (info, { sansAppel = false } = {}) => {
    const sortieAbs = path.resolve(dir, info.element.sortie);
    const enCoursAilleurs = () => ecrireLigneCouts(racine, arbre, ligneCout({
      lot: lotObj.nom,
      element: info.id,
      service: lotObj.service,
      empreinte: info.empreinte,
      cout_usd: 0,
      source: 'reel',
      proprietaire,
      etat: 'en-cours-ailleurs',
      sortie: sortieAbs,
    }));

    if (verrouElementVivantAilleurs(racine, info.empreinte)) { enCoursAilleurs(); return; }

    const vivMoi = jobsMod.capturerVivacite(process.pid);
    const verrou = acquerirVerrou(verrouElementPath(racine, info.empreinte), {
      proprietaire, pid: process.pid, starttime: vivMoi.starttime, groupe: prise.moi.groupe, job, debut: jobsMod.nowIso(),
    });
    if (!verrou.acquis) { enCoursAilleurs(); return; }
    if (verrou.repris) journaliserReprise(racine, `élément ${info.empreinte.slice(0, 12)}`, verrou.repris);

    try {
      const statut = statutElement(racine, arbre, info.empreinte, sortieAbs);
      if (statut.statut === 'fait') return; // déjà publié ici, rien à écrire (pas repayé)
      if (statut.statut === 'repris') {
        fs.mkdirSync(path.dirname(sortieAbs), { recursive: true });
        fs.copyFileSync(statut.sourceSortie, sortieAbs);
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom,
          element: info.id,
          service: lotObj.service,
          empreinte: info.empreinte,
          cout_usd: 0,
          source: 'reel',
          proprietaire,
          etat: 'repris',
          sha_sortie: statut.shaSortie,
          sortie: sortieAbs,
        }));
        return;
      }
      if (sansAppel) {
        // Revue n° 20 : doublon d'un élément de ce lot dont le premier a échoué — jamais un second appel payant.
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom,
          element: info.id,
          service: lotObj.service,
          empreinte: info.empreinte,
          cout_usd: 0,
          source: 'reel',
          proprietaire,
          etat: 'echec',
          sortie: sortieAbs,
        }));
        return;
      }
      const refus = autoriserHorsDevis(info);
      if (refus) {
        refuses += 1;
        try { process.stdout.write(`[lot] ${jobsMod.nowIso()} élément ${info.id} non joué : ${refus}\n`); } catch (_err) { /* ignore */ }
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom,
          element: info.id,
          service: lotObj.service,
          empreinte: info.empreinte,
          cout_usd: 0,
          source: 'reel',
          proprietaire,
          etat: 'hors-budget',
          sortie: sortieAbs,
        }));
        return;
      }

      const entreesAbs = (info.element.entrees || []).map((e) => path.resolve(dir, e));
      const partielAbs = `${sortieAbs}.partiel`;
      fs.mkdirSync(path.dirname(partielAbs), { recursive: true });
      // Seconde revue n° 27 : les deux argv sont résolus AVANT l'appel payant — un gabarit sans valeur échoue
      // sans rien payer (validerFormatLot l'a déjà refusé en amont ; ceci est le filet).
      let argvCommande;
      let argvValiderPre = null;
      try {
        argvCommande = resoudreArgv(lotObj.commande, {
          entrees: entreesAbs, sortie: partielAbs, parametres: info.element.parametres || {},
        });
        if (Array.isArray(lotObj.valider)) {
          argvValiderPre = resoudreArgv(lotObj.valider, {
            fichier: partielAbs, entrees: entreesAbs, parametres: info.element.parametres || {},
          });
        }
      } catch (err) {
        refuses += 1;
        try { process.stdout.write(`[lot] ${jobsMod.nowIso()} élément ${info.id} non joué : ${err.message}\n`); } catch (_err) { /* ignore */ }
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom, element: info.id, service: lotObj.service, empreinte: info.empreinte,
          cout_usd: 0, source: 'reel', proprietaire, etat: 'echec', sortie: sortieAbs,
        }));
        return;
      }
      const res = await executerCommande(argvCommande, { cwd: dir, env: process.env });
      const coutDeclare = dernierCoutDeclare(res.stdout);
      let ok = res.code === 0;
      if (ok && Array.isArray(lotObj.valider)) {
        // Revue finale n° 27 : `valider` voit les mêmes entrées et paramètres que la commande ; une erreur
        // de résolution après l'appel payant vaut échec de validation, jamais une ligne de coût perdue.
        let rv;
        try {
          rv = spawnSync(argvValiderPre[0], argvValiderPre.slice(1), { cwd: dir });
        } catch (_err) { rv = null; }
        if (!rv || rv.status !== 0) ok = false;
      }
      if (ok) {
        fs.mkdirSync(path.dirname(sortieAbs), { recursive: true });
        try { fs.renameSync(partielAbs, sortieAbs); } catch (_err) { /* partiel déjà absent */ }
        let sha = null;
        try { sha = sha256Fichier(sortieAbs); } catch (_err) { /* sortie absente malgré code 0 : traçable par sha null */ }
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom,
          element: info.id,
          service: lotObj.service,
          empreinte: info.empreinte,
          cout_usd: coutDeclare !== null ? coutDeclare : info.element.cout_estime_usd,
          source: coutDeclare !== null ? 'reel' : 'estime',
          proprietaire,
          etat: 'fait',
          sha_sortie: sha,
          sortie: sortieAbs,
        }));
      } else {
        echecs += 1;
        try { fs.renameSync(partielAbs, `${sortieAbs}.echec`); } catch (_err) { /* partiel déjà absent */ }
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom,
          element: info.id,
          service: lotObj.service,
          empreinte: info.empreinte,
          cout_usd: coutDeclare !== null ? coutDeclare : 0,
          source: coutDeclare !== null ? 'reel' : 'estime',
          proprietaire,
          etat: 'echec',
          sortie: `${sortieAbs}.echec`,
        }));
      }
    } finally {
      libererVerrou(verrouElementPath(racine, info.empreinte));
    }
  };

  // Revue finale n° 26 : une exception dans un élément ne fait jamais sortir jouer-lot pendant que
  // d'autres appels payants tournent — elle devient une ligne `echec` et les autres éléments finissent.
  let exceptions = 0;
  // Seconde revue n° 71 : un élément en `echec` rend le job `echoue` (code 1), jamais `fini 0` — le propriétaire
  // réveillé ne croit plus livré un lot sans sortie ; relancé, le lot ne rejoue que les éléments non faits.
  let echecs = 0;
  const traiterSansEchapper = async (info, optsElement) => {
    try {
      await traiterElement(info, optsElement);
    } catch (err) {
      exceptions += 1;
      try { process.stdout.write(`[lot] ${jobsMod.nowIso()} élément ${info.id} : ${err.message}\n`); } catch (_err) { /* ignore */ }
      try {
        ecrireLigneCouts(racine, arbre, ligneCout({
          lot: lotObj.nom,
          element: info.id,
          service: lotObj.service,
          empreinte: info.empreinte,
          cout_usd: 0,
          source: 'estime',
          proprietaire,
          etat: 'echec',
          sortie: path.resolve(dir, String(info.element.sortie)),
        }));
      } catch (_err) { /* meilleur effort : l'exception est déjà au journal */ }
    }
  };

  try {
    // Revue n° 20 : deux éléments de même empreinte ne tournent jamais ensemble (le second verrait le
    // verrou du premier et ne produirait rien) ; les doublons passent après, un par un, par copie.
    const vus = new Set();
    const premiers = [];
    const doublons = [];
    for (const info of empreintesInfo) {
      (vus.has(info.empreinte) ? doublons : premiers).push(info);
      vus.add(info.empreinte);
    }
    await executerParLots(premiers, paralleles, (info) => traiterSansEchapper(info));
    await executerParLots(doublons, 1, (info) => traiterSansEchapper(info, { sansAppel: true }));
  } finally {
    // Seconde revue n° 68 : jamais retirer un verrou ou une réservation repris entre-temps par un autre.
    libererSiAMoi(rp);
    libererSiAMoi(verrouLotPath(racine, cleReelle));
  }
  return exceptions > 0 || refuses > 0 || echecs > 0 ? 1 : 0;
}

function libererSiAMoi(fichier) {
  const d = lireJsonSiExiste(fichier);
  if (d && d.pid === process.pid) libererVerrou(fichier);
}

/** Prise en charge par jouer-lot (seconde revue n° 68) du verrou de lot et de la réservation que `lot` a posés au nom
 *  du superviseur (son parent) : réécrits à son pid. Détenteur mort → verrou repris sous marque, réservation refaite à
 *  vide (tout élément sera recontrôlé, n° 64) ; détenteur vivant qui n'est ni lui ni son parent → refus, rien joué. */
function prendreEnCharge(racine, cle, proprietaire) {
  const moi = Object.assign({ pid: process.pid, starttime: jobsMod.capturerVivacite(process.pid).starttime }, groupeDeMoi());
  const aNous = (d) => d && (d.pid === process.pid || d.pid === process.ppid);
  const vivant = (d) => detenteurVivant(d);
  const vl = verrouLotPath(racine, cle);
  const lotData = lireJsonSiExiste(vl);
  if (aNous(lotData)) {
    ecrireAtomique(vl, JSON.stringify(Object.assign({}, lotData, moi)));
  } else if (vivant(lotData)) {
    return { ok: false, message: `lot ${cle} détenu par ${lotData.proprietaire} (pid ${lotData.pid}) : rien joué` };
  } else {
    const donnees = Object.assign({ proprietaire, job: null, debut: jobsMod.nowIso() }, lotData || {}, moi);
    delete donnees.jeton;
    const a = acquerirVerrou(vl, donnees);
    if (!a.acquis) return { ok: false, message: `lot ${cle} repris par un autre : rien joué` };
    if (a.repris) journaliserReprise(racine, `lot ${cle}`, a.repris);
  }
  const rp = reservationPath(racine, cle);
  const budgetLock = budgetLockPath(racine);
  acquerirMutex(budgetLock);
  try {
    const res = lireJsonSiExiste(rp);
    if (res && !aNous(res) && vivant(res)) {
      libererSiAMoi(vl);
      return { ok: false, message: `réservation du lot ${cle} tenue par le pid ${res.pid} : rien joué` };
    }
    const reservation = aNous(res)
      ? Object.assign({}, res, moi)
      : Object.assign({ proprietaire, job: null, plafond: null }, res || {}, moi, { montant: 0, empreintes: [] });
    ecrireAtomique(rp, JSON.stringify(reservation));
    return { ok: true, moi, reservation };
  } finally {
    libererMutex(budgetLock);
  }
}

module.exports = {
  lotsDir,
  elementsDir,
  reservationsDir,
  coutsJsonlPath,
  coutsServicesPath,
  budgetLockPath,
  verrouLotPath,
  verrouElementPath,
  reservationPath,
  arbreCourant,
  sha256Texte,
  sha256Fichier,
  jsonCanonique,
  empreinteElement,
  calculerEmpreintesLot,
  cleLot,
  validerFormatLot,
  resoudreArgv,
  acquerirVerrou,
  journaliserReprise,
  libererVerrou,
  acquerirMutex,
  libererMutex,
  verrousLotVivants,
  verrouElementVivantAilleurs,
  parserTableCouts,
  ecrireLigneCouts,
  statutElement,
  trierElements,
  lireBudgetServices,
  coutsNonCommitesDe,
  nombreUsd,
  cumulActuel,
  dernierCoutDeclare,
  executerCommande,
  executerParLots,
  lot,
  jouerLot,
};
