#!/usr/bin/env node
'use strict';
/**
 * jointure — croise les fiches d'unité (`memoire/U<n>[suffixe]-<slug>.md`) d'une mission avec les
 * lignes de session de son `registry/SESSIONS.md`, pour répondre à « quelle session a produit
 * quelle unité, à quel coût ».
 *
 * Usage :
 *   node jointure.js --mission <racine> [--format table|json] [--instance <chemin>]
 *
 * Arborescence attendue (identique pour une mission vivante `mission/` et une mission archivée
 * `docs/archive/mission-<nom>/`) : `registry/SESSIONS.md` à la racine donnée, et les instances en
 * sous-répertoires de profondeur quelconque, chacune avec `memoire/U<n>[suffixe]-<slug>.md`. Le
 * chemin d'instance d'une fiche = son chemin relatif à la racine de mission, moins le segment
 * final `memoire/<fichier>`.
 *
 * Lecture de `SESSIONS.md` : le fichier est append-only et son en-tête (13 colonnes dans sa version
 * actuelle) s'est enrichi au fil des versions du lanceur (`Contexte`, puis `Fournisseur / modèle
 * réel`, ajoutées en fin de ligne). Le nom de chaque colonne d'en-tête est reconnu par préfixe
 * (`COLONNES`) puis chaque ligne de donnée est découpée et mappée **par position** sur cet en-tête :
 * une ligne ancienne, écrite avant l'ajout d'une colonne, a moins de cellules que l'en-tête courant
 * — les colonnes en trop (toujours en fin de ligne, car les colonnes sont ajoutées en queue) valent
 * `null`, sans jamais lever d'exception. La date de la première colonne est la fin de session
 * (le lanceur écrit la ligne à la mort de la session, `appendSessionLine` dans
 * `framework/bin/holarch-spawn.js`) ; avec `Durée`, l'intervalle de la session est
 * `[Date − Durée, Date]` — c'est la clé de jointure avec la date (souvent arrondie à la minute,
 * écrite à la main) d'une fiche d'unité de même instance.
 *
 * Une fiche est rattachée à la session de même instance dont l'intervalle contient sa date
 * (bornes comprises) ; si plusieurs conviennent, celle dont la fin est la plus proche de la date de
 * la fiche, et une seule — jamais de rattachement multiple.
 *
 * Aucun accès réseau, aucune dépendance hors bibliothèque standard de Node.
 */

const fs = require('fs');
const path = require('path');

/** Reconnaissance des colonnes d'en-tête par préfixe (ordre sans ambiguïté de préfixe commun). */
const COLONNES = [
  ['Date', 'dateFin'],
  ['Instance', 'instance'],
  ['Session', 'session'],
  ['Modèle', 'modele'],
  ['Tours', 'tours'],
  ['Tokens', 'tokens'],
  ['Coût', 'coutUsd'],
  ['Durée', 'duree'],
  ['Fin', 'finResume'],
  ['STATUS', 'status'],
  ['Réveil', 'reveil'],
  ['Contexte', 'contexte'],
  ['Fournisseur', 'fournisseur'],
];

/** Découpe une ligne de table markdown `| a | b | c |` en cellules `['a','b','c']` (non trimmées). */
function decouperLigne(ligne) {
  const t = String(ligne).trim().replace(/^\|/, '').replace(/\|$/, '');
  return t.split('|');
}

/** Mappe les cellules d'en-tête vers les clés canoniques de `COLONNES` (ou `null` si non reconnue). */
function mapperColonnes(celluesEntete) {
  return celluesEntete.map((c) => {
    const cell = c.trim();
    const trouve = COLONNES.find(([prefixe]) => cell.startsWith(prefixe));
    return trouve ? trouve[1] : null;
  });
}

/** `43s`, `6m58s`, `1h02m03s` → millisecondes ; forme non reconnue → `null`. */
function parseDureeMs(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(s);
  if (!m || (!m[1] && !m[2] && !m[3])) return null;
  const h = parseInt(m[1] || '0', 10);
  const mi = parseInt(m[2] || '0', 10);
  const se = parseInt(m[3] || '0', 10);
  return ((h * 60 + mi) * 60 + se) * 1000;
}

/** `0.2033` / `≈ 0.23` / `?` → `{valeur, approximatif}` ou `null` si `?`/vide/illisible. */
function parseCoutUsd(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === '?') return null;
  const approximatif = s.startsWith('≈');
  const n = parseFloat(s.replace('≈', '').trim());
  if (Number.isNaN(n)) return null;
  return { valeur: n, approximatif };
}

/** `53529 / 136512` → `{depart, max}` ; `— / —` ou illisible → `null`. */
function parseContexte(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const parts = s.split('/').map((p) => p.trim());
  if (parts.length !== 2 || parts[0] === '—' || parts[1] === '—') return null;
  const a = parseInt(parts[0], 10);
  const b = parseInt(parts[1], 10);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return { depart: a, max: b };
}

/** Entier ou `null` si `?`/vide/illisible. */
function parseTours(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (s === '' || s === '?') return null;
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
}

/** Analyse le texte d'un `registry/SESSIONS.md` en un tableau de sessions typées. */
function parseSessions(texte) {
  const lignes = String(texte || '').split('\n');
  const headerIdx = lignes.findIndex((l) => /^\|\s*Date/.test(l.trim()));
  if (headerIdx === -1) return [];
  const colMap = mapperColonnes(decouperLigne(lignes[headerIdx]));
  const sessions = [];
  for (let i = headerIdx + 1; i < lignes.length; i++) {
    const ligne = lignes[i];
    if (!/^\|\s*20\d{2}-/.test(ligne.trim())) continue;
    const cellules = decouperLigne(ligne);
    const brut = {};
    for (let c = 0; c < colMap.length; c++) {
      const cle = colMap[c];
      if (!cle) continue;
      brut[cle] = c < cellules.length ? cellules[c].trim() : null;
    }
    const dateFinMs = brut.dateFin ? Date.parse(brut.dateFin) : NaN;
    const coutParse = parseCoutUsd(brut.coutUsd);
    const contexteParse = parseContexte(brut.contexte);
    sessions.push({
      instance: brut.instance || null,
      session: brut.session || null,
      modele: brut.modele || null,
      tours: parseTours(brut.tours),
      tours_brut: brut.tours != null ? brut.tours : null,
      tokens: brut.tokens != null ? brut.tokens : null,
      cout_usd: coutParse ? coutParse.valeur : null,
      cout_usd_approximatif: coutParse ? coutParse.approximatif : false,
      cout_usd_brut: brut.coutUsd != null ? brut.coutUsd : null,
      duree_ms: parseDureeMs(brut.duree),
      duree_brut: brut.duree != null ? brut.duree : null,
      date_fin: brut.dateFin || null,
      date_fin_ms: Number.isNaN(dateFinMs) ? null : dateFinMs,
      resume_fin: brut.finResume != null ? brut.finResume : null,
      status: brut.status != null ? brut.status : null,
      reveil: brut.reveil != null ? brut.reveil : null,
      contexte: contexteParse,
      contexte_brut: brut.contexte != null ? brut.contexte : null,
      fournisseur: brut.fournisseur != null ? brut.fournisseur : null,
    });
  }
  return sessions;
}

/** Analyse le frontmatter (entre les deux premières lignes `---`) d'une fiche d'unité. */
function parseFiche(texte) {
  const lignes = String(texte || '').split('\n');
  if (!lignes.length || lignes[0].trim() !== '---') return {};
  let fin = -1;
  for (let i = 1; i < lignes.length; i++) {
    if (lignes[i].trim() === '---') { fin = i; break; }
  }
  if (fin === -1) return {};
  const champs = {};
  for (let i = 1; i < fin; i++) {
    const m = /^([A-Za-z_]+):\s*(.*)$/.exec(lignes[i]);
    if (!m) continue;
    champs[m[1].trim()] = m[2].trim();
  }
  return champs;
}

function listerFichiers(dir, out) {
  let entrees;
  try {
    entrees = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const entree of entrees) {
    const p = path.join(dir, entree.name);
    if (entree.isDirectory()) listerFichiers(p, out);
    else if (entree.isFile()) out.push(p);
  }
}

const RE_FICHE = /^U\d+[A-Za-z]?-.+\.md$/;

/** Parcourt une racine de mission et retourne toutes les fiches d'unité, avec instance et chemin. */
function collecterFiches(missionRoot) {
  const fichiers = [];
  listerFichiers(missionRoot, fichiers);
  const out = [];
  for (const f of fichiers) {
    if (path.basename(path.dirname(f)) !== 'memoire') continue;
    if (!RE_FICHE.test(path.basename(f))) continue;
    const texte = fs.readFileSync(f, 'utf8');
    const champs = parseFiche(texte);
    const instanceDir = path.dirname(path.dirname(f));
    const instance = path.relative(missionRoot, instanceDir).split(path.sep).join('/');
    const chemin = path.relative(missionRoot, f).split(path.sep).join('/');
    out.push(Object.assign({}, champs, {
      id: champs.id || null,
      date: champs.date || null,
      instance,
      chemin,
    }));
  }
  return out;
}

function arrondi2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Joint sessions et fiches : chaque fiche rejoint la session de même instance dont l'intervalle
 * `[fin − durée, fin]` contient sa date, bornes comprises (fin la plus proche en cas de
 * chevauchement, jamais de rattachement multiple). Retourne `{mission, sessions, fiches_non_rattachees, totaux}`.
 */
function joindre(sessions, fiches, options) {
  const opts = options || {};
  const sessionsUse = opts.instance ? sessions.filter((s) => s.instance === opts.instance) : sessions.slice();
  const fichesUse = opts.instance ? fiches.filter((f) => f.instance === opts.instance) : fiches.slice();

  const sessionOut = sessionsUse.map((s) => Object.assign({}, s, { fiches: [] }));
  const nonRattachees = [];

  for (const fiche of fichesUse) {
    const ficheDateMs = fiche.date ? Date.parse(fiche.date) : NaN;
    const memeInstance = sessionOut.filter((s) => s.instance === fiche.instance);
    if (memeInstance.length === 0) {
      nonRattachees.push({ fiche, motif: 'aucune session pour cette instance' });
      continue;
    }
    let meilleure = null;
    let meilleurEcart = Infinity;
    for (const s of memeInstance) {
      if (s.duree_ms == null || s.date_fin_ms == null || Number.isNaN(ficheDateMs)) continue;
      const finMs = s.date_fin_ms;
      const debutMs = finMs - s.duree_ms;
      if (ficheDateMs >= debutMs && ficheDateMs <= finMs) {
        const ecart = Math.abs(finMs - ficheDateMs);
        if (ecart < meilleurEcart) { meilleurEcart = ecart; meilleure = s; }
      }
    }
    if (meilleure) meilleure.fiches.push(fiche);
    else nonRattachees.push({ fiche, motif: 'hors de tout intervalle de session' });
  }

  for (const s of sessionOut) {
    s.unites = s.fiches.map((f) => f.id);
    s.cout_par_unite = (s.cout_usd != null && s.fiches.length > 0) ? arrondi2(s.cout_usd / s.fiches.length) : null;
  }

  const totalTours = sessionOut.reduce((acc, s) => acc + (s.tours != null ? s.tours : 0), 0);
  const totalCout = sessionOut.reduce((acc, s) => acc + (s.cout_usd != null ? s.cout_usd : 0), 0);
  const fichesRattachees = sessionOut.reduce((acc, s) => acc + s.fiches.length, 0);

  return {
    mission: opts.missionRoot != null ? opts.missionRoot : null,
    sessions: sessionOut,
    fiches_non_rattachees: nonRattachees,
    totaux: {
      sessions: sessionOut.length,
      tours: totalTours,
      cout_usd: Math.round(totalCout * 10000) / 10000,
      fiches_rattachees: fichesRattachees,
      fiches_total: fichesRattachees + nonRattachees.length,
    },
  };
}

function formatTable(result) {
  const lignes = [];
  lignes.push(`<!-- mission : ${result.mission} · ${result.sessions.length} session(s) · ${result.totaux.fiches_total} fiche(s) -->`);
  lignes.push('');
  lignes.push('| fin | instance | modèle / effort | tours | coût USD | contexte départ/max | unités | coût/unité |');
  lignes.push('|---|---|---|---|---|---|---|---|');
  for (const s of result.sessions) {
    const fin = s.date_fin || '—';
    const tours = s.tours_brut != null ? s.tours_brut : '?';
    const cout = s.cout_usd_brut != null ? s.cout_usd_brut : '?';
    const contexte = s.contexte_brut != null ? s.contexte_brut : '— / —';
    const unites = s.unites.length ? s.unites.join(', ') : '—';
    const coutParUnite = s.cout_par_unite != null ? s.cout_par_unite.toFixed(2) : '—';
    lignes.push(`| ${fin} | ${s.instance || '—'} | ${s.modele || '—'} | ${tours} | ${cout} | ${contexte} | ${unites} | ${coutParUnite} |`);
  }
  if (result.fiches_non_rattachees.length) {
    lignes.push('');
    lignes.push('| fiche | instance | id | date | motif |');
    lignes.push('|---|---|---|---|---|');
    for (const { fiche, motif } of result.fiches_non_rattachees) {
      lignes.push(`| ${fiche.chemin} | ${fiche.instance || '—'} | ${fiche.id || '—'} | ${fiche.date || '—'} | ${motif} |`);
    }
  }
  lignes.push('');
  const t = result.totaux;
  lignes.push(`${t.sessions} session(s) · ${t.tours} tours · ${t.cout_usd.toFixed(2)} USD · ${t.fiches_rattachees} fiche(s) rattachée(s) sur ${t.fiches_total}`);
  return lignes.join('\n') + '\n';
}

function formatJson(result) {
  return JSON.stringify(result, null, 2) + '\n';
}

function parseArgs(argv) {
  const o = { mission: null, format: 'table', instance: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mission') o.mission = argv[++i];
    else if (a === '--format') o.format = argv[++i];
    else if (a === '--instance') o.instance = argv[++i];
    else throw new Error(`option inconnue : ${a}`);
  }
  if (!o.mission) throw new Error('--mission est obligatoire');
  if (o.format !== 'table' && o.format !== 'json') throw new Error(`--format invalide : ${o.format}`);
  return o;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`jointure : ${e.message}\n`);
    return 2;
  }
  const missionRoot = path.resolve(opts.mission);
  if (!fs.existsSync(missionRoot) || !fs.statSync(missionRoot).isDirectory()) {
    process.stderr.write(`jointure : répertoire de mission introuvable : ${missionRoot}\n`);
    return 2;
  }
  const sessionsPath = path.join(missionRoot, 'registry', 'SESSIONS.md');
  if (!fs.existsSync(sessionsPath)) {
    process.stderr.write(`jointure : fichier introuvable : ${sessionsPath}\n`);
    return 2;
  }
  const texte = fs.readFileSync(sessionsPath, 'utf8');
  const sessions = parseSessions(texte);
  const fiches = collecterFiches(missionRoot);
  const result = joindre(sessions, fiches, { instance: opts.instance, missionRoot: opts.mission });
  process.stdout.write(opts.format === 'json' ? formatJson(result) : formatTable(result));
  return 0;
}

module.exports = {
  parseSessions, parseFiche, collecterFiches, joindre, formatTable, formatJson,
  parseArgs, main, parseDureeMs, parseCoutUsd, parseContexte, parseTours,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
