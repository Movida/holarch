#!/usr/bin/env node
'use strict';
/**
 * observe.js — voir une mission HOLARCH avancer, sans LLM et sans rien écrire.
 *
 *   node tools/holarch-observe/observe.js                 # un instantané texte, puis sort
 *   node tools/holarch-observe/observe.js --json          # le même instantané en JSON (pour un script ou un skill)
 *   node tools/holarch-observe/observe.js --watch         # écran rafraîchi à chaque changement (inotify) et toutes les 5 s
 *   node tools/holarch-observe/observe.js --evenements    # une ligne horodatée par changement d'état (pour un Monitor)
 *   options : --root <dir>  --intervalle <s> (scrutation, défaut 5)  --sans-effacer (--watch sans effacer l'écran)
 *
 * L'affichage ne fait jamais partie du harnais : s'il tombe, rien ne change pour la mission.
 * Collecte : ./collecte.js (lecture seule, ≈ 0,2 s). Diagnostic : docs/diagnostics/2026-09-11-visualisation-temps-reel.md.
 */
const fs = require('fs');
const path = require('path');
const { collecter, findRoot } = require('./collecte.js');

function k(n) { return n == null ? '?' : `${Math.round(n / 1000)}k`; }
function usd(n) { return n == null ? '?' : n.toFixed(2); }
function court(s, n) { s = String(s || ''); return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
function pad(s, n) { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); }

/** Instantané → texte (≤ 40 lignes pour une mission à quelques instances). */
function formater(e, opts) {
  const l = [];
  const o = opts || {};
  l.push(`HOLARCH · mission ${e.mission.nom || '(sans nom)'} · ${e.horodatage.slice(11, 19)} UTC · arbre ${e.git.branche} @${e.git.head} · ${e.git.worktrees.length} worktree(s)${o.mode ? ` · ${o.mode}` : ''}`);
  if (!e.mission.ouverte) { l.push('aucune mission ouverte (mission/OBJECTIVE.md absent)'); return l.join('\n'); }
  l.push('Instances (état effectif = STATUS du worktree ⊕ verrou ⊕ processus)');
  if (!e.instances.length) l.push('  aucune instance incarnée (mission non démarrée : npm run bootstrap)');
  for (const i of e.instances) {
    const nom = '  '.repeat(i.profondeur) + (i.chemin.includes('/') ? i.chemin.split('/').pop() : i.chemin);
    const s = i.sessions;
    const bilan = `U ${i.unitesPass}/${i.unites.length} · ${i.git.commits} commit(s) · ${s.n} session(s) ${usd(s.usd)} USD${i.messages.aRepondre ? ` · ${i.messages.aRepondre} à répondre` : ''}`;
    l.push(`${pad(nom, 34)} ${pad(i.effectif, 74)} ${bilan}`);
    if (i.note && !/session vivante/.test(i.effectif)) l.push(`${' '.repeat(36)}note : ${court(i.note, 100)}`);
  }
  const vivantes = e.instances.filter((i) => i.live.vivant);
  if (vivantes.length) {
    l.push(`Sessions vivantes : ${vivantes.map((i) => `${i.chemin} ${i.contexte ? i.contexte.session.slice(0, 8) : '?'} contexte ${i.transcription ? k(i.transcription.contexte) : (i.contexte ? `~${k(i.contexte.dernier)}` : '?')}${i.contexte ? ` (hook ${i.contexte.toursHook} appels, départ ${k(i.contexte.depart)})` : ''}`).join(' ; ')} · seuil ${k(e.mission.seuilContexteTokens)}`);
  } else l.push('Sessions vivantes : aucune');
  const t = e.sessions.total;
  const par = Object.entries(e.sessions.parInstance).map(([c, v]) => `${c} ${v.n}×/${usd(v.usd)}`).join(', ');
  l.push(`Coût (SESSIONS.md, tarif liste) : ${t.n} session(s), ${t.tours} tours, ${usd(t.usd)} USD${par ? ` — ${par}` : ''}${e.sessions.sansResultat ? ` · ${e.sessions.sansResultat} sans résultat JSON` : ''}${e.transcriptions.sansJournal.length ? ` · ${e.transcriptions.sansJournal.length} session(s) sans journal (${e.transcriptions.sansJournal.map((x) => `${x.chemin} ${x.tours} tours`).join(', ')})` : ''}`);
  if (e.taches.length) l.push(`Tâches détachées : ${e.taches.slice(-5).map((x) => `${x.id} ${x.state}${x.state === 'running' ? (x.vivant ? ' (pid vivant)' : ' (PID MORT)') : ''}${x.arretLanceur ? ' ARRÊT' : ''}`).join(' ; ')}`);
  const pm = e.messagesPourMainteneur.filter((m) => !m.repondu);
  l.push(`Messages : pour le mainteneur ${pm.length ? pm.map((m) => `${m.type} ${m.id} de ${m.from} (${m.date.slice(0, 16)})`).join(' ; ') : 'aucun'} · sans réponse entre instances ${e.messagesSansReponse.length}${e.reveils.length ? ` · dernier réveil ${e.reveils[e.reveils.length - 1].chemin} ${e.reveils[e.reveils.length - 1].date.slice(0, 16)}` : ''}`);
  const g = e.git;
  l.push(`Git : ${g.nonCommittes.length ? `${g.nonCommittes.length} non committé(s) (${g.fichiersInstance.length} d'instance, ${g.fichiersLanceur.length} du lanceur, ${g.fichiersMaintenance.length} hors mission/)` : 'arbre principal propre'}${g.worktrees.length ? ` · worktrees : ${g.worktrees.map((w) => `${path.basename(w.chemin)} @${w.head}`).join(', ')}` : ''}${g.ecartHolonV2 ? ` · holon-v2/main : +${g.ecartHolonV2.avance}/-${g.ecartHolonV2.retard}` : ''}`);
  const al = e.anomalies.filter((a) => a.niveau === 'alerte');
  const inf = e.anomalies.filter((a) => a.niveau !== 'alerte');
  l.push(`Anomalies : ${al.length} alerte(s), ${inf.length} info(s)`);
  for (const a of al) l.push(`  ⚠ ${a.chemin ? `${a.chemin} · ` : ''}${court(a.texte, 150)}`);
  for (const a of inf.slice(0, 8)) l.push(`  ℹ ${a.chemin ? `${a.chemin} · ` : ''}${court(a.texte, 150)}`);
  if (inf.length > 8) l.push(`  … ${inf.length - 8} info(s) de plus (--json)`);
  return l.join('\n');
}

/** Résumé stable d'un instantané (sans horloge ni compteurs qui bougent à chaque tour) : une ligne par fait. */
function resumer(e) {
  const l = [];
  l.push(`arbre ${e.git.branche}`);
  for (const i of e.instances) l.push(`${i.chemin} ${i.effectif.replace(/\(pid \d+(, \d+ min)?, [^)]*\)/, '').replace(/\s+·\s*$/, '').trim()} U${i.unitesPass}/${i.unites.length} c${i.git.commits}${i.note ? ` note:${court(i.note, 60)}` : ''}`);
  l.push(`sessions ${e.sessions.total.n} ${usd(e.sessions.total.usd)} USD`);
  for (const t of e.taches) l.push(`tâche ${t.id} ${t.state}${t.arretLanceur ? ' ARRÊT' : ''}`);
  for (const m of e.messagesPourMainteneur) l.push(`mainteneur ${m.type} ${m.id}${m.repondu ? ' (répondu)' : ''}`);
  for (const m of e.messagesSansReponse) l.push(`sans réponse ${m.type} ${m.id} → ${m.to}`);
  for (const r of e.reveils) l.push(`réveil ${r.date} ${r.chemin}`);
  for (const a of e.anomalies) l.push(`${a.niveau === 'alerte' ? '⚠' : 'ℹ'} ${a.code} ${a.chemin}`);
  return l;
}

/** Lignes apparues / disparues entre deux résumés. */
function difference(avant, apres) {
  const a = new Set(avant); const b = new Set(apres);
  return { ajoutees: apres.filter((x) => !a.has(x)), retirees: avant.filter((x) => !b.has(x)) };
}

/** Dossiers à surveiller pour cet instantané (liste refaite à chaque collecte : un worktree neuf est pris en compte). */
function dossiersAObserver(root, e) {
  const out = new Set();
  const m = path.join(root, 'mission');
  for (const rel of ['', 'registry', 'registry/instances', '.holarch', '.holarch/live', '.holarch/tasks', '.holarch/stop', '.holarch/worktrees']) out.add(path.join(m, rel));
  for (const i of e.instances) { out.add(path.join(m, i.chemin)); out.add(path.join(m, i.chemin, 'memoire')); }
  for (const w of e.git.worktrees) {
    for (const rel of ['registry', '.holarch/live']) out.add(path.join(w.chemin, 'mission', rel));
    for (const i of e.instances) if (i.git.worktree === w.chemin) { out.add(path.join(w.chemin, 'mission', i.chemin)); out.add(path.join(w.chemin, 'mission', i.chemin, 'memoire')); }
  }
  for (const rel of ['', 'refs/heads', 'refs/heads/holarch']) out.add(path.join(root, '.git', rel));
  for (const t of e.transcriptions.vivantes) out.add(path.dirname(t.fichier));
  return [...out];
}

function parseArgs(argv) {
  const o = { root: null, json: false, watch: false, evenements: false, intervalle: 5, effacer: true, aide: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') o.root = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--watch') o.watch = true;
    else if (a === '--evenements') o.evenements = true;
    else if (a === '--intervalle') o.intervalle = Math.max(1, Number(argv[++i]) || 5);
    else if (a === '--sans-effacer') o.effacer = false;
    else if (a === '--une-fois') { o.watch = false; o.evenements = false; }
    else if (a === '--aide' || a === '-h' || a === '--help') o.aide = true;
  }
  return o;
}

function boucle(root, o, sortie) {
  const watchers = new Map();
  let minuterie = null;
  let dernierResume = null;
  let enCours = false;
  const rafraichir = () => {
    if (enCours) return;
    enCours = true;
    let e;
    try { e = collecter(root); } catch (err) { sortie(`[observe] collecte impossible : ${err.message}`); enCours = false; return; }
    if (o.evenements) {
      const r = resumer(e);
      if (dernierResume === null) { sortie(`${e.horodatage.slice(11, 19)} état initial\n  ${r.join('\n  ')}`); }
      else { const dlt = difference(dernierResume, r); if (dlt.ajoutees.length || dlt.retirees.length) sortie(`${e.horodatage.slice(11, 19)}${dlt.ajoutees.map((x) => `\n  + ${x}`).join('')}${dlt.retirees.map((x) => `\n  - ${x}`).join('')}`); }
      dernierResume = r;
    } else {
      sortie(`${o.effacer ? '\x1b[2J\x1b[3J\x1b[H' : '\n'}${formater(e, { mode: `--watch (inotify + scrutation ${o.intervalle} s, Ctrl-C pour sortir)` })}`);
    }
    // (ré)armer les observateurs sur les dossiers de cet instantané
    const voulus = new Set(dossiersAObserver(root, e));
    for (const [dir, w] of watchers) if (!voulus.has(dir)) { try { w.close(); } catch (_) { /* ignore */ } watchers.delete(dir); }
    for (const dir of voulus) {
      if (watchers.has(dir) || !fs.existsSync(dir)) continue;
      try { const w = fs.watch(dir, () => planifier()); w.on('error', () => { try { w.close(); } catch (_) { /* ignore */ } watchers.delete(dir); }); watchers.set(dir, w); } catch (_) { /* dossier disparu entre-temps */ }
    }
    enCours = false;
  };
  const planifier = () => { if (minuterie) clearTimeout(minuterie); minuterie = setTimeout(rafraichir, 400); };
  rafraichir();
  const tick = setInterval(rafraichir, o.intervalle * 1000);
  const arret = () => { clearInterval(tick); for (const w of watchers.values()) { try { w.close(); } catch (_) { /* ignore */ } } process.exit(0); };
  process.on('SIGINT', arret); process.on('SIGTERM', arret);
}

function main(argv) {
  const o = parseArgs(argv);
  if (o.aide) { process.stdout.write(fs.readFileSync(__filename, 'utf8').split('\n').slice(3, 12).map((l) => l.replace(/^ \* ?/, '')).join('\n') + '\n'); return 0; }
  const root = o.root ? findRoot(o.root) : findRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) { process.stderr.write('racine introuvable (framework/KERNEL.md) — --root <dir>\n'); return 1; }
  if (o.watch || o.evenements) { boucle(root, o, (s) => process.stdout.write(`${s}\n`)); return null; }
  const e = collecter(root);
  process.stdout.write(o.json ? `${JSON.stringify(e, null, 2)}\n` : `${formater(e)}\n`);
  return 0;
}

module.exports = { formater, resumer, difference, dossiersAObserver, parseArgs, main };

if (require.main === module) { const code = main(process.argv.slice(2)); if (code !== null) process.exit(code); }
