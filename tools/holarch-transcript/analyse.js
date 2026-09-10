#!/usr/bin/env node
'use strict';
/**
 * analyse.js — lecture d'une transcription Claude Code (`~/.claude/projects/<slug>/<session-id>.jsonl`) :
 * contexte réel à chaque tour (entrée + cache lu + cache écrit, exactement ce que lit le hook
 * `context-watch`), appels d'outils et taille de leurs résultats, compactions automatiques.
 *
 * C'est l'outil du diagnostic `docs/diagnostics/2026-09-09-contexte-fixe-au-reveil.md` : il répond à
 * « qu'est-ce qui a fait grossir le contexte, et quand » sans estimation.
 *
 * Usage :
 *   node tools/holarch-transcript/analyse.js <session-id | fichier.jsonl> [...] [--json] [--projet <slug>]
 *   Les identifiants de session viennent de mission/registry/SESSIONS.md (colonne Session).
 *   <slug> : nom du répertoire sous ~/.claude/projects/ ; par défaut, dérivé de la racine du dépôt
 *   courant (`/workspaces/holon` → `-workspaces-holon`).
 * Aucune dépendance, aucun réseau, lecture seule.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const court = (s, n) => String(s || '').replace(/\s+/g, ' ').slice(0, n);

/** Slug Claude Code d'un répertoire de projet : chaque caractère hors [A-Za-z0-9] devient « - ». */
function slugProjet(dir) {
  return path.resolve(dir).replace(/[^A-Za-z0-9]/g, '-');
}

/** Chemin de la transcription d'une session : un fichier .jsonl tel quel, sinon <projets>/<slug>/<id>.jsonl. */
function cheminTranscription(idOuFichier, { slug, projets } = {}) {
  if (/\.jsonl$/.test(idOuFichier)) return path.resolve(idOuFichier);
  const base = projets || path.join(os.homedir(), '.claude', 'projects');
  return path.join(base, slug || slugProjet(process.cwd()), `${idOuFichier}.jsonl`);
}

/**
 * Analyse les lignes JSON d'une transcription.
 * @param {string[]} lignes — une entrée JSON par ligne (les lignes illisibles sont ignorées)
 * @returns {{promptInitialChars: number|null, tours: Array, compactions: Array, hooks: number}}
 *   tour : {tour, contexte, entree, cacheLu, cacheEcrit, sortie, outils: string[], resultats: [{outil, chars, debut}]}
 */
function analyser(lignes) {
  const objets = lignes.map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  const res = { promptInitialChars: null, tours: [], compactions: [], hooks: 0 };
  const enAttente = new Map(); // tool_use_id → description
  let resultatsDepuis = [];
  for (const o of objets) {
    if (o.type === 'system' && o.subtype === 'compact_boundary') {
      const m = o.compactMetadata || {};
      res.compactions.push({ apresTour: res.tours.length, declencheur: m.trigger || '?', avant: m.preTokens || null, apres: m.postTokens || null });
      continue;
    }
    if (o.type === 'user' && o.message) {
      const c = o.message.content;
      if (typeof c === 'string') { if (res.promptInitialChars === null) res.promptInitialChars = c.length; continue; }
      if (!Array.isArray(c)) continue;
      for (const part of c) {
        if (part.type === 'text' && res.promptInitialChars === null) res.promptInitialChars = part.text.length;
        if (part.type === 'tool_result') {
          const txt = typeof part.content === 'string' ? part.content : Array.isArray(part.content) ? part.content.map((x) => x.text || '').join('') : '';
          resultatsDepuis.push({ outil: enAttente.get(part.tool_use_id) || '?', chars: txt.length, debut: court(txt, 80) });
        }
      }
      continue;
    }
    if (o.type === 'assistant' && o.message) {
      const u = o.message.usage || {};
      const outils = [];
      for (const part of o.message.content || []) {
        if (part.type !== 'tool_use') continue;
        const inp = part.input || {};
        const d = `${part.name}(${court(inp.file_path || inp.command || inp.pattern || inp.prompt || JSON.stringify(inp), 100)})`;
        enAttente.set(part.id, d);
        outils.push(d);
      }
      res.tours.push({
        tour: res.tours.length + 1,
        contexte: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        entree: u.input_tokens || 0,
        cacheLu: u.cache_read_input_tokens || 0,
        cacheEcrit: u.cache_creation_input_tokens || 0,
        sortie: u.output_tokens || 0,
        outils,
        resultats: resultatsDepuis,
      });
      resultatsDepuis = [];
      continue;
    }
    if (o.type === 'hook_additional_context' || (typeof o.content === 'string' && o.content.includes('budget de contexte'))) res.hooks += 1;
  }
  return res;
}

/** Rendu texte lisible : une ligne par tour, résultats d'outils en retrait. */
function formater(id, a) {
  const out = [`### session ${id}`];
  if (a.promptInitialChars !== null) out.push(`prompt utilisateur initial : ${a.promptInitialChars} caractères`);
  const pic = a.tours.reduce((m, t) => Math.max(m, t.contexte), 0);
  for (const t of a.tours) {
    for (const r of t.resultats) out.push(`      ← résultat ${String(r.chars).padStart(7)} c  ${r.outil}  « ${r.debut} »`);
    out.push(`tour ${String(t.tour).padStart(2)}  contexte=${String(t.contexte).padStart(7)}  (entrée ${t.entree} / cache lu ${t.cacheLu} / cache écrit ${t.cacheEcrit} / sortie ${t.sortie})  ${t.outils.join(' ; ')}`);
    const c = a.compactions.find((x) => x.apresTour === t.tour);
    if (c) out.push(`      ⟲ compaction ${c.declencheur} : ${c.avant} → ${c.apres} tokens`);
  }
  out.push(`pic de contexte : ${pic} tokens · ${a.tours.length} tour(s) · ${a.compactions.length} compaction(s)`);
  return out.join('\n');
}

function main(argv) {
  const o = { ids: [], json: false, slug: '' };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--json') o.json = true;
    else if (x === '--projet') o.slug = argv[++i];
    else if (x === '-h' || x === '--help' || x.startsWith('-')) { process.stdout.write('Usage : node tools/holarch-transcript/analyse.js <session-id | fichier.jsonl> [...] [--json] [--projet <slug>]\n'); process.exit(x === '-h' || x === '--help' ? 0 : 2); }
    else o.ids.push(x);
  }
  if (!o.ids.length) { process.stderr.write('aucun identifiant de session ni fichier .jsonl\n'); process.exit(2); }
  const tout = {};
  for (const id of o.ids) {
    const f = cheminTranscription(id, { slug: o.slug });
    if (!fs.existsSync(f)) { process.stderr.write(`transcription absente : ${f}\n`); process.exitCode = 1; continue; }
    const a = analyser(fs.readFileSync(f, 'utf8').split('\n').filter(Boolean));
    tout[id] = a;
    if (!o.json) process.stdout.write(`${formater(id, a)}\n\n`);
  }
  if (o.json) process.stdout.write(`${JSON.stringify(tout, null, 2)}\n`);
}

module.exports = { analyser, formater, slugProjet, cheminTranscription };
if (require.main === module) main(process.argv.slice(2));
