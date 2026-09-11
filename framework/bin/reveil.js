'use strict';
// Grammaire et évaluation du champ « Réveil » de STATUS.md (docs/IMPLEMENTATION.md §3.1-§3.2).
// Module Node autonome, sans dépendance, require-able par le lanceur et par les tests.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TYPES = ['TASK', 'DELIVERABLE', 'BLOCKER', 'CLARIFICATION', 'PROPOSAL', 'ALERT', 'RESPONSE'];
const ETATS = ['INIT', 'READY', 'WORKING', 'WAITING_CHILDREN', 'BLOCKED', 'DELIVERED', 'FAILED', 'ARCHIVED'];

function formatTerm(t) {
  if (t.kind === 'enfant') return `enfant:${t.arg}:${t.arg2}`;
  return `${t.kind}:${t.arg}`;
}

function parseTerm(str) {
  let m;
  if ((m = str.match(/^message:([A-Z]+)$/))) {
    if (!TYPES.includes(m[1])) { parseReveil.lastError = `type de message inconnu : ${m[1]}`; return null; }
    return { kind: 'message', arg: m[1] };
  }
  if ((m = str.match(/^enfant:([^:]+):([A-Z_]+)$/))) {
    if (!ETATS.includes(m[2])) { parseReveil.lastError = `état inconnu : ${m[2]}`; return null; }
    if (!m[1]) { parseReveil.lastError = "nom d'enfant vide"; return null; }
    return { kind: 'enfant', arg: m[1], arg2: m[2] };
  }
  if ((m = str.match(/^enfants:([A-Z_]+)$/))) {
    if (!ETATS.includes(m[1])) { parseReveil.lastError = `état inconnu : ${m[1]}`; return null; }
    return { kind: 'enfants', arg: m[1] };
  }
  if ((m = str.match(/^fichier:(.+)$/))) {
    return { kind: 'fichier', arg: m[1] };
  }
  if ((m = str.match(/^date:(.+)$/))) {
    if (Number.isNaN(Date.parse(m[1]))) { parseReveil.lastError = `date invalide : ${m[1]}`; return null; }
    return { kind: 'date', arg: m[1] };
  }
  parseReveil.lastError = `terme non reconnu : ${str}`;
  return null;
}

function splitTop(str) {
  return str.split(',').map((s) => s.trim()).filter((s) => s.length);
}

/** @returns {{op:'terme'|'tous'|'lun', termes?:AST[], kind?:string, arg?:string, arg2?:string}|null} */
function parseReveil(text) {
  parseReveil.lastError = null;
  const compact = String(text == null ? '' : text).replace(/\s+/g, '');
  if (compact === '' || compact === '—' || compact === '-') return null;
  let m;
  if ((m = compact.match(/^tous\((.+)\)$/))) {
    const termes = [];
    for (const p of splitTop(m[1])) {
      const t = parseTerm(p);
      if (!t) return null;
      termes.push(t);
    }
    if (!termes.length) { parseReveil.lastError = 'tous() vide'; return null; }
    return { op: 'tous', termes };
  }
  if ((m = compact.match(/^lun\((.+)\)$/))) {
    const termes = [];
    for (const p of splitTop(m[1])) {
      const t = parseTerm(p);
      if (!t) return null;
      termes.push(t);
    }
    if (!termes.length) { parseReveil.lastError = 'lun() vide'; return null; }
    return { op: 'lun', termes };
  }
  const t = parseTerm(compact);
  if (!t) return null;
  return Object.assign({ op: 'terme' }, t);
}
parseReveil.lastError = null;

/** forme canonique, pour les journaux */
function formatReveil(ast) {
  if (!ast) return '—';
  if (ast.op === 'terme') return formatTerm(ast);
  return `${ast.op}(${ast.termes.map(formatTerm).join(',')})`;
}

/** Parseur minimal des blocs de message (KERNEL §7) : ne retient que type et date. */
function parseMessages(texte) {
  const t = String(texte || '');
  const re = /^---\nid: /gm;
  const idx = [];
  let m;
  while ((m = re.exec(t))) idx.push(m.index);
  const msgs = [];
  for (let i = 0; i < idx.length; i++) {
    const start = idx[i];
    const end = i + 1 < idx.length ? idx[i + 1] : t.length;
    const block = t.slice(start, end);
    const field = (name) => { const mm = block.match(new RegExp(`^${name}:\\s*(.*)$`, 'm')); return mm ? mm[1].trim() : ''; };
    msgs.push({ type: field('type'), date: field('date') });
  }
  return msgs;
}

function worktreesDir(root) { return path.join(root, 'mission', '.holarch', 'worktrees'); }
function enfantsSurDisque(base, chemin, into) {
  const dir = path.join(base, 'mission', chemin);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) if (e.isDirectory() && e.name !== 'workspace' && fs.existsSync(path.join(dir, e.name, 'STATUS.md'))) into.add(e.name);
}
/** Enfants directs de `chemin` (relatif à mission/) : instances incarnées ou spawnées.
 *  Union de trois sources — l'arbre `root` (isolation aucune/branche), les worktrees `mission/.holarch/worktrees/*`
 *  (chantier 3 : sous `isolation = worktree`, l'arbre du parent ne contient PAS ses enfants), et, si
 *  `gb = {prefixe}` est fourni (git-branches actif), les branches `<prefixe><chemin-tirets>-*` (enfant spawné mais
 *  jamais incarné : STATUS.md READY sur sa branche seulement — il compte, sinon `enfants:DELIVERED` serait vrai
 *  avant même son lancement). Dogfooding du 2026-09-10 : « aucun enfant incarné » alors que deux enfants
 *  détachés avaient livré dans leurs worktrees. */
function listChildren(root, chemin, gb) {
  const noms = new Set();
  enfantsSurDisque(root, chemin, noms);
  let wts = [];
  try { wts = fs.readdirSync(worktreesDir(root), { withFileTypes: true }); } catch { /* aucun worktree */ }
  for (const w of wts) if (w.isDirectory()) enfantsSurDisque(path.join(worktreesDir(root), w.name), chemin, noms);
  if (gb && gb.prefixe !== undefined) {
    const motif = `${gb.prefixe}${chemin.replace(/\//g, '-')}-*`;
    const list = spawnSync('git', ['-C', root, 'branch', '--list', '--format=%(refname:short)', motif], { encoding: 'utf8' });
    const re = new RegExp(`^mission/${chemin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/STATUS\.md$`);
    for (const b of (list.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      const tree = spawnSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', b, '--', `mission/${chemin}/`], { encoding: 'utf8' });
      for (const f of (tree.stdout || '').split('\n')) { const m = f.trim().match(re); if (m) noms.add(m[1]); }
    }
  }
  return [...noms].sort();
}

function evalTerm(t, ctx) {
  const terme = formatTerm(t);
  if (t.kind === 'message') {
    const texte = ctx.readInbox ? ctx.readInbox(ctx.chemin) : '';
    const msgs = parseMessages(texte);
    const since = ctx.sinceIso ? Date.parse(ctx.sinceIso) : null;
    const trouve = msgs.find((mm) => mm.type === t.arg && (since === null || Number.isNaN(since) || Date.parse(mm.date) > since));
    return { terme, vrai: !!trouve, pourquoi: trouve ? `message ${t.arg} daté ${trouve.date} trouvé dans INBOX.md` : `aucun message ${t.arg} récent dans INBOX.md` };
  }
  if (t.kind === 'enfant') {
    const chemin = t.arg.includes('/') ? t.arg : `${ctx.chemin}/${t.arg}`;
    const st = (ctx.readStatus ? ctx.readStatus(chemin) : null) || {};
    const vrai = st.etat === t.arg2;
    return { terme, vrai, pourquoi: `enfant ${chemin} à l'état ${st.etat || '(absent)'} (attendu ${t.arg2})` };
  }
  if (t.kind === 'enfants') {
    const enfants = listChildren(ctx.root, ctx.chemin, ctx.gitBranches);
    if (!enfants.length) return { terme, vrai: false, pourquoi: 'aucun enfant incarné' };
    const etats = enfants.map((n) => ((ctx.readStatus ? ctx.readStatus(`${ctx.chemin}/${n}`) : null) || {}).etat || '(absent)');
    const vrai = etats.every((e) => e === t.arg);
    return { terme, vrai, pourquoi: `enfants [${enfants.join(', ')}] états [${etats.join(', ')}] (attendu ${t.arg})` };
  }
  if (t.kind === 'fichier') {
    const p = path.join(ctx.root, t.arg);
    const vrai = fs.existsSync(p);
    return { terme, vrai, pourquoi: vrai ? `fichier ${t.arg} existe` : `fichier ${t.arg} absent` };
  }
  if (t.kind === 'date') {
    const now = ctx.now instanceof Date ? ctx.now : new Date();
    const cible = Date.parse(t.arg);
    const vrai = now.getTime() >= cible;
    return { terme, vrai, pourquoi: `horloge ${now.toISOString()} ${vrai ? '≥' : '<'} ${t.arg}` };
  }
  return { terme, vrai: false, pourquoi: 'terme inconnu' };
}

/**
 * ctx = {root, chemin, sinceIso, now: Date, readStatus(cheminInstance) → {etat,note}, readInbox(chemin) → texte,
 *        gitBranches?: {prefixe} (git-branches actif, isolation ≠ aucune — enfants énumérés aussi depuis les branches)}
 * @returns {{satisfied: boolean, details: Array<{terme: string, vrai: boolean, pourquoi: string}>}}
 */
function evalReveil(ast, ctx) {
  if (!ast) return { satisfied: false, details: [{ terme: '—', vrai: false, pourquoi: 'aucune condition' }] };
  if (ast.op === 'terme') {
    const d = evalTerm(ast, ctx);
    return { satisfied: d.vrai, details: [d] };
  }
  const details = ast.termes.map((t) => evalTerm(t, ctx));
  const satisfied = ast.op === 'tous' ? details.every((d) => d.vrai) : details.some((d) => d.vrai);
  return { satisfied, details };
}

/** Toutes les instances de mission/ (hors graveyard, hors workspace) dont STATUS.md porte une ligne Réveil non vide.
 *  Chantier 3 : une instance incarnée dans son worktree n'a son STATUS.md à jour QUE là ; chaque worktree
 *  `mission/.holarch/worktrees/<chemin-tirets>` n'est lu que pour SA propre instance (jamais pour les copies
 *  périmées du parent ou des frères qu'il contient), et une entrée de worktree prime sur l'arbre principal. */
function listWaiters(root) {
  const byChemin = new Map();
  const skipDirs = new Set(['workspace', 'graveyard', '.holarch']);
  const skipTop = new Set(['registry', 'shared', '.holarch', 'graveyard']);
  function walk(base, relChemin, accept) {
    const dir = path.join(base, 'mission', relChemin);
    const statusPath = path.join(dir, 'STATUS.md');
    if (accept(relChemin) && fs.existsSync(statusPath)) {
      const texte = fs.readFileSync(statusPath, 'utf8');
      const etat = (texte.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m) || [])[1] || '';
      const note = (texte.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m) || [])[1] || '';
      const reveilTxt = (texte.match(/^\|\s*R[ée]veil\s*\|\s*(.*?)\s*\|\s*$/m) || [])[1] || '';
      if (reveilTxt && reveilTxt !== '—' && reveilTxt !== '-') {
        const ast = parseReveil(reveilTxt);
        if (ast) byChemin.set(relChemin, { chemin: relChemin, ast, etat, note });
      }
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || skipDirs.has(e.name)) continue;
      walk(base, `${relChemin}/${e.name}`, accept);
    }
  }
  function walkTop(base, accept) {
    let top;
    try { top = fs.readdirSync(path.join(base, 'mission'), { withFileTypes: true }); } catch { top = []; }
    for (const e of top) {
      if (!e.isDirectory() || skipTop.has(e.name)) continue;
      walk(base, e.name, accept);
    }
  }
  walkTop(root, () => true);
  let wts = [];
  try { wts = fs.readdirSync(worktreesDir(root), { withFileTypes: true }); } catch { /* aucun worktree */ }
  for (const w of wts) if (w.isDirectory()) walkTop(path.join(worktreesDir(root), w.name), (rel) => rel.replace(/\//g, '-') === w.name);
  return [...byChemin.values()];
}

module.exports = { parseReveil, formatReveil, evalReveil, listWaiters, listChildren };
