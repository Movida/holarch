#!/usr/bin/env node
'use strict';
/**
 * holarch-hooks.js — garde-fous mécaniques du harnais HOLARCH (framework v1.1).
 *
 * Branchés par framework/claude/instance-settings.json (passé via --settings par le lanceur) :
 *   Stop        → sleep-guard   : refuse la fin de session tant que STATUS.md est à WORKING sans note
 *                                 d'hibernation volontaire, ou que mission/ contient des changements non committés
 *                                 (hors fichiers en vol d'une autre instance vivante — enfant détaché, parent).
 *   SessionStart → session-start : rappelle le contexte de départ de la session précédente
 *                                 (registry/SESSIONS.md) et la discipline unites-indexees (chantier 7, §9.2).
 *   PreToolUse  → git-guard     : refuse `git add` hors de mission/ (-A, ., -u sans pathspec, chemins framework/…) et `git commit -a`
 *   PreToolUse  → spawn-guard   : refuse `node framework/bin/holarch-spawn.js <enfant>` si la mécanique de spawn
 *                                 (KERNEL §9) est incomplète, si la cible n'est pas un enfant direct, si la
 *                                 profondeur dépasse profondeur_max, ou si le budget d'instances est nul/dépassé.
 *   PreToolUse  → wake-guard    : refuse tout Write/Edit hors de l'arbre propre de l'instance (mission/<chemin>/**)
 *                                 tant que son STATUS.md n'est pas passé à un état actif et qu'elle n'a pas ajouté
 *                                 sa ligne ON_ORIENT à registry/PROGRESS.md pour la session courante (symétrique
 *                                 de sleep-guard côté réveil — cf. T4 en conditions réelles, constat C4).
 *   PostToolUse → context-watch : mesure le contexte réel (usage de la transcription) et, au-delà du seuil,
 *                                 injecte l'ordre d'hiberner volontairement (module context-budget, KERNEL §5.8).
 * Inertes (sortie `{}`) hors d'une session lancée par holarch-spawn (variable HOLARCH_INSTANCE absente).
 * Fail-open : toute erreur interne laisse l'action se dérouler normalement — les règles du KERNEL restent
 * la référence, ces hooks n'en sont que le renfort mécanique.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const reveil = require(path.join(__dirname, '..', 'bin', 'reveil.js'));

const STOP_BLOCKS_MAX = 3;
const WARN_STEP = 20000;
const FACT_STEP = 50000; // un fait de contexte injecté à chaque palier de 50k tokens sous le seuil
// Défauts du module memoire/unites-indexees.md (`ligne_max_chars`, `memoire_max_lignes`) — CONFIG.md
// ne porte pas de mécanisme de surcharge par paramètre de module ; ces valeurs suivent donc le
// module tel qu'il se lit, comme STOP_BLOCKS_MAX ci-dessus suit son propre module.
const UNITES_LIGNE_MAX_CHARS = 200;
const UNITES_MEMOIRE_MAX_LIGNES = 60;
const VALUE_OPTS = new Set(['--profil', '--modele', '--model', '--effort', '--budget-usd', '--max-tours', '--max-turns', '--permission-mode', '--root', '--timeout-min', '--arret']);

function readIf(p) { try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; } }
function exists(p) { try { fs.accessSync(p); return true; } catch (_) { return false; } }
function emit(obj) { process.stdout.write(JSON.stringify(obj)); }
function ok() { emit({}); }
function stripTicks(s) { return String(s || '').trim().replace(/^`+|`+$/g, '').trim(); }

function parseStatus(text) {
  const s = { etat: '', note: '', reveil: '' };
  if (!text) return s;
  const e = text.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m);
  if (e) s.etat = e[1];
  const n = text.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m);
  if (n) s.note = n[1];
  const r = text.match(/^\|\s*R[ée]veil\s*\|\s*(.*?)\s*\|\s*$/m);
  if (r) s.reveil = r[1];
  return s;
}
function parseFiche(text) {
  const f = { alloue: null, consomme: null };
  if (!text) return f;
  const m = text.match(/^\|\s*Budget allou[ée] \/ consomm[ée]\s*\|\s*(\d+)\s*\/\s*(\d+)/mi);
  if (m) { f.alloue = Number(m[1]); f.consomme = Number(m[2]); }
  return f;
}
function configParam(root, key) {
  const text = readIf(path.join(root, 'framework', 'CONFIG.md'));
  if (!text) return '';
  const m = text.match(new RegExp(`^\\|\\s*${key}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm'));
  return m ? stripTicks(m[1]) : '';
}
function fichePath(root, chemin) { return path.join(root, 'mission', 'registry', 'instances', `${chemin.replace(/\//g, '-')}.md`); }
// Noms des modules de la table « Modules actifs » de CONFIG.md — `configParam` ne lit qu'un
// paramètre scalaire `| clé | valeur |`, insuffisant pour une liste de lignes `| # | Catégorie | Module |`.
function activeModules(root) {
  const text = readIf(path.join(root, 'framework', 'CONFIG.md'));
  if (!text) return [];
  const section = text.match(/##\s*Modules actifs\s*\n([\s\S]*?)(?:\n##\s|\n*$)/);
  if (!section) return [];
  const mods = [];
  for (const line of section[1].split('\n')) {
    const cells = line.split('|').map((c) => c.trim()).filter((c) => c !== '');
    if (cells.length < 3) continue;
    if (cells[0] === '#' || /^-+$/.test(cells[0])) continue;
    mods.push(cells[cells.length - 1]);
  }
  return mods;
}

function stateFile(sessionId) {
  const dir = path.join(os.tmpdir(), 'holarch-hooks');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${(sessionId || 'nosession').replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}
function loadState(sessionId) { try { return JSON.parse(fs.readFileSync(stateFile(sessionId), 'utf8')); } catch (_) { return {}; } }
function saveState(sessionId, st) { try { fs.writeFileSync(stateFile(sessionId), JSON.stringify(st)); } catch (_) { /* ignore */ } }

// Mesure instantanée (module context-budget, volet 8.1) : contexte réel de la session en cours,
// à côté du verrou de vivacité du lanceur (mission/.holarch/live/<chemin-tirets>.json).
function contexteLivePath(root, instance) {
  return path.join(root, 'mission', '.holarch', 'live', `${instance.replace(/\//g, '-')}.contexte.json`);
}
function updateContexteLive(root, instance, sessionId, tokens) {
  const file = contexteLivePath(root, instance);
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { data = {}; }
  if (data.session_id !== sessionId) data = { session_id: sessionId, depart: tokens, max: tokens, dernier: tokens, tours: 0 };
  data.tours = (data.tours || 0) + 1;
  data.dernier = tokens;
  if (tokens > data.max) data.max = tokens;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data));
  } catch (_) { /* fail-open */ }
}

function gitDirtyCount(root, paths, exclure) {
  const r = spawnSync('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all', '--', ...paths], { encoding: 'utf8' });
  if (r.status !== 0) return 0; // pas un dépôt git : rien à exiger
  return r.stdout.split('\n').filter((l) => {
    if (!l.trim() || /mission\/\.holarch\//.test(l)) return false;
    const rel = l.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, '');
    return !(exclure && exclure(rel));
  }).length;
}

/** Toutes les instances de la mission (répertoires porteurs d'un STATUS.md), chemins `a/b/c`. */
function allInstances(root) {
  const out = [];
  const walk = (chemin) => {
    for (const c of reveil.listChildren(root, chemin)) { const full = chemin ? `${chemin}/${c}` : c; out.push(full); walk(full); }
  };
  walk('');
  return out;
}
// Même verrou que le lanceur (liveLockPath/isLive), lu sans jamais le nettoyer.
function isLiveInstance(root, chemin) {
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(root, 'mission', '.holarch', 'live', `${chemin.replace(/\//g, '-')}.json`), 'utf8')); } catch (_) { return false; }
  if (!data || !data.pid) return false;
  try { process.kill(data.pid, 0); return true; } catch (_) { return false; }
}
// Fichiers qu'une AUTRE instance, vivante en ce moment (enfant détaché, parent en cours), est en train
// d'écrire : ils ne sont pas à committer par celle-ci. Sans ce filtre, un parent qui clôt sa session
// pendant que son enfant détaché travaille était forcé de committer les fichiers de l'enfant, à
// mi-écriture (dogfooding §3.9 du 2026-09-10). Un ancêtre vivant ne masque que sa fiche registre :
// son sous-arbre et sa zone shared/ contiennent ceux de l'instance courante.
function enVolDAutrui(root, instance) {
  const autres = allInstances(root).filter((i) => i !== instance && isLiveInstance(root, i));
  if (!autres.length) return null;
  const prefixes = [];
  for (const a of autres) {
    prefixes.push(`mission/registry/instances/${a.replace(/\//g, '-')}.md`);
    if (!instance.startsWith(`${a}/`)) prefixes.push(`mission/${a}/`, `mission/shared/${a}/`);
  }
  return (rel) => prefixes.some((p) => rel === p || rel.startsWith(p));
}

// ---------------------------------------------------------------------------
function sleepGuard(ctx) {
  const { root, instance, input } = ctx;
  const st = parseStatus(readIf(path.join(root, 'mission', instance, 'STATUS.md')));
  if (!st.etat) return ok(); // instance absente (ex. bootstrap arrêté à la validation) : rien à exiger
  const voluntary = /hibernation volontaire/i.test(st.note || '');
  const problems = [];
  if (st.etat === 'WORKING' && !voluntary) {
    problems.push('`STATUS.md` indique encore WORKING — mets-le à ton état réel (DELIVERED, BLOCKED, WAITING_CHILDREN ou FAILED) ; laisse WORKING uniquement pour une hibernation volontaire, en écrivant dans sa Note « hibernation volontaire (contexte) » ou, après un changement de Profil/Effort dans ta fiche registre, « hibernation volontaire (changement de régime : <ancien> → <nouveau>) »');
  }
  if (st.etat === 'WAITING_CHILDREN' || st.etat === 'BLOCKED') {
    const ast = st.reveil && st.reveil !== '—' ? reveil.parseReveil(st.reveil) : null;
    if (!ast) {
      problems.push(`ligne \`Réveil\` de STATUS.md vide ou invalide pour un état ${st.etat} — écris une condition valide avant d'hiberner : \`terme | tous(liste) | lun(liste)\`, termes possibles \`message:TYPE\`, \`enfant:NOM:ETAT\`, \`enfants:ETAT\`, \`fichier:CHEMIN\`, \`date:ISO8601\` (docs/IMPLEMENTATION.md §3.1, module direct-spawn v1.2.0).`);
    }
  }
  if ((process.env.HOLARCH_COMMIT || 'oui') !== 'non') {
    // Racine : toute la mission (elle seule répond de l'ensemble) ; enfant : son sous-arbre, le registre et sa zone de publication.
    const scope = instance.includes('/') ? [`mission/${instance}`, 'mission/registry', `mission/shared/${instance}`] : ['mission'];
    const dirty = gitDirtyCount(root, scope, enVolDAutrui(root, instance));
    if (dirty) problems.push(`${dirty} fichier(s) de mission/ non committé(s) — \`git add -A && git commit -m "[${instance}] <résumé>"\` (KERNEL §5.6)`);
  }
  // Bornes du module memoire/unites-indexees.md : ne s'appliquent que si ce module est actif (à la
  // différence du fusible de budget ci-dessus, ce n'est pas une garantie du harnais mais le renfort
  // d'un module optionnel — spec §2.4).
  if (activeModules(root).includes('unites-indexees')) {
    const mem = readIf(path.join(root, 'mission', instance, 'MEMORY.md'));
    if (mem) {
      const lines = mem.split('\n');
      const tropLongue = lines.some((l) => l.length > UNITES_LIGNE_MAX_CHARS);
      if (tropLongue) problems.push(`une ligne de \`MEMORY.md\` dépasse ${UNITES_LIGNE_MAX_CHARS} caractères (module unites-indexees) — reformule en plusieurs lignes courtes`);
      const corps = lines.filter((l) => !/^#+\s/.test(l));
      if (corps.length > UNITES_MEMOIRE_MAX_LIGNES) problems.push(`\`MEMORY.md\` dépasse ${UNITES_MEMOIRE_MAX_LIGNES} lignes hors titres de section (module unites-indexees) — synthétise, renvoie aux fiches \`memoire/U<n>-….md\` pour le détail`);
    }
  }
  // Constat bloquant sans message : « impossible / bloqué / refusé » dans la dernière entrée du journal ou la fiche
  // d'unité la plus récente, sans BLOCKER, CLARIFICATION ni PROPOSAL envoyé ce jour et sans « constat non bloquant » —
  // un implémenteur a tenu trois sessions sur un constat faux sans le remonter (holarch-delegation, 2026-09-11).
  const constat = constatSansMessage(root, instance);
  if (constat) problems.push(constat);
  if (!problems.length) return ok();
  const state = loadState(input.session_id);
  state.stopBlocks = (state.stopBlocks || 0) + 1;
  saveState(input.session_id, state);
  if (state.stopBlocks > STOP_BLOCKS_MAX) return ok(); // on laisse finir : le lanceur signalera l'état anormal
  emit({
    decision: 'block',
    reason: `[HOLARCH · garde-fou ON_SLEEP ${state.stopBlocks}/${STOP_BLOCKS_MAX}] Avant de terminer : ${problems.join(' ; ')}. Vérifie aussi que MEMORY.md, JOURNAL.md (si requis par le module mémoire actif) et ta fiche registre sont à jour, puis termine.`,
  });
}

function constatSansMessage(root, instance) {
  const base = path.join(root, 'mission', instance);
  const journal = readIf(path.join(base, 'JOURNAL.md')) || '';
  const entrees = journal.split(/^## /m);
  let texte = entrees[entrees.length - 1] || '';
  try {
    const dir = path.join(base, 'memoire');
    const fiches = fs.readdirSync(dir).filter((f) => /^U\d+/.test(f)).sort((a, b) => parseInt(b.match(/\d+/)[0], 10) - parseInt(a.match(/\d+/)[0], 10));
    if (fiches.length) texte += '\n' + (readIf(path.join(dir, fiches[0])) || '');
  } catch (_) { /* pas de mémoire adressée */ }
  const motif = texte.match(/\b(impossible|bloqu[ée]e?s?|refus[ée]e?s?|ne (?:peut|peux) pas)\b/i);
  if (!motif || /constat non bloquant/i.test(texte)) return '';
  const parent = instance.includes('/') ? instance.split('/').slice(0, -1).join('/') : null;
  const cibles = [path.join(base, 'OUTBOX.md')];
  if (parent) cibles.push(path.join(root, 'mission', parent, 'INBOX.md'));
  const jour = new Date().toISOString().slice(0, 10);
  const inst = instance.replace(/[/.]/g, '\\$&');
  const re = new RegExp(`^from:\\s*${inst}\\s*$[\\s\\S]*?^type:\\s*(BLOCKER|CLARIFICATION|PROPOSAL)\\s*$[\\s\\S]*?^date:\\s*${jour}`, 'm');
  for (const c of cibles) if (re.test(readIf(c) || '')) return '';
  return `ton journal ou ta dernière fiche dit « ${motif[0]} » sans BLOCKER, CLARIFICATION ni PROPOSAL envoyé aujourd'hui — envoie le message à ton parent, ou écris « constat non bloquant : <pourquoi> » dans JOURNAL.md`;
}

// Enfants directs réellement incarnés de `instance` : sous-répertoires de mission/<instance>/ (hors workspace/) qui
// portent leur propre STATUS.md. Recompté depuis le disque plutôt que lu sur la fiche du parent (colonne « Budget
// alloué / consommé », auto-déclarée et jamais recalculée) — constat A2, audit indépendant du 2026-09-03 : cette
// fiche peut être fausse (sous-évaluée) sans que rien ne le détecte.
// Chantier 3 (git-branches 1.1.0, dogfooding du 2026-09-10) : sous `isolation = worktree`, les fichiers d'un enfant
// n'existent PAS sur disque dans l'arbre du parent — ON_SPAWN les commit sur la branche de l'enfant puis le parent
// revient sur sa propre branche ; à la ré-incarnation ils vivent dans le worktree de l'enfant. Le fusible résout
// donc chaque fichier d'enfant dans cet ordre : disque (aucune/branche, ou parent encore sur la branche de
// l'enfant) → worktree de l'enfant → branche de l'enfant (`git cat-file -e`), exactement ce que git-branches
// prescrit au parent en ON_CHILD_DONE (`git show <branche>:…`).
function gitBranches(root) {
  if (!activeModules(root).includes('git-branches')) return null;
  const isolation = configParam(root, 'isolation') || 'worktree';
  if (isolation === 'aucune') return null;
  return { isolation, prefixe: configParam(root, 'prefixe_branche') || 'holarch/' };
}
function brancheDe(gb, chemin) { return `${gb.prefixe}${chemin.replace(/\//g, '-')}`; }
function worktreeDe(root, chemin) { return path.join(root, 'mission', '.holarch', 'worktrees', chemin.replace(/\//g, '-')); }
function surBranche(root, branche, rel) {
  const r = spawnSync('git', ['-C', root, 'cat-file', '-e', `${branche}:${rel}`], { encoding: 'utf8' });
  return r.status === 0;
}
/** `rel` est relatif à la racine du dépôt (ex. mission/<enfant>/ROLE.md, mission/registry/instances/<tirets>.md). */
function childFileExists(root, chemin, rel, gb) {
  if (exists(path.join(root, rel))) return true;
  if (!gb) return false;
  if (gb.isolation === 'worktree' && exists(path.join(worktreeDe(root, chemin), rel))) return true;
  return surBranche(root, brancheDe(gb, chemin), rel);
}
function countChildren(root, instance, gb) {
  const dir = path.join(root, 'mission', instance);
  const noms = new Set();
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { /* pas de sous-arbre sur disque */ }
  for (const e of entries) if (e.isDirectory() && e.name !== 'workspace' && exists(path.join(dir, e.name, 'STATUS.md'))) noms.add(e.name);
  if (gb) {
    // Union avec les enfants dont la branche existe : `git ls-tree` de chaque branche `<prefixe><instance-tirets>-*`,
    // en ne retenant que les STATUS.md d'un enfant DIRECT de `instance` (le nommage en tirets est ambigu, le
    // contenu de la branche ne l'est pas).
    const motif = `${brancheDe(gb, instance)}-*`;
    const list = spawnSync('git', ['-C', root, 'branch', '--list', '--format=%(refname:short)', motif], { encoding: 'utf8' });
    const re = new RegExp(`^mission/${instance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([^/]+)/STATUS\.md$`);
    for (const b of (list.stdout || '').split('\n').map((s) => s.trim()).filter(Boolean)) {
      const tree = spawnSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', b, '--', `mission/${instance}/`], { encoding: 'utf8' });
      for (const f of (tree.stdout || '').split('\n')) { const m = f.trim().match(re); if (m) noms.add(m[1]); }
    }
  }
  return noms.size;
}

function spawnGuard(ctx) {
  const { root, instance, input } = ctx;
  if (input.tool_name !== 'Bash') return ok();
  const cmd = String((input.tool_input && input.tool_input.command) || '');
  // Ne considère que les segments qui INVOQUENT réellement le lanceur (en tête de segment, éventuellement après des
  // affectations de variables d'environnement) — pas toute commande qui mentionne la sous-chaîne "holarch-spawn.js"
  // en passant (ex. `wc -l` sur son propre source, un message qui le cite) — constat A5, audit indépendant.
  const segments = cmd.split(/[;&|]+/).map((s) => s.trim());
  const invoke = segments.find((s) => /^(?:\S+=\S*\s+)*node\s+\S*holarch-spawn\.js(?:\s|$)/.test(s));
  if (!invoke) return ok();
  const deny = (why) => emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[HOLARCH · fusible spawn] ${why}` } });
  if (/--bootstrap/.test(invoke)) return deny("le bootstrap se lance une seule fois, par l'utilisateur — jamais depuis une instance.");
  if (/(^|\s)--reveil(\s|$)/.test(invoke)) return deny("--reveil est réservé au harnais et à l'utilisateur : une instance ne réveille jamais elle-même le reste de la holarchie.");
  if (/(^|\s)--arret(\s|$)/.test(invoke)) return deny("--arret est réservé au harnais et à l'utilisateur : une instance ne s'arrête ni n'arrête une autre instance par ce biais.");
  const after = invoke.split(/holarch-spawn\.js/)[1] || '';
  const tokens = after.trim().split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean);
  let target = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (VALUE_OPTS.has(t)) { i++; continue; }
    if (t.startsWith('-')) continue;
    target = t; break;
  }
  target = target.replace(/^mission\//, '').replace(/\/+$/, '');
  if (!target) return deny("chemin d'instance manquant.");
  // --dry-run ne lance rien : contrôle de forme seulement, pas les règles d'autorisation (cible, profondeur, budget)
  // — sans quoi une instance ne peut même pas vérifier son propre lancement (CLAUDE.md l'exige avant tout changement
  // du harnais), constat A5.
  if (/(^|\s)--dry-run(\s|$)/.test(invoke)) return ok();
  if (!target.startsWith(`${instance}/`)) return deny(`tu ne peux incarner que tes propres enfants directs (\`${instance}/<nom>\`) — cible demandée : \`${target}\` (KERNEL §4).`);
  if (target.slice(instance.length + 1).includes('/')) return deny(`\`${target}\` n'est pas un enfant direct de \`${instance}\` : chaque parent incarne ses propres enfants.`);
  const gb = gitBranches(root);
  const ou = gb ? ` (ni sur disque, ni dans son worktree, ni sur sa branche \`${brancheDe(gb, target)}\`)` : '';
  for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) {
    if (!childFileExists(root, target, `mission/${target}/${f}`, gb)) return deny(`mission/${target}/${f} absent${ou} — applique d'abord la mécanique structurelle du spawn (KERNEL §9).`);
  }
  if (!childFileExists(root, target, path.relative(root, fichePath(root, target)), gb)) return deny(`fiche registre \`registry/instances/${target.replace(/\//g, '-')}.md\` absente${ou} (module registre, ON_SPAWN).`);
  const pmax = Number(configParam(root, 'profondeur_max'));
  const depth = target.split('/').length;
  if (pmax && depth > pmax) return deny(`profondeur ${depth} > profondeur_max ${pmax} (module max-depth) : fais le travail toi-même ou émets un BLOCKER.`);
  const parent = parseFiche(readIf(fichePath(root, instance)));
  if (parent.alloue !== null) {
    if (parent.alloue <= 0) return deny('ton budget d\'instances alloué est nul (module instance-budget) : spawn interdit — fais le travail toi-même ou émets un BLOCKER motivé.');
    // `target` a déjà ses ROLE.md/STATUS.md/MEMORY.md sur disque à ce point (mécanique KERNEL §9 vérifiée plus
    // haut) : `countChildren` le compte donc lui-même, qu'il s'agisse de sa toute première incarnation ou d'une
    // ré-incarnation. `>=` refusait à tort le N-ième enfant d'un budget N (il se compte lui-même en atteignant
    // N) ; seul un compte qui DÉPASSE alloué signale un vrai dépassement (RAPPORT-iteration-9 §8, D32).
    const consumed = countChildren(root, instance, gb);
    if (consumed > parent.alloue) return deny(`budget d'instances dépassé : ${consumed} enfant(s) déjà incarné(s) (celui-ci compris) > alloué ${parent.alloue} (module instance-budget, recompté depuis mission/${instance}/${gb ? ' et depuis les branches d\'enfants' : ''} — pas depuis ta fiche registre).`);
  }
  return ok();
}

function wakeGuard(ctx) {
  const { root, instance, input } = ctx;
  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') return ok();
  const target = String((input.tool_input && input.tool_input.file_path) || '');
  if (!target) return ok();
  const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
  const ownFiche = `mission/registry/instances/${instance.replace(/\//g, '-')}.md`;
  if (rel.startsWith(`mission/${instance}/`) || rel === 'mission/registry/PROGRESS.md' || rel === ownFiche) return ok();
  if (!rel.startsWith('mission/')) return ok(); // hors mission/ (ex. dépôt --add-dir) : hors périmètre de ce garde-fou
  const st = parseStatus(readIf(path.join(root, 'mission', instance, 'STATUS.md')));
  if (!st.etat) return ok(); // instance pas encore incarnée (mécanique de spawn en cours)
  const state = loadState(input.session_id);
  if (state.wakeGateOpen) return ok();
  // Baseline fournie par le lanceur (taille de PROGRESS.md avant le lancement, HOLARCH_PROGRESS_BASELINE) plutôt que
  // posée au premier appel gaté du hook : une instance conforme écrit son ON_ORIENT *avant* sa première production
  // hors de son arbre (KERNEL §2, phases 1-2 avant le reste) — poser la baseline ici la ratait systématiquement et
  // refusait la toute première écriture d'une instance qui avait pourtant déjà fait ce qu'on lui demandait
  // (constat A6, audit indépendant du 2026-09-03, reproduit deux fois en conditions réelles).
  const baseline = Number(process.env.HOLARCH_PROGRESS_BASELINE) || 0;
  const active = ['WORKING', 'WAITING_CHILDREN', 'BLOCKED'].includes(st.etat);
  const progress = readIf(path.join(root, 'mission', 'registry', 'PROGRESS.md')) || '';
  const fresh = progress.slice(baseline);
  const orientRe = new RegExp(`· ${instance.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} · ON_ORIENT ·`);
  if (active && orientRe.test(fresh)) {
    state.wakeGateOpen = true;
    saveState(input.session_id, state);
    return ok();
  }
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: '[HOLARCH · garde-fou ON_ORIENT] Avant d\'écrire hors de ton propre arbre (mission/<chemin>/) : passe STATUS.md à un état actif (WORKING, WAITING_CHILDREN ou BLOCKED) et ajoute ta ligne ON_ORIENT à registry/PROGRESS.md (module heartbeat-log, KERNEL §2 phases 1-2) — pas un blocage, une correction immédiate.',
    },
  });
}

// Refuse tout Write/Edit sous framework/, docs/, tools/ ou sur mission/OBJECTIVE.md — hors du cas normal
// d'une instance qui écrit dans son propre arbre mission/ (KERNEL, module framework-guard, chantier 7 U2 §9.4).
// Ces répertoires sont le produit et la documentation du harnais, pas la production d'une mission : une instance
// n'y écrit jamais, quel que soit son état (à la différence de wake-guard, indépendante de STATUS.md/ON_ORIENT).
function frameworkGuard(ctx) {
  const { root, input } = ctx;
  if (input.tool_name !== 'Write' && input.tool_name !== 'Edit') return ok();
  const target = String((input.tool_input && input.tool_input.file_path) || '');
  if (!target) return ok();
  const rel = path.relative(root, path.resolve(root, target)).split(path.sep).join('/');
  const interdit = rel.startsWith('framework/') || rel.startsWith('docs/') || rel.startsWith('tools/') || rel === 'mission/OBJECTIVE.md';
  if (!interdit) return ok();
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `[HOLARCH · garde-fou framework-guard] \`${rel}\` est hors de ton arbre de mission (framework/, docs/, tools/ et mission/OBJECTIVE.md sont le harnais, pas ta production) : travaille sous mission/<ton-chemin>/ ou mission/shared/<ton-chemin>/.`,
    },
  });
}

/**
 * git-guard (1.15.1) : une instance n'écrit jamais hors de `mission/` (KERNEL §4) — elle n'a donc jamais à y indexer
 * quoi que ce soit. Refuse `git add` sans pathspec restreint à mission/ (`-A`, `--all`, `.`, `-u`, `:/`) et tout
 * `git commit -a`/`--all`/`-am` : le 2026-09-11 la racine, qui travaille dans l'arbre principal partagé, a embarqué
 * dans son commit deux fichiers d'outillage qu'une session de maintenance venait de modifier. Un `git add` dont chaque
 * chemin est sous mission/ passe (`git add -A mission/`, `git add mission/concepteur/JOURNAL.md`).
 */
function gitGuard(ctx) {
  const { input } = ctx;
  if (input.tool_name !== 'Bash') return ok();
  const cmd = String((input.tool_input && input.tool_input.command) || '');
  const deny = (why) => emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[HOLARCH · garde-fou git-guard] ${why}` } });
  for (const seg of cmd.split(/[;&|]+/).map((s) => s.trim())) {
    const m = seg.match(/^(?:\S+=\S*\s+)*git\s+(?:-C\s+\S+\s+)?(add|commit)\b(.*)$/);
    if (!m) continue;
    const tokens = m[2].trim().split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, '')).filter(Boolean);
    if (m[1] === 'commit') {
      if (tokens.some((t) => t === '--all' || /^-[a-zA-Z]*a[a-zA-Z]*$/.test(t))) return deny("`git commit -a` indexe tout l'arbre, y compris ce qu'une autre session a en cours : nomme tes fichiers avec `git add mission/...` puis `git commit` sans -a.");
      continue;
    }
    const paths = tokens.filter((t) => !t.startsWith('-') || t === '.' || t === ':/');
    const wide = tokens.some((t) => t === '-A' || t === '--all' || t === '-u' || t === '--update' || t === '.' || t === ':/' || t.startsWith(':/'));
    if (!paths.length && wide) return deny("`git add -A`/`-u`/`.` sans pathspec indexe tout l'arbre, y compris ce qu'une autre session a en cours : restreins à ton arbre (`git add -A mission/` ou des chemins sous mission/).");
    const hors = paths.filter((p) => p !== '.' && p !== ':/' && !/^(\.\/)?mission\//.test(p));
    if (hors.length) return deny(`\`git add ${hors.join(' ')}\` indexe hors de mission/ (framework/, docs/, tools/ sont le harnais, pas ta production) : une instance ne stage que sous mission/.`);
    if (paths.some((p) => p === '.' || p === ':/')) return deny("`git add .` indexe tout l'arbre : restreins à mission/.");
  }
  return ok();
}

function lastAssistantUsage(transcriptPath) {
  let fd = null;
  try {
    const size = fs.statSync(transcriptPath).size;
    const span = Math.min(size, 1024 * 1024);
    const buf = Buffer.alloc(span);
    fd = fs.openSync(transcriptPath, 'r');
    fs.readSync(fd, buf, 0, span, size - span);
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line.includes('"assistant"') || !line.includes('"usage"')) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.type === 'assistant' && obj.message && obj.message.usage) return obj.message.usage;
      } catch (_) { /* ligne tronquée ou non-JSON */ }
    }
  } catch (_) { /* pas de transcription */ } finally { if (fd !== null) fs.closeSync(fd); }
  return null;
}

// Chantier 7, §9.2 : liste de contrôle ON_SLEEP complète, injectée en plus de l'ordre d'hiberner
// (KERNEL §2 phase 9 et §5.8) au franchissement du seuil de contexte — l'ordre existait déjà, cette
// liste ne fait que l'expliciter point par point pour réduire le risque d'oubli en fin de session.
const CHECKLIST_ON_SLEEP = 'Liste de contrôle ON_SLEEP : ☐ MEMORY.md réécrit en entier (État courant / Décisions prises / Prochaines actions / Points de vigilance) ☐ fiche memoire/U<n>-….md de l\'unité en cours si elle s\'achève ici ☐ STATUS.md à l\'état réel, Note d\'hibernation posée ☐ entrée JOURNAL.md ☐ fiche registre à jour (Statut, budget consommé, Profil/Effort, livrables) ☐ commit Git [<ton chemin>] ….';

/**
 * SessionStart (chantier 7, §9.2) : rappelle, au réveil, le contexte de départ mesuré à la session
 * précédente de cette instance (dernière ligne de registry/SESSIONS.md la concernant, colonne
 * « Contexte (départ / max) ») et la discipline du module mémoire `unites-indexees` — sans lire ni
 * dupliquer le prompt utilisateur du lanceur, qui porte déjà cette information en détail : ce hook
 * n'est qu'un rappel court, redondant par construction (deux canaux plutôt qu'un, §9.2). Fail-open :
 * silence (`ok()`) si registry/SESSIONS.md est absent ou ne mentionne pas encore cette instance.
 */
function sessionStart(ctx) {
  const { root, instance } = ctx;
  const txt = readIf(path.join(root, 'mission', 'registry', 'SESSIONS.md'));
  let contexte = null;
  if (txt) {
    const lignes = txt.split('\n').filter((l) => l.startsWith('|') && l.includes(`| ${instance} |`));
    if (lignes.length) {
      const cellules = lignes[lignes.length - 1].split('|').map((c) => c.trim()).filter((c) => c.length);
      const derniere = cellules[cellules.length - 1];
      if (derniere && derniere !== '— / —') contexte = derniere;
    }
  }
  const rappelContexte = contexte ? `Ta session précédente avait démarré avec un contexte de ${contexte} tokens (registry/SESSIONS.md). ` : '';
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `[HOLARCH · rappel d'orientation] ${rappelContexte}Discipline mémoire (module unites-indexees) : plan de session = 1 à 3 unités numérotées U<n>, un commit par unité achevée, une fiche memoire/U<n>-….md à chaque unité (réussie, échouée ou partielle) ; ne relis que ce que ton plan cite explicitement — jamais un fichier entier par anticipation.`,
    },
  });
}

/** Messages apparus dans INBOX.md depuis le premier appel du hook (l'état de session retient les identifiants déjà
 *  vus ; ceux présents au lancement étaient dans le prompt). Renvoie une note à injecter, ou ''. */
function courrierNouveau(root, instance, state) {
  const txt = readIf(path.join(root, 'mission', instance, 'INBOX.md'));
  if (txt === null) return '';
  const ids = []; const meta = {};
  for (const bloc of txt.split(/^---\s*$/m)) {
    const id = (bloc.match(/^id:\s*(.+)$/m) || [])[1];
    if (!id) continue;
    const t = id.trim(); ids.push(t);
    meta[t] = { type: ((bloc.match(/^type:\s*(\S+)/m) || [])[1] || '?'), from: ((bloc.match(/^from:\s*(\S+)/m) || [])[1] || '?') };
  }
  if (!Array.isArray(state.seenIds)) { state.seenIds = ids; return ''; }
  const nouveaux = ids.filter((i) => !state.seenIds.includes(i));
  if (!nouveaux.length) return '';
  state.seenIds = ids;
  return `[HOLARCH · courrier] ${nouveaux.length} message(s) arrivé(s) dans ton INBOX.md depuis le début de la session : ${nouveaux.map((i) => `${i} (${meta[i].type} de ${meta[i].from})`).join(', ')}. Lis-le(s) maintenant (\`grep -n '^id: ' mission/${instance}/INBOX.md\` puis \`sed -n\`) : un TASK ou une RESPONSE de ton parent ou du mainteneur s'applique immédiatement, avant l'unité suivante.`;
}

function contextWatch(ctx) {
  const { root, instance, input } = ctx;
  // Chantier 7, §9.1/9.3 : une transcription de sous-agent (`Agent`, module delegation-intra-session)
  // vit sous `<sid>/subagents/` — elle ne doit jamais déclencher l'ordre d'hiberner l'instance : le
  // sous-agent n'est pas l'instance, son contexte lui est propre et se referme à sa propre fin.
  if (input.transcript_path && input.transcript_path.includes('/subagents/')) return ok();
  const stopFile = path.join(root, 'mission', '.holarch', 'stop', instance.replace(/\//g, '-'));
  const state0 = loadState(input.session_id);
  if (exists(stopFile) && !state0.stopRequested) {
    state0.stopRequested = true;
    saveState(input.session_id, state0);
    emit({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: "[HOLARCH · arrêt demandé] Un arrêt propre a été demandé pour cette instance (--arret). Ne commence aucune nouvelle unité de travail : termine celle en cours, puis hiberne — MEMORY.md complet pour ton futur toi, entrée JOURNAL.md, STATUS.md laissé à ton état réel avec la Note « hibernation volontaire (arrêt demandé) », fiche registre à jour, commit, puis termine la session. Le lanceur ne te ré-incarnera pas automatiquement après cette note (à la différence d'une hibernation de contexte ou de budget).",
      },
    });
    return;
  }
  if (!input.transcript_path) return ok();
  const limit = Number(process.env.HOLARCH_CONTEXT_LIMIT) || 120000;
  const usage = lastAssistantUsage(input.transcript_path);
  if (!usage) return ok();
  const tokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  updateContexteLive(root, instance, input.session_id, tokens);
  const state = loadState(input.session_id);
  const notes = [];
  // Courrier arrivé en cours de session : un message écrit après le lancement n'était lu qu'à la session suivante —
  // une session entière tournant sur d'anciennes consignes à chaque réglage du mainteneur (trois fois le 2026-09-11).
  const courrier = courrierNouveau(root, instance, state);
  if (courrier) notes.push(courrier);
  const k = (n) => `${Math.round(n / 1000)}k`;
  if (tokens < limit) {
    // Fait de contexte à chaque palier de FACT_STEP sous le seuil : l'instance sait où elle en est et n'hiberne pas par
    // habitude (hibernation à 139k sous un fusible à 250k, constatée le 2026-09-11).
    const palier = Math.floor(tokens / FACT_STEP);
    if (palier > (state.lastFactPalier || 0)) {
      state.lastFactPalier = palier;
      notes.push(`[HOLARCH · contexte] ~${k(tokens)} tokens sur un seuil de ${k(limit)} : ${k(limit - tokens)} de marge. N'hiberne pas pour le contexte tant que ce hook ne te le demande pas ; enchaîne l'unité suivante de ton plan de session.`);
    }
    saveState(input.session_id, state);
    if (!notes.length) return ok();
    emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } });
    return;
  }
  if (tokens < (state.lastWarnAt || 0) + WARN_STEP) {
    saveState(input.session_id, state);
    if (!notes.length) return ok();
    emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } });
    return;
  }
  state.lastWarnAt = tokens;
  saveState(input.session_id, state);
  const hard = tokens >= limit * 1.25;
  emit({
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: `${notes.length ? `${notes.join('\n')}\n` : ''}[HOLARCH · budget de contexte${hard ? ' — DÉPASSEMENT' : ''}] Contexte de cette session : ~${k(tokens)} tokens (seuil ${k(limit)}). ${hard ? 'Ne commence aucune nouvelle unité de travail.' : "Termine l'unité de travail en cours sans en commencer une autre."} Puis hiberne volontairement (module context-budget, KERNEL §5.8) : MEMORY.md complet pour ton futur toi, entrée JOURNAL.md, STATUS.md laissé à ton état réel avec la Note « hibernation volontaire (contexte) », fiche registre à jour, commit, puis termine la session. Le lanceur holarch-spawn te ré-incarnera automatiquement avec un contexte neuf. ${CHECKLIST_ON_SLEEP}`,
    },
  });
}

// ---------------------------------------------------------------------------
function main() {
  const event = process.argv[2] || '';
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) { input = {}; }
  const instance = process.env.HOLARCH_INSTANCE || '';
  if (!instance) return ok(); // hors lanceur : inerte
  const root = process.env.HOLARCH_ROOT || input.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const ctx = { root, instance, input };
  try {
    if (event === 'session-start') return sessionStart(ctx);
    if (event === 'sleep-guard') return sleepGuard(ctx);
    if (event === 'spawn-guard') return spawnGuard(ctx);
    if (event === 'wake-guard') return wakeGuard(ctx);
    if (event === 'framework-guard') return frameworkGuard(ctx);
    if (event === 'git-guard') return gitGuard(ctx);
    if (event === 'context-watch') return contextWatch(ctx);
    return ok();
  } catch (e) {
    process.stderr.write(`holarch-hooks ${event}: ${e && e.message}\n`);
    return ok();
  }
}

module.exports = { parseStatus, parseFiche, lastAssistantUsage, activeModules, STOP_BLOCKS_MAX, WARN_STEP, UNITES_LIGNE_MAX_CHARS, UNITES_MEMOIRE_MAX_LIGNES, contexteLivePath, updateContexteLive, frameworkGuard };
if (require.main === module) main();
