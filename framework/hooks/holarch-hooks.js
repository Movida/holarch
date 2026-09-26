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
let budgetWatchModule = null;
try { budgetWatchModule = require(path.join(__dirname, 'budget-watch.js')); } catch (_) { budgetWatchModule = null; } // fail-open : un fixture de test peut copier holarch-hooks.js seul, sans budget-watch.js

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
  const prefixes = [];
  for (const a of autres) {
    prefixes.push(`mission/registry/instances/${a.replace(/\//g, '-')}.md`);
    if (!instance.startsWith(`${a}/`)) prefixes.push(`mission/${a}/`, `mission/shared/${a}/`);
  }
  // Chantier 16 §18.6 (lots payants) : `mission/registry/COUTS-SERVICES.md` s'ajoute aux fichiers
  // ignorés tant qu'un verrou de lot vivant appartient à un autre propriétaire — même règle que les
  // autres instances vivantes ci-dessus (require paresseux : `lots.js` peut être absent tant que ce
  // paquet n'est pas promu, ou toute autre erreur de lecture — meilleur effort, jamais bloquant).
  let lotAutrui = false;
  try {
    const lots = require('../bin/lots');
    const jobsMod = require('../bin/jobs');
    const racinePrincipale = jobsMod.racine(root);
    // Revue n° 28 : jamais ignoré si mes propres lignes de coût y sont encore non committées.
    lotAutrui = lots.verrousLotVivants(racinePrincipale).some((v) => v.proprietaire !== instance)
      && !lots.coutsNonCommitesDe(root, instance);
  } catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') { /* meilleur effort : toute autre erreur est ignorée aussi */ }
  }
  if (!autres.length && !lotAutrui) return null;
  if (lotAutrui) prefixes.push('mission/registry/COUTS-SERVICES.md');
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
  // Seconde revue n° 50 : le saut de ligne sépare aussi les commandes, et une commande n'invoque le lanceur qu'une
  // fois — sinon seul le premier segment (souvent un --dry-run, qui passe sans règle) était contrôlé et le suivant
  // (`… --dry-run && node … --detach --budget-usd 999`) lançait sans aucune.
  const segments = cmd.split(/[;&|\n]+/).map((s) => s.trim());
  const invoke = segments.find((s) => /^(?:\S+=\S*\s+)*node\s+\S*holarch-spawn\.js(?:\s|$)/.test(s));
  if (!invoke) return ok();
  const deny = (why) => emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[HOLARCH · fusible spawn] ${why}` } });
  if ((cmd.match(/holarch-spawn\.js/g) || []).length > 1) return deny('une seule mention du lanceur par commande qui l\'invoque : lance chaque enfant (et son éventuel --dry-run) par une commande Bash distincte.');
  // Seconde revue n° 63 : --reprendre relance toute tâche au pid mort de la holarchie avec ses surcharges d'origine
  // (celles du mainteneur comprises) — geste du mainteneur, comme --reveil et --arret, jamais d'une instance.
  if (/(^|\s)--reprendre(\s|$)/.test(invoke)) return deny("--reprendre est réservé à l'utilisateur : il relance les tâches de toute la holarchie avec leurs surcharges d'origine, jamais depuis une instance.");
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
  // Chantier 17, §17.3 : une ligne « Veille » de la fiche de l'enfant ne s'accorde qu'à un profil conception ou
  // exploration (profil absent = execution, défaut d'un enfant). Fiche lue comme `childFileExists` la trouve :
  // arbre du parent, worktree de l'enfant, sinon sa branche.
  {
    const relFiche = path.relative(root, fichePath(root, target)).split(path.sep).join('/');
    let texteFiche = readIf(fichePath(root, target));
    if (!texteFiche && gb && gb.isolation === 'worktree') texteFiche = readIf(path.join(worktreeDe(root, target), relFiche));
    if (!texteFiche && gb) {
      const r = spawnSync('git', ['-C', root, 'show', `${brancheDe(gb, target)}:${relFiche}`], { encoding: 'utf8' });
      if (r.status === 0) texteFiche = r.stdout;
    }
    const veille = require(path.join(__dirname, '..', 'bin', 'veille.js'));
    const refusVeille = veille.refusVeille(veille.lireVeille(texteFiche), veille.lireProfil(texteFiche) || 'execution');
  // Chantier 16, §18.2 (docs/IMPLEMENTATION.md) : même refus que le lanceur pour une ligne « Budget USD
  // / session » de la fiche de l'enfant illisible ou au-delà de budget_usd_session_max — même lecture de
  // fiche (arbre du parent, worktree de l'enfant, sinon sa branche) que pour Veille juste au-dessus.
  {
    const relFiche = path.relative(root, fichePath(root, target)).split(path.sep).join('/');
    let texteFicheBudget = readIf(fichePath(root, target));
    if (!texteFicheBudget && gb && gb.isolation === 'worktree') texteFicheBudget = readIf(path.join(worktreeDe(root, target), relFiche));
    if (!texteFicheBudget && gb) {
      const r = spawnSync('git', ['-C', root, 'show', `${brancheDe(gb, target)}:${relFiche}`], { encoding: 'utf8' });
      if (r.status === 0) texteFicheBudget = r.stdout;
    }
    const budgetSession = require(path.join(__dirname, '..', 'bin', 'budget-session.js'));
    const refusBudget = budgetSession.refusBudgetFiche(
      budgetSession.lireBudgetFiche(texteFicheBudget),
      budgetSession.plafondEffectif({ budget_usd_session_max: configParam(root, 'budget_usd_session_max'), budget_usd_par_session: configParam(root, 'budget_usd_par_session') }),
    );
    // Seconde revue n° 61 : plafond illisible = refus, comme au lanceur (resoudreBudget), jamais 20 en silence.
    const refusMax = budgetSession.refusPlafond({ budget_usd_session_max: configParam(root, 'budget_usd_session_max') });
    if (refusMax) return deny(`${refusMax}.`);
    if (refusBudget) return deny(`fiche registre de \`${target}\` : ${refusBudget}.`);
    // Revue finale n° 50 : `--budget-usd` passé par une instance est soumis au même plafond que la fiche —
    // au-delà, seul le mainteneur (hors spawn-guard) le pose (§18.10, écart n° 7).
    // Seconde revue n° 50 : chaque occurrence est contrôlée — le lanceur garde la dernière, une option répétée
    // (`--budget-usd 5 --budget-usd 999`) ne passe plus par la première.
    for (let iBudget = 0; iBudget < tokens.length; iBudget++) {
      if (!(tokens[iBudget] === '--budget-usd' || tokens[iBudget].startsWith('--budget-usd='))) continue;
      const brut = tokens[iBudget].includes('=') ? tokens[iBudget].slice('--budget-usd='.length) : (tokens[iBudget + 1] || '');
      const usd = budgetSession.lireNombre(brut);
      const plafondCli = budgetSession.plafondEffectif({ budget_usd_session_max: configParam(root, 'budget_usd_session_max'), budget_usd_par_session: configParam(root, 'budget_usd_par_session') });
      if (!(usd > 0)) return deny(`--budget-usd illisible (« ${brut} ») : un nombre positif attendu (§18.2).`);
      if (usd > plafondCli) return deny(`--budget-usd ${usd} USD > plafond budget_usd_session_max (${plafondCli} USD, §18.2) : au-delà, geste du mainteneur seul.`);
    }
  }
    if (refusVeille) return deny(`fiche registre de \`${target}\` : ${refusVeille}.`);
  }
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

// Racine de l'arbre principal du dépôt vue depuis `root` (chantier 14, §15.1) : dans un worktree,
// `<root>/.git` est un FICHIER contenant `gitdir: <principal>/.git/worktrees/<nom>` — `readIf` échoue
// aussi bien sur une absence de fichier que sur un répertoire (EISDIR), ce qui rend `racinePrincipale`
// inerte (null) dans l'arbre principal sans test explicite. Repli sur le chemin du worktree lui-même
// (`.../mission/.holarch/worktrees/<nom>`) si le fichier `.git` ne porte pas la forme attendue.
function racinePrincipale(root) {
  const gitFile = readIf(path.join(root, '.git'));
  if (gitFile) {
    const m = gitFile.match(/^gitdir:\s*(.+?)\/\.git\/worktrees\//m);
    if (m) return m[1];
  }
  const marker = '/mission/.holarch/worktrees/';
  const idx = root.indexOf(marker);
  if (idx !== -1) return root.slice(0, idx);
  return null;
}

/**
 * path-guard (chantier 14, §15.1) : sous `isolation = worktree`, un chemin absolu qui pointe l'arbre
 * PRINCIPAL du dépôt (pas le worktree courant) porte des données périmées pour cette session — un
 * refus muet « hors du projet » a coûté 58 tours (docs/IMPLEMENTATION.md §15.1). Ce hook remplace ce
 * refus par un message qui nomme le chemin relatif à reprendre. Inerte dans l'arbre principal
 * (`racinePrincipale` y renvoie null ou root lui-même).
 */
function pathGuard(ctx) {
  const { root, input } = ctx;
  const principal = racinePrincipale(root);
  if (!principal || principal === root) return ok();
  const candidates = [];
  const fp = input.tool_input && input.tool_input.file_path;
  if (input.tool_name === 'Write' || input.tool_name === 'Edit' || input.tool_name === 'Read' || fp) {
    if (fp) candidates.push(String(fp));
  } else if (input.tool_name === 'Bash') {
    const cmd = String((input.tool_input && input.tool_input.command) || '');
    const re = /(?:^|[\s'"=:(,])(\/[^\s'"`;)|&]+)/g;
    const seen = new Set();
    let m;
    while ((m = re.exec(cmd)) !== null) {
      const c = m[1];
      if (c.length > 1 && !seen.has(c)) { seen.add(c); candidates.push(c); }
    }
  }
  for (const c of candidates) {
    if (c === root || c.startsWith(`${root}/`)) continue; // absolu dans le worktree : accepté
    if (c.startsWith(`${principal}/`)) {
      const rel = c.slice(principal.length + 1);
      emit({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[HOLARCH · garde-fou path-guard] \`${c}\` pointe l'arbre principal du dépôt (données périmées pour cette session), ta racine de travail est ${root}, le chemin relatif est \`${rel}\` — reprends avec ce chemin.`,
        },
      });
      return;
    }
    // relatif ou absolu hors des deux : hors du périmètre de ce garde-fou, accepté.
  }
  return ok();
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

// --- deliver-guard (chantier 15, §16.1) -------------------------------------------------------
// Un fichier présent n'est plus jamais pris pour un livrable conforme (docs/diagnostics/
// 2026-09-20-retex-montage-video-pacs.md) : tout message `type: DELIVERABLE` écrit dans un
// INBOX.md/OUTBOX.md doit citer, pour chaque livrable exigé par la table « Livrables » de sa
// source de rôle (ROLE.md d'un enfant, OBJECTIVE.md pour l'instance racine — sans `/` dans son
// chemin), la commande de contrôle déjà lancée avec un code 0, et une ligne « Regardé : » attestant
// une inspection humaine sur pièces. Inerte si la source ne porte pas de colonne « Contrôle »
// (compatibilité avec les missions existantes) ou si le message n'est pas un DELIVERABLE.
// Un `Write` réécrit tout le fichier (les anciens messages compris) : seul le texte réellement
// ajouté par l'appel d'outil est jugé, et chaque bloc `type: DELIVERABLE` de cet ajout est jugé
// séparément, avec sa propre section `## Contrôles` — un ancien DELIVERABLE déjà sur disque ne
// fait ni passer ni refuser un nouveau bloc à sa place.

/** Découpe une ligne de table markdown `| a | b | c |` en cellules trimées, sans les vides de bord. */
function splitRow(line) {
  let l = String(line || '').trim();
  if (l.startsWith('|')) l = l.slice(1);
  if (l.endsWith('|')) l = l.slice(0, -1);
  return l.split('|').map((c) => c.trim());
}
function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/**
 * Table « Livrables » d'un ROLE.md/OBJECTIVE.md : cherche la première ligne d'en-tête portant une
 * cellule `Livrable`. Sans cellule `Contrôle` dans ce même en-tête → `null` (inerte, compatibilité).
 * Sinon → tableau `{ livrable, controle }` (`controle` vide pour une cellule vide ou `—`).
 */
function parseLivrables(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const header = splitRow(lines[i]);
    const livIdx = header.findIndex((c) => c === 'Livrable');
    if (livIdx === -1) continue;
    const ctrlIdx = header.findIndex((c) => c === 'Contrôle');
    if (ctrlIdx === -1) return null;
    let j = i + 1;
    if (j < lines.length && /^\s*\|/.test(lines[j]) && isSeparatorRow(splitRow(lines[j]))) j++;
    const rows = [];
    for (; j < lines.length; j++) {
      if (!/^\s*\|/.test(lines[j])) break;
      const cells = splitRow(lines[j]);
      const controle = stripTicks(cells[ctrlIdx]);
      rows.push({ livrable: stripTicks(cells[livIdx]), controle: controle === '—' ? '' : controle });
    }
    return rows;
  }
  return null;
}

/**
 * Table `| Livrable | Commande | Code | Rapport |` de la section `## Contrôles` (ou `Contrôles :`)
 * d'un message : de cette ligne jusqu'à la prochaine ligne `## ` ou la fin. `[]` si la section ou la
 * table est absente.
 */
function parseControlesMessage(text) {
  const lines = String(text || '').split('\n');
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*##\s*Contr[ôo]les\s*$/.test(lines[i]) || /^\s*Contr[ôo]les\s*:/.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return [];
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  const section = lines.slice(start, end);
  for (let i = 0; i < section.length; i++) {
    if (!/^\s*\|/.test(section[i])) continue;
    const header = splitRow(section[i]);
    const idx = {};
    header.forEach((c, k) => { idx[c] = k; });
    if (idx.Commande === undefined || idx.Code === undefined) continue;
    let j = i + 1;
    if (j < section.length && /^\s*\|/.test(section[j]) && isSeparatorRow(splitRow(section[j]))) j++;
    const rows = [];
    for (; j < section.length; j++) {
      if (!/^\s*\|/.test(section[j])) break;
      const cells = splitRow(section[j]);
      rows.push({
        livrable: idx.Livrable !== undefined ? stripTicks(cells[idx.Livrable]) : '',
        commande: stripTicks(cells[idx.Commande]),
        code: stripTicks(cells[idx.Code]),
        rapport: idx.Rapport !== undefined ? stripTicks(cells[idx.Rapport]) : '',
      });
    }
    return rows;
  }
  return [];
}

/** Pour un `Write` dont la cible existe déjà sur disque et dont `content` commence par le contenu
 *  actuel du fichier : ne retient que la partie ajoutée après cet ancien contenu (une réécriture
 *  totale du fichier ne doit pas faire rejuger les DELIVERABLE déjà présents). Sinon (fichier absent,
 *  ou `content` ne commençant pas par l'ancien contenu) retourne `content` en entier. */
function texteAjouteWrite(chemin, content) {
  const ancien = readIf(chemin);
  if (ancien !== null && content.startsWith(ancien)) return content.slice(ancien.length);
  return content;
}

/** Cible et texte ajouté par l'appel d'outil en cours, ou `null` si hors périmètre (ni Write/Edit/Bash
 *  pertinent, ni cible INBOX.md/OUTBOX.md). Pour un `Write`, seul le texte ajouté par rapport au
 *  contenu déjà sur disque (voir `texteAjouteWrite`) ; pour un `Edit`, `new_string` ; pour un `Bash`,
 *  la commande entière. */
function cibleDeliverGuard(input) {
  const ti = input.tool_input || {};
  if (input.tool_name === 'Write') {
    const cible = String(ti.file_path || '');
    return { cible, contenu: texteAjouteWrite(cible, String(ti.content || '')) };
  }
  if (input.tool_name === 'Edit') return { cible: String(ti.file_path || ''), contenu: String(ti.new_string || '') };
  if (input.tool_name === 'Bash') {
    const cmd = String(ti.command || '');
    const re = />>?\s*(\S+)/g;
    let m;
    while ((m = re.exec(cmd)) !== null) {
      const cible = m[1].replace(/^['"]|['"]$/g, '');
      if (path.basename(cible) === 'INBOX.md' || path.basename(cible) === 'OUTBOX.md') return { cible, contenu: cmd };
    }
    return null;
  }
  return null;
}

/** Découpe un texte en blocs de message : un bloc commence à une ligne `---` immédiatement suivie
 *  d'une ligne `id:` (le texte avant le premier bloc est ignoré) et s'étend jusqu'au bloc suivant ou
 *  la fin du texte. Retourne tous les blocs, avec leur `type` et leur `porte` (chantier 15, §16.3)
 *  s'ils en portent un. */
function blocsMessages(texte) {
  const lignes = String(texte || '').split('\n');
  const debuts = [];
  for (let i = 0; i < lignes.length - 1; i++) {
    if (/^---\s*$/.test(lignes[i]) && /^id:/.test(lignes[i + 1])) debuts.push(i);
  }
  const blocs = [];
  for (let k = 0; k < debuts.length; k++) {
    const fin = k + 1 < debuts.length ? debuts[k + 1] : lignes.length;
    const bloc = lignes.slice(debuts[k], fin).join('\n');
    const idm = bloc.match(/^id:\s*(\S+)/m);
    const typem = bloc.match(/^\s*type:\s*(\S+)/m);
    const portem = bloc.match(/^\s*porte:\s*(\S+)/m);
    blocs.push({ id: idm ? idm[1] : '?', type: typem ? typem[1] : '', texte: bloc, porte: portem ? portem[1] : '' });
  }
  return blocs;
}

/** Ne retient, parmi tous les blocs de `blocsMessages`, que ceux dont le frontmatter porte
 *  `type: DELIVERABLE` (compatibilité : forme utilisée par deliver-guard avant §16.3). */
function blocsDeliverable(texte) {
  return blocsMessages(texte).filter((b) => b.type === 'DELIVERABLE');
}

function deliverGuard(ctx) {
  try {
    const { root, instance, input } = ctx;
    const trouve = cibleDeliverGuard(input);
    if (!trouve) return ok();
    const base = path.basename(trouve.cible);
    if (base !== 'INBOX.md' && base !== 'OUTBOX.md') return ok();
    const blocs = blocsDeliverable(trouve.contenu);
    if (!blocs.length) return ok();

    const source = instance.includes('/')
      ? path.join(root, 'mission', instance, 'ROLE.md')
      : path.join(root, 'mission', 'OBJECTIVE.md');
    const texteSource = readIf(source);
    if (texteSource === null) return ok();

    // gate-guard (chantier 15, §16.3) : un livrable protégé par une porte non franchie est refusé
    // indépendamment de la colonne Contrôle — vérifié avant le `return ok()` de compatibilité.
    const portes = parseValidationsRequises(texteSource);
    if (portes) {
      const franchies = portesFranchies(root, instance);
      const nomsTable = parseNomsLivrables(texteSource);
      for (const bloc of blocs) {
        const couverts = bloc.texte.match(/^Livrables couverts\s*:\s*(.+)$/m);
        const annonces = couverts
          ? couverts[1].split(',').map((s) => s.trim()).filter(Boolean)
          : nomsTable;
        for (const p of portes) {
          if (franchies.has(p.porte)) continue;
          const touche = annonces.find((nom) => p.livrables.some((l) => l.toLowerCase() === nom.toLowerCase()));
          if (!touche) continue;
          return emit({
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `[HOLARCH · garde-fou gate-guard] DELIVERABLE ${bloc.id} refusé : le livrable « ${touche} » est protégé par la porte ${p.porte} (« ${p.quoi} ») non franchie — demande-la à ${p.parQui} (CLARIFICATION avec \`porte: ${p.porte}\`) ; une RESPONSE portant \`porte: ${p.porte}\` la franchit.`,
            },
          });
        }
      }
    }

    const livrables = parseLivrables(texteSource);
    if (!livrables) return ok(); // pas de colonne Contrôle : compatibilité

    for (const bloc of blocs) {
      const contenu = bloc.texte;
      let exiges = livrables.filter((l) => l.controle);
      const couverts = contenu.match(/^Livrables couverts\s*:\s*(.+)$/m);
      if (couverts) {
        const noms = couverts[1].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
        exiges = exiges.filter((l) => noms.includes(l.livrable.trim().toLowerCase()));
      }

      const lignesMessage = parseControlesMessage(contenu);
      const etats = exiges.map((l) => {
        const trouvee = lignesMessage.find((r) => r.commande === l.controle);
        return { livrable: l.livrable, controle: l.controle, code: trouvee ? trouvee.code : null };
      });
      const manques = etats.filter((e) => e.code === null || e.code !== '0');
      const regardeOk = /^Regard[ée]\s*:\s*\S/m.test(contenu);
      if (!manques.length && regardeOk) continue;

      const resume = [];
      for (const e of manques) {
        resume.push(e.code === null ? `commande de « ${e.livrable} » manquante` : `commande de « ${e.livrable} » code ${e.code} ≠ 0`);
      }
      if (!regardeOk) resume.push('ligne « Regardé : » manquante');

      const lignesSquelette = etats.map((e) => {
        const codeCell = e.code === null ? '<code>' : (e.code === '0' ? '0' : `${e.code} ≠ 0 — corrige puis rejoue`);
        return `| ${e.livrable} | \`${e.controle}\` | ${codeCell} | <chemin du rapport ou sa première ligne> |`;
      });
      const squelette = [
        '## Contrôles',
        '| Livrable | Commande | Code | Rapport |',
        '|---|---|---|---|',
        ...lignesSquelette,
        '',
        'Regardé : <ce qui a été inspecté à l\'œil ou à l\'oreille, et comment>',
      ].join('\n');
      return emit({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[HOLARCH · garde-fou deliver-guard] DELIVERABLE ${bloc.id} refusé : ${resume.join(' ; ')}.\nSquelette attendu dans le corps du message :\n${squelette}\nUne commande n'est citée qu'après avoir été lancée : cite le code réel, jamais un code supposé.`,
        },
      });
    }
    return ok();
  } catch (_) {
    return ok();
  }
}

// --- gate-guard (chantier 15, §16.3) -----------------------------------------------------------
// Une section « Validations requises » de ROLE.md/OBJECTIVE.md déclare des portes de validation :
// tant qu'une porte n'a pas été franchie (une RESPONSE de l'INBOX.md de l'instance portant
// `porte: V<n>`), toute écriture sous un chemin qu'elle protège est refusée (hook `gateGuard`,
// PreToolUse sur Write|Edit|Bash), et tout DELIVERABLE d'un livrable qu'elle protège est refusé par
// `deliverGuard` (voir plus haut, vérifié avant son `return ok()` de compatibilité — la protection
// par porte ne dépend pas de la colonne Contrôle). Une CLARIFICATION portant `porte: V<n>` est la
// façon ordinaire de la demander ; aucun nouveau type de message.

/** Noms des livrables de la table « Livrables » d'une source de rôle (colonne `Livrable`), quelle que
 *  soit la présence d'une colonne `Contrôle` — indépendant de `parseLivrables` (deliver-guard), utilisé
 *  par gate-guard pour savoir quels livrables une porte protège. `[]` si aucune table Livrables. */
function parseNomsLivrables(text) {
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const header = splitRow(lines[i]);
    const livIdx = header.findIndex((c) => c === 'Livrable');
    if (livIdx === -1) continue;
    let j = i + 1;
    if (j < lines.length && /^\s*\|/.test(lines[j]) && isSeparatorRow(splitRow(lines[j]))) j++;
    const noms = [];
    for (; j < lines.length; j++) {
      if (!/^\s*\|/.test(lines[j])) break;
      noms.push(stripTicks(splitRow(lines[j])[livIdx]));
    }
    return noms;
  }
  return [];
}

/**
 * Table « Validations requises » d'un ROLE.md/OBJECTIVE.md : cherche la ligne `## Validations
 * requises` (ou `### `), puis la première table dont l'en-tête porte `Porte` et `Protège`. `null` si
 * section ou table absente. Sinon `[{ porte, quoi, parQui, chemins: [...], livrables: [...] }]` — la
 * cellule « Protège » est découpée sur ` ; ` (ou `;`), chaque morceau `DELIVERABLE « X »` /
 * `DELIVERABLE "X"` / `DELIVERABLE X` → livrable nommé `X` ; sinon → chemin (préfixe, backticks
 * retirés, `./` de tête retiré). Une ligne dont la cellule Porte est vide ou `—` n'est pas retenue.
 */
function parseValidationsRequises(text) {
  const lines = String(text || '').split('\n');
  let debut = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#{2,3}\s*Validations requises\s*$/.test(lines[i].trim())) { debut = i; break; }
  }
  if (debut === -1) return null;
  for (let i = debut + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i])) return null; // section suivante avant toute table trouvée
    if (!/^\s*\|/.test(lines[i])) continue;
    const header = splitRow(lines[i]);
    const porteIdx = header.findIndex((c) => c === 'Porte');
    const protegeIdx = header.findIndex((c) => c === 'Protège');
    if (porteIdx === -1 || protegeIdx === -1) continue;
    const quoiIdx = header.findIndex((c) => c === 'Quoi');
    const parQuiIdx = header.findIndex((c) => c === 'Par qui');
    let j = i + 1;
    if (j < lines.length && /^\s*\|/.test(lines[j]) && isSeparatorRow(splitRow(lines[j]))) j++;
    const rows = [];
    for (; j < lines.length; j++) {
      if (!/^\s*\|/.test(lines[j])) break;
      const cells = splitRow(lines[j]);
      const porte = stripTicks(cells[porteIdx]);
      if (!porte || porte === '—') continue;
      const morceaux = String(cells[protegeIdx] || '').split(/\s*;\s*/).map((s) => s.trim()).filter(Boolean);
      const chemins = [];
      const livrables = [];
      for (const m of morceaux) {
        if (m === '—') continue;
        const dm = /^DELIVERABLE\s*[«"]?\s*([^»"]+?)\s*[»"]?\s*$/.exec(m);
        if (dm) { livrables.push(dm[1].trim()); continue; }
        const chemin = stripTicks(m).replace(/^\.\//, '');
        if (chemin) chemins.push(chemin);
      }
      rows.push({
        porte,
        quoi: quoiIdx !== -1 ? stripTicks(cells[quoiIdx]) : '',
        parQui: parQuiIdx !== -1 ? stripTicks(cells[parQuiIdx]) : '',
        chemins, livrables,
      });
    }
    return rows;
  }
  return null;
}

/** Ensemble des portes (`porte: V<n>`) franchies par une RESPONSE de l'INBOX.md de l'instance. */
function portesFranchies(root, instance) {
  const texte = readIf(path.join(root, 'mission', instance, 'INBOX.md'));
  if (texte === null) return new Set();
  const portes = new Set();
  for (const bloc of blocsMessages(texte)) {
    if (bloc.type === 'RESPONSE' && bloc.porte) portes.add(bloc.porte);
  }
  return portes;
}

/** Cibles visées par l'appel d'outil en cours, pour gate-guard : `file_path` pour Write/Edit ; pour un
 *  Bash, toutes les cibles de redirection `>`/`>>` (même regex que `cibleDeliverGuard`) — sans la
 *  restriction à INBOX.md/OUTBOX.md, gate-guard protège n'importe quel chemin de la colonne Protège. */
function ciblesGateGuard(input) {
  const ti = input.tool_input || {};
  if (input.tool_name === 'Write' || input.tool_name === 'Edit') return ti.file_path ? [String(ti.file_path)] : [];
  if (input.tool_name === 'Bash') {
    const cmd = String(ti.command || '');
    const re = />>?\s*(\S+)/g;
    const cibles = [];
    let m;
    while ((m = re.exec(cmd)) !== null) cibles.push(m[1].replace(/^['"]|['"]$/g, ''));
    return cibles;
  }
  return [];
}

/** Chemin rendu relatif à `root` (si absolu et sous `root`), séparateurs normalisés `/`. */
function cheminRelatifRoot(root, cible) {
  let p = String(cible || '');
  if (path.isAbsolute(p)) {
    const rel = path.relative(root, p);
    if (!rel.startsWith('..')) p = rel;
  }
  return p.split(path.sep).join('/');
}

function gateGuard(ctx) {
  try {
    const { root, instance, input } = ctx;
    const cibles = ciblesGateGuard(input);
    if (!cibles.length) return ok();

    const source = instance.includes('/')
      ? path.join(root, 'mission', instance, 'ROLE.md')
      : path.join(root, 'mission', 'OBJECTIVE.md');
    const texteSource = readIf(source);
    if (texteSource === null) return ok();
    const portes = parseValidationsRequises(texteSource);
    if (!portes) return ok(); // pas de section Validations requises : inerte

    const franchies = portesFranchies(root, instance);
    for (const cible of cibles) {
      const chemin = cheminRelatifRoot(root, cible);
      const p = portes.find((q) => !franchies.has(q.porte) && q.chemins.some((c) => chemin.startsWith(c)));
      if (!p) continue;
      return emit({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: `[HOLARCH · garde-fou gate-guard] écriture sous ${chemin} refusée : porte ${p.porte} (« ${p.quoi} ») non franchie — demande-la à ${p.parQui} par une CLARIFICATION portant \`porte: ${p.porte}\` dans son en-tête ; elle sera franchie par une RESPONSE portant \`porte: ${p.porte}\`. La préparation (échantillon, plan, règles du métier) reste permise hors de ${p.chemins.join(', ')}.`,
        },
      });
    }
    return ok();
  } catch (_) {
    return ok();
  }
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
 * Chantier 15, §16.4 : `<root>/mission/OBJECTIVE.md`, s'il existe, doit porter les trois sections que
 * produit `tools/holarch-init` (« Échéance », « Validations requises », « Ressources ») ; une table
 * dont l'en-tête porte une cellule « Livrable » sans cellule « Contrôle » ajoute `colonne Contrôle`
 * aux manques. Dupliqué de `tools/config-lint` (fonction `verifierBriefObjective`) : le framework ne
 * dépend d'aucun fichier de `tools/`. Renvoie `''` si le fichier est absent ou complet.
 */
function briefIncomplet(root) {
  const texte = readIf(path.join(root, 'mission', 'OBJECTIVE.md'));
  if (texte === null) return '';
  const manquants = [];
  if (!/^#{2,3}\s*Échéance\s*$/m.test(texte)) manquants.push('Échéance');
  if (!/^#{2,3}\s*Validations requises\s*$/m.test(texte)) manquants.push('Validations requises');
  if (!/^#{2,3}\s*Ressources\s*$/m.test(texte)) manquants.push('Ressources');
  const lignes = texte.split('\n');
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i].trim();
    if (!ligne.startsWith('|') || /^\|[\s:|-]+\|?$/.test(ligne)) continue;
    if ((i > 0 ? lignes[i - 1].trim() : '').startsWith('|')) continue;
    const cellules = ligne.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim().toLowerCase());
    if (cellules.some((c) => c.includes('livrable')) && !cellules.some((c) => c.includes('contrôle') || c.includes('controle'))) {
      manquants.push('colonne Contrôle');
      break;
    }
  }
  return manquants.length ? `brief incomplet : ${manquants.join(', ')} absentes` : '';
}

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
  // Chantier 15, §16.4 : seule la racine (instance sans '/', profondeur 1) porte le brief de mission —
  // un enfant a son propre ROLE.md, pas de mission/OBJECTIVE.md à lui.
  let prefixeBrief = '';
  if (!instance.includes('/')) {
    const b = briefIncomplet(root);
    if (b) prefixeBrief = `[HOLARCH · brief] ${b} — une CLARIFICATION d'orientation groupée à l'utilisateur est attendue avant toute unité de production (typed-escalation, ON_ORIENT). `;
  }
  emit({
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `${prefixeBrief}[HOLARCH · rappel d'orientation] ${rappelContexte}Discipline mémoire (module unites-indexees) : plan de session = 1 à 3 unités numérotées U<n>, un commit par unité achevée, une fiche memoire/U<n>-….md à chaque unité (réussie, échouée ou partielle) ; ne relis que ce que ton plan cite explicitement — jamais un fichier entier par anticipation.`,
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
// Chantier 16, §18.1 (docs/IMPLEMENTATION.md) : budgetWatch joue dans la même invocation PostToolUse
// que contextWatch (une seule lecture de la fin de transcription par appel d'outil), sans changer son
// comportement quand budgetWatch est inerte — contextWatch émet sa sortie via `emit` (process.stdout),
// capturée ici pour être fusionnée avec la note éventuelle de budgetWatch, qui s'applique aussi aux
// sous-agents que contextWatch ignore (early return plus haut dans contextWatch).
function budgetAndContextWatch(ctx) {
  const chunks = [];
  const ecritureOriginale = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => { chunks.push(chunk); return true; };
  try {
    contextWatch(ctx);
  } finally {
    process.stdout.write = ecritureOriginale;
  }
  let sortieContexte = {};
  try { sortieContexte = JSON.parse(chunks.join('')); } catch (_) { sortieContexte = {}; }
  let noteBudget = null;
  try {
    const r = budgetWatchModule.budgetWatch({ input: ctx.input, root: ctx.root, instance: ctx.instance, env: process.env });
    noteBudget = r && r.note;
  } catch (_) { noteBudget = null; }
  const noteContexte = sortieContexte && sortieContexte.hookSpecificOutput && sortieContexte.hookSpecificOutput.additionalContext;
  const notes = [noteContexte, noteBudget].filter(Boolean);
  if (!notes.length) return ok();
  emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } });
}
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
    if (event === 'path-guard') return pathGuard(ctx);
    if (event === 'git-guard') return gitGuard(ctx);
    if (event === 'deliver-guard') return deliverGuard(ctx);
    if (event === 'gate-guard') return gateGuard(ctx);
    if (event === 'context-watch') return budgetAndContextWatch(ctx);
    return ok();
  } catch (e) {
    process.stderr.write(`holarch-hooks ${event}: ${e && e.message}\n`);
    return ok();
  }
}

module.exports = { parseStatus, parseFiche, lastAssistantUsage, activeModules, STOP_BLOCKS_MAX, WARN_STEP, UNITES_LIGNE_MAX_CHARS, UNITES_MEMOIRE_MAX_LIGNES, contexteLivePath, updateContexteLive, frameworkGuard, pathGuard, racinePrincipale, deliverGuard, parseLivrables, parseControlesMessage, parseValidationsRequises, portesFranchies, gateGuard, briefIncomplet };
if (require.main === module) main();
