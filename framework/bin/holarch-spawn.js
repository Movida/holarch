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
 *     si le module mémoire `unites-indexees` est actif : ROLE, MEMORY, STATUS, <reveil>, INBOX (sélection
 *     ciblée), memoire/INDEX.md — ni JOURNAL.md ni PROGRESS.md (chantier 1, mémoire adressée) ;
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
const { spawnSync, spawn } = require('child_process');
const reveil = require('./reveil');

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
  sessions_max_par_instance: '24',
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
/**
 * Découpe un fichier de messages (INBOX.md/OUTBOX.md, KERNEL §7) en blocs `---\nid: ...`. Retourne
 * l'en-tête avant le premier message et la liste des messages avec leurs champs `id`, `date`, `type`,
 * `ref` extraits de l'en-tête YAML de chaque bloc.
 */
function parseMessageBlocks(text) {
  const t = String(text || '');
  const re = /^---\nid: /gm;
  const idx = [];
  let m;
  while ((m = re.exec(t))) idx.push(m.index);
  const header = idx.length ? t.slice(0, idx[0]) : t;
  const msgs = [];
  for (let i = 0; i < idx.length; i++) {
    const start = idx[i];
    const end = i + 1 < idx.length ? idx[i + 1] : t.length;
    const block = t.slice(start, end);
    const field = (name) => { const mm = block.match(new RegExp(`^${name}:\\s*(.*)$`, 'm')); return mm ? mm[1].trim() : ''; };
    msgs.push({ start, end, block, id: field('id'), date: field('date'), type: field('type'), ref: field('ref') });
  }
  return { header, msgs };
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

/** true si `module` (catégorie `categorie`) figure dans la table « Modules actifs » de CONFIG.md. */
function moduleActive(cfg, categorie, module) {
  return ((cfg && cfg.modules) || []).some((m) => m.categorie === categorie && m.module === module);
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
// Mémoire adressée (chantier 1) : fiches d'unité, index, sélection d'INBOX, réveil
// ---------------------------------------------------------------------------
/**
 * Lit l'en-tête d'une fiche d'unité (`framework/templates/UNITE.template.md`). Cherche les deux
 * premières lignes `---` du texte (le commentaire HTML précédent est ignoré) et parse les paires
 * `clé: valeur` entre elles. Retourne null si moins de deux lignes `---` ne sont trouvées. Les clés
 * manquantes sont tolérées (chaîne vide).
 */
function parseUniteHeader(text) {
  const lines = String(text || '').split('\n');
  let start = -1;
  let end = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      if (start === -1) start = i;
      else { end = i; break; }
    }
  }
  if (start === -1 || end === -1) return null;
  const header = { id: '', date: '', critere: '', resultat: '', preuve: '', commit: '', tags: '' };
  for (const raw of lines.slice(start + 1, end)) {
    const m = raw.match(/^([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*(.*)$/);
    if (m && Object.prototype.hasOwnProperty.call(header, m[1].toLowerCase())) {
      header[m[1].toLowerCase()] = m[2].trim();
    }
  }
  return header;
}

/** Numéro d'unité extrait d'un id `U<n>` ou `U<n><lettre>` (reprise) ; NaN si non reconnu. */
function uniteNumero(id) {
  const m = String(id || '').match(/^U(\d+)/i);
  return m ? Number(m[1]) : NaN;
}

/**
 * Régénère `mission/<chemin>/memoire/INDEX.md` : une ligne par fiche `U<n>-*.md` de `memoire/`,
 * triée par numéro d'unité croissant (U2 avant U10), format
 * `| U12 | 2026-09-09 | PASS | <critere tronqué à 90 car.> | U12-slug.md |`, précédée d'un en-tête
 * de table et d'un commentaire « régénéré par le lanceur, ne pas éditer ». Ne crée rien si
 * `memoire/` n'existe pas. Idempotente : rappelée sans changement, produit le même contenu.
 */
function buildMemoryIndex(root, chemin) {
  const dir = path.join(root, 'mission', chemin, 'memoire');
  if (!fs.existsSync(dir)) return { lignes: 0, contenu: '' };
  const files = fs.readdirSync(dir).filter((f) => f !== 'INDEX.md' && /^U\d+[a-zA-Z]*-.*\.md$/.test(f));
  const entries = [];
  for (const f of files) {
    const h = parseUniteHeader(readIf(path.join(dir, f)));
    if (!h) continue;
    entries.push({ num: uniteNumero(h.id || f), file: f, h });
  }
  entries.sort((a, b) => (a.num - b.num) || a.file.localeCompare(b.file));
  const header = [
    '<!-- régénéré par le lanceur, ne pas éditer -->',
    '| Unité | Date | Résultat | Critère | Fiche |',
    '|---|---|---|---|---|',
  ];
  const rows = entries.map((e) => {
    const critere = String(e.h.critere || '').slice(0, 90);
    return `| ${e.h.id || '?'} | ${e.h.date || '—'} | ${e.h.resultat || '—'} | ${critere} | ${e.file} |`;
  });
  const contenu = `${header.concat(rows).join('\n')}\n`;
  fs.writeFileSync(path.join(dir, 'INDEX.md'), contenu);
  return { lignes: rows.length, contenu };
}

/** Date ISO (et sha) du dernier commit ayant touché mission/<chemin>/MEMORY.md (= dernière
 *  hibernation), ou null si Git est absent, en échec, ou si le fichier n'a jamais été committé. */
function lastHibernationCommit(root, chemin) {
  const rel = path.join('mission', chemin, 'MEMORY.md').split(path.sep).join('/');
  let r;
  try { r = spawnSync('git', ['log', '-1', '--format=%H%n%cI', '--', rel], { cwd: root, encoding: 'utf8' }); }
  catch (_) { return null; }
  if (!r || r.error || r.status !== 0 || !r.stdout || !r.stdout.trim()) return null;
  const lines = r.stdout.trim().split('\n');
  if (lines.length < 2 || !lines[0] || !lines[1]) return null;
  return { sha: lines[0], dateIso: lines[1] };
}

/**
 * Messages d'INBOX.md « non traités » : union de (a) messages dont `date:` est postérieure à la
 * date du dernier commit MEMORY.md, (b) les 2 derniers messages du fichier, (c) messages de type
 * TASK ou RESPONSE dont l'`id` n'apparaît dans aucun `ref:` d'OUTBOX.md. Ordre du fichier conservé,
 * puis borné par tailInboxBounded(reveil_inbox_messages, reveil_inbox_chars). Sans dépôt Git (git
 * absent, en échec, ou MEMORY.md jamais committé) : repli sur tailInboxBounded seul.
 */
function selectInboxMessages(root, chemin, params) {
  const inboxText = readIf(path.join(root, 'mission', chemin, 'INBOX.md')) || '';
  const nMsg = Number(params.reveil_inbox_messages) || Number(DEFAULTS.reveil_inbox_messages);
  const nChars = Number(params.reveil_inbox_chars) || Number(DEFAULTS.reveil_inbox_chars);
  const hib = lastHibernationCommit(root, chemin);
  if (!hib) {
    const b = tailInboxBounded(inboxText, nMsg, nChars);
    return { content: b.content, hidden: b.hidden, criteres: 'repli sans git : tailInboxBounded seul' };
  }
  const { header, msgs } = parseMessageBlocks(inboxText);
  if (!msgs.length) return { content: inboxText, hidden: 0, criteres: 'aucun message' };
  const outboxText = readIf(path.join(root, 'mission', chemin, 'OUTBOX.md')) || '';
  const refs = new Set();
  for (const m of outboxText.matchAll(/^ref:\s*(.*)$/gm)) { const v = m[1].trim(); if (v && v !== '—') refs.add(v); }
  const selected = new Set();
  for (const m of msgs) { if (m.date && m.date > hib.dateIso) selected.add(m); }
  for (const m of msgs.slice(-2)) selected.add(m);
  for (const m of msgs) { if ((m.type === 'TASK' || m.type === 'RESPONSE') && m.id && !refs.has(m.id)) selected.add(m); }
  const ordered = msgs.filter((m) => selected.has(m));
  const rawContent = header + ordered.map((m) => m.block).join('');
  const hiddenParUnion = msgs.length - ordered.length;
  const b = tailInboxBounded(rawContent, nMsg, nChars);
  return {
    content: b.content,
    hidden: hiddenParUnion + b.hidden,
    criteres: 'postérieurs au dernier commit MEMORY ; 2 derniers ; TASK/RESPONSE sans ref dans OUTBOX',
  };
}

/**
 * Bloc `<reveil>` injecté après STATUS.md : état et note de STATUS.md, identifiants des messages
 * INBOX ajoutés depuis lastHibernationCommit, enfants directs dont STATUS.md a changé depuis ce
 * commit (avec leur état courant). Condition de réveil (chantier 2) omise tant qu'il n'est pas en
 * place. Sans Git : bloc réduit à l'état de STATUS.md.
 */
function describeWakeReason(root, chemin) {
  const status = parseStatus(readIf(path.join(root, 'mission', chemin, 'STATUS.md')));
  const lines = [`état : ${status.etat || '(absent)'}${status.note ? ` — ${status.note}` : ''}`];
  const hib = lastHibernationCommit(root, chemin);
  if (!hib) {
    lines.push('sans Git : bloc réduit à l\'état de STATUS.md');
    return lines.join('\n');
  }
  const { msgs } = parseMessageBlocks(readIf(path.join(root, 'mission', chemin, 'INBOX.md')) || '');
  const nouveaux = msgs.filter((m) => m.date && m.date > hib.dateIso).map((m) => m.id || '?');
  lines.push(nouveaux.length ? `messages INBOX nouveaux depuis ${hib.sha.slice(0, 8)} : ${nouveaux.join(', ')}` : 'aucun message INBOX nouveau depuis la dernière hibernation');
  const relBase = path.join('mission', chemin).split(path.sep).join('/');
  let diff;
  try { diff = spawnSync('git', ['diff', '--name-only', hib.sha, '--', `${relBase}/*/STATUS.md`], { cwd: root, encoding: 'utf8' }); }
  catch (_) { diff = null; }
  const children = [];
  if (diff && !diff.error && diff.status === 0 && diff.stdout) {
    for (const f of diff.stdout.trim().split('\n').filter(Boolean)) {
      const relToChild = path.relative(relBase, f).split(path.sep).join('/');
      const childName = relToChild.split('/')[0];
      if (!childName || children.some((c) => c.startsWith(`${childName} `))) continue;
      const st = parseStatus(readIf(path.join(root, relBase, childName, 'STATUS.md')));
      children.push(`${childName} → ${st.etat || '(absent)'}`);
    }
  }
  lines.push(children.length ? `enfants dont le statut a changé : ${children.join(', ')}` : 'aucun enfant dont le statut a changé');
  return lines.join('\n');
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

function buildUserPromptDetail(root, chemin, meta, params, bootstrap, cfg) {
  const p = [];
  const blocs = [];
  const num = (k, d) => { const v = Number(params[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const harnais = [
    `Harnais de cette session : profil ${meta.profil}, modèle ${meta.modele}, effort ${meta.effort}${meta.origine_effort === 'fiche' ? ' (posé dans ta fiche registre)' : ''}, au plus ${params.max_tours_par_session} tours et ${params.budget_usd_par_session} USD (tarif liste) ; un hook te préviendra si ton contexte dépasse ${Math.round(Number(params.seuil_contexte_tokens) / 1000)}k tokens — tu devras alors hiberner volontairement (KERNEL §5.8 : MEMORY.md complet, STATUS.md laissé à son état réel avec la note « hibernation volontaire (contexte) », commit, fin de session ; le lanceur te ré-incarne avec un contexte neuf tant que chaque session laisse une trace de progrès — une fiche d'unité ou un commit [${chemin}] — au plus ${params.relances_max} session(s) consécutive(s) sans progrès et ${params.sessions_max_par_instance} sessions en tout, après quoi il alerte ton parent).`,
    `Ton modèle et ton effort sont fixés pour toute cette session ; changer de régime n'est possible qu'entre deux sessions (module d'orchestration, ON_PLAN) : ligne \`Profil\` ou \`Effort\` de ta propre fiche registre, justification dans JOURNAL.md et PROGRESS.md, puis hibernation volontaire avec la note « hibernation volontaire (changement de régime : <ancien> → <nouveau>) » — le lanceur te ré-incarne sur le nouveau régime (au plus ${params.changements_regime_max} fois, décompté à part des ré-incarnations de contexte).`,
    "Commandes Bash exécutables sans approbation : git add/commit/mv/status/log/diff/show/branch/switch/merge (toujours depuis la racine, jamais `git -C`), mkdir, ls, wc, head, tail, grep, find, diff, date, echo, printf, pwd, python3, pytest, node, npm test, npm run, et `node framework/bin/holarch-spawn.js <chemin-enfant>` pour incarner un enfant. Une commande composée (`;`, `&&`, `|`) n'est acceptée que si chacun de ses segments l'est. Toute autre commande est refusée immédiatement (pas de blocage) : adapte-toi au lieu de réessayer. Toute écriture sous framework/ ou dans mission/OBJECTIVE.md est refusée mécaniquement (KERNEL §4).",
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
  const uniteMode = moduleActive(cfg || {}, 'memoire', 'unites-indexees');
  p.push(`Tu incarnes l'instance \`${chemin}\` (profondeur ${meta.depth}, profil ${meta.profil}). Le KERNEL, CONFIG.md et les modules actifs sont dans ton prompt système. Voici l'état exact de tes fichiers d'instance au réveil — ne les relis pas, ils sont identiques sur disque :`);
  const base = path.join(root, 'mission', chemin);
  // Dans les deux cas (unites-indexees actif ou non), l'index est régénéré avant assemblage du prompt
  // s'il existe un répertoire memoire/ (spec §2.3) — écriture du lanceur, pas de l'instance (KERNEL §4).
  buildMemoryIndex(root, chemin);
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
  if (uniteMode) {
    const reveil = describeWakeReason(root, chemin);
    p.push(`<reveil>\n${reveil}\n</reveil>`);
    blocs.push({ nom: 'REVEIL', chars: reveil.length, note: '' });
  }
  const inbox = readIf(path.join(base, 'INBOX.md'));
  if (inbox === null) {
    p.push(introuvable('INBOX.md'));
    blocs.push({ nom: 'INBOX', chars: 0, note: '' });
  } else if (uniteMode) {
    const sel = selectInboxMessages(root, chemin, params);
    const note = sel.hidden
      ? `${sel.hidden} message(s) non sélectionné(s) (critères : ${sel.criteres}) — ${rappel}`
      : `critères : ${sel.criteres}`;
    p.push(fileBlock(`mission/${chemin}/INBOX.md`, sel.content, note));
    blocs.push({ nom: 'INBOX', chars: sel.content.length, note: sel.hidden ? `${sel.hidden} masqué(s)` : '' });
  } else {
    const nMsg = num('reveil_inbox_messages', INBOX_TAIL_MESSAGES);
    const nChars = num('reveil_inbox_chars', 12000);
    const { content, hidden } = tailInboxBounded(inbox, nMsg, nChars);
    p.push(fileBlock(`mission/${chemin}/INBOX.md`, content, hidden ? `${hidden} message(s) plus ancien(s) masqué(s) (borne : ${nMsg} messages, ${nChars} caractères) — ${rappel}` : undefined));
    blocs.push({ nom: 'INBOX', chars: content.length, note: hidden ? `${hidden} masqué(s)` : '' });
  }
  const detailDe = (r) => (r.droppedLines ? `${r.droppedLines} ligne(s) retirée(s)` : (r.truncatedLine ? 'dernière ligne tronquée' : ''));
  if (!uniteMode) {
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
  } else {
    // unites-indexees : ni JOURNAL.md ni PROGRESS.md (spec §2.3) — memoire/INDEX.md à la place,
    // au plus 60 lignes, les plus récentes.
    const idx = readIf(path.join(base, 'memoire', 'INDEX.md'));
    if (idx !== null) {
      const capped = tailBounded(idx, 60, Number.MAX_SAFE_INTEGER);
      p.push(fileBlock(`mission/${chemin}/memoire/INDEX.md`, capped.content, capped.droppedLines ? `60 dernières lignes (${capped.droppedLines} retirée(s))` : undefined));
      blocs.push({ nom: 'INDEX', chars: capped.content.length, note: '' });
    }
  }
  p.push(...harnais);
  p.push("Démarre ton cycle de vie au hook ON_WAKE (KERNEL §2) sans relire les fichiers déjà fournis, et termine obligatoirement par ON_SLEEP.");
  return { prompt: p.join('\n\n'), blocs };
}

function buildUserPrompt(root, chemin, meta, params, bootstrap, cfg) {
  return buildUserPromptDetail(root, chemin, meta, params, bootstrap, cfg).prompt;
}

// ---------------------------------------------------------------------------
// Préparation d'un lancement
// ---------------------------------------------------------------------------
function prepareLaunch(root, chemin, opts) {
  const bootstrap = !!opts.bootstrap;
  try { fs.unlinkSync(stopPath(root, chemin)); } catch (_) { /* rien à supprimer */ }
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
  const detail = buildUserPromptDetail(root, chemin, meta, Object.assign({}, params, { budget_usd_par_session: budget, max_tours_par_session: maxTours }), bootstrap, cfg);
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
  fs.mkdirSync(liveDir(launch.root), { recursive: true });
  fs.writeFileSync(liveLockPath(launch.root, launch.chemin), JSON.stringify({ pid: process.pid, startedAt: nowIso(), attempt }));
  const bin = process.env.HOLARCH_FAKE_CLAUDE ? process.execPath : 'claude';
  const realArgs = process.env.HOLARCH_FAKE_CLAUDE ? [process.env.HOLARCH_FAKE_CLAUDE, ...args] : args;
  const r = spawnSync(bin, realArgs, {
    cwd: launch.root,
    env: launch.env,
    encoding: 'utf8',
    input: launch.prompt,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    timeout: launch.timeoutMs || undefined,
    killSignal: 'SIGTERM',
  });
  try { fs.unlinkSync(liveLockPath(launch.root, launch.chemin)); } catch (_) { /* ignore */ }
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

function liveDir(root) { return path.join(root, 'mission', '.holarch', 'live'); }
function liveLockPath(root, chemin) { return path.join(liveDir(root), `${chemin.replace(/\//g, '-')}.json`); }
function isLive(root, chemin) {
  let data;
  try { data = JSON.parse(fs.readFileSync(liveLockPath(root, chemin), 'utf8')); } catch (_) { return false; }
  if (!data || !data.pid) return false;
  try { process.kill(data.pid, 0); return true; }
  catch (_) { try { fs.unlinkSync(liveLockPath(root, chemin)); } catch (_) { /* ignore */ } return false; }
}

function tasksDir(root) { return path.join(root, 'mission', '.holarch', 'tasks'); }
function stopPath(root, chemin) { return path.join(root, 'mission', '.holarch', 'stop', chemin.replace(/\//g, '-')); }

function lastStatusCommitIso(root, chemin) {
  const rel = path.join('mission', chemin, 'STATUS.md').split(path.sep).join('/');
  let r;
  try { r = spawnSync('git', ['log', '-1', '--format=%cI', '--', rel], { cwd: root, encoding: 'utf8' }); }
  catch (_) { return null; }
  if (!r || r.error || r.status !== 0 || !r.stdout || !r.stdout.trim()) return null;
  return r.stdout.trim().split('\n')[0];
}

function appendReveilsLine(root, chemin, declencheur, condition, tacheId) {
  const p = path.join(root, 'mission', 'registry', 'REVEILS.md');
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      '# Réveils — mission', '',
      '<!-- Append-only, écrit par le lanceur (wakeWaiters). Une ligne par réveil déclenché. -->', '',
      '| Date (UTC) | Instance réveillée | Déclencheur | Condition | Tâche |',
      '|---|---|---|---|---|', '',
    ].join('\n'));
  }
  fs.appendFileSync(p, `| ${nowIso()} | ${chemin} | ${declencheur} | ${condition} | ${tacheId} |\n`);
}

function wakeWaiters(root, declencheur) {
  const waiters = reveil.listWaiters(root);
  const reveilles = [];
  const now = new Date();
  const readStatus = (chemin) => readStatusOf(root, chemin);
  const readInbox = (chemin) => readIf(path.join(root, 'mission', chemin, 'INBOX.md')) || '';
  for (const w of waiters) {
    if (w.chemin === declencheur) continue;
    if (!['WAITING_CHILDREN', 'BLOCKED', 'READY'].includes(w.etat)) continue;
    if (isLive(root, w.chemin)) continue;
    const sinceIso = lastStatusCommitIso(root, w.chemin);
    const evalRes = reveil.evalReveil(w.ast, { root, chemin: w.chemin, sinceIso, now, readStatus, readInbox });
    if (!evalRes.satisfied) continue;
    const condition = reveil.formatReveil(w.ast);
    const { id } = detachLaunch(root, w.chemin, {});
    appendReveilsLine(root, w.chemin, declencheur || '--reveil', condition, id);
    reveilles.push({ chemin: w.chemin, tache: id, condition });
  }
  return reveilles;
}

function detachLaunch(root, chemin, opts) {
  const dir = tasksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${chemin.replace(/\//g, '-')}-${Date.now()}`;
  const logPath = path.join(dir, `${id}.log`);
  const jsonPath = path.join(dir, `${id}.json`);
  const fd = fs.openSync(logPath, 'a');
  const env = Object.assign({}, process.env, { HOLARCH_TASK_ID: id });
  const child = spawn(process.execPath, [__filename, chemin], {
    cwd: root, env, detached: true, stdio: ['ignore', fd, fd],
  });
  fs.writeFileSync(jsonPath, JSON.stringify({
    id, chemin, pid: child.pid, startedAt: nowIso(), state: 'running',
    parent: (opts && opts.parent) || 'utilisateur', opts: opts || {},
  }, null, 2));
  child.unref();
  fs.closeSync(fd);
  return { id, pid: child.pid };
}

function finishLaunch(root, chemin, code, sessions) {
  const id = process.env.HOLARCH_TASK_ID;
  if (id) {
    const jsonPath = path.join(tasksDir(root), `${id}.json`);
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      data.state = code === 0 ? 'done' : 'failed';
      data.exitCode = code;
      data.finishedAt = nowIso();
      data.sessions = (sessions || []).map((s) => s.res && s.res.session_id).filter(Boolean);
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    } catch (_) { /* pas de tâche associée : rien à mettre à jour */ }
  }
  return wakeWaiters(root, chemin);
}

/** Traces de progrès d'une instance — fiches d'unité (`memoire/U<n>-*.md`) et commits `[<chemin>]` — ce qui
 *  distingue une hibernation utile d'une boucle qui relit et hiberne sans rien produire. */
function progressSnapshot(root, chemin) {
  let fiches = 0;
  try { fiches = fs.readdirSync(path.join(root, 'mission', chemin, 'memoire')).filter((f) => /^U\d+-.*\.md$/.test(f)).length; } catch (_) { /* pas de mémoire adressée */ }
  let commits = null;
  try {
    const r = spawnSync('git', ['log', '--format=%s', '-500'], { cwd: root, encoding: 'utf8' });
    if (r.status === 0) commits = r.stdout.split('\n').filter((s) => s.startsWith(`[${chemin}]`)).length;
  } catch (_) { /* pas un dépôt git */ }
  return { fiches, commits };
}
function hasProgressed(avant, apres) {
  if (apres.fiches > avant.fiches) return true;
  return avant.commits !== null && apres.commits !== null && apres.commits > avant.commits;
}
/** Sessions déjà journalisées pour l'instance dans registry/SESSIONS.md (toutes invocations du lanceur). */
function countSessions(root, chemin) {
  const text = readIf(path.join(root, 'mission', 'registry', 'SESSIONS.md')) || '';
  return text.split('\n').filter((l) => /^\| \d{4}-/.test(l) && (l.split('|')[2] || '').trim() === chemin).length;
}
/** ALERT du lanceur dans l'INBOX du parent (KERNEL §7, provenance `harnais`) : l'enfant ne sera plus ré-incarné
 *  tout seul, le parent décide — relance détachée, TASK correctif ou FAILED. Rien pour une racine (pas de parent). */
function appendAlertToParent(root, chemin, corps) {
  if (!chemin.includes('/')) return null;
  const parent = chemin.slice(0, chemin.lastIndexOf('/'));
  const p = path.join(root, 'mission', parent, 'INBOX.md');
  if (!fs.existsSync(p)) return null;
  const date = nowIso();
  const id = `MSG-harnais-${chemin.replace(/\//g, '-')}-${date.replace(/[^0-9]/g, '').slice(0, 14)}`;
  fs.appendFileSync(p, `\n---\nid: ${id}\nfrom: harnais\nto: ${parent}\ntype: ALERT\nref: —\ndate: ${date}\n---\n${corps}\n`);
  return id;
}

function launchWithRelaunches(root, chemin, opts, runner) {
  runner = runner || runOnce;
  const sessions = [];
  let attempt = 0;
  let relances = 0; // ré-incarnations de contexte consécutives SANS progrès (relances_max)
  let changements = 0; // ré-incarnations après un changement de régime (changements_regime_max)
  for (;;) {
    attempt += 1;
    // Reconstruit le lancement à chaque tentative : après une hibernation volontaire, MEMORY/STATUS/INBOX/JOURNAL
    // ont changé sur disque (écrits par la session qui vient de se terminer) — les relire ici est ce qui évite
    // d'injecter dans le prompt de la ré-incarnation l'état d'avant cette session (bug constaté en pratique,
    // T4 réel session n°4→5 : la ré-incarnation recevait l'état de la session n°3).
    const launch = prepareLaunch(root, chemin, opts);
    if (opts.timeoutMin > 0) launch.timeoutMs = opts.timeoutMin * 60 * 1000;
    const avant = progressSnapshot(root, chemin);
    const out = runner(launch, attempt);
    const status = readStatusOf(root, chemin);
    const line = appendSessionLine(root, launch.cfg.nom, chemin, launch.meta, out.res, out.elapsedMs, status.etat || '(absent)', { systeme: launch.systemPrompt.length, utilisateur: launch.prompt.length });
    sessions.push(Object.assign({ status, line, launch }, out));
    const maxRelances = Number(launch.params.relances_max) || 0;
    const maxChangements = Number(launch.params.changements_regime_max) || 0;
    const isArret = /hibernation volontaire \(arrêt demandé\)/i.test(status.note || '');
    const voluntary = status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '') && !isArret;
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
    // Ré-incarnation de contexte : tant que chaque session laisse une trace de progrès (fiche d'unité, commit
    // [<chemin>]), on continue — relances_max borne les sessions consécutives SANS progrès, sessions_max_par_instance
    // borne le total (toutes invocations). Épuisé : ALERT au parent, qui décide (relance détachée, TASK, FAILED) —
    // plus d'humain dans la boucle (revue du 2026-09-10, holarch.md §15 décision 23).
    if (hasProgressed(avant, progressSnapshot(root, chemin))) relances = 0; else relances += 1;
    const total = countSessions(root, chemin);
    const maxSessions = Number(launch.params.sessions_max_par_instance) || 0;
    let arret = null;
    if (maxSessions && total >= maxSessions) arret = { motif: 'plafond', max: maxSessions, total };
    else if (relances > maxRelances) arret = { motif: 'sans-progres', sansProgres: relances, max: maxRelances };
    if (arret) {
      const note = (status.note || '').slice(0, 200);
      const suite = `Il ne sera plus ré-incarné tout seul : relance-le en tâche détachée (\`node framework/bin/holarch-spawn.js ${chemin} --detach\`) après lecture de sa mémoire, recadre-le (\`TASK\`), ou passe-le \`FAILED\`.`;
      arret.alerte = appendAlertToParent(root, chemin, arret.motif === 'plafond'
        ? `**Enfant \`${chemin}\` arrêté par le lanceur** : plafond \`sessions_max_par_instance\` (${maxSessions}) atteint, STATUS encore WORKING (hibernation volontaire). Dernière note : « ${note} ». ${suite}`
        : `**Enfant \`${chemin}\` arrêté par le lanceur** : ${relances} session(s) consécutive(s) en hibernation volontaire sans progrès (aucune nouvelle fiche \`memoire/U<n>-*.md\`, aucun commit \`[${chemin}]\`). Dernière note : « ${note} ». ${suite}`);
      sessions[sessions.length - 1].arret = arret;
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ré-incarnations arrêtées (${arret.motif === 'plafond' ? `plafond ${maxSessions} sessions` : `${relances} sans progrès`})${arret.alerte ? ` — ALERT ${arret.alerte} au parent` : ''}\n`);
      return sessions;
    }
    process.stderr.write(`HOLARCH ▸ ${chemin} ▸ hibernation volontaire (contexte) — ré-incarnation (${relances} sans progrès sur ${maxRelances} ; ${total}${maxSessions ? `/${maxSessions}` : ''} sessions)\n`);
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
  const isArret = /hibernation volontaire \(arrêt demandé\)/i.test(status.note || '');
  const voluntary = status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '') && !isArret;
  if (!last.res) {
    const causeExacte = last.error ? ` — cause : ${last.error.code || ''} ${last.error.message || ''}`.trim() : '';
    lines.push(`⚠ aucun résultat JSON du CLI (code ${last.exitCode}, signal ${last.signal || '—'})${causeExacte} — voir ${last.logBase}.stderr.log`);
    code = 2;
  }
  else if (last.res.is_error) { lines.push(`⚠ fin anormale : ${last.res.subtype} — voir ${last.logBase}.result.json`); code = 2; }
  if (isArret) { lines.push('ℹ arrêt propre demandé (--arret) : session terminée sans ré-incarnation.'); }
  else if (status.etat === 'WORKING' && !voluntary) { lines.push('⚠ STATUS.md est resté à WORKING : session plantée ou ON_SLEEP non exécuté (direct-spawn : relancer une fois, puis FAILED + recadrage).'); code = 2; }
  else if (voluntary) {
    const a = last.arret || {};
    const decision = a.alerte ? `ALERT ${a.alerte} déposé dans l'INBOX du parent, qui décide (relance détachée, TASK, FAILED)` : 'relancer manuellement (racine sans parent) ou relever le plafond';
    lines.push(a.motif === 'plafond'
      ? `⚠ plafond sessions_max_par_instance (${a.max}) atteint, STATUS encore WORKING (hibernation volontaire) — ${decision}.`
      : `⚠ ${a.sansProgres || sessions.length} session(s) en hibernation volontaire sans progrès (ni fiche d'unité ni commit [${launch.chemin}] nouveaux) : STATUS encore WORKING — ${decision}.`);
    code = 3;
  }
  // §3.1 : une condition de réveil invalide vaut « aucune condition » — dit ici, sinon l'instance attend sans jamais être réveillée.
  if (status.reveil && status.reveil !== '—' && !reveil.parseReveil(status.reveil)) lines.push(`⚠ ligne Réveil de STATUS.md invalide (« ${status.reveil} ») : traitée comme « aucune condition », le harnais ne réveillera pas cette instance — grammaire dans docs/IMPLEMENTATION.md §3.1.`);
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
  const o = { chemin: null, bootstrap: false, dryRun: false, json: false, profil: '', modele: '', effort: '', budget: '', maxTours: '', permissionMode: '', root: '', timeoutMin: 0, addDir: [], detach: false, reveil: false, taches: false, arret: '' };
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
    else if (a === '--detach') o.detach = true;
    else if (a === '--reveil') o.reveil = true;
    else if (a === '--taches') o.taches = true;
    else if (a === '--arret') o.arret = next();
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
    '          --detach --reveil --taches --arret <chemin> (réveil/arrêt/tâches : voir docs/IMPLEMENTATION.md §3.2-§3.5)',
  ].join('\n');
}

function listTaches(root) {
  const dir = tasksDir(root);
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { files = []; }
  return files.sort().map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } }).filter(Boolean);
}
function writeStopRequest(root, chemin) {
  const dir = path.join(root, 'mission', '.holarch', 'stop');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, chemin.replace(/\//g, '-'));
  fs.writeFileSync(p, `${nowIso()}\n`);
  return p;
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n${usage()}\n`); process.exit(1); }
  if (o.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  const root = o.root ? path.resolve(o.root) : findRoot(process.cwd());
  if (!root) { process.stderr.write('Racine introuvable : lance depuis un dépôt contenant framework/KERNEL.md et mission/ (ou --root).\n'); process.exit(1); }

  if (o.taches) {
    const taches = listTaches(root);
    if (!taches.length) process.stdout.write('aucune tâche détachée.\n');
    for (const t of taches) process.stdout.write(`${t.id} · ${t.chemin} · ${t.state} · pid ${t.pid}${t.exitCode !== undefined ? ` · exit ${t.exitCode}` : ''}\n`);
    return;
  }
  if (o.arret) {
    const chemin = o.arret.replace(/^mission\//, '').replace(/\/+$/, '');
    const p = writeStopRequest(root, chemin);
    process.stdout.write(`HOLARCH ▸ ${chemin} ▸ arrêt demandé (${p})\n`);
    return;
  }
  if (o.reveil) {
    const now = new Date();
    const readStatus = (chemin) => readStatusOf(root, chemin);
    const readInbox = (chemin) => readIf(path.join(root, 'mission', chemin, 'INBOX.md')) || '';
    const waiters = reveil.listWaiters(root);
    if (o.dryRun) {
      if (!waiters.length) process.stdout.write('aucune instance en attente (ligne Réveil non vide).\n');
      for (const w of waiters) {
        const sinceIso = lastStatusCommitIso(root, w.chemin);
        const evalRes = reveil.evalReveil(w.ast, { root, chemin: w.chemin, sinceIso, now, readStatus, readInbox });
        process.stdout.write(`${w.chemin} · ${reveil.formatReveil(w.ast)} · ${evalRes.satisfied ? 'satisfaite' : 'non satisfaite'}${isLive(root, w.chemin) ? ' · live' : ''}\n`);
        for (const d of evalRes.details) process.stdout.write(`  - ${d.terme} : ${d.vrai ? 'vrai' : 'faux'} (${d.pourquoi})\n`);
      }
      return;
    }
    const reveilles = wakeWaiters(root, '--reveil');
    if (!reveilles.length) process.stdout.write('aucun réveil déclenché.\n');
    for (const r of reveilles) process.stdout.write(`HOLARCH ▸ ${r.chemin} ▸ réveillée · tâche ${r.tache} · condition ${r.condition}\n`);
    return;
  }

  if (!o.chemin) { process.stdout.write(`${usage()}\n`); process.exit(1); }

  if (o.detach && !o.dryRun) {
    const { id, pid } = detachLaunch(root, o.chemin, {});
    process.stdout.write(`HOLARCH ▸ ${o.chemin} ▸ détaché · tâche ${id} (pid ${pid})\n`);
    return;
  }

  let launch;
  try { launch = prepareLaunch(root, o.chemin, o); } catch (e) { process.stderr.write(`holarch-spawn : ${e.message}\n`); process.exit(1); }

  if (o.detach && o.dryRun) {
    process.stdout.write(`HOLARCH ▸ ${launch.chemin} ▸ détaché (dry-run) · lancerait : node ${__filename} ${launch.chemin} (HOLARCH_TASK_ID=<id>)\n`);
    return;
  }

  if (o.dryRun) {
    if (o.timeoutMin > 0) launch.timeoutMs = o.timeoutMin * 60 * 1000;
    process.stdout.write([
      `racine        : ${root}`,
      `instance      : ${launch.chemin}${launch.bootstrap ? ' (bootstrap)' : ''} · profil ${launch.meta.profil} · profondeur ${launch.meta.depth}`,
      `modèle/effort : ${launch.meta.modele} / ${launch.meta.effort} (effort : ${launch.meta.origine_effort})${launch.params.modele_repli ? ` (repli ${launch.params.modele_repli})` : ''}`,
      `fusibles      : ${launch.maxTours} tours · ${launch.budget} USD · contexte ${launch.params.seuil_contexte_tokens} tokens (autocompact ${launch.params.autocompact_tokens}) · relances sans progrès ${launch.params.relances_max} · sessions/instance ${launch.params.sessions_max_par_instance} · changements de régime ${launch.params.changements_regime_max}`,
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
  finishLaunch(root, o.chemin, code, sessions);
  process.exit(code);
}

module.exports = {
  parseConfig, parseFiche, parseStatus, resolveParams, resolveProfile, resolveMetaFromDisk,
  buildSystemPrompt, buildUserPrompt, prepareLaunch, parseResultJson, appendSessionLine, summarize,
  findRoot, launchWithRelaunches, DEFAULTS, DEFAULT_POLICY, tailInboxMessages, INBOX_TAIL_MESSAGES,
  buildUserPromptDetail, tailBounded, tailInboxBounded, moduleActive, parseUniteHeader,
  buildMemoryIndex, lastHibernationCommit, selectInboxMessages, describeWakeReason,
  isLive, wakeWaiters, detachLaunch, finishLaunch, lastStatusCommitIso, stopPath, liveLockPath,
  progressSnapshot, hasProgressed, countSessions, appendAlertToParent,
};

if (require.main === module) main();
