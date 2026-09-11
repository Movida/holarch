#!/usr/bin/env node
'use strict';
/**
 * refus.js — relevé des appels d'outil refusés par l'allowlist des instances (mesure avant réglage).
 *
 * Chaque session `claude -p` lancée par le lanceur laisse `mission/.holarch/sessions/<instance>-<date>-N.result.json`
 * avec `permission_denials: [{tool_name, tool_input}]`. Un refus coûte un tour entier à l'instance (2026-09-11 :
 * 5 à 7 refus par session sur holarch-fournisseurs, soit ~60 tours sur la mission). Ce script agrège les refus par
 * outil et par forme de commande, avec un exemple, pour décider ce qui mérite d'entrer dans l'allowlist
 * (`framework/claude/instance-settings.json`) et ce qui doit rester un refus (écriture par redirection Bash, etc.).
 *
 * Usage : node tools/holarch-session/refus.js [--root <dir>] [--dir <sessions>] [--json] [--top <n>]
 * Lecture seule, aucune dépendance, aucun réseau.
 */
const fs = require('fs');
const path = require('path');

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

function main(argv) {
  let root = process.cwd(); let dir = null; let json = false; let top = 15;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root') root = argv[++i];
    else if (argv[i] === '--dir') dir = argv[++i];
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '--top') top = Number(argv[++i]) || 15;
  }
  const r = relever(dir || path.join(root, 'mission', '.holarch', 'sessions'));
  process.stdout.write(json ? `${JSON.stringify(r, null, 2)}\n` : `${formater(r, top)}\n`);
}

module.exports = { forme, relever, formater };
if (require.main === module) main(process.argv.slice(2));
