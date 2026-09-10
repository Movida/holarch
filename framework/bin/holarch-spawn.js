#!/usr/bin/env node
'use strict';
/**
 * holarch-spawn.js — lanceur d'instance HOLARCH (framework v1.1).
 *
 * Incarne une instance (ou exécute le bootstrap) via `claude -p` avec les options
 * qui rendent la session économe et bornée :
 *   - modèle / effort résolus depuis CONFIG.md (politique par profil) et la fiche registre (profil, et effort
 *     jugé par instance — ligne `Effort`) ; changement de régime décidé par l'instance entre deux sessions
 *     (fiche modifiée + hibernation volontaire) → ré-incarnation sur le nouveau régime, décomptée à part ;
 *   - KERNEL + CONFIG + modules actifs injectés dans le prompt système (identique pour
 *     toutes les instances d'une mission → cache de prompt partagé, zéro lecture au réveil) ;
 *   - fichiers d'instance (ROLE, MEMORY, STATUS, fin d'INBOX, fin de JOURNAL, lignes PROGRESS) injectés
 *     dans le prompt utilisateur, bornés en caractères (paramètres reveil_*) → aucune relecture au ON_WAKE ;
 *   - outils restreints, skills/MCP désactivés, mémoire automatique coupée ;
 *   - fusibles durs : --max-turns, --max-budget-usd, --autocompact, hooks (framework/hooks/) ;
 *   - résultat JSON exploité : coût, tokens, tours, session → registry/SESSIONS.md (append-only).
 *
 * Usage :
 *   node framework/bin/holarch-spawn.js <chemin-instance> [options]
 *   node framework/bin/holarch-spawn.js --bootstrap [options]
 * Options : --profil <p> --modele <m> --effort <e> --budget-usd <n> --max-tours <n>
 *           --permission-mode <m> --timeout-min <n> --root <dir> --add-dir <dir> --dry-run --json
 *           (--add-dir répétable : un dépôt externe accessible en lecture/écriture par la session,
 *           en plus de la racine HOLARCH — cf. docs/holarch.md §16.1)
 * Codes de sortie : 0 état terminal atteint (≠ WORKING) · 1 erreur du lanceur ·
 *                   2 session terminée avec STATUS=WORKING ou erreur du CLI ·
 *                   3 hibernations volontaires épuisées (STATUS encore WORKING).
 * Aucune dépendance hors Node.js (déjà requis par Claude Code).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const VALID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const VALID_PERMISSION_MODES = ['acceptEdits', 'default', 'manual', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
const TERMINAL_STATES = ['DELIVERED', 'BLOCKED', 'FAILED', 'WAITING_CHILDREN', 'ARCHIVED', 'READY'];

/** Valeurs par défaut des paramètres (surchargeables dans CONFIG.md, table « Paramètres »). */
const DEFAULTS = {
  modele_cli: 'opus',
  effort_cli: 'high',
  modele_repli: '',
  permission_mode: 'acceptEdits',
  budget_usd_par_session: '5',
  max_tours_par_session: '200',
  seuil_contexte_tokens: '120000',
  autocompact_tokens: '180000',
  outils_cli: 'Read,Write,Edit,Bash,Glob,Grep,Agent,TodoWrite',
  relances_max: '2',
  changements_regime_max: '1',
  commit_par_session: 'oui',
  // Bornes du prompt de réveil (chantier 0, diagnostic 2026-09-09 : les bornes en lignes ne bornaient rien,
  // une ligne de JOURNAL.md ou de PROGRESS.md pouvant faire plusieurs milliers de caractères).
  reveil_journal_lignes: '40',
  reveil_journal_chars: '8000',
  reveil_progress_lignes: '10',
  reveil_progress_chars: '4000',
  reveil_inbox_messages: '8',
  reveil_inbox_chars: '12000',
  reveil_memory_chars: '20000',
};

/** Politique de modèle par profil, par défaut (surchargeable : CONFIG.md « ## Politique de modèle »). */
const DEFAULT_POLICY = {
  conception: { modele: 'opus', effort: 'high' },
  execution: { modele: 'sonnet', effort: 'medium' },
  relecture: { modele: 'opus', effort: 'medium' },
  exploration: { modele: 'fable', effort: 'xhigh' },
};

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function readIf(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}
function stripTicks(s) { return String(s || '').trim().replace(/^`+|`+$/g, '').trim(); }
function tailLines(text, n) {
  const lines = String(text || '').split('\n');
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}
/** Nombre de messages INBOX.md conservés en entier au réveil (KERNEL §7 : un message = un bloc
 *  `---\nid: ...` ; couper à l'intérieur romprait le format). Au-delà, les plus anciens sont
 *  masqués (jamais supprimés du fichier sur disque) avec une note de rappel, même traitement que
 *  JOURNAL.md ci-dessous. */
const INBOX_TAIL_MESSAGES = 8;
function tailInboxMessages(text, n) {
  const t = String(text || '');
  const re = /^---\nid: /gm;
  const idx = [];
  let m;
  while ((m = re.exec(t))) idx.push(m.index);
  if (idx.length <= n) return { content: t, hidden: 0 };
  const header = t.slice(0, idx[0]);
  const keepFrom = idx[idx.length - n];
  return { content: header + t.slice(keepFrom), hidden: idx.length - n };
}
/**
 * Garde les `maxLines` dernières lignes de `text`, puis retire des lignes entières par le début tant que le
 * total dépasse `maxChars`. Si la dernière ligne dépasse seule `maxChars`, n'en garde que la fin, préfixée
 * de "… ". `droppedLines` compte les lignes retirées par la borne en caractères (pas par celle en lignes).
 */
function tailBounded(text, maxLines, maxChars) {
  const lines = String(text || '').split('\n');
  const kept = lines.slice(Math.max(0, lines.length - maxLines));
  let total = kept.join('\n').length;
  let droppedLines = 0;
  while (kept.length > 1 && total > maxChars) { total -= kept.shift().length + 1; droppedLines += 1; }
  let truncatedLine = false;
  if (kept.length === 1 && kept[0].length > maxChars) {
    let fin = kept[0].slice(-(maxChars - 2)); // « … » compris dans la borne
    if (/^[\uDC00-\uDFFF]/.test(fin)) fin = fin.slice(1); // jamais couper un caractère sur deux unités
    kept[0] = `… ${fin}`;
    truncatedLine = true;
  }
  return { content: kept.join('\n'), droppedLines, truncatedLine };
}
/**
 * Comme tailInboxMessages, puis retire les messages les plus anciens tant que le total dépasse `maxChars`,
 * en gardant toujours le dernier message entier. Jamais de coupe à l'intérieur d'un bloc (KERNEL §7).
 */
function tailInboxBounded(text, maxMessages, maxChars) {
  const t = String(text || '');
  const re = /^---\nid: /gm;
  const idx = [];
  let m;
  while ((m = re.exec(t))) idx.push(m.index);
  if (!idx.length) return { content: t, hidden: 0 };
  const header = t.slice(0, idx[0]);
  let start = Math.max(0, idx.length - maxMessages);
  while (start < idx.length - 1 && header.length + (t.length - idx[start]) > maxChars) start += 1;
  return { content: header + t.slice(idx[start]), hidden: start };
}
function fmtDuration(ms) {
  const s = Math.round((ms || 0) / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}
function fichePath(root, chemin) {
  return path.join(root, 'mission', 'registry', 'instances', `${chemin.replace(/\//g, '-')}.md`);
}
function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

/** Remonte depuis `start` jusqu'au répertoire contenant framework/KERNEL.md et mission/. */
function findRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md')) && fs.existsSync(path.join(dir, 'mission'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Parsing des fichiers normatifs (markdown à tableaux stricts, spec §9.1)
// ---------------------------------------------------------------------------
function parseConfig(text) {
  const cfg = { nom: '', modules: [], params: {}, policy: {} };
  if (!text) return cfg;
  const m = text.match(/^#\s*Configuration\s*[—-]+\s*mission\s*:\s*(.+)$/m);
  if (m) cfg.nom = stripTicks(m[1]);
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) { section = line.replace(/^#+\s*/, '').toLowerCase(); continue; }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0 || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (section.startsWith('modules actifs') && cells.length >= 3 && /^\d+$/.test(cells[0])) {
      cfg.modules.push({ categorie: cells[1].toLowerCase(), module: stripTicks(cells[2]) });
    } else if (section.startsWith('param') && cells.length >= 2 && /^[a-z][a-z0-9_]*$/.test(cells[0])) {
      cfg.params[cells[0]] = stripTicks(cells[1]);
    } else if (section.startsWith('politique de mod') && cells.length >= 3) {
      const profil = stripTicks(cells[0]).toLowerCase();
      if (profil && profil !== 'profil') cfg.policy[profil] = { modele: stripTicks(cells[1]), effort: stripTicks(cells[2]).toLowerCase() };
    }
  }
  return cfg;
}

function parseFiche(text) {
  const f = { profil: '', effort: '', alloue: null, consomme: null, statut: '' };
  if (!text) return f;
  const row = (label) => {
    const m = text.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'mi'));
    return m ? stripTicks(m[1]) : '';
  };
  f.profil = row('Profil').toLowerCase();
  f.effort = row('Effort').toLowerCase(); // optionnel : effort jugé pour la tâche (direct-spawn), prime sur celui du profil
  f.statut = row('Statut');
  const b = row('Budget allou[ée] / consomm[ée]').match(/(\d+)\s*\/\s*(\d+)/);
  if (b) { f.alloue = Number(b[1]); f.consomme = Number(b[2]); }
  return f;
}

function parseStatus(text) {
  const s = { etat: '', note: '' };
  if (!text) return s;
  const e = text.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m);
  if (e) s.etat = e[1];
  const n = text.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m);
  if (n) s.note = n[1];
  return s;
}

// ---------------------------------------------------------------------------
// Résolution modèle / effort / paramètres
// ---------------------------------------------------------------------------
function resolveParams(cfg) {
  return Object.assign({}, DEFAULTS, cfg.params || {});
}

function resolveProfile(cfg, fiche, chemin, overrides) {
  const depth = chemin.split('/').length;
  let profil = (overrides.profil || fiche.profil || (depth === 1 ? 'conception' : 'execution')).toLowerCase();
  // Précédence : option CLI > ligne `Effort` de la fiche registre (effort seulement — jugé par le parent pour la
  // tâche, ou changé par l'instance elle-même : direct-spawn) > table « Politique de modèle » de CONFIG.md >
  // modele_cli/effort_cli explicites de CONFIG.md > politique par défaut du module (DEFAULT_POLICY) > DEFAULTS.
  // Le modèle, lui, vient toujours du profil (ou de l'option CLI).
  const explicit = cfg.params || {};
  let modele = explicit.modele_cli || (DEFAULT_POLICY[profil] && DEFAULT_POLICY[profil].modele) || DEFAULTS.modele_cli;
  let effort = explicit.effort_cli || (DEFAULT_POLICY[profil] && DEFAULT_POLICY[profil].effort) || DEFAULTS.effort_cli;
  let origineEffort = explicit.effort_cli ? 'config' : 'defaut';
  const row = (cfg.policy || {})[profil];
  if (row) { modele = row.modele || modele; if (row.effort) { effort = row.effort; origineEffort = 'config'; } }
  else if (!DEFAULT_POLICY[profil]) profil = `${profil} (profil inconnu → défauts)`;
  if (fiche.effort) {
    if (VALID_EFFORTS.includes(fiche.effort)) { effort = fiche.effort; origineEffort = 'fiche'; }
    else process.stderr.write(`HOLARCH ▸ ${chemin} ▸ effort « ${fiche.effort} » de la fiche registre non reconnu (valeurs : ${VALID_EFFORTS.join(', ')}) — ignoré, effort du profil conservé\n`);
  }
  if (overrides.modele) modele = overrides.modele;
  if (overrides.effort) { effort = overrides.effort; origineEffort = 'option'; }
  effort = String(effort).toLowerCase();
  if (!VALID_EFFORTS.includes(effort)) throw new Error(`effort invalide « ${effort} » (valeurs : ${VALID_EFFORTS.join(', ')})`);
  return { profil, modele, effort, depth, origine_effort: origineEffort };
}

// ---------------------------------------------------------------------------
// Construction des prompts
// ---------------------------------------------------------------------------
function fileBlock(rel, content, note) {
  const attrs = note ? ` note="${note}"` : '';
  return `<fichier chemin="${rel}"${attrs}>\n${String(content).replace(/\s+$/, '')}\n</fichier>`;
}

function buildSystemPrompt(root, cfg, bootstrap) {
  const parts = [];
  parts.push(
    '# Contrat HOLARCH — fourni par le lanceur framework/bin/holarch-spawn.js',
    "Les fichiers ci-dessous sont des copies intégrales et exactes de leur version sur disque : ne les relis pas avec un outil (économie de contexte, KERNEL §5.8). Tout ce qui n'est pas ici (gabarits de framework/templates/, fichiers d'autres instances, registre) se lit à la demande, au moment où c'est utile.",
    '',
  );
  const push = (rel) => {
    const c = readIf(path.join(root, rel));
    parts.push(c === null ? `<fichier chemin="${rel}" note="INTROUVABLE sur disque"></fichier>` : fileBlock(rel, c));
  };
  if (bootstrap) push('framework/BOOTSTRAP.md');
  push('framework/KERNEL.md');
  push('framework/CONFIG.md');
  if (bootstrap) push('framework/MANIFEST.md');
  const seen = new Set();
  for (const { categorie, module } of cfg.modules) {
    const rel = `framework/modules/${categorie}/${module}.md`;
    if (seen.has(rel)) continue;
    seen.add(rel);
    push(rel);
  }
  return parts.join('\n');
}

function buildUserPromptDetail(root, chemin, meta, params, bootstrap) {
  const p = [];
  const blocs = [];
  const num = (k, d) => { const v = Number(params[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const harnais = [
    `Harnais de cette session : profil ${meta.profil}, modèle ${meta.modele}, effort ${meta.effort}${meta.origine_effort === 'fiche' ? ' (posé dans ta fiche registre)' : ''}, au plus ${params.max_tours_par_session} tours et ${params.budget_usd_par_session} USD (tarif liste) ; un hook te préviendra si ton contexte dépasse ${Math.round(Number(params.seuil_contexte_tokens) / 1000)}k tokens — tu devras alors hiberner volontairement (KERNEL §5.8 : MEMORY.md complet, STATUS.md laissé à son état réel avec la note « hibernation volontaire (contexte) », commit, fin de session ; le lanceur te ré-incarne avec un contexte neuf).`,
    `Ton modèle et ton effort sont fixés pour toute cette session ; changer de régime n'est possible qu'entre deux sessions (module d'orchestration, ON_PLAN) : ligne \`Profil\` ou \`Effort\` de ta propre fiche registre, justification dans JOURNAL.md et PROGRESS.md, puis hibernation volontaire avec la note « hibernation volontaire (changement de régime : <ancien> → <nouveau>) » — le lanceur te ré-incarne sur le nouveau régime (au plus ${params.changements_regime_max} fois, décompté à part des ré-incarnations de contexte).`,
    "Commandes Bash exécutables sans approbation : git add/commit/mv/status/log/diff/show, mkdir, python3, pytest, node, npm test, npm run, et `node framework/bin/holarch-spawn.js <chemin-enfant>` pour incarner un enfant. Toute autre commande est refusée immédiatement (pas de blocage) : adapte-toi au lieu de réessayer. Toute écriture sous framework/ ou dans mission/OBJECTIVE.md est refusée mécaniquement (KERNEL §4).",
    "Un garde-fou empêche la fin de session tant que STATUS.md indique WORKING sans note d'hibernation volontaire, ou tant que des modifications de mission/ ne sont pas committées : passe toujours par ON_SLEEP.",
  ];
  if (bootstrap) {
    p.push(`Tu es la première session de cette mission. Exécute la procédure de framework/BOOTSTRAP.md (fournie dans ton prompt système) : validation, initialisation, création de la racine \`concepteur\`, puis incarnation immédiate. Profil de la racine : ${meta.profil} — écris \`| Profil | conception |\` dans sa fiche registre.`);
    const obj = readIf(path.join(root, 'mission', 'OBJECTIVE.md'));
    p.push(obj === null ? '<fichier chemin="mission/OBJECTIVE.md" note="INTROUVABLE"></fichier>' : fileBlock('mission/OBJECTIVE.md', obj));
    blocs.push({ nom: 'OBJECTIVE', chars: obj === null ? 0 : obj.length, note: '' });
    p.push(...harnais);
    return { prompt: p.join('\n\n'), blocs };
  }
  p.push(`Tu incarnes l'instance \`${chemin}\` (profondeur ${meta.depth}, profil ${meta.profil}). Le KERNEL, CONFIG.md et les modules actifs sont dans ton prompt système. Voici l'état exact de tes fichiers d'instance au réveil — ne les relis pas, ils sont identiques sur disque :`);
  const base = path.join(root, 'mission', chemin);
  const rappel = "relis le fichier complet si ON_ORIENT l'exige";
  const introuvable = (name) => `<fichier chemin="mission/${chemin}/${name}" note="INTROUVABLE"></fichier>`;
  const role = readIf(path.join(base, 'ROLE.md'));
  p.push(role === null ? introuvable('ROLE.md') : fileBlock(`mission/${chemin}/ROLE.md`, role));
  blocs.push({ nom: 'ROLE', chars: role === null ? 0 : role.length, note: '' });
  const memory = readIf(path.join(base, 'MEMORY.md'));
  if (memory === null) {
    p.push(introuvable('MEMORY.md'));
    blocs.push({ nom: 'MEMORY', chars: 0, note: '' });
  } else {
    // Filet, jamais un fonctionnement normal : MEMORY.md est l'unique support de continuité (KERNEL §5.3) et
    // doit tenir entier. S'il dépasse, on garde la queue et on le dit à l'instance et sur stderr.
    const memChars = num('reveil_memory_chars', 20000);
    const m = tailBounded(memory, Number.MAX_SAFE_INTEGER, memChars);
    let note;
    if (m.droppedLines || m.truncatedLine) {
      note = `TRONQUÉ à ${memChars} caractères (queue conservée, ${m.droppedLines} ligne(s) retirée(s)) — MEMORY.md dépasse la borne du réveil : relis le fichier complet à ON_WAKE et raccourcis-le à ON_SLEEP (module mémoire)`;
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ MEMORY.md tronqué à l'injection (${memory.length} caractères pour une borne de ${memChars}) — module mémoire à revoir\n`);
    }
    p.push(fileBlock(`mission/${chemin}/MEMORY.md`, m.content, note));
    blocs.push({ nom: 'MEMORY', chars: m.content.length, note: note ? `${m.droppedLines} ligne(s) retirée(s)` : '' });
  }
  const st = readIf(path.join(base, 'STATUS.md'));
  p.push(st === null ? introuvable('STATUS.md') : fileBlock(`mission/${chemin}/STATUS.md`, st));
  blocs.push({ nom: 'STATUS', chars: st === null ? 0 : st.length, note: '' });
  const inbox = readIf(path.join(base, 'INBOX.md'));
  if (inbox === null) {
    p.push(introuvable('INBOX.md'));
    blocs.push({ nom: 'INBOX', chars: 0, note: '' });
  } else {
    const nMsg = num('reveil_inbox_messages', INBOX_TAIL_MESSAGES);
    const nChars = num('reveil_inbox_chars', 12000);
    const { content, hidden } = tailInboxBounded(inbox, nMsg, nChars);
    p.push(fileBlock(`mission/${chemin}/INBOX.md`, content, hidden ? `${hidden} message(s) plus ancien(s) masqué(s) (borne : ${nMsg} messages, ${nChars} caractères) — ${rappel}` : undefined));
    blocs.push({ nom: 'INBOX', chars: content.length, note: hidden ? `${hidden} masqué(s)` : '' });
  }
  const detailDe = (r) => (r.droppedLines ? `${r.droppedLines} ligne(s) retirée(s)` : (r.truncatedLine ? 'dernière ligne tronquée' : ''));
  const journal = readIf(path.join(base, 'JOURNAL.md'));
  if (journal && journal.split('\n').length > 12) {
    const jl = num('reveil_journal_lignes', 40);
    const jc = num('reveil_journal_chars', 8000);
    const j = tailBounded(journal, jl, jc);
    const d = detailDe(j);
    p.push(fileBlock(`mission/${chemin}/JOURNAL.md`, j.content, `${jl} dernières lignes, bornées à ${jc} caractères${d ? ` (${d})` : ''} — ${rappel}`));
    blocs.push({ nom: 'JOURNAL', chars: j.content.length, note: d });
  }
  const progress = readIf(path.join(root, 'mission', 'registry', 'PROGRESS.md'));
  if (progress) {
    const mine = progress.split('\n').filter((l) => l.includes(` · ${chemin} · `));
    if (mine.length) {
      const pl = num('reveil_progress_lignes', 10);
      const pc = num('reveil_progress_chars', 4000);
      const pr = tailBounded(mine.join('\n'), pl, pc);
      const d = detailDe(pr);
      p.push(fileBlock('mission/registry/PROGRESS.md', pr.content, `lignes de cette instance, ${pl} dernières, bornées à ${pc} caractères${d ? ` (${d})` : ''}`));
      blocs.push({ nom: 'PROGRESS', chars: pr.content.length, note: d });
    }
  }
  p.push(...harnais);
  p.push("Démarre ton cycle de vie au hook ON_WAKE (KERNEL §2) sans relire les fichiers déjà fournis, et termine obligatoirement par ON_SLEEP.");
  return { prompt: p.join('\n\n'), blocs };
}

function buildUserPrompt(root, chemin, meta, params, bootstrap) {
  return buildUserPromptDetail(root, chemin, meta, params, bootstrap).prompt;
}

// ---------------------------------------------------------------------------
// Préparation d'un lancement
// ---------------------------------------------------------------------------
function prepareLaunch(root, chemin, opts) {
  const bootstrap = !!opts.bootstrap;
  const cfg = parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md')));
  const params = resolveParams(cfg);
  const fiche = bootstrap ? parseFiche(null) : parseFiche(readIf(fichePath(root, chemin)));
  const meta = resolveProfile(cfg, fiche, chemin, opts);
  if (!bootstrap) {
    const base = path.join(root, 'mission', chemin);
    for (const name of ['ROLE.md', 'STATUS.md']) {
      if (!fs.existsSync(path.join(base, name))) throw new Error(`instance ${chemin} : ${name} introuvable (mécanique de spawn KERNEL §9 non faite ?)`);
    }
  }
  const permissionMode = opts.permissionMode || params.permission_mode;
  if (!VALID_PERMISSION_MODES.includes(permissionMode)) throw new Error(`permission_mode invalide « ${permissionMode} »`);
  const budget = opts.budget || params.budget_usd_par_session;
  const maxTours = opts.maxTours || params.max_tours_par_session;
  const systemPrompt = buildSystemPrompt(root, cfg, bootstrap);
  const detail = buildUserPromptDetail(root, chemin, meta, Object.assign({}, params, { budget_usd_par_session: budget, max_tours_par_session: maxTours }), bootstrap);
  const prompt = detail.prompt;
  const settingsFile = path.join(root, 'framework', 'claude', 'instance-settings.json');
  // Motifs RELATIFS à la racine du projet (constat D2, session n°7 de concepteur — sondé en conditions
  // réelles) : les règles de permission de Claude Code s'évaluent en relatif, jamais en absolu. Un motif
  // `Edit(${root}/framework/**)` est donc syntaxiquement valide mais inerte — il ne matche jamais rien,
  // et Write/Edit sous framework/ passent. Défense en profondeur : les mêmes motifs relatifs sont aussi
  // posés en dur dans `permissions.deny` d'`instance-settings.json`, pour ne pas dépendre d'un seul canal.
  const denied = [
    `Edit(framework/**)`, `Write(framework/**)`,
    `Edit(mission/OBJECTIVE.md)`, `Write(mission/OBJECTIVE.md)`,
  ];
  const addDirs = (opts.addDir || []).map((d) => path.resolve(d));
  // `-p` sans valeur : le prompt est transmis par stdin (voir runOnce), pas comme argument de
  // ligne de commande. Motif D41 (2026-09-09, session de maintenance) : Linux limite un argument
  // individuel de execve() à MAX_ARG_STRLEN (128 Ko), indépendamment de la limite globale ARG_MAX
  // (2 Mo) — un prompt utilisateur qui grossit avec la mission (INBOX.md, MEMORY.md) finit par la
  // dépasser et spawnSync échoue en E2BIG, silencieusement (voir la remontée d'erreur dans
  // `summarize`). stdin n'a pas cette limite.
  const args = [
    '-p',
    '--model', meta.modele,
    '--effort', meta.effort,
    '--permission-mode', permissionMode,
    '--output-format', 'json',
    '--max-turns', String(maxTours),
    '--max-budget-usd', String(budget),
    '--append-system-prompt-file', '<SYSTEM_PROMPT_FILE>',
    '--exclude-dynamic-system-prompt-sections',
    '--settings', settingsFile,
    '--tools', params.outils_cli,
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--autocompact', String(params.autocompact_tokens),
    '--disallowedTools', denied.join(','),
    '-n', `holarch:${chemin}`,
  ];
  if (params.modele_repli) args.push('--fallback-model', params.modele_repli);
  for (const d of addDirs) args.push('--add-dir', d);
  // Identité Git des commits de mission : posée ici, dans l'environnement de la session, jamais dans la
  // configuration Git du dépôt (BOOTSTRAP §0, point 3 : les commits humains restent attribués à l'humain).
  // Une valeur déjà exportée par l'utilisateur est respectée.
  const identite = {
    GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'HOLARCH',
    GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'holarch@localhost',
    GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME || 'HOLARCH',
    GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL || 'holarch@localhost',
  };
  const env = Object.assign({}, process.env, identite, {
    HOLARCH_ROOT: root,
    HOLARCH_INSTANCE: chemin,
    HOLARCH_CONTEXT_LIMIT: String(params.seuil_contexte_tokens),
    HOLARCH_COMMIT: params.commit_par_session,
    HOLARCH_BOOTSTRAP: bootstrap ? '1' : '0',
    // Taille de registry/PROGRESS.md avant ce lancement : baseline de wake-guard (garde-fou ON_ORIENT). Calculée ici,
    // pas au premier appel du hook côté session, pour ne pas rater une ligne ON_ORIENT écrite avant toute écriture
    // hors de l'arbre propre de l'instance — cf. holarch-hooks.js, wakeGuard.
    HOLARCH_PROGRESS_BASELINE: String((readIf(path.join(root, 'mission', 'registry', 'PROGRESS.md')) || '').length),
  });
  return { root, chemin, bootstrap, cfg, params, meta, permissionMode, budget, maxTours, args, env, systemPrompt, prompt, blocs: detail.blocs, settingsFile };
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------
function parseResultJson(stdout) {
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { const d = JSON.parse(t); if (d && d.type === 'result') return d; } catch (_) { /* ligne suivante */ }
  }
  return null;
}

function ensureSessionsFile(root, missionName) {
  const p = path.join(root, 'mission', 'registry', 'SESSIONS.md');
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      `# Sessions — mission ${missionName || '(sans nom)'}`,
      '',
      '<!-- Append-only, écrit par framework/bin/holarch-spawn.js après chaque session (aucune instance n\'écrit ici).',
      'Coût = estimation locale au tarif liste (--output-format json, total_cost_usd). Tokens : entrée fraîche / lus en cache / écrits en cache / sortie.',
      'Colonne Modèle/effort : un modèle par délégation à un sous-agent Agent le fait apparaître ici avec son coût (res.modelUsage, tarif liste), ex. "claude-opus-5 1.2900+claude-sonnet-5 0.2700/high" ; modèles haiku filtrés (bruit d\'appels internes). -->',
      '',
      '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée / cache lu / cache écrit / sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
      '',
    ].join('\n'));
  }
  return p;
}

function appendSessionLine(root, missionName, chemin, meta, res, elapsedMs, status, promptChars) {
  const p = ensureSessionsFile(root, missionName);
  const u = (res && res.usage) || {};
  const modelEntries = res && res.modelUsage
    ? Object.entries(res.modelUsage).filter(([m]) => !/haiku/i.test(m))
    : [];
  const models = modelEntries
    .map(([m, mu]) => (typeof mu.costUSD === 'number' ? `${m} ${mu.costUSD.toFixed(4)}` : m))
    .join('+');
  const cost = res && typeof res.total_cost_usd === 'number' ? res.total_cost_usd.toFixed(4) : '?';
  const fin = res ? `${res.subtype || '?'}${res.is_error ? ' (erreur)' : ''}${res.permission_denials && res.permission_denials.length ? ` · ${res.permission_denials.length} refus` : ''}` : 'sans résultat JSON';
  const line = `| ${nowIso()} | ${chemin} | ${res && res.session_id ? res.session_id : '—'} | ${models || meta.modele}/${meta.effort} | ${res ? res.num_turns : '?'} | ${u.input_tokens ?? '?'} / ${u.cache_read_input_tokens ?? '?'} / ${u.cache_creation_input_tokens ?? '?'} / ${u.output_tokens ?? '?'} | ${cost} | ${fmtDuration(elapsedMs)} | ${fin} | ${status || '?'} | ${promptChars ? `${promptChars.systeme} / ${promptChars.utilisateur}` : '—'} |\n`;
  fs.appendFileSync(p, line);
  return line;
}

function runOnce(launch, attempt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-spawn-'));
  const sysFile = path.join(tmp, 'system-prompt.md');
  fs.writeFileSync(sysFile, launch.systemPrompt);
  const args = launch.args.map((a) => (a === '<SYSTEM_PROMPT_FILE>' ? sysFile : a));
  const logDir = path.join(launch.root, 'mission', '.holarch', 'sessions');
  fs.mkdirSync(logDir, { recursive: true });
  const ignore = path.join(launch.root, 'mission', '.holarch', '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n'); // journaux bruts hors Git
  const stamp = nowIso().replace(/[:]/g, '').replace('T', '-').replace('Z', '');
  const logBase = path.join(logDir, `${launch.chemin.replace(/\//g, '-')}-${stamp}-${attempt}`);
  const t0 = Date.now();
  const r = spawnSync('claude', args, {
    cwd: launch.root,
    env: launch.env,
    encoding: 'utf8',
    input: launch.prompt,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    timeout: launch.timeoutMs || undefined,
    killSignal: 'SIGTERM',
  });
  const elapsedMs = Date.now() - t0;
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  if (r.stderr) fs.writeFileSync(`${logBase}.stderr.log`, r.stderr);
  const res = parseResultJson(r.stdout);
  if (r.stdout) fs.writeFileSync(`${logBase}.result.json`, r.stdout);
  return { res, elapsedMs, exitCode: r.status, signal: r.signal, error: r.error, logBase, stderr: r.stderr || '' };
}

function readStatusOf(root, chemin) {
  return parseStatus(readIf(path.join(root, 'mission', chemin, 'STATUS.md')));
}

/** Relit CONFIG.md et la fiche registre sur disque et en résout le régime (profil, modèle, effort) — même
 *  résolution que prepareLaunch, sans construire les prompts. */
function resolveMetaFromDisk(root, chemin, opts) {
  const cfg = parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md')));
  const fiche = opts.bootstrap ? parseFiche(null) : parseFiche(readIf(fichePath(root, chemin)));
  return resolveProfile(cfg, fiche, chemin, opts);
}

function launchWithRelaunches(root, chemin, opts, runner) {
  runner = runner || runOnce;
  const sessions = [];
  let attempt = 0;
  let relances = 0; // ré-incarnations de contexte (relances_max)
  let changements = 0; // ré-incarnations après un changement de régime (changements_regime_max)
  for (;;) {
    attempt += 1;
    // Reconstruit le lancement à chaque tentative : après une hibernation volontaire, MEMORY/STATUS/INBOX/JOURNAL
    // ont changé sur disque (écrits par la session qui vient de se terminer) — les relire ici est ce qui évite
    // d'injecter dans le prompt de la ré-incarnation l'état d'avant cette session (bug constaté en pratique,
    // T4 réel session n°4→5 : la ré-incarnation recevait l'état de la session n°3).
    const launch = prepareLaunch(root, chemin, opts);
    if (opts.timeoutMin > 0) launch.timeoutMs = opts.timeoutMin * 60 * 1000;
    const out = runner(launch, attempt);
    const status = readStatusOf(root, chemin);
    const line = appendSessionLine(root, launch.cfg.nom, chemin, launch.meta, out.res, out.elapsedMs, status.etat || '(absent)', { systeme: launch.systemPrompt.length, utilisateur: launch.prompt.length });
    sessions.push(Object.assign({ status, line, launch }, out));
    const maxRelances = Number(launch.params.relances_max) || 0;
    const maxChangements = Number(launch.params.changements_regime_max) || 0;
    const voluntary = status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '');
    if (!voluntary) return sessions;
    // Changement de régime (direct-spawn, ON_PLAN) : l'instance a modifié la ligne Profil ou Effort de sa fiche
    // registre avant d'hiberner. La fiche est relue ici comme prepareLaunch la relira au tour suivant ; un régime
    // différent est ré-incarné sur le nouveau modèle/effort, décompté à part des ré-incarnations de contexte.
    const regime = (m) => `${m.modele}/${m.effort}`;
    const next = resolveMetaFromDisk(root, chemin, opts);
    if (regime(next) !== regime(launch.meta)) {
      if (changements >= maxChangements) {
        process.stderr.write(`HOLARCH ▸ ${chemin} ▸ changement de régime demandé (${regime(launch.meta)} → ${regime(next)}) mais changements_regime_max (${maxChangements}) atteint — pas de ré-incarnation automatique\n`);
        return sessions;
      }
      changements += 1;
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ changement de régime ${changements}/${maxChangements} : ${regime(launch.meta)} → ${regime(next)} (profil ${next.profil}) — ré-incarnation\n`);
      continue;
    }
    if (relances >= maxRelances) return sessions;
    relances += 1;
    process.stderr.write(`HOLARCH ▸ ${chemin} ▸ hibernation volontaire (contexte) — ré-incarnation ${relances}/${maxRelances}\n`);
  }
}

function summarize(launch, sessions) {
  const last = sessions[sessions.length - 1];
  const status = last.status;
  const cost = sessions.reduce((a, s) => a + ((s.res && s.res.total_cost_usd) || 0), 0);
  const turns = sessions.reduce((a, s) => a + ((s.res && s.res.num_turns) || 0), 0);
  const ms = sessions.reduce((a, s) => a + s.elapsedMs, 0);
  const ids = sessions.map((s) => (s.res && s.res.session_id ? s.res.session_id.slice(0, 8) : '—')).join(', ');
  const lines = [];
  const regimes = [];
  for (const s of sessions) {
    const m = (s.launch && s.launch.meta) || launch.meta;
    const r = `${m.modele}/${m.effort}`;
    if (regimes[regimes.length - 1] !== r) regimes.push(r);
  }
  lines.push(`HOLARCH ▸ ${launch.chemin} ▸ STATUS=${status.etat || '(absent)'} · ${sessions.length} session(s) · ${turns} tours · ${cost.toFixed(2)} USD · ${fmtDuration(ms)} · ${regimes.join(' → ')} · sessions ${ids}`);
  if (regimes.length > 1) lines.push(`ℹ changement de régime décidé par l'instance (fiche registre) : ${regimes.join(' → ')} — motif dans son JOURNAL.md, trace par session dans mission/registry/SESSIONS.md`);
  let code = 0;
  const voluntary = status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '');
  if (!last.res) {
    const causeExacte = last.error ? ` — cause : ${last.error.code || ''} ${last.error.message || ''}`.trim() : '';
    lines.push(`⚠ aucun résultat JSON du CLI (code ${last.exitCode}, signal ${last.signal || '—'})${causeExacte} — voir ${last.logBase}.stderr.log`);
    code = 2;
  }
  else if (last.res.is_error) { lines.push(`⚠ fin anormale : ${last.res.subtype} — voir ${last.logBase}.result.json`); code = 2; }
  if (status.etat === 'WORKING' && !voluntary) { lines.push('⚠ STATUS.md est resté à WORKING : session plantée ou ON_SLEEP non exécuté (direct-spawn : relancer une fois, puis FAILED + recadrage).'); code = 2; }
  else if (voluntary) { lines.push(`⚠ hibernations volontaires épuisées (${sessions.length}) : STATUS encore WORKING — relancer manuellement ou augmenter relances_max.`); code = 3; }
  const denials = sessions.reduce((a, s) => a + ((s.res && s.res.permission_denials && s.res.permission_denials.length) || 0), 0);
  if (denials) lines.push(`ℹ ${denials} appel(s) d'outil refusé(s) par les règles d'autorisation (détail : ${last.logBase}.result.json).`);
  if (status.note) lines.push(`ℹ note STATUS : ${status.note.slice(0, 300)}`);
  lines.push(`ℹ journal des sessions : mission/registry/SESSIONS.md`);
  return { text: lines.join('\n'), code };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { chemin: null, bootstrap: false, dryRun: false, json: false, profil: '', modele: '', effort: '', budget: '', maxTours: '', permissionMode: '', root: '', timeoutMin: 0, addDir: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--bootstrap') o.bootstrap = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    else if (a === '--profil') o.profil = next();
    else if (a === '--modele' || a === '--model') o.modele = next();
    else if (a === '--effort') o.effort = next();
    else if (a === '--budget-usd') o.budget = next();
    else if (a === '--max-tours' || a === '--max-turns') o.maxTours = next();
    else if (a === '--permission-mode') o.permissionMode = next();
    else if (a === '--root') o.root = next();
    else if (a === '--add-dir') o.addDir.push(next());
    else if (a === '--timeout-min') o.timeoutMin = Number(next());
    else if (a === '-h' || a === '--help') { o.help = true; }
    else if (a.startsWith('-')) throw new Error(`option inconnue : ${a}`);
    else if (!o.chemin) o.chemin = a.replace(/^mission\//, '').replace(/\/+$/, '');
    else throw new Error(`argument inattendu : ${a}`);
  }
  if (o.bootstrap) o.chemin = 'concepteur';
  return o;
}

function usage() {
  return [
    'Usage : node framework/bin/holarch-spawn.js <chemin-instance> [options]',
    '        node framework/bin/holarch-spawn.js --bootstrap [options]',
    'Options : --profil <conception|execution|relecture|exploration> --modele <alias|id> --effort <low|medium|high|xhigh|max>',
    '          --budget-usd <n> --max-tours <n> --permission-mode <mode> --timeout-min <n> --root <dir>',
    '          --add-dir <dir> (répétable — dépôt externe accessible en plus de la racine) --dry-run --json',
  ].join('\n');
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n${usage()}\n`); process.exit(1); }
  if (o.help || !o.chemin) { process.stdout.write(`${usage()}\n`); process.exit(o.help ? 0 : 1); }
  const root = o.root ? path.resolve(o.root) : findRoot(process.cwd());
  if (!root) { process.stderr.write('Racine introuvable : lance depuis un dépôt contenant framework/KERNEL.md et mission/ (ou --root).\n'); process.exit(1); }
  let launch;
  try { launch = prepareLaunch(root, o.chemin, o); } catch (e) { process.stderr.write(`holarch-spawn : ${e.message}\n`); process.exit(1); }
  if (o.dryRun) {
    if (o.timeoutMin > 0) launch.timeoutMs = o.timeoutMin * 60 * 1000;
    process.stdout.write([
      `racine        : ${root}`,
      `instance      : ${launch.chemin}${launch.bootstrap ? ' (bootstrap)' : ''} · profil ${launch.meta.profil} · profondeur ${launch.meta.depth}`,
      `modèle/effort : ${launch.meta.modele} / ${launch.meta.effort} (effort : ${launch.meta.origine_effort})${launch.params.modele_repli ? ` (repli ${launch.params.modele_repli})` : ''}`,
      `fusibles      : ${launch.maxTours} tours · ${launch.budget} USD · contexte ${launch.params.seuil_contexte_tokens} tokens (autocompact ${launch.params.autocompact_tokens}) · relances ${launch.params.relances_max} · changements de régime ${launch.params.changements_regime_max}`,
      `prompt système: ${launch.systemPrompt.length} caractères (KERNEL + CONFIG + ${launch.cfg.modules.length} modules${launch.bootstrap ? ' + BOOTSTRAP + MANIFEST' : ''})`,
      `prompt        : ${launch.prompt.length} caractères (transmis par stdin, pas en argument — voir D41)`,
      `blocs         : ${launch.blocs.map((b) => `${b.nom} ${b.chars}${b.note ? ` (${b.note})` : ''}`).join(' · ')}`,
      `commande      : claude ${launch.args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `'${a}'` : a)).join(' ')} < <prompt sur stdin>`,
      '',
    ].join('\n'));
    if (o.json) process.stdout.write(`${JSON.stringify({ root, chemin: launch.chemin, meta: launch.meta, params: launch.params, args: launch.args }, null, 2)}\n`);
    return;
  }
  const sessions = launchWithRelaunches(root, o.chemin, o);
  const { text, code } = summarize(sessions[sessions.length - 1].launch, sessions);
  process.stdout.write(`${text}\n`);
  if (o.json) process.stdout.write(`${JSON.stringify(sessions.map((s) => ({ session_id: s.res && s.res.session_id, cost: s.res && s.res.total_cost_usd, turns: s.res && s.res.num_turns, subtype: s.res && s.res.subtype, status: s.status })), null, 2)}\n`);
  process.exit(code);
}

module.exports = { parseConfig, parseFiche, parseStatus, resolveParams, resolveProfile, resolveMetaFromDisk, buildSystemPrompt, buildUserPrompt, prepareLaunch, parseResultJson, appendSessionLine, summarize, findRoot, launchWithRelaunches, DEFAULTS, DEFAULT_POLICY, tailInboxMessages, INBOX_TAIL_MESSAGES, buildUserPromptDetail, tailBounded, tailInboxBounded };

if (require.main === module) main();
