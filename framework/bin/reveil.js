'use strict';
// Grammaire et évaluation du champ « Réveil » de STATUS.md (docs/IMPLEMENTATION.md §3.1-§3.2).
// Module Node autonome, sans dépendance, require-able par le lanceur et par les tests.
const fs = require('fs');
const path = require('path');

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

/** Sous-répertoires directs de `chemin` (relatif à mission/) qui sont des instances incarnées (STATUS.md présent, hors workspace/). */
function listChildren(root, chemin) {
  const dir = path.join(root, 'mission', chemin);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => e.isDirectory() && e.name !== 'workspace')
    .filter((e) => fs.existsSync(path.join(dir, e.name, 'STATUS.md')))
    .map((e) => e.name)
    .sort();
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
    const enfants = listChildren(ctx.root, ctx.chemin);
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
 * ctx = {root, chemin, sinceIso, now: Date, readStatus(cheminInstance) → {etat,note}, readInbox(chemin) → texte}
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

/** Toutes les instances de mission/ (hors graveyard, hors workspace) dont STATUS.md porte une ligne Réveil non vide. */
function listWaiters(root) {
  const out = [];
  const skipDirs = new Set(['workspace', 'graveyard', '.holarch']);
  const skipTop = new Set(['registry', 'shared', '.holarch', 'graveyard']);
  function walk(relChemin) {
    const dir = path.join(root, 'mission', relChemin);
    const statusPath = path.join(dir, 'STATUS.md');
    if (fs.existsSync(statusPath)) {
      const texte = fs.readFileSync(statusPath, 'utf8');
      const etat = (texte.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m) || [])[1] || '';
      const note = (texte.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m) || [])[1] || '';
      const reveilTxt = (texte.match(/^\|\s*R[ée]veil\s*\|\s*(.*?)\s*\|\s*$/m) || [])[1] || '';
      if (reveilTxt && reveilTxt !== '—' && reveilTxt !== '-') {
        const ast = parseReveil(reveilTxt);
        if (ast) out.push({ chemin: relChemin, ast, etat, note });
      }
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || skipDirs.has(e.name)) continue;
      walk(`${relChemin}/${e.name}`);
    }
  }
  let top;
  try { top = fs.readdirSync(path.join(root, 'mission'), { withFileTypes: true }); } catch { top = []; }
  for (const e of top) {
    if (!e.isDirectory() || skipTop.has(e.name)) continue;
    walk(e.name);
  }
  return out;
}

module.exports = { parseReveil, formatReveil, evalReveil, listWaiters, listChildren };
