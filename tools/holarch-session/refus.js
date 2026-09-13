#!/usr/bin/env node
'use strict';
/**
 * refus.js — relevé des refus subis par une instance avant de régler quoi que ce soit (mesure avant réglage).
 *
 * Deux sources, jamais mélangées dans un même total :
 *
 * 1. Refus d'allowlist (chantier 13) : chaque session `claude -p` lancée par le lanceur laisse
 *    `mission/.holarch/sessions/<instance>-<date>-N.result.json` avec
 *    `permission_denials: [{tool_name, tool_input}]`. Un refus coûte un tour entier à l'instance
 *    (archive du chantier 13, holarch-fournisseurs, 2026-09-11 : 58 refus pour un enfant sur deux
 *    sessions). `relever()`/`formater()`/`forme()` — inchangés depuis le chantier 13.
 *
 * 2. Refus de garde-fou (hooks du harnais, chantier 14, docs/IMPLEMENTATION.md §15.5) : un hook
 *    `PreToolUse` peut refuser un appel sans passer par l'allowlist (`framework/hooks/holarch-hooks.js`,
 *    `permissionDecisionReason` commençant par `[HOLARCH · garde-fou <nom>]`). Ce refus n'apparaît pas
 *    dans `permission_denials` (qui ne connaît que les refus d'allowlist) : il ne se lit que dans la
 *    transcription `.jsonl` de la session (`~/.claude/projects/<slug>/<session-id>.jsonl`, colonne
 *    Session de `mission/registry/SESSIONS.md`). `releverHooks()`/`formaterHooks()` le ventilent par
 *    garde-fou et par cause — le nom du garde-fou est LU dans le message, jamais une liste codée en
 *    dur : un garde-fou qui n'existe pas encore aujourd'hui (ex. `path-guard`, chantier 14) sera compté
 *    dès qu'il émettra un message de cette forme, sans toucher ce fichier.
 *
 * Usage :
 *   node tools/holarch-session/refus.js [--root <dir>] [--dir <sessions>] [--json] [--top <n>]
 *   node tools/holarch-session/refus.js --transcriptions <dossier-de-*.jsonl> [--json] [--top <n>]
 *   node tools/holarch-session/refus.js --help
 * Lecture seule, aucune dépendance, aucun réseau.
 * `--transcriptions` seul ne relève que les refus de garde-fou : le bloc « refus d'allowlist » porte sur
 * la mission courante, donc en général sur une autre mission que les transcriptions demandées ; il faut
 * `--dir <sessions>` (ou `--root <dir>`) pour le demander explicitement en plus.
 *
 * Forme des événements de refus : `releverHooks()` est délibérément tolérant à l'emplacement exact du
 * message dans la ligne JSON (parcours générique de toutes les valeurs chaîne de la ligne, comme
 * `tools/holarch-transcript/analyse.js` le fait déjà pour les `tool_result`) plutôt que de supposer un
 * seul chemin de champ — une hypothèse fausse ferait un train de zéros silencieux, pas une erreur.
 * Cette tolérance a été validée le 2026-09-13 sur les transcriptions réelles de `~/.claude/projects`
 * (mesure faite par le mainteneur, hors de portée d'une session d'instance : voir README) : les refus
 * réels sont reconnus et le nom du garde-fou est bien lu dans le message, sans correction nécessaire.
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// 1. Refus d'allowlist — mission/.holarch/sessions/*.result.json (chantier 13, inchangé)
// ---------------------------------------------------------------------------

/** Forme normalisée d'un refus : outil + squelette de la commande (Bash) ou du chemin (Read/Write/Edit). */
function forme(d) {
  const t = d.tool_name || '?';
  const inp = d.tool_input || {};
  if (t === 'Bash') {
    const c = String(inp.command || '').trim();
    const horsGuillemets = c.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/2>&1|2>\/dev\/null|>\/dev\/null/g, '');
    if (/<<-?\s*['"]?\w+['"]?/.test(c) || /(^|[^>])>>?\s*\S/.test(horsGuillemets)) return 'Bash · écriture par redirection (>, >>, heredoc)';
    const tokens = c.replace(/^\s*(cd\s+\S+\s*&&\s*)/, '').split(/\s+/);
    const t0 = tokens[0] || '';
    if (t0 === 'git' && tokens[1] === '-C') return `Bash · git -C <dir> ${tokens[3] || ''}`.trim();
    if (['git', 'node', 'npm', 'npx'].includes(t0)) return `Bash · ${t0} ${(tokens[1] || '').replace(/^.*\//, '')}`.trim();
    if (/\$\(|\$\{|\bfor\b|\bwhile\b|\|\s*xargs/.test(c)) return `Bash · ${t0} (expansion, boucle ou xargs)`;
    return `Bash · ${t0}`;
  }
  const p = String(inp.file_path || inp.path || inp.pattern || '');
  const rel = p.replace(/^\/workspaces\/[^/]+\//, '').replace(/^.*\/mission\/\.holarch\/worktrees\/[^/]+\//, '');
  const zone = rel.split('/').slice(0, 2).join('/');
  return `${t} · ${zone}`;
}

function relever(dir) {
  const fichiers = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.result.json')).sort() : [];
  const parForme = new Map();
  const sessions = [];
  for (const f of fichiers) {
    let r;
    try { r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    const d = Array.isArray(r.permission_denials) ? r.permission_denials : [];
    sessions.push({ fichier: f, refus: d.length, tours: r.num_turns || 0 });
    for (const x of d) {
      const k = forme(x);
      const e = parForme.get(k) || { forme: k, n: 0, sessions: new Set(), exemple: '' };
      e.n += 1; e.sessions.add(f);
      if (!e.exemple) e.exemple = JSON.stringify(x.tool_input).slice(0, 160);
      parForme.set(k, e);
    }
  }
  const formes = [...parForme.values()].map((e) => ({ forme: e.forme, n: e.n, sessions: e.sessions.size, exemple: e.exemple })).sort((a, b) => b.n - a.n);
  const totalRefus = sessions.reduce((a, s) => a + s.refus, 0);
  const totalTours = sessions.reduce((a, s) => a + s.tours, 0);
  return { dir, sessions: sessions.length, totalRefus, totalTours, formes };
}

function formater(r, top) {
  const l = [`[refus d'allowlist — ${r.dir}]`, `${r.sessions} session(s) · ${r.totalTours} tours · ${r.totalRefus} refus (${r.totalTours ? ((100 * r.totalRefus) / r.totalTours).toFixed(1) : '0'} % des tours)`];
  for (const f of r.formes.slice(0, top)) l.push(`${String(f.n).padStart(4)} × ${f.forme}  (${f.sessions} session(s))  ex. ${f.exemple}`);
  if (r.formes.length > top) l.push(`  … ${r.formes.length - top} forme(s) de plus (--top)`);
  return l.join('\n');
}

// ---------------------------------------------------------------------------
// 2. Refus de garde-fou (hooks) — transcriptions .jsonl (chantier 14, docs/IMPLEMENTATION.md §15.5)
// ---------------------------------------------------------------------------

const PREFIXE_GARDE_FOU = '[HOLARCH · garde-fou';

/**
 * Nom du garde-fou depuis le contenu entre crochets : « garde-fou ON_SLEEP 2/3 » → « ON_SLEEP »,
 * « garde-fou git-guard » → « git-guard ». Aucune liste codée en dur : le nom vient du premier mot du
 * message lui-même — un garde-fou qui n'existe pas encore (ex. `path-guard`) sera reconnu dès qu'il
 * écrira un message dans cette forme.
 */
function nomGardeFou(bracket) {
  const m = /^garde-fou\s+(\S+)/.exec(String(bracket || '').trim());
  return m ? m[1] : (String(bracket || '').trim() || '?');
}

/**
 * Cause normalisée d'un message de garde-fou : les segments entre apostrophes inverses (chemin,
 * commande — la partie qui change à chaque appel : `mission/x/STATUS.md`, `git add mission/foo`…) sont
 * remplacés par un espace réservé, puis le texte est coupé au premier « : » isolé — séparateur present
 * dans tous les messages actuels (ON_SLEEP « Avant de terminer : … », git-guard « … en cours : nomme
 * tes fichiers… », framework-guard « … pas ta production) : travaille sous… ») entre le constat (stable
 * d'un appel à l'autre) et la consigne de correction (parfois variable). Deux refus de même nature avec
 * un chemin différent retombent ainsi dans la même cause.
 */
function causeMessage(msg) {
  const sansVariable = String(msg || '').replace(/`[^`]*`/g, '‹…›').replace(/\s+/g, ' ').trim();
  const avant = sansVariable.split(/\s:\s/)[0];
  return avant || sansVariable;
}

/** « [HOLARCH · garde-fou XXX] … » → { nom, cause, message } ; null si le texte ne correspond pas au préfixe. */
function analyserMessageGardeFou(texte) {
  const m = /^\[HOLARCH · (garde-fou [^\]]+)\]\s*([\s\S]*)$/.exec(String(texte || ''));
  if (!m) return null;
  return { nom: nomGardeFou(m[1]), cause: causeMessage(m[2]), message: m[2].trim() };
}

/**
 * Tous les messages de garde-fou trouvés dans une valeur JSON déjà parsée (une ligne de transcription) —
 * parcours générique de toutes les chaînes de l'objet, jamais un seul chemin de champ codé en dur (voir
 * la note de limite en tête de fichier). Un même texte trouvé plusieurs fois DANS LA MÊME LIGNE n'est
 * retourné qu'une fois (dédoublonné) : on compte des refus, pas des occurrences de sérialisation interne.
 */
function messagesGardeFouDansLigne(objet) {
  const vus = new Set();
  const pile = [objet];
  while (pile.length) {
    const v = pile.pop();
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') { if (v.startsWith(PREFIXE_GARDE_FOU)) vus.add(v); continue; }
    if (Array.isArray(v)) { for (const x of v) pile.push(x); continue; }
    if (typeof v === 'object') { for (const k of Object.keys(v)) pile.push(v[k]); }
  }
  return [...vus];
}

/**
 * Liste les fichiers `.jsonl` d'un dossier de transcriptions — même convention que
 * `tools/holarch-bench/bench.js::sessionsMdDepuisTranscriptions` : un fichier `<id>.jsonl` directement
 * sous `dossier`, ou un sous-dossier `<id>/` contenant un `.jsonl` (racine ou `subagents/*.jsonl` — un
 * sous-agent peut heurter un garde-fou comme la session qui l'a lancé). Nom de session = chemin relatif
 * sans l'extension.
 */
function listerJsonl(dossier) {
  const fichiers = [];
  const visiter = (dir, rel) => {
    let entrees;
    try { entrees = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entrees) {
      const p = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) visiter(p, r);
      else if (e.name.endsWith('.jsonl')) fichiers.push({ chemin: p, session: r.replace(/\.jsonl$/, '') });
    }
  };
  visiter(dossier, '');
  return fichiers.sort((a, b) => a.session.localeCompare(b.session));
}

/** Ventile les refus de garde-fou (hooks) d'un dossier de transcriptions `.jsonl` par garde-fou et par cause. */
function releverHooks(dossier) {
  const fichiers = fs.existsSync(dossier) ? listerJsonl(dossier) : [];
  const parCle = new Map(); // "<nom> · <cause>" -> { nom, cause, n, sessions:Set, exemple }
  const sessions = [];
  let total = 0;
  for (const f of fichiers) {
    let texte;
    try { texte = fs.readFileSync(f.chemin, 'utf8'); } catch (_) { continue; }
    let nRefusSession = 0;
    for (const ligne of texte.split('\n')) {
      if (!ligne.includes(PREFIXE_GARDE_FOU)) continue; // filtre rapide avant JSON.parse
      let obj;
      try { obj = JSON.parse(ligne); } catch (_) { continue; }
      for (const msg of messagesGardeFouDansLigne(obj)) {
        const a = analyserMessageGardeFou(msg);
        if (!a) continue;
        const cle = `${a.nom} · ${a.cause}`;
        const e = parCle.get(cle) || { nom: a.nom, cause: a.cause, n: 0, sessions: new Set(), exemple: '' };
        e.n += 1; e.sessions.add(f.session);
        if (!e.exemple) e.exemple = a.message.slice(0, 160);
        parCle.set(cle, e);
        nRefusSession += 1; total += 1;
      }
    }
    sessions.push({ session: f.session, refus: nRefusSession });
  }
  const formes = [...parCle.values()]
    .map((e) => ({ nom: e.nom, cause: e.cause, n: e.n, sessions: e.sessions.size, exemple: e.exemple }))
    .sort((a, b) => b.n - a.n);
  const parGardeFou = new Map();
  for (const f of formes) parGardeFou.set(f.nom, (parGardeFou.get(f.nom) || 0) + f.n);
  return {
    dossier,
    sessions,
    totalRefus: total,
    parGardeFou: [...parGardeFou.entries()].map(([nom, n]) => ({ nom, n })).sort((a, b) => b.n - a.n),
    formes,
  };
}

function formaterHooks(r, top) {
  const l = [`[refus de garde-fou (hooks) — ${r.dossier}]`, `${r.sessions.length} session(s)/transcription(s) · ${r.totalRefus} refus`];
  for (const g of r.parGardeFou) l.push(`  ${String(g.n).padStart(4)} × garde-fou ${g.nom}`);
  for (const f of r.formes.slice(0, top)) l.push(`${String(f.n).padStart(4)} × ${f.nom} · ${f.cause}  (${f.sessions} session(s))  ex. ${f.exemple}`);
  if (r.formes.length > top) l.push(`  … ${r.formes.length - top} forme(s) de plus (--top)`);
  return l.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return [
    'Usage :',
    '  node tools/holarch-session/refus.js [--root <dir>] [--dir <sessions>] [--json] [--top <n>]',
    '  node tools/holarch-session/refus.js --transcriptions <dossier-de-*.jsonl> [--json] [--top <n>]',
    '  node tools/holarch-session/refus.js --help',
    '',
    '`--transcriptions` seul ne relève que les refus de garde-fou du dossier donné : les deux mesures',
    'portent en général sur deux missions différentes, les mêler dans une seule sortie induit en erreur.',
    'Ajoute `--dir <sessions>` (ou `--root <dir>`) pour obtenir aussi le bloc « refus d\'allowlist ».',
  ].join('\n');
}

function main(argv) {
  let root = process.cwd(); let dir = null; let json = false; let top = 15; let transcriptions = null; let help = false;
  let sourceAllowlistExplicite = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') { root = argv[++i]; sourceAllowlistExplicite = true; }
    else if (argv[i] === '--dir') { dir = argv[++i]; sourceAllowlistExplicite = true; }
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '--top') top = Number(argv[++i]) || 15;
    else if (argv[i] === '--transcriptions') transcriptions = argv[++i];
    else if (argv[i] === '--help' || argv[i] === '-h') help = true;
  }
  if (help) { process.stdout.write(`${usage()}\n`); return; }

  // `--transcriptions` seul : le bloc allowlist de la mission *courante* n'a rien à voir avec les
  // transcriptions demandées (deux missions distinctes) — on ne le relève que si sa source est demandée.
  const avecAllowlist = !transcriptions || sourceAllowlistExplicite;
  const rAllowlist = avecAllowlist ? relever(dir || path.join(root, 'mission', '.holarch', 'sessions')) : null;
  const rHooks = transcriptions ? releverHooks(transcriptions) : null;

  if (json) {
    const sortie = rHooks ? (rAllowlist ? { allowlist: rAllowlist, hooks: rHooks } : { hooks: rHooks }) : rAllowlist;
    process.stdout.write(`${JSON.stringify(sortie, null, 2)}\n`);
    return;
  }
  if (rAllowlist) process.stdout.write(`${formater(rAllowlist, top)}\n`);
  if (rHooks) process.stdout.write(`${rAllowlist ? '\n' : ''}${formaterHooks(rHooks, top)}\n`);
}

module.exports = {
  forme, relever, formater,
  nomGardeFou, causeMessage, analyserMessageGardeFou, messagesGardeFouDansLigne, listerJsonl, releverHooks, formaterHooks,
};
if (require.main === module) main(process.argv.slice(2));
