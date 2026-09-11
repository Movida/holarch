#!/usr/bin/env node
'use strict';
/**
 * etat.js — état du dépôt en une commande, pour une session de maintenance (hors holarchie).
 *
 * Remplace la check-list manuelle de docs/ENVIRONNEMENT.md §11 : branche et fichiers non committés,
 * processus de mission en cours, derniers commits, organigramme et état de la racine, dernières
 * sessions journalisées, authentification gh, versions, remotes.
 *
 * Usage :
 *   node tools/holarch-session/etat.js            # texte complet
 *   node tools/holarch-session/etat.js --bref     # une dizaine de lignes
 *   node tools/holarch-session/etat.js --hook     # hook SessionStart : JSON additionalContext (version brève),
 *                                                 # inerte ({}) dans une session d'instance (HOLARCH_INSTANCE posée)
 * Aucune dépendance, aucun réseau (l'authentification gh est lue dans hosts.yml, pas vérifiée en ligne).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function readIf(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 8000 }, opts || {}));
  return r.status === 0 ? String(r.stdout || '').trim() : null;
}

/** Racine du dépôt : remonte jusqu'à framework/KERNEL.md. */
function findRoot(start) {
  let d = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(d, 'framework', 'KERNEL.md'))) return d;
    const p = path.dirname(d);
    if (p === d) break;
    d = p;
  }
  return null;
}

/** Processus de mission (lanceur et sessions `claude -p`), jamais la session interactive. */
function processusMission(psText) {
  const lignes = String(psText || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lignes
    .filter((l) => /holarch-spawn\.js|claude -p\b/.test(l) && !/--replay-user-messages/.test(l) && !/grep/.test(l))
    .map((l) => { const m = l.match(/^(\d+)\s+(.*)$/); return m ? { pid: Number(m[1]), commande: m[2].slice(0, 90) } : null; })
    .filter(Boolean);
}

/** Collecte pure : toutes les entrées/sorties passent par `deps` (surchargeables dans les tests). */
function collecter(root, deps) {
  const d = Object.assign({
    git: (args) => run('git', ['-C', root, ...args]),
    ps: () => run('ps', ['-eo', 'pid,args']) || '',
    hostsYml: () => readIf(path.join(os.homedir(), '.config', 'gh', 'hosts.yml')),
    versionClaude: () => run('claude', ['--version']),
    versionNode: () => process.version,
    lire: (rel) => readIf(path.join(root, rel)),
  }, deps || {});
  const e = { root };
  e.branche = d.git(['branch', '--show-current']) || '(détachée)';
  const status = d.git(['status', '--short', '--untracked-files=all']) || '';
  // `run` retire les blancs de tête : la première ligne de `git status --short` peut avoir perdu son espace initial.
  e.nonCommittes = status.split('\n').filter(Boolean).map((l) => l.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim());
  e.fichiersInstance = e.nonCommittes.filter((f) => /^mission\/(?!OBJECTIVE\.md$)/.test(f));
  e.commits = (d.git(['log', '--oneline', '-5']) || '').split('\n').filter(Boolean).map((l) => l.slice(0, 100));
  e.remotes = (d.git(['remote', '-v']) || '').split('\n').filter((l) => /\(push\)/.test(l)).map((l) => l.split(/\s+/).slice(0, 2).join(' '));
  e.processus = processusMission(d.ps());
  const cfg = d.lire('framework/CONFIG.md') || '';
  const m = cfg.match(/^#\s*Configuration\s*[—-]+\s*mission\s*:\s*(.+)$/m);
  e.mission = m ? m[1].trim() : '(CONFIG.md sans nom)';
  // Après un archivage, mission/ n'existe plus mais CONFIG.md porte encore le nom de la mission archivée (2026-09-11).
  e.missionAbsente = d.lire('mission/OBJECTIVE.md') === null && d.lire('mission/concepteur/STATUS.md') === null;
  const parseStatus = (t) => { const s = { etat: '', note: '' }; if (!t) return s; const a = t.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m); if (a) s.etat = a[1]; const n = t.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m); if (n) s.note = n[1]; return s; };
  e.racine = parseStatus(d.lire('mission/concepteur/STATUS.md'));
  e.enfants = [];
  try {
    for (const nom of fs.readdirSync(path.join(root, 'mission', 'concepteur'), { withFileTypes: true })) {
      if (!nom.isDirectory() || nom.name === 'workspace' || nom.name === 'memoire') continue;
      const st = parseStatus(d.lire(`mission/concepteur/${nom.name}/STATUS.md`));
      if (st.etat) e.enfants.push({ nom: nom.name, etat: st.etat });
    }
  } catch (_) { /* pas de racine incarnée */ }
  const sessions = d.lire('mission/registry/SESSIONS.md');
  e.sessions = sessions ? sessions.split('\n').filter((l) => /^\| 20/.test(l)).slice(-3).map((l) => { const c = l.split('|').map((x) => x.trim()); return `${c[1].slice(0, 16)} ${c[2]} ${c[10] || ''} ${c[7]} USD ${c[5]} tours`; }) : [];
  const hosts = d.hostsYml();
  const u = hosts && hosts.match(/user:\s*(\S+)/);
  e.gh = hosts ? (u ? `authentifié (${u[1]})` : 'authentifié') : 'non authentifié — gh auth login --web';
  e.versions = { claude: d.versionClaude() || '?', node: d.versionNode(), framework: (d.lire('framework/VERSION') || '?').trim() };
  return e;
}

function formater(e, bref) {
  const l = [];
  l.push(`[HOLARCH · état du dépôt — tools/holarch-session/etat.js]`);
  const nc = e.nonCommittes.length;
  l.push(`branche ${e.branche} · ${nc ? `${nc} fichier(s) non committé(s)${e.fichiersInstance.length ? ` dont ${e.fichiersInstance.length} d'instance (à laisser à l'instance)` : ''}` : 'arbre propre'}`);
  if (nc && !bref) for (const f of e.nonCommittes.slice(0, 10)) l.push(`  · ${f}`);
  const racine = e.racine.etat ? `concepteur ${e.racine.etat}${e.racine.note ? ` (${e.racine.note.slice(0, 60)})` : ''}` : 'aucune racine incarnée (mission non démarrée)';
  const enfants = e.enfants.length ? ` · enfants : ${e.enfants.map((x) => `${x.nom} ${x.etat}`).join(', ')}` : '';
  l.push(e.missionAbsente ? `aucune mission ouverte (mission/ absent ; CONFIG.md porte encore le nom « ${e.mission} », à réécrire à l'ouverture de la prochaine)` : `mission ${e.mission} : ${racine}${enfants}`);
  l.push(e.processus.length ? `⚠ ${e.processus.length} processus de mission en cours : ${e.processus.map((p) => `${p.pid} ${p.commande.split(' ').slice(0, 4).join(' ')}`).join(' ; ')} — ne pas toucher mission/ ni changer de branche (skill holarch-pause)` : 'aucune session de mission en cours');
  l.push(`derniers commits : ${e.commits.map((c) => (bref ? c.slice(0, 60) : c)).join(' · ')}`);
  if (e.sessions.length) l.push(`dernières sessions : ${e.sessions.join(' · ')}`);
  l.push(`framework v${e.versions.framework} · gh ${e.gh} · Claude Code ${e.versions.claude.replace(/\s*\(Claude Code\)/, '')} · Node ${e.versions.node} · remotes : ${e.remotes.join(', ') || 'aucun'}`);
  l.push(`règles : docs/ENVIRONNEMENT.md (§7 réservé au mainteneur, §12 fichiers transverses) · scripts : npm run etat | lint | test | dry-run | mission -- <chemin> | upgrade | publish-template -- --out <dir>`);
  return l.join('\n');
}

function main(argv) {
  const hook = argv.includes('--hook');
  const bref = hook || argv.includes('--bref');
  if (hook && process.env.HOLARCH_INSTANCE) { process.stdout.write('{}'); return; } // instance : inerte
  const root = findRoot(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (!root) { if (hook) process.stdout.write('{}'); else process.stderr.write('racine introuvable (framework/KERNEL.md)\n'); return; }
  let texte;
  try { texte = formater(collecter(root), bref); } catch (e) { if (hook) { process.stdout.write('{}'); return; } throw e; }
  if (hook) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: texte } }));
  else process.stdout.write(`${texte}\n`);
}

module.exports = { collecter, formater, processusMission, findRoot };
if (require.main === module) main(process.argv.slice(2));
