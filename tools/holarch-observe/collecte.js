#!/usr/bin/env node
'use strict';
/**
 * collecte.js — instantané de l'état d'une mission HOLARCH en cours : lecture seule, sans LLM.
 *
 * Réconcilie ce que quatre acteurs écrivent à des moments différents (instance, parent, lanceur, hooks)
 * en un seul objet JSON : instances avec leur état *effectif* (STATUS du worktree ⊕ verrou `live/` ⊕
 * processus ⊕ tâche), sessions vivantes et leur contexte, coût cumulé (registry/SESSIONS.md), unités
 * closes et commits, messages qui attendent le mainteneur, Git par instance, anomalies nommées.
 * Diagnostic d'origine : docs/diagnostics/2026-09-11-visualisation-temps-reel.md (§3 pour les sources).
 *
 * Règles : aucune écriture (ni sous mission/, ni ailleurs) ; toute source absente ou illisible donne
 * une valeur vide, jamais une exception ; toutes les entrées/sorties passent par `deps`, surchargeables
 * dans les tests (HOLARCH_OBSERVE_PS et HOLARCH_OBSERVE_TRANSCRIPTS pour l'exécutable).
 *
 * Usage en module : const { collecter } = require('./collecte'); const etat = collecter(root);
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const reveil = require('../../framework/bin/reveil.js');
const messageLint = require('../message-lint/message-lint.js');

/** Seuils des alertes de blocage (2026-09-12) : sessions consécutives sans unité close ; durée d'une session vivante. */
const SESSIONS_SANS_PROGRES = 4;
const SESSION_LONGUE_S = 45 * 60;
const BRANCHE_PRINCIPALE = 'main';
const TYPES_A_REPONDRE = new Set(['BLOCKER', 'CLARIFICATION', 'PROPOSAL']);
const ETATS_TERMINAUX = new Set(['DELIVERED', 'FAILED', 'ARCHIVED']);

function readIf(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } }
function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 8000 }, opts || {}));
  return r.status === 0 ? String(r.stdout || '') : null;
}
function tirets(chemin) { return String(chemin).replace(/\//g, '-'); }
function num(x) { const n = Number(String(x || '').replace(',', '.')); return Number.isFinite(n) ? n : null; }

/** Racine du dépôt : remonte jusqu'à framework/KERNEL.md (même règle que tools/holarch-session/etat.js). */
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

// ---------------------------------------------------------------------------------------------------
// Parseurs purs (texte → objet). Tous tolèrent null.

function parseStatus(t) {
  const s = { etat: '', depuis: '', posePar: '', note: '', reveil: '' };
  if (!t) return s;
  const cell = (nom) => { const m = t.match(new RegExp(`^\\|\\s*${nom}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm')); return m ? m[1].trim() : ''; };
  s.etat = (t.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m) || [])[1] || '';
  s.depuis = cell('Depuis'); s.posePar = cell('Posé par'); s.note = cell('Note');
  const r = cell('R[ée]veil');
  s.reveil = r === '—' || r === '-' ? '' : r;
  return s;
}

function parseFiche(t) {
  const f = { statut: '', budgetAlloue: null, budgetConsomme: null, profil: '', effort: '' };
  if (!t) return f;
  const cell = (nom) => { const m = t.match(new RegExp(`^\\|\\s*${nom}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm')); return m ? m[1].trim() : ''; };
  f.statut = cell('Statut'); f.profil = cell('Profil'); f.effort = cell('Effort');
  const b = cell('Budget allou[ée] \\/ consomm[ée]').match(/(\d+)\s*\/\s*(\d+)/);
  if (b) { f.budgetAlloue = Number(b[1]); f.budgetConsomme = Number(b[2]); }
  return f;
}

/** ORG.md : liste indentée `- \`nom\` — ETAT — …` ; le chemin se reconstruit par l'indentation (2 espaces par niveau). */
function parseOrg(t) {
  const out = [];
  if (!t) return out;
  const pile = [];
  for (const ligne of t.split('\n')) {
    const m = ligne.match(/^(\s*)-\s*`([^`]+)`\s*[—-]+\s*([A-Z_]+)/);
    if (!m) continue;
    const niveau = Math.floor(m[1].length / 2);
    pile.length = niveau;
    const nom = m[2].includes('/') ? m[2].split('/').pop() : m[2];
    pile[niveau] = nom;
    out.push({ chemin: pile.slice(0, niveau + 1).join('/'), etat: m[3], ligne: ligne.trim() });
  }
  return out;
}

/** registry/SESSIONS.md : une ligne par session (colonnes du lanceur, `appendSessionLine`). */
function parseSessions(t) {
  const rows = [];
  if (!t) return rows;
  for (const l of t.split('\n')) {
    if (!/^\|\s*20\d\d-/.test(l)) continue;
    const c = l.split('|').map((x) => x.trim());
    if (c.length < 9) continue;
    const tok = (c[6] || '').split('/').map((x) => num(x.trim()));
    rows.push({
      date: c[1], instance: c[2], session: c[3] === '—' ? '' : c[3], modele: c[4], tours: num(c[5]),
      tokens: { entree: tok[0], cacheLu: tok[1], cacheEcrit: tok[2], sortie: tok[3] },
      usd: num(String(c[7] || '').replace('≈', '')), duree: c[8] || '', // « ≈ » = coût calculé au catalogue (1.16.0), compté comme les autres fin: c[9] || '', status: c[10] || '', reveil: c[11] || '', contexte: c[12] || '',
    });
  }
  return rows;
}

function parseReveils(t) {
  const rows = [];
  if (!t) return rows;
  for (const l of t.split('\n')) {
    if (!/^\|\s*20\d\d-/.test(l)) continue;
    const c = l.split('|').map((x) => x.trim());
    rows.push({ date: c[1], chemin: c[2], declencheur: c[3], condition: c[4], tache: c[5] });
  }
  return rows;
}

function parseIndex(t) {
  const rows = [];
  if (!t) return rows;
  for (const l of t.split('\n')) {
    const c = l.split('|').map((x) => x.trim());
    if (c.length < 6 || !/^U\d+/.test(c[1])) continue;
    rows.push({ unite: c[1], date: c[2], resultat: c[3], critere: c[4], fiche: c[5] });
  }
  return rows;
}

function parseMessages(t) {
  if (!t) return [];
  return messageLint.decouperBlocs(t).map((b) => {
    const { champs } = messageLint.parseChamps(b.champsBruts);
    return { id: champs.id || '', from: champs.from || '', to: champs.to || '', type: (champs.type || '').toUpperCase(), ref: champs.ref || '', date: champs.date || '', origine: champs.origine || '', corps: b.corps.slice(0, 400) };
  });
}

/** `ps -eo pid,ppid,etimes,args` → processus de mission : lanceurs (`holarch-spawn.js <chemin>`) et sessions
 *  `claude -p … -n holarch:<chemin>` ; jamais une session interactive (`--replay-user-messages`). */
function parsePs(text) {
  const out = [];
  for (const l of String(text || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const args = m[4];
    if (/--replay-user-messages|grep/.test(args)) continue;
    const p = { pid: Number(m[1]), ppid: Number(m[2]), secondes: Number(m[3]), role: '', chemin: '', commande: args.slice(0, 120) };
    let mm;
    if ((mm = args.match(/^\S*node(?:\.exe)?\s+\S*holarch-spawn\.js\s+(--bootstrap|[A-Za-z0-9_./-]+)/))) { p.role = 'lanceur'; p.chemin = mm[1] === '--bootstrap' ? 'bootstrap' : mm[1]; }
    else if (/(^|\s)claude -p(\s|$)/.test(args)) { p.role = 'claude'; mm = args.match(/\s-n\s+holarch:(\S+)/); p.chemin = mm ? mm[1] : ''; }
    else if (/holarch-watch\/watch\.js/.test(args)) { p.role = 'watch'; }
    else continue;
    out.push(p);
  }
  // un `claude -p` sans nom : chemin du lanceur parent s'il y en a un
  for (const p of out) if (p.role === 'claude' && !p.chemin) { const l = out.find((q) => q.role === 'lanceur' && q.pid === p.ppid); if (l) p.chemin = l.chemin; }
  return out;
}

function parseWorktrees(porcelain) {
  const out = [];
  let cur = null;
  for (const l of String(porcelain || '').split('\n')) {
    if (l.startsWith('worktree ')) { cur = { chemin: l.slice(9).trim(), head: '', branche: '' }; out.push(cur); }
    else if (cur && l.startsWith('HEAD ')) cur.head = l.slice(5).trim().slice(0, 7);
    else if (cur && l.startsWith('branch ')) cur.branche = l.slice(7).trim().replace(/^refs\/heads\//, '');
  }
  return out;
}

/** Dernier `usage` assistant d'une transcription Claude Code (queue du fichier, comme le hook context-watch). */
function usageDepuisQueue(texte) {
  const lignes = String(texte || '').split('\n');
  for (let i = lignes.length - 1; i >= 0; i--) {
    const l = lignes[i];
    if (!l.includes('"assistant"') || !l.includes('"usage"')) continue;
    try { const o = JSON.parse(l); if (o.type === 'assistant' && o.message && o.message.usage) return o.message.usage; } catch (_) { /* ligne tronquée */ }
  }
  return null;
}
function contexteDe(usage) { return usage ? (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0) : null; }

/** Une transcription est celle d'une instance si son premier message utilisateur est le prompt du lanceur. */
function instanceDeTranscription(tete) {
  const m = String(tete || '').match(/Tu incarnes l'instance `([^`]+)`/);
  if (m) return m[1];
  if (/Tu es la première session de cette mission\. Exécute la procédure de framework\/BOOTSTRAP\.md/.test(tete)) return 'bootstrap';
  return '';
}

// ---------------------------------------------------------------------------------------------------

function depsParDefaut(root) {
  return {
    lire: (abs) => readIf(abs),
    existe: (abs) => fs.existsSync(abs),
    lister: (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).map((e) => ({ nom: e.name, dossier: e.isDirectory() })); } catch (_) { return []; } },
    stat: (abs) => { try { const s = fs.statSync(abs); return { taille: s.size, modifie: s.mtime.toISOString() }; } catch (_) { return null; } },
    lireQueue: (abs, octets) => { try { const size = fs.statSync(abs).size; const span = Math.min(size, octets); const buf = Buffer.alloc(span); const fd = fs.openSync(abs, 'r'); try { fs.readSync(fd, buf, 0, span, size - span); } finally { fs.closeSync(fd); } return buf.toString('utf8'); } catch (_) { return ''; } },
    lireTete: (abs, octets) => { try { const size = fs.statSync(abs).size; const span = Math.min(size, octets); const buf = Buffer.alloc(span); const fd = fs.openSync(abs, 'r'); try { fs.readSync(fd, buf, 0, span, 0); } finally { fs.closeSync(fd); } return buf.toString('utf8'); } catch (_) { return ''; } },
    git: (args, cwd) => run('git', ['-C', cwd || root, ...args]),
    ps: () => (process.env.HOLARCH_OBSERVE_PS !== undefined ? process.env.HOLARCH_OBSERVE_PS : run('ps', ['-eo', 'pid,ppid,etimes,args']) || ''),
    pidVivant: (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; } },
    transcriptionsDir: (cwd) => process.env.HOLARCH_OBSERVE_TRANSCRIPTS || path.join(os.homedir(), '.claude', 'projects', String(cwd || root).replace(/[^A-Za-z0-9]/g, '-')),
    now: () => new Date(),
  };
}

/** Collecte pure : `deps` surchargeable (tests). Ne lève jamais pour une source absente. */
function collecter(root, depsSur) {
  const d = Object.assign(depsParDefaut(root), depsSur || {});
  const now = d.now();
  const nowMs = now.getTime();
  const e = { horodatage: now.toISOString(), root, mission: {}, git: {}, instances: [], processus: [], taches: [], sessions: {}, reveils: [], messagesPourMainteneur: [], messagesSansReponse: [], transcriptions: { vivantes: [], sansJournal: [] }, anomalies: [] };
  const anomalie = (niveau, code, chemin, texte) => e.anomalies.push({ niveau, code, chemin: chemin || '', texte });
  const lireRel = (rel) => d.lire(path.join(root, rel));
  const holarch = path.join(root, 'mission', '.holarch');

  // --- mission et configuration ---------------------------------------------------------------------
  const cfg = lireRel('framework/CONFIG.md') || '';
  const nom = cfg.match(/^#\s*Configuration\s*[—-]+\s*mission\s*:\s*(.+)$/m);
  e.mission.nom = nom ? nom[1].trim() : '';
  const param = (k, def) => { const m = cfg.match(new RegExp(`^\\|\\s*${k}\\s*\\|\\s*([^|]+?)\\s*\\|`, 'm')); return m ? m[1].trim() : def; };
  e.mission.budgetUsdParSession = num(param('budget_usd_par_session', '')) ;
  e.mission.seuilContexteTokens = num(param('seuil_contexte_tokens', ''));
  e.mission.budgetInstancesTotal = num(param('budget_instances_total', ''));
  const prefixe = param('prefixe_branche', 'holarch/');
  e.mission.isolation = param('isolation', 'worktree');
  e.mission.objectif = ((lireRel('mission/OBJECTIVE.md') || '').split('\n').find((l) => l.startsWith('# ')) || '').replace(/^#\s*/, '');
  e.mission.ouverte = d.existe(path.join(root, 'mission', 'OBJECTIVE.md'));
  const debutMission = num((d.git(['log', '--diff-filter=A', '-1', '--format=%ct', '--', 'mission/OBJECTIVE.md']) || '').trim()) || 0;

  // --- git : arbre principal, worktrees, branches ---------------------------------------------------
  e.git.branche = (d.git(['branch', '--show-current']) || '').trim() || '(détachée)';
  e.git.head = (d.git(['rev-parse', '--short', 'HEAD']) || '').trim();
  const status = (d.git(['status', '--short', '--untracked-files=all']) || '').split('\n').filter(Boolean).map((l) => l.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim());
  e.git.nonCommittes = status;
  e.git.fichiersLanceur = status.filter((f) => /^mission\/registry\/(SESSIONS|REVEILS)\.md$/.test(f));
  e.git.fichiersInstance = status.filter((f) => /^mission\//.test(f) && !e.git.fichiersLanceur.includes(f));
  e.git.fichiersMaintenance = status.filter((f) => !/^mission\//.test(f));
  e.git.worktrees = parseWorktrees(d.git(['worktree', 'list', '--porcelain'])).filter((w) => path.resolve(w.chemin) !== path.resolve(root));
  const branches = (d.git(['branch', '--list', '--format=%(refname:short)', `${prefixe}*`]) || '').split('\n').map((s) => s.trim()).filter(Boolean);
  e.git.branchesInstance = branches;
  const ecart = (d.git(['rev-list', '--left-right', '--count', `${BRANCHE_PRINCIPALE}...holon-v2/${BRANCHE_PRINCIPALE}`]) || '').trim().split(/\s+/);
  e.git.ecartHolonV2 = ecart.length === 2 ? { avance: num(ecart[0]), retard: num(ecart[1]) } : null;
  if (e.git.branche !== BRANCHE_PRINCIPALE) anomalie('alerte', 'branche-principale', '', `l'arbre principal est sur « ${e.git.branche} », pas sur ${BRANCHE_PRINCIPALE} (bascule oubliée par une session tuée ?)`);
  if (e.git.fichiersLanceur.length) anomalie('info', 'journal-lanceur-non-committe', '', `${e.git.fichiersLanceur.join(', ')} non committé(s) : journal du lanceur, la racine le committe à sa prochaine session`);

  // --- instances : arbre principal, worktrees, branches --------------------------------------------
  const skipTop = new Set(['registry', 'shared', '.holarch', 'graveyard']);
  const skipDirs = new Set(['workspace', 'memoire', 'graveyard', '.holarch']);
  const chemins = new Map(); // chemin → {source, base, branche}
  const walk = (base, rel, source, accepte) => {
    const dir = path.join(base, 'mission', rel);
    if (accepte(rel) && d.existe(path.join(dir, 'STATUS.md')) && !chemins.has(rel)) chemins.set(rel, { source, base });
    for (const ent of d.lister(dir)) if (ent.dossier && !skipDirs.has(ent.nom)) walk(base, `${rel}/${ent.nom}`, source, accepte);
  };
  const walkTop = (base, source, accepte) => { for (const ent of d.lister(path.join(base, 'mission'))) if (ent.dossier && !skipTop.has(ent.nom)) walk(base, ent.nom, source, accepte); };
  // 1. worktrees : chacun ne fait foi que pour sa propre instance
  for (const w of e.git.worktrees) { const nomW = path.basename(w.chemin); walkTop(w.chemin, 'worktree', (rel) => tirets(rel) === nomW); }
  // 2. branches d'instance sans worktree : STATUS committé
  for (const b of branches) {
    const suffixe = b.slice(prefixe.length);
    const arbre = (d.git(['ls-tree', '-r', '--name-only', b, '--', 'mission/']) || '').split('\n');
    for (const f of arbre) { const m = f.trim().match(/^mission\/(.+)\/STATUS\.md$/); if (m && tirets(m[1]) === suffixe && !chemins.has(m[1])) chemins.set(m[1], { source: 'branche', base: root, branche: b }); }
  }
  // 3. arbre principal (racines, et photo `INIT` des enfants pas encore incarnés)
  walkTop(root, 'arbre', () => true);

  const lireInstance = (info, chemin, rel) => {
    if (info.source === 'branche') return d.git(['show', `${info.branche}:mission/${chemin}/${rel}`]);
    return d.lire(path.join(info.base, 'mission', chemin, rel));
  };
  const lireRegistre = (info, chemin, rel) => {
    if (info.source === 'branche') return d.git(['show', `${info.branche}:mission/registry/${rel}`]) || lireRel(`mission/registry/${rel}`);
    return d.lire(path.join(info.base, 'mission', 'registry', rel)) || lireRel(`mission/registry/${rel}`);
  };

  // --- lanceur : verrous, contextes, tâches, arrêts ---------------------------------------------------
  const lireLive = (base) => {
    const out = { verrous: {}, contextes: {} };
    for (const ent of d.lister(path.join(base, 'mission', '.holarch', 'live'))) {
      if (ent.dossier) continue;
      const abs = path.join(base, 'mission', '.holarch', 'live', ent.nom);
      let data = null; try { data = JSON.parse(d.lire(abs) || 'null'); } catch (_) { data = null; }
      if (!data) continue;
      const st = d.stat(abs);
      if (ent.nom.endsWith('.contexte.json')) out.contextes[ent.nom.replace(/\.contexte\.json$/, '')] = Object.assign({ fichier: abs, modifie: st ? st.modifie : '' }, data);
      else if (ent.nom.endsWith('.json')) out.verrous[ent.nom.replace(/\.json$/, '')] = Object.assign({ fichier: abs }, data);
    }
    return out;
  };
  const live = lireLive(root);
  for (const w of e.git.worktrees) { const l = lireLive(w.chemin); Object.assign(live.contextes, l.contextes); for (const [k, v] of Object.entries(l.verrous)) if (!live.verrous[k]) live.verrous[k] = v; }
  for (const ent of d.lister(path.join(holarch, 'tasks'))) {
    if (!ent.nom.endsWith('.json')) continue;
    let t = null; try { t = JSON.parse(d.lire(path.join(holarch, 'tasks', ent.nom)) || 'null'); } catch (_) { t = null; }
    if (!t) continue;
    const log = d.lire(path.join(holarch, 'tasks', ent.nom.replace(/\.json$/, '.log'))) || '';
    t.vivant = t.state === 'running' ? d.pidVivant(t.pid) : false;
    t.arretLanceur = /ré-incarnations arrêtées|STATUS=FAILED/.test(log);
    t.derniereLigne = log.trim().split('\n').filter(Boolean).pop() || '';
    if (t.state === 'running' && !t.vivant) anomalie('alerte', 'tache-pid-mort', t.chemin, `tâche ${t.id} « running » mais pid ${t.pid} mort (redémarrage du conteneur ?) — node framework/bin/holarch-spawn.js --reprendre`);
    if (t.arretLanceur) anomalie('alerte', 'reincarnations-arretees', t.chemin, `le lanceur a arrêté les ré-incarnations (tâche ${t.id}) : ${t.derniereLigne.slice(0, 120)}`);
    e.taches.push(t);
  }
  e.taches.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const arrets = d.lister(path.join(holarch, 'stop')).filter((x) => !x.dossier).map((x) => x.nom);
  e.processus = parsePs(d.ps());
  const sessionsJournal = parseSessions(lireRel('mission/registry/SESSIONS.md'));
  e.reveils = parseReveils(lireRel('mission/registry/REVEILS.md'));

  // --- sessions : cumul -------------------------------------------------------------------------------
  const cumul = { n: 0, tours: 0, usd: 0, parInstance: {} };
  for (const s of sessionsJournal) {
    cumul.n++; cumul.tours += s.tours || 0; cumul.usd += s.usd || 0;
    const pi = cumul.parInstance[s.instance] || (cumul.parInstance[s.instance] = { n: 0, tours: 0, usd: 0, derniere: '' });
    pi.n++; pi.tours += s.tours || 0; pi.usd += s.usd || 0; pi.derniere = s.date;
  }
  cumul.usd = Math.round(cumul.usd * 10000) / 10000;
  for (const pi of Object.values(cumul.parInstance)) pi.usd = Math.round(pi.usd * 10000) / 10000;
  e.sessions = { lignes: sessionsJournal.slice(-20), total: { n: cumul.n, tours: cumul.tours, usd: cumul.usd }, parInstance: cumul.parInstance, sansResultat: sessionsJournal.filter((s) => /sans rés/.test(s.fin)).length };
  const sidsJournal = new Set(sessionsJournal.map((s) => s.session).filter(Boolean));

  // --- transcriptions : sessions vivantes et sessions sans journal -----------------------------------
  // Claude Code range la transcription sous ~/.claude/projects/<slug du cwd> : le cwd d'un enfant est son worktree.
  const dirsTranscriptions = [d.transcriptionsDir(root), ...e.git.worktrees.map((w) => d.transcriptionsDir(w.chemin))].filter((x, i, a) => a.indexOf(x) === i);
  const transcriptionDe = (sid, cwd) => {
    const abs = path.join(d.transcriptionsDir(cwd || root), `${sid}.jsonl`);
    const st = d.stat(abs);
    if (!st) return null;
    const usage = usageDepuisQueue(d.lireQueue(abs, 512 * 1024));
    return { session: sid, fichier: abs, taille: st.taille, modifie: st.modifie, contexte: contexteDe(usage), ageSecondes: Math.max(0, Math.round((nowMs - Date.parse(st.modifie)) / 1000)) };
  };

  // --- instances : lecture et réconciliation ---------------------------------------------------------
  const orgs = parseOrg(lireRel('mission/registry/ORG.md'));
  const messages = []; // tous, pour la réconciliation des réponses
  const parChemin = new Map();
  for (const [chemin, info] of chemins) {
    const st = parseStatus(lireInstance(info, chemin, 'STATUS.md'));
    const fiche = parseFiche(lireRegistre(info, chemin, `instances/${tirets(chemin)}.md`));
    const index = parseIndex(lireInstance(info, chemin, 'memoire/INDEX.md'));
    const inbox = parseMessages(lireInstance(info, chemin, 'INBOX.md')).map((m) => Object.assign(m, { boite: 'INBOX', chez: chemin }));
    const outbox = parseMessages(lireInstance(info, chemin, 'OUTBOX.md')).map((m) => Object.assign(m, { boite: 'OUTBOX', chez: chemin }));
    messages.push(...inbox, ...outbox);
    const branche = chemin.includes('/') ? `${prefixe}${tirets(chemin)}` : BRANCHE_PRINCIPALE;
    const brancheExiste = chemin.includes('/') ? branches.includes(branche) : true;
    const log = brancheExiste ? (d.git(['log', '--format=%h%x09%ct%x09%s', '-300', branche]) || '') : '';
    const commits = log.split('\n').filter((l) => l.split('\t')[2] && l.split('\t')[2].startsWith(`[${chemin}]`));
    const dernier = commits[0] ? commits[0].split('\t') : null;
    const worktree = e.git.worktrees.find((w) => path.basename(w.chemin) === tirets(chemin)) || null;
    const propre = worktree ? ((d.git(['status', '--porcelain'], worktree.chemin) || '').split('\n').filter(Boolean)) : null;
    const verrou = live.verrous[tirets(chemin)] || null;
    const contexte = live.contextes[tirets(chemin)] || null;
    const procs = e.processus.filter((p) => p.chemin === chemin);
    const claude = procs.find((p) => p.role === 'claude') || null;
    const lanceur = procs.find((p) => p.role === 'lanceur') || null;
    const tache = e.taches.filter((t) => t.chemin === chemin).pop() || null;
    const verrouVivant = verrou ? d.pidVivant(verrou.pid) : false;
    const vivant = !!claude || verrouVivant;
    const transcription = contexte && contexte.session_id ? transcriptionDe(contexte.session_id, worktree ? worktree.chemin : root) : null;
    const cumulI = cumul.parInstance[chemin] || { n: 0, tours: 0, usd: 0, derniere: '' };
    const org = orgs.find((o) => o.chemin === chemin) || null;
    const inst = {
      chemin, parent: chemin.includes('/') ? chemin.slice(0, chemin.lastIndexOf('/')) : 'utilisateur', profondeur: chemin.split('/').length,
      source: info.source, etat: st.etat, depuis: st.depuis, note: st.note, reveil: st.reveil, reveilEval: null,
      fiche, org: org ? org.etat : '', unites: index, unitesPass: index.filter((u) => /PASS/i.test(u.resultat)).length,
      git: { branche, brancheExiste, worktree: worktree ? worktree.chemin : '', head: worktree ? worktree.head : '', nonCommittes: propre, commits: commits.length, dernierCommit: dernier ? { sha: dernier[0], date: new Date(Number(dernier[1]) * 1000).toISOString(), sujet: dernier[2] } : null },
      live: { vivant, verrou: verrou ? { pid: verrou.pid, vivant: verrouVivant, startedAt: verrou.startedAt, attempt: verrou.attempt } : null, pidClaude: claude ? claude.pid : null, secondes: claude ? claude.secondes : (lanceur ? lanceur.secondes : null), lanceurPid: lanceur ? lanceur.pid : null, tache: tache ? { id: tache.id, state: tache.state, vivant: tache.vivant } : null, arretDemande: arrets.includes(tirets(chemin)) },
      contexte: contexte ? { session: contexte.session_id, depart: contexte.depart, max: contexte.max, dernier: contexte.dernier, toursHook: contexte.tours, modifie: contexte.modifie } : null,
      transcription,
      sessions: cumulI,
      messages: { recus: inbox.length, emis: outbox.length, aRepondre: 0 },
      effectif: '',
    };
    // Réveil
    if (st.reveil) {
      const ast = reveil.parseReveil(st.reveil);
      if (ast) {
        try {
          const ev = reveil.evalReveil(ast, { root, chemin, sinceIso: st.depuis, now, readStatus: (c) => (parChemin.get(c) ? { etat: parChemin.get(c).etat } : parseStatus(lireInstance(chemins.get(c) || { source: 'arbre', base: root }, c, 'STATUS.md'))), readInbox: () => lireInstance(info, chemin, 'INBOX.md') || '', gitBranches: { prefixe } });
          inst.reveilEval = { satisfait: ev.satisfied, details: ev.details };
        } catch (_) { inst.reveilEval = null; }
      }
    }
    parChemin.set(chemin, inst);
    e.instances.push(inst);
  }
  // Évaluation des réveils dans un second temps (les états des frères sont connus)
  for (const inst of e.instances) {
    if (!inst.reveil || !inst.reveilEval) continue;
    const ast = reveil.parseReveil(inst.reveil);
    try {
      const ev = reveil.evalReveil(ast, { root, chemin: inst.chemin, sinceIso: inst.depuis, now, readStatus: (c) => (parChemin.get(c) ? { etat: parChemin.get(c).etat } : {}), readInbox: () => lireInstance(chemins.get(inst.chemin), inst.chemin, 'INBOX.md') || '', gitBranches: { prefixe } });
      inst.reveilEval = { satisfait: ev.satisfied, details: ev.details };
    } catch (_) { /* garder la première évaluation */ }
  }

  // --- état effectif et anomalies par instance ------------------------------------------------------
  for (const inst of e.instances) {
    const l = inst.live;
    const hib = /hibernation volontaire/i.test(inst.note);
    let eff;
    if (l.vivant) {
      const ctx = inst.transcription && inst.transcription.contexte ? `${Math.round(inst.transcription.contexte / 1000)}k tokens` : (inst.contexte ? `~${Math.round(inst.contexte.dernier / 1000)}k tokens` : 'contexte inconnu');
      eff = `${inst.etat} · session vivante${l.pidClaude ? ` (pid ${l.pidClaude}` : (l.verrou ? ` (lanceur ${l.verrou.pid}` : ' (')}${l.secondes != null ? `, ${Math.round(l.secondes / 60)} min` : ''}, ${ctx})`;
      if (l.arretDemande) eff += ' · arrêt demandé';
    } else if (inst.etat === 'WORKING') {
      if (l.tache && l.tache.state === 'running' && l.tache.vivant) eff = 'WORKING · lanceur vivant entre deux sessions (attente 429 ou ré-incarnation)';
      else if (hib) eff = 'WORKING · hibernation volontaire, relance attendue';
      else { eff = 'WORKING · aucune session vivante (session tuée ou plantée ?)'; anomalie('alerte', 'working-sans-session', inst.chemin, `STATUS WORKING sans verrou ni processus — session tuée ou plantée : relancer (node framework/bin/holarch-spawn.js ${inst.chemin})`); }
    } else if (inst.etat === 'WAITING_CHILDREN' || inst.etat === 'BLOCKED') {
      const ev = inst.reveilEval;
      eff = `${inst.etat} · attend ${inst.reveil || '(sans condition)'}${ev ? (ev.satisfait ? ' — condition SATISFAITE, réveil attendu' : ' — condition non satisfaite') : ''}`;
      if (ev && ev.satisfait) anomalie('alerte', 'reveil-attendu', inst.chemin, `condition de réveil « ${inst.reveil} » satisfaite et aucune session vivante — node framework/bin/holarch-spawn.js --reveil --dry-run`);
      if (!inst.reveil) anomalie('info', 'attente-sans-condition', inst.chemin, `${inst.etat} sans ligne Réveil : personne ne la réveillera automatiquement`);
    } else if (inst.etat === 'INIT' || inst.etat === 'READY') {
      eff = `${inst.etat} · ${inst.git.brancheExiste && !inst.git.worktree ? 'branche créée, en attente d\'incarnation' : 'pas encore incarnée'}`;
    } else if (ETATS_TERMINAUX.has(inst.etat)) eff = `${inst.etat} · terminée`;
    else eff = inst.etat || '(STATUS illisible)';
    inst.effectif = eff;
    if (l.verrou && !l.verrou.vivant) anomalie('alerte', 'verrou-perime', inst.chemin, `verrou live/${tirets(inst.chemin)}.json au pid ${l.verrou.pid} mort — nettoyé au prochain appel du lanceur pour cette instance`);
    if (inst.org && inst.etat && inst.org !== inst.etat) anomalie('info', 'org-en-retard', inst.chemin, `ORG.md dit ${inst.org}, STATUS.md dit ${inst.etat} (ORG est tenu par le parent à ses unités)`);
    if (inst.fiche.statut && inst.etat && inst.fiche.statut !== inst.etat && !(inst.fiche.statut === 'INIT' && inst.etat === 'WORKING' && l.vivant)) anomalie('info', 'fiche-en-retard', inst.chemin, `fiche registre à ${inst.fiche.statut}, STATUS.md à ${inst.etat}`);
    if (inst.git.nonCommittes && inst.git.nonCommittes.length && !l.vivant) anomalie('info', 'worktree-non-committe', inst.chemin, `${inst.git.nonCommittes.length} fichier(s) non committé(s) dans son worktree sans session vivante (repris à sa prochaine incarnation)`);
    if (inst.contexte && !l.vivant && inst.contexte.session && !sidsJournal.has(inst.contexte.session)) anomalie('info', 'contexte-orphelin', inst.chemin, `live/${tirets(inst.chemin)}.contexte.json (session ${inst.contexte.session.slice(0, 8)}) sans session vivante ni ligne SESSIONS.md : session tuée ?`);
    if (inst.transcription) e.transcriptions.vivantes.push(Object.assign({ chemin: inst.chemin }, inst.transcription));
    // Blocages à prévenir (2026-09-12, demande du mainteneur) : une instance qui enchaîne les sessions sans clore une
    // unité (mesure-gpt5mini : 7 sessions, 0 unité, hibernations à 50 k tokens), ou une session anormalement longue.
    const enCours = !['DELIVERED', 'FAILED', 'ARCHIVED', 'BLOCKED'].includes(inst.etat);
    if (enCours && inst.sessions.n >= SESSIONS_SANS_PROGRES && inst.unitesPass === 0) anomalie('alerte', 'sans-progres', inst.chemin, `${inst.sessions.n} session(s), ${inst.sessions.usd.toFixed(2)} USD, aucune unité close : tourne sans livrer — \`node framework/bin/holarch-spawn.js --arret ${inst.chemin}\` puis recadrage (TASK) ou verdict (FAILED) par le parent`);
    if (l.vivant && l.secondes && l.secondes >= SESSION_LONGUE_S) anomalie('alerte', 'session-longue', inst.chemin, `session vivante depuis ${Math.round(l.secondes / 60)} min (pid ${l.pidClaude || '?'}) — vérifier la transcription (\`node tools/holarch-transcript/analyse.js <session>\`) avant qu'un fusible ne parle`);
    if (l.vivant && inst.transcription && inst.transcription.contexte && e.mission.seuilContexteTokens && inst.transcription.contexte >= e.mission.seuilContexteTokens) anomalie('info', 'contexte-au-seuil', inst.chemin, `contexte ${Math.round(inst.transcription.contexte / 1000)}k ≥ seuil ${Math.round(e.mission.seuilContexteTokens / 1000)}k : hibernation imminente`);
  }
  for (const inst of e.instances) {
    for (const p of e.processus) if (p.role === 'claude' && p.chemin === inst.chemin && !inst.live.verrou) anomalie('info', 'processus-sans-verrou', inst.chemin, `claude -p (pid ${p.pid}) sans verrou live/ : lancé hors lanceur ?`);
  }
  for (const p of e.processus) if (p.chemin && !parChemin.has(p.chemin) && p.chemin !== 'bootstrap') anomalie('info', 'processus-inconnu', p.chemin, `processus ${p.role} (pid ${p.pid}) pour une instance sans STATUS.md`);

  // --- messages : ce qui attend une réponse, ce qui attend le mainteneur ----------------------------
  const repondus = new Set(messages.filter((m) => m.type === 'RESPONSE' && m.ref && m.ref !== '—').map((m) => m.ref));
  const vus = new Set();
  for (const m of messages) {
    if (!m.id || vus.has(m.id)) continue;
    vus.add(m.id);
    const attend = TYPES_A_REPONDRE.has(m.type) && !repondus.has(m.id);
    if (m.to === 'utilisateur' && (attend || m.type === 'DELIVERABLE' || m.type === 'ALERT')) {
      e.messagesPourMainteneur.push({ id: m.id, from: m.from, type: m.type, date: m.date, corps: m.corps.slice(0, 200), repondu: repondus.has(m.id) });
    } else if (attend) {
      e.messagesSansReponse.push({ id: m.id, from: m.from, to: m.to, type: m.type, date: m.date, corps: m.corps.slice(0, 120) });
      const dest = parChemin.get(m.to); if (dest) dest.messages.aRepondre++;
    }
  }
  const attendMainteneur = e.messagesPourMainteneur.filter((m) => !m.repondu);
  if (attendMainteneur.length) anomalie('alerte', 'attend-mainteneur', '', `${attendMainteneur.length} message(s) pour utilisateur sans RESPONSE : ${attendMainteneur.map((m) => `${m.type} ${m.id}`).join(', ')}`);

  // --- transcriptions d'instances sans ligne SESSIONS.md (sessions tuées) ----------------------------
  const sidsVivants = new Set(e.transcriptions.vivantes.map((t) => t.session));
  for (const tdir of dirsTranscriptions) for (const ent of d.lister(tdir)) {
    if (ent.dossier || !ent.nom.endsWith('.jsonl')) continue;
    const sid = ent.nom.replace(/\.jsonl$/, '');
    if (sidsJournal.has(sid) || sidsVivants.has(sid)) continue;
    const abs = path.join(tdir, ent.nom);
    const st = d.stat(abs);
    if (!st || (debutMission && Date.parse(st.modifie) / 1000 < debutMission)) continue;
    const chemin = instanceDeTranscription(d.lireTete(abs, 64 * 1024));
    if (!chemin) continue;
    const texte = d.lire(abs) || '';
    let tours = 0; let pic = 0;
    for (const l of texte.split('\n')) {
      if (!l.includes('"assistant"') || !l.includes('"usage"')) continue;
      try { const o = JSON.parse(l); if (o.type === 'assistant' && o.message && o.message.usage) { tours++; pic = Math.max(pic, contexteDe(o.message.usage)); } } catch (_) { /* ignore */ }
    }
    // Transcription close depuis moins de trois minutes : le lanceur n'a peut-être pas encore écrit sa ligne (fin de
    // session, ON_SLEEP → journal). Ce n'est une anomalie qu'une fois ce délai passé — sinon chaque transition de
    // session émettait un couple d'alertes +/- en mode --evenements --mainteneur (constaté le 2026-09-11 soir).
    const recente = nowMs - Date.parse(st.modifie) < 3 * 60 * 1000;
    e.transcriptions.sansJournal.push({ chemin, session: sid, fichier: abs, tours, pic, modifie: st.modifie, recente });
    if (recente) continue;
    anomalie('alerte', 'session-sans-journal', chemin, `transcription ${sid.slice(0, 8)} (${chemin}, ${tours} tours, pic ${Math.round(pic / 1000)}k) sans ligne dans SESSIONS.md : session tuée avant son résultat, coût invisible`);
  }

  e.instances.sort((a, b) => a.chemin.localeCompare(b.chemin));
  e.anomalies.sort((a, b) => (a.niveau === b.niveau ? 0 : a.niveau === 'alerte' ? -1 : 1));
  return e;
}

module.exports = { collecter, findRoot, parseStatus, parseFiche, parseOrg, parseSessions, parseReveils, parseIndex, parseMessages, parsePs, parseWorktrees, usageDepuisQueue, instanceDeTranscription, depsParDefaut };
