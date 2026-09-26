#!/usr/bin/env node
'use strict';
/**
 * holarch-spawn.js — lanceur d'instance HOLARCH (framework v1.1).
 *
 * Incarne une instance (ou exécute le bootstrap) via l'**exécuteur** sélectionné
 * (`bin/executeurs/`, `claude-code` par défaut), avec ce qui rend la session économe et bornée.
 * Tout ce qui est propre à un fournisseur — nom du binaire, arguments, champs du résultat,
 * reconnaissance d'une limite 429 — vit dans `bin/executeurs/<nom>.js` : ce fichier n'en connaît
 * rien et ne manipule que l'intention de session et le `Resultat` normalisé (chantier 9, volet 1) :
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
 *   - fusibles durs : plafonds de tours et de dépense, compactage, hooks (framework/hooks/),
 *     traduits en options concrètes par l'exécuteur — et seulement s'il en a la capacité ;
 *   - `Resultat` normalisé exploité : coût, tokens, tours, session → registry/SESSIONS.md (append-only).
 *
 * Usage :
 *   node framework/bin/holarch-spawn.js <chemin-instance> [options]
 *   node framework/bin/holarch-spawn.js --bootstrap [options]
 * Options : --profil <p> --modele <m> --effort <e> --budget-usd <n> --max-tours <n>
 *           --permission-mode <m> --timeout-min <n> --root <dir> --add-dir <dir> --dry-run --json
 *           (--add-dir répétable : un dépôt externe accessible en lecture/écriture par la session,
 *           en plus de la racine HOLARCH — cf. docs/holarch.md §16.1)
 * Codes de sortie : 0 état terminal atteint (≠ WORKING) · 1 erreur du lanceur ·
 *                   2 session terminée avec STATUS=WORKING ou erreur de l'exécuteur ·
 *                   3 hibernations volontaires épuisées (STATUS encore WORKING).
 * Aucune dépendance hors Node.js (déjà requis par Claude Code).
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');
const reveil = require('./reveil');
// Exécuteurs (chantier 9, volet 1) : tout ce qui est propre à un fournisseur de modèles — nom du
// binaire, arguments, champs du JSON de résultat, motif de limite — vit sous `bin/executeurs/`.
// Le lanceur ne connaît que le contrat { nom, capacites, preparer, executer, normaliser, limite }.
const executeurs = require('./executeurs');
// Catalogue de modèles (chantier 9, volet 2) : les deux tables facultatives `## Fournisseurs` et
// `## Catalogue de modèles` de CONFIG.md. Module pur : il traduit du texte en données et ne sait
// rien du lanceur. Tables absentes ⇒ catalogue vide ⇒ comportement d'un CONFIG.md 1.11, inchangé.
const catalogue = require('./catalogue');
const gardeGit = require('./gardes/git');
// Attente interruptible d'une limite 429 (chantier 16, §18.3) : module autonome, testable depuis
// le paquet promouvable — voir framework/bin/attente-limite.js. Chargé paresseusement, comme
// budget-session.js : les tests qui recopient holarch-spawn.js dans un bac à sable sans ce module
// (unites-indexees-*) le chargent sans MODULE_NOT_FOUND tant qu'aucune limite 429 ne survient.
function attenteLimite() { return require('./attente-limite'); }

const VALID_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const VALID_PERMISSION_MODES = ['acceptEdits', 'default', 'manual', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
const TERMINAL_STATES = ['DELIVERED', 'BLOCKED', 'FAILED', 'WAITING_CHILDREN', 'ARCHIVED', 'READY'];

/** Valeurs par défaut des paramètres (surchargeables dans CONFIG.md, table « Paramètres »). */
const DEFAULTS = {
  modele_cli: 'opus',
  effort_cli: 'high',
  modele_repli: '',
  permission_mode: 'acceptEdits',
  // Exécuteur par défaut de la mission. Vide ⇒ sélection par `executeurs.nomPour` (fournisseur du
  // catalogue, sinon l'exécuteur par défaut). Un nom inconnu fait échouer le lancement, franchement.
  executeur: '',
  // 1.11.0 : 5 → 8 USD, 120k → 180k et 180k → 400k. Mesuré sur trois missions (2026-09-11) : un enfant démarre à ~69k,
  // clôt vers seuil + 25k ; à 250k le fusible n'a jamais sonné et c'est le budget qui arbitrait (holarch-delegation).
  budget_usd_par_session: '8',
  budget_usd_session_max: '20', // chantier 16, §18.2 : plafond de la ligne « Budget USD / session » de la fiche registre
  max_tours_par_session: '200',
  seuil_contexte_tokens: '240000', // 1.13.0 : p90 198 602 mesuré sur holarch-outillage (docs/diagnostics/2026-09-11-seuil-contexte-240k.md)
  autocompact_tokens: '400000',
  outils_cli: 'Read,Write,Edit,Bash,Glob,Grep,Agent,TodoWrite',
  relances_max: '2',
  sessions_sans_unite_max: '3', // 1.21.0 (P5 holarch-modeles) : sessions consécutives sans nouvelle fiche d'unité, commits ou pas
  sessions_max_par_instance: '24',
  changements_regime_max: '1',
  commit_par_session: 'oui',
  // Chantier 3 : isolation d'une instance non-racine — worktree (défaut) crée mission/.holarch/worktrees/
  // <chemin-tirets> à la première incarnation ; branche : reste sur la branche sans worktree séparé ;
  // aucune : comportement historique (pas d'isolation Git). Voir resolveWorkspace.
  isolation: 'worktree',
  // Bornes du prompt de réveil (chantier 0, diagnostic 2026-09-09 : les bornes en lignes ne bornaient rien,
  // une ligne de JOURNAL.md ou de PROGRESS.md pouvant faire plusieurs milliers de caractères).
  reveil_journal_lignes: '40',
  reveil_journal_chars: '8000',
  reveil_progress_lignes: '10',
  reveil_progress_chars: '4000',
  reveil_inbox_messages: '8',
  reveil_inbox_chars: '12000',
  reveil_memory_chars: '20000',
  // Module extensions/delegation-intra-session (chantier 7, §9.1) : modèle par défaut du sous-agent
  // `holarch-unite` construit par --agents (buildAgentsOption). Sans effet si le module n'est pas actif.
  sous_agent_modele: 'sonnet',
  sous_agent_effort: 'medium',
};

/** Politique de modèle par profil, par défaut (surchargeable : CONFIG.md « ## Politique de modèle »). */
const DEFAULT_POLICY = {
  conception: { modele: 'opus', effort: 'high' },
  execution: { modele: 'opus', effort: 'low' },
  relecture: { modele: 'opus', effort: 'medium' },
  exploration: { modele: 'opus', effort: 'xhigh' },
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
 * Offsets des ouvertures d'enveloppe (KERNEL §7) d'un texte INBOX/OUTBOX, mêmes règles que
 * `message-lint` (`trouverOuvertures`, toutes les ouvertures — valides ou non, §5.1 B2) : ne jamais
 * dupliquer ici une seconde grammaire qui verrait des blocs différents de l'outil de lint. `require`
 * local (jamais en tête de fichier) avec repli fail-open sur l'ancien regex (`id:` avec espace
 * obligatoire) si `message-lint` est indisponible — conventions §0.2, hooks fail-open.
 */
function ouverturesMessages(t) {
  try {
    return require('../../tools/message-lint/message-lint').trouverOuvertures(t).map((o) => o.offset);
  } catch (_) {
    const re = /^---\nid: /gm;
    const idx = [];
    let m;
    while ((m = re.exec(t))) idx.push(m.index);
    return idx;
  }
}
/**
 * Comme tailInboxMessages, puis retire les messages les plus anciens tant que le total dépasse `maxChars`,
 * en gardant toujours le dernier message entier. Jamais de coupe à l'intérieur d'un bloc (KERNEL §7).
 */
function tailInboxBounded(text, maxMessages, maxChars) {
  const t = String(text || '');
  const idx = ouverturesMessages(t);
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
  const idx = ouverturesMessages(t);
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
  return path.join(instanceRoot(root, chemin), 'mission', 'registry', 'instances', `${chemin.replace(/\//g, '-')}.md`);
}
function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }

// ---------------------------------------------------------------------------
// Chantier 3 : un worktree par instance (git-branches v1.1.0, isolation=worktree)
// ---------------------------------------------------------------------------
function worktreeDir(root, chemin) {
  return path.join(root, 'mission', '.holarch', 'worktrees', chemin.replace(/\//g, '-'));
}
function hasWorktree(root, chemin) {
  return fs.existsSync(worktreeDir(root, chemin));
}
/** Racine réelle des fichiers d'une instance : son worktree s'il existe, sinon la racine du dépôt. */
function instanceRoot(root, chemin) {
  return hasWorktree(root, chemin) ? worktreeDir(root, chemin) : root;
}
/** Chemin réel d'un fichier d'instance : dans le worktree de l'instance s'il existe, sinon dans root. */
function instancePath(root, chemin, rel) {
  return path.join(instanceRoot(root, chemin), 'mission', chemin, rel);
}
/** Si git-branches est actif avec isolation=worktree et que l'instance n'est pas la racine :
 *  dir = mission/.holarch/worktrees/<chemin-tirets> ; s'il n'existe pas : `git worktree add <dir> holarch/<chemin-tirets>`
 *  (la branche doit exister : sinon erreur explicite « spawn incomplet : branche absente »).
 *  Retourne {cwd: dir, branche} ; sinon {cwd: root, branche: null}. */
function resolveWorkspace(root, chemin, cfg) {
  if (!chemin.includes('/') || !moduleActive(cfg, 'extensions', 'git-branches')) return { cwd: root, branche: null };
  const params = resolveParams(cfg);
  const prefixe = params.prefixe_branche || 'holarch/';
  const branche = `${prefixe}${chemin.replace(/\//g, '-')}`;
  if (params.isolation !== 'worktree') return { cwd: root, branche };
  const dir = worktreeDir(root, chemin);
  if (!fs.existsSync(dir)) {
    const check = spawnSync('git', ['rev-parse', '--verify', branche], { cwd: root, encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`spawn incomplet : branche absente (${branche})`);
    const add = spawnSync('git', ['worktree', 'add', dir, branche], { cwd: root, encoding: 'utf8' });
    if (add.status !== 0) throw new Error(`git worktree add a échoué pour ${chemin} : ${(add.stderr || '').trim()}`);
  }
  return { cwd: dir, branche };
}
/** Écrit sous `<root>/mission/.holarch/graveyard/<chemin-tirets>-<horodatage>.patch` le diff (index et arbre,
 *  fichiers non suivis inclus) du worktree `dir` par rapport à HEAD, sans polluer l'index réel du worktree :
 *  copie de son fichier d'index dans un temporaire, passé par `GIT_INDEX_FILE` aux commandes git. Écrit
 *  toujours un fichier (même vide) — les raisons d'un diff vide ou d'un échec de commande sont notées en
 *  en-tête (lignes `# …`). Retourne le chemin du patch relatif à `root`. */
function writeGraveyardPatch(root, chemin, dir) {
  const notes = [];
  let diff = '';
  try {
    const gitPath = spawnSync('git', ['-C', dir, 'rev-parse', '--git-path', 'index'], { encoding: 'utf8' });
    if (gitPath.status !== 0) throw new Error((gitPath.stderr || '').trim() || 'git rev-parse --git-path index a échoué');
    const indexReel = gitPath.stdout.trim();
    const indexAbs = path.isAbsolute(indexReel) ? indexReel : path.join(dir, indexReel);
    const indexTmp = path.join(os.tmpdir(), `holarch-graveyard-index-${process.pid}-${Date.now()}`);
    fs.copyFileSync(indexAbs, indexTmp);
    const env = Object.assign({}, process.env, { GIT_INDEX_FILE: indexTmp });
    const add = spawnSync('git', ['-C', dir, 'add', '-N', '.'], { encoding: 'utf8', env });
    if (add.status !== 0) notes.push(`git add -N . a échoué : ${(add.stderr || '').trim()}`);
    const diffRes = spawnSync('git', ['-C', dir, 'diff', 'HEAD'], { encoding: 'utf8', env });
    if (diffRes.status !== 0) notes.push(`git diff HEAD a échoué : ${(diffRes.stderr || '').trim()}`);
    else diff = diffRes.stdout || '';
    try { fs.unlinkSync(indexTmp); } catch (_) { /* best-effort */ }
  } catch (e) {
    notes.push(e.message);
  }
  if (!diff.trim()) notes.push('diff vide');
  const graveyard = path.join(root, 'mission', '.holarch', 'graveyard');
  fs.mkdirSync(graveyard, { recursive: true });
  const horodatage = new Date().toISOString().replace(/[:.]/g, '-');
  const fichier = path.join(graveyard, `${chemin.replace(/\//g, '-')}-${horodatage}.patch`);
  const entete = notes.map((n) => `# ${n}\n`).join('');
  fs.writeFileSync(fichier, entete + diff);
  return path.relative(root, fichier);
}

/** `--nettoyer-worktree <chemin>` : git worktree remove (refuse si des changements non committés subsistent,
 *  sauf `--forcer` : le diff est alors sauvé sous `mission/.holarch/graveyard/` avant suppression forcée). */
function removeWorktree(root, chemin, opts = {}) {
  const dir = worktreeDir(root, chemin);
  if (!fs.existsSync(dir)) return { removed: false, reason: 'absent' };
  if (!opts.forcer) {
    try {
      // require paresseux (chantier 16, U10) : un arbre plus ancien sans jobs.js reste utilisable
      // (MODULE_NOT_FOUND ignoré) ; toute autre erreur remonte.
      const { jobsVivantsDans } = require('./jobs');
      const vivants = jobsVivantsDans(root, dir);
      if (vivants.length) {
        const noms = vivants.map((j) => `${j.id} (${j.proprietaire})`).join(', ');
        return { removed: false, reason: `job vivant dans ce worktree : ${noms}` };
      }
    } catch (err) {
      if (!err || err.code !== 'MODULE_NOT_FOUND') throw err;
    }
  }
  const status = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' });
  const sale = status.status === 0 && !!status.stdout.trim();
  if (sale && !opts.forcer) return { removed: false, reason: 'changements non committés' };
  const patch = sale ? writeGraveyardPatch(root, chemin, dir) : null;
  const args = opts.forcer ? ['worktree', 'remove', '--force', dir] : ['worktree', 'remove', dir];
  const rm = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (rm.status !== 0) return { removed: false, reason: (rm.stderr || '').trim() || 'échec git worktree remove' };
  return patch ? { removed: true, patch } : { removed: true };
}

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
// Chantier 15, §16.2 : --controle <chemin> — rejeu de la colonne Contrôle d'un ROLE.md/OBJECTIVE.md
// ---------------------------------------------------------------------------
/** Source des livrables de `chemin` et l'espace de travail où rejouer ses commandes : règle
 *  « worktree → disque → branche ». `null` si introuvable dans les trois. */
function resolveSourceControle(root, chemin, cfg) {
  const relSource = chemin.includes('/') ? path.join('mission', chemin, 'ROLE.md') : path.join('mission', 'OBJECTIVE.md');
  if (hasWorktree(root, chemin)) {
    const cwd = worktreeDir(root, chemin);
    const texte = readIf(path.join(cwd, relSource));
    if (texte !== null) return { texte, espace: 'worktree', cwd, source: relSource };
  }
  const texteDisque = readIf(path.join(root, relSource));
  if (texteDisque !== null) return { texte: texteDisque, espace: 'disque', cwd: root, source: relSource };
  const gb = gitBranchesCtx(cfg);
  const prefixe = (gb && gb.prefixe) || 'holarch/';
  const branche = `${prefixe}${chemin.replace(/\//g, '-')}`;
  const show = spawnSync('git', ['show', `${branche}:${relSource.replace(/\\/g, '/')}`], { cwd: root, encoding: 'utf8' });
  if (show.status === 0) return {
    texte: show.stdout, espace: 'branche', cwd: root, source: relSource,
  };
  return null;
}

/** `--controle <chemin>` (docs/IMPLEMENTATION.md §16.2) : rejoue chaque commande de la colonne
 *  Contrôle de la source de rôle de `chemin` dans son espace de travail réel, imprime code et
 *  première ligne de chaque rapport, écrit `mission/.holarch/controles/<chemin-tirets>-<ts>.json`.
 *  Retourne `{ code, fichier }` — code 0 ssi tous les contrôles exécutés sont à 0 (aucune colonne
 *  Contrôle : code 0, rien écrit ; source introuvable : code 2, rien écrit). */
function controle(root, chemin) {
  // Chargé ici, pas en tête de fichier : les sandboxes des autres tests (unites-indexees-select-
  // inbox-messages-origine.test.js, etc.) ne reconstituent que framework/bin/ autour de ce fichier,
  // jamais framework/hooks/ — un require de tête casserait tout ce qui n'exerce pas --controle.
  const holarchHooks = require('../hooks/holarch-hooks');
  const cfg = parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md')));
  const resolu = resolveSourceControle(root, chemin, cfg);
  if (!resolu) {
    const attendu = chemin.includes('/') ? `mission/${chemin}/ROLE.md` : 'mission/OBJECTIVE.md';
    process.stderr.write(`HOLARCH ▸ ${chemin} ▸ --controle : source introuvable (ni worktree, ni disque, ni branche) — ${attendu}\n`);
    return { code: 2, fichier: null };
  }
  const livrables = holarchHooks.parseLivrables(resolu.texte);
  if (!livrables) {
    process.stdout.write('aucune colonne Contrôle : rien à rejouer\n');
    return { code: 0, fichier: null };
  }
  const controles = [];
  for (const l of livrables) {
    if (!l.controle) { process.stdout.write(`${l.livrable} : — (pas de contrôle)\n`); continue; }
    const res = spawnSync(l.controle, { shell: true, cwd: resolu.cwd, encoding: 'utf8', timeout: 10 * 60 * 1000 });
    const code = res.status === null ? 1 : res.status;
    const premiereLigne = (res.stdout || '').split('\n').map((s) => s.trim()).find(Boolean)
      || (res.stderr || '').split('\n').map((s) => s.trim()).find(Boolean) || '-';
    process.stdout.write(`${l.livrable} · ${l.controle} → code ${code} · ${premiereLigne}\n`);
    controles.push({
      livrable: l.livrable, commande: l.controle, code, premiereLigne,
    });
  }
  const tousAZero = controles.every((c) => c.code === 0);
  const ts = new Date().toISOString().replace(/:/g, '-');
  const dir = path.join(root, 'mission', '.holarch', 'controles');
  fs.mkdirSync(dir, { recursive: true });
  const fichier = path.join(dir, `${chemin.replace(/\//g, '-')}-${ts}.json`);
  fs.writeFileSync(fichier, JSON.stringify({
    chemin, date: new Date().toISOString(), source: resolu.source, espace: resolu.espace, cwd: resolu.cwd, controles, tousAZero,
  }, null, 2));
  return { code: tousAZero ? 0 : 1, fichier };
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
  const f = { profil: '', effort: '', modele: '', alloue: null, consomme: null, statut: '' };
  if (!text) return f;
  const row = (label) => {
    const m = text.match(new RegExp(`^\\|\\s*${label}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'mi'));
    return m ? stripTicks(m[1]) : '';
  };
  f.profil = row('Profil').toLowerCase();
  f.effort = row('Effort').toLowerCase(); // optionnel : effort jugé pour la tâche (direct-spawn), prime sur celui du profil
  // Optionnel (chantier 9, volet 2) : identifiant du catalogue de modèles posé par le parent au spawn
  // (« choisis le modèle de l'enfant selon sa tâche, sinon la politique décide »). La casse est
  // conservée : un identifiant de catalogue peut en porter (`opus@openrouter`, `Sonnet-4.5`).
  f.modele = row('Mod[èe]le');
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
  const p = Object.assign({}, DEFAULTS, cfg.params || {});
  // Troisième revue n° 76 : sans ligne budget_usd_par_session (ou vide), le défaut est min(8, budget_usd_session_max)
  // — le 8 de DEFAULTS ne dépasse plus un plafond déclaré plus bas (lanceur, dry-run et réveil lisent tous ceci).
  const declare = cfg.params && cfg.params.budget_usd_par_session;
  let bs = null;
  try { bs = require('./budget-session'); } catch (_) { /* lanceur copié seul (fixtures de test) : défaut de DEFAULTS */ }
  if (bs && (declare === undefined || declare === null || String(declare).trim() === '')) p.budget_usd_par_session = String(bs.budgetParDefaut(p));
  return p;
}

function resolveProfile(cfg, fiche, chemin, overrides) {
  const depth = chemin.split('/').length;
  let profil = (overrides.profil || fiche.profil || (depth === 1 ? 'conception' : 'execution')).toLowerCase();
  // Précédence : option CLI > lignes `Modèle` et `Effort` de la fiche registre (jugées par le parent pour la
  // tâche, ou changées par l'instance elle-même : direct-spawn) > table « Politique de modèle » de CONFIG.md >
  // modele_cli/effort_cli explicites de CONFIG.md > politique par défaut du module (DEFAULT_POLICY) > DEFAULTS.
  // La ligne `Modèle` (chantier 9, volet 2) nomme un identifiant du catalogue ; elle est facultative, et son
  // absence redonne exactement le comportement antérieur (le modèle vient du profil).
  const explicit = cfg.params || {};
  let modele = explicit.modele_cli || (DEFAULT_POLICY[profil] && DEFAULT_POLICY[profil].modele) || DEFAULTS.modele_cli;
  let effort = explicit.effort_cli || (DEFAULT_POLICY[profil] && DEFAULT_POLICY[profil].effort) || DEFAULTS.effort_cli;
  let origineEffort = explicit.effort_cli ? 'config' : 'defaut';
  let origineModele = explicit.modele_cli ? 'config' : 'defaut';
  const row = (cfg.policy || {})[profil];
  if (row) { if (row.modele) { modele = row.modele; origineModele = 'config'; } if (row.effort) { effort = row.effort; origineEffort = 'config'; } }
  else if (!DEFAULT_POLICY[profil]) profil = `${profil} (profil inconnu → défauts)`;
  if (fiche.modele) { modele = fiche.modele; origineModele = 'fiche'; }
  if (fiche.effort) {
    if (VALID_EFFORTS.includes(fiche.effort)) { effort = fiche.effort; origineEffort = 'fiche'; }
    else process.stderr.write(`HOLARCH ▸ ${chemin} ▸ effort « ${fiche.effort} » de la fiche registre non reconnu (valeurs : ${VALID_EFFORTS.join(', ')}) — ignoré, effort du profil conservé\n`);
  }
  if (overrides.modele) { modele = overrides.modele; origineModele = 'option'; }
  if (overrides.effort) { effort = overrides.effort; origineEffort = 'option'; }
  effort = String(effort).toLowerCase();
  if (!VALID_EFFORTS.includes(effort)) throw new Error(`effort invalide « ${effort} » (valeurs : ${VALID_EFFORTS.join(', ')})`);
  return { profil, modele, effort, depth, origine_effort: origineEffort, origine_modele: origineModele };
}

/**
 * Complète le régime résolu par ce que le catalogue de modèles (volet 2) sait du modèle demandé :
 * `fournisseur` (nom, ou null), `modele_reel` (ce qui sera réellement envoyé) et `tarif` (l'entrée de
 * catalogue, pour le coût estimé). Catalogue vide ou identifiant hors catalogue ⇒ `fournisseur` null
 * et `modele_reel` égal à l'identifiant : le lanceur se comporte alors exactement comme avant le
 * chantier 9 (compatibilité ascendante d'un `CONFIG.md` 1.11).
 * Les incohérences sont **signalées sans bloquer** (stderr) : une table mal remplie ne doit pas
 * empêcher une session d'avoir lieu — `config-lint` est là pour la refuser, en amont et à froid.
 */
function enrichirMeta(meta, cat, chemin, opts) {
  const entree = catalogue.modele(cat, meta.modele);
  const f = catalogue.fournisseurDe(cat, meta.modele);
  meta.modele_reel = catalogue.modeleReel(cat, meta.modele);
  meta.fournisseur = f ? f.nom : null;
  meta.passerelle = !!(f && f.url_var); // fournisseur à variables : le coût du CLI n'y fait pas foi (1.21.0)
  meta.tarif = entree || null;
  // Marque portée par la session de repli (volet 3) jusqu'à la colonne « Fin » de SESSIONS.md.
  meta.repli_depuis = (opts && opts.repliDepuis) || null;
  // Permis de protocole (chantier 13) : avertissement au spawn si le modèle n'a pas de permis au
  // catalogue, ou si sa note est sous le seuil (3/4). Jamais un refus — un modèle sans permis reste
  // lançable, l'avertissement est là pour que le choix soit conscient (docs/IMPLEMENTATION.md §14).
  const ecartPermisModele = catalogue.ecartPermis(entree);
  if (ecartPermisModele) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ${ecartPermisModele}\n`);
  if (entree && !catalogue.effortPermis(entree, meta.effort)) {
    process.stderr.write(`HOLARCH ▸ ${chemin} ▸ effort « ${meta.effort} » hors des paliers déclarés pour « ${meta.modele} » (${(entree.efforts || []).join(', ')}) — lancé tel quel\n`);
  }
  if (cat && (cat.aFournisseurs || cat.aCatalogue)) {
    const ecarts = catalogue.verifierCatalogue(cat);
    if (ecarts.length) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ catalogue de modèles incohérent : ${ecarts.join(' ; ')}\n`);
  }
  return meta;
}

/**
 * Fiche de fournisseur transmise à l'exécuteur (`launch.fournisseur`) : ce que le catalogue déclare,
 * plus l'URL et le jeton **lus dans l'environnement** aux variables nommées par la table (jamais
 * committés, geste du mainteneur). null si le modèle n'a pas de fournisseur déclaré.
 */
function fournisseurPour(cat, meta, env) {
  const f = catalogue.fournisseurDe(cat, meta.modele);
  if (!f) return null;
  return {
    nom: f.nom,
    executeur: f.executeur,
    secours: f.secours,
    modele_reel: meta.modele_reel,
    url_var: f.url_var,
    jeton_var: f.jeton_var,
    url: f.url_var ? (env[f.url_var] || null) : null,
    jeton: f.jeton_var ? (env[f.jeton_var] || null) : null,
  };
}

/**
 * Fournisseurs qu'une session peut atteindre — celui de son modèle, puis le secours de celui-ci si le
 * modèle y a un équivalent (repli 429, §11.3) — dont une variable déclarée au catalogue est absente de
 * `env`. Vide quand tout est là, ou quand le modèle n'a pas de fournisseur déclaré. Un fournisseur
 * déclaré mais hors d'atteinte (ni modèle ni secours de cette session) ne compte pas : le preset en
 * déclare un par défaut, sans que la mission s'en serve.
 */
function fournisseursSansVariables(cat, meta, env) {
  const f = catalogue.fournisseurDe(cat, meta.modele);
  if (!f) return [];
  const noms = [f.nom];
  const secours = catalogue.secoursDe(cat, f.nom);
  if (secours && catalogue.equivalentChez(cat, meta.modele, secours)) noms.push(secours);
  const manques = [];
  for (const nom of noms) {
    const ff = catalogue.fournisseur(cat, nom);
    if (!ff) continue;
    const variables = [ff.url_var, ff.jeton_var].filter((v) => v && !env[v]);
    if (variables.length) manques.push({ nom, variables });
  }
  return manques;
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
/** `opts.ecrire === false` (--dry-run) : calcule l'index sans l'écrire — un --dry-run ne doit rien laisser sur disque,
 *  a fortiori dans les fichiers d'une autre instance (ALERT MSG-implementeur-002, mission holarch-provenance, 2026-09-10). */
function buildMemoryIndex(root, chemin, opts) {
  const dir = instancePath(root, chemin, 'memoire');
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
  if (!opts || opts.ecrire !== false) fs.writeFileSync(path.join(dir, 'INDEX.md'), contenu);
  return { lignes: rows.length, contenu };
}

/** Date ISO (et sha) du dernier commit ayant touché mission/<chemin>/MEMORY.md (= dernière
 *  hibernation), ou null si Git est absent, en échec, ou si le fichier n'a jamais été committé. */
function lastHibernationCommit(root, chemin) {
  const rel = path.join('mission', chemin, 'MEMORY.md').split(path.sep).join('/');
  let r;
  try { r = spawnSync('git', ['log', '-1', '--format=%H%n%cI', '--', rel], { cwd: instanceRoot(root, chemin), encoding: 'utf8' }); }
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
/** INBOX.md d'une instance telle que le harnais doit la voir : son fichier (worktree → disque) PLUS, sous un worktree
 *  par instance (chantier 3), les messages que ses descendants lui ont écrits dans LEUR worktree — copie de
 *  mission/<chemin>/INBOX.md sur leur branche, pas encore fusionnée. Sans cela, un ALERT/BLOCKER/CLARIFICATION d'un
 *  enfant n'atteint le parent qu'à la fusion : les termes `message:` de sa condition de réveil ne le voient jamais
 *  (mission holarch-provenance, 2026-09-10). Dédoublonné par id ; chaque bloc ajouté porte un commentaire de provenance
 *  en fin de bloc. Retourne null si aucun fichier n'existe nulle part. */
function readInboxOf(root, chemin) {
  const own = readIf(instancePath(root, chemin, 'INBOX.md'));
  let text = own === null ? '' : own;
  const ids = new Set(parseMessageBlocks(text).msgs.map((m) => m.id).filter(Boolean));
  const wdir = path.join(root, 'mission', '.holarch', 'worktrees');
  const prefix = `${chemin.replace(/\//g, '-')}-`;
  let wts = [];
  try { wts = fs.readdirSync(wdir, { withFileTypes: true }); } catch (_) { /* aucun worktree */ }
  let trouve = own !== null;
  for (const w of wts) {
    if (!w.isDirectory() || !w.name.startsWith(prefix)) continue; // descendants seulement
    const copy = readIf(path.join(wdir, w.name, 'mission', chemin, 'INBOX.md'));
    if (copy === null) continue;
    trouve = true;
    for (const m of parseMessageBlocks(copy).msgs) {
      if (!m.id || ids.has(m.id)) continue;
      ids.add(m.id);
      const bloc = m.block.replace(/\s*$/, '');
      text += `${text && !text.endsWith('\n') ? '\n' : ''}${bloc}\n<!-- non fusionné : lu depuis le worktree ${w.name} -->\n`;
    }
  }
  return trouve ? text : null;
}

/**
 * 1.14.0 — relais parent → enfant sous `git-branches` / `isolation = worktree`. L'INBOX d'un enfant vit dans son
 * worktree, où son parent n'écrit jamais (cloisonnement, allowlist sans `git -C`). Le parent écrit donc à son enfant
 * dans `mission/<chemin-enfant>/INBOX.md` de SON PROPRE arbre (instanceRoot du parent) et committe ; à l'incarnation
 * suivante de l'enfant, ce relais copie dans le worktree tout message committé qui n'y est pas encore (bloc identique,
 * pour que la fusion `merge=union` ultérieure reste propre), un commit par message dont le sujet reproduit la classe
 * de provenance déduite par message-lint --blame sur la source : `[<from>]` (vérifié), sans préfixe (utilisateur),
 * `[harnais]` sinon (non vérifié, et le reste). Un message non encore committé n'est pas relayé (typed-escalation :
 * un ordre non committé n'est jamais exécuté — autant ne pas le transporter). Fail-open : jamais bloquant.
 */
function relayInboxFromParent(root, chemin) {
  if (!chemin.includes('/') || !hasWorktree(root, chemin)) return null;
  const parent = chemin.split('/').slice(0, -1).join('/');
  const parentTree = instanceRoot(root, parent);
  const rel = path.join('mission', chemin, 'INBOX.md').split(path.sep).join('/');
  const src = path.join(parentTree, rel);
  const dstDir = worktreeDir(root, chemin);
  const dst = path.join(dstDir, rel);
  const res = { parent, relayes: [], ignores: [], commit: null };
  const srcText = readIf(src);
  if (srcText === null) return res;
  const dstText0 = readIf(dst);
  let texte = dstText0 === null ? `# INBOX — ${chemin}\n\n<!-- Append-only (KERNEL §7). Messages reçus, au format framework/templates/MESSAGE.template.md. -->\n` : dstText0;
  const ids = new Set(parseMessageBlocks(texte).msgs.map((m) => m.id).filter(Boolean));
  const manquants = parseMessageBlocks(srcText).msgs.filter((m) => m.id && !ids.has(m.id));
  if (!manquants.length) return res;
  const analyses = new Map();
  try {
    const { analyserMessages } = require('../../tools/message-lint/message-lint');
    for (const a of analyserMessages(srcText, { root: parentTree, fichier: rel, blame: true })) if (a.id) analyses.set(a.id, a);
  } catch (_) { /* fail-open : relais sous [harnais], provenance non vérifiée */ }
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'HOLARCH', GIT_AUTHOR_EMAIL: 'holarch@localhost', GIT_COMMITTER_NAME: 'HOLARCH', GIT_COMMITTER_EMAIL: 'holarch@localhost' });
  for (const m of manquants) {
    const a = analyses.get(m.id);
    if (a && /non encore committ/i.test(a.motif || '')) { res.ignores.push({ id: m.id, motif: a.motif }); continue; }
    const bloc = m.block.replace(/\s*$/, '');
    texte += `${texte && !texte.endsWith('\n') ? '\n' : ''}${bloc}\n`;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, texte);
    const prefixe = a && a.verifiee === true ? (a.origine === 'utilisateur' ? '' : `[${a.origine}] `) : '[harnais] ';
    const motif = a && a.verifiee === true ? `depuis l'arbre de ${parent}` : `provenance non vérifiée${a && a.motif ? ` : ${a.motif}` : ''}`;
    const sujet = `${prefixe}relais INBOX ${m.id} (lanceur, ${motif})`;
    let sha = null;
    if (spawnSync('git', ['-C', dstDir, 'add', '--', rel], { encoding: 'utf8', env }).status === 0
      && spawnSync('git', ['-C', dstDir, 'commit', '-q', '-m', sujet], { encoding: 'utf8', env }).status === 0) {
      sha = (spawnSync('git', ['-C', dstDir, 'rev-parse', 'HEAD'], { encoding: 'utf8', env }).stdout || '').trim() || null;
      res.commit = sha;
    }
    res.relayes.push({ id: m.id, sujet, sha, verifie: !!(a && a.verifiee === true) });
  }
  return res;
}

function selectInboxMessages(root, chemin, params) {
  const inboxText = readInboxOf(root, chemin) || '';
  const nMsg = Number(params.reveil_inbox_messages) || Number(DEFAULTS.reveil_inbox_messages);
  const nChars = Number(params.reveil_inbox_chars) || Number(DEFAULTS.reveil_inbox_chars);
  const hib = lastHibernationCommit(root, chemin);
  if (!hib) {
    const b = tailInboxBounded(inboxText, nMsg, nChars);
    return { content: b.content, hidden: b.hidden, criteres: 'repli sans git : tailInboxBounded seul', verifies: 0, nonVerifies: 0 };
  }
  const { header, msgs } = parseMessageBlocks(inboxText);
  if (!msgs.length) return { content: inboxText, hidden: 0, criteres: 'aucun message', verifies: 0, nonVerifies: 0 };
  const outboxText = readIf(instancePath(root, chemin, 'OUTBOX.md')) || '';
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
  const annotated = annoterOrigines(root, chemin, inboxText, b.content);
  return {
    content: annotated.content,
    hidden: hiddenParUnion + b.hidden,
    criteres: 'postérieurs au dernier commit MEMORY ; 2 derniers ; TASK/RESPONSE sans ref dans OUTBOX',
    verifies: annotated.verifies,
    nonVerifies: annotated.nonVerifies,
  };
}

/**
 * Annote chaque message de `content` (sous-ensemble déjà borné de inboxText, KERNEL §7 : jamais de
 * coupe à l'intérieur d'un bloc) d'un commentaire HTML de provenance, déduite par
 * tools/message-lint/message-lint.js --blame contre le fichier réel INBOX.md de l'instance (chantier 4,
 * docs/IMPLEMENTATION.md §5.3). Le blame tourne sur `inboxText` (texte complet non tronqué) pour que
 * les numéros de ligne restent valides contre le fichier sur disque ; le résultat est ensuite reporté
 * sur `content` par id. Sans message-lint disponible (chemin rompu, pas de dépôt Git) : contenu
 * inchangé, 0 vérifié / 0 non vérifié — fail-open, jamais bloquant.
 */
function annoterOrigines(root, chemin, inboxText, content) {
  let analyserMessages;
  try {
    ({ analyserMessages } = require('../../tools/message-lint/message-lint'));
  } catch (_) {
    return { content, verifies: 0, nonVerifies: 0 };
  }
  const cwd = instanceRoot(root, chemin);
  const fichier = path.join('mission', chemin, 'INBOX.md').split(path.sep).join('/');
  let analyses;
  try {
    analyses = analyserMessages(inboxText, { root: cwd, fichier, blame: true });
  } catch (_) {
    return { content, verifies: 0, nonVerifies: 0 };
  }
  const parId = new Map();
  for (const a of analyses) if (a.id) parId.set(a.id, a);
  const { header, msgs } = parseMessageBlocks(content);
  let verifies = 0;
  let nonVerifies = 0;
  let out = header;
  for (const m of msgs) {
    const a = m.id ? parId.get(m.id) : undefined;
    if (a && a.verifiee === true) {
      verifies += 1;
      out += `<!-- origine vérifiée : ${a.origine}${a.sha ? ` (commit ${a.sha.slice(0, 8)})` : ''} -->\n`;
    } else {
      nonVerifies += 1;
      const nonFusionne = m.block.match(/<!-- non fusionné : lu depuis le worktree ([^ ]+) -->/);
      const motif = nonFusionne
        ? `non fusionné, lu depuis le worktree ${nonFusionne[1]} (vérifiable à la fusion de sa branche)`
        : a
          ? `from=${a.from || '?'} auteur du commit=${a.origine || '?'}`
          : 'bloc non apparié par message-lint (id absent ou enveloppe invalide)';
      out += `<!-- origine NON VÉRIFIÉE : ${motif} -->\n`;
    }
    out += m.block;
  }
  return { content: out, verifies, nonVerifies };
}

/**
 * Bloc `<reveil>` injecté après STATUS.md : état et note de STATUS.md, identifiants des messages
 * INBOX ajoutés depuis lastHibernationCommit, enfants directs dont STATUS.md a changé depuis ce
 * commit (avec leur état courant). Condition de réveil (chantier 2) omise tant qu'il n'est pas en
 * place. Sans Git : bloc réduit à l'état de STATUS.md.
 */
function describeWakeReason(root, chemin) {
  const status = parseStatus(readIf(instancePath(root, chemin, 'STATUS.md')));
  const lines = [`état : ${status.etat || '(absent)'}${status.note ? ` — ${status.note}` : ''}`];
  const hib = lastHibernationCommit(root, chemin);
  if (!hib) {
    lines.push('sans Git : bloc réduit à l\'état de STATUS.md');
    return lines.join('\n');
  }
  const { msgs } = parseMessageBlocks(readInboxOf(root, chemin) || '');
  const nouveaux = msgs.filter((m) => m.date && m.date > hib.dateIso).map((m) => m.id || '?');
  lines.push(nouveaux.length ? `messages INBOX nouveaux depuis ${hib.sha.slice(0, 8)} : ${nouveaux.join(', ')}` : 'aucun message INBOX nouveau depuis la dernière hibernation');
  // Enfants directs : énumérés par union arbre du parent + worktrees + branches (reveil.listChildren) et lus par
  // readStatusOf (worktree → disque → branche) — sous isolation = worktree, leur STATUS.md n'est PAS dans l'arbre
  // de ce parent (dogfooding du 2026-09-10 : le bloc annonçait « aucun enfant dont le statut a changé » alors que
  // les deux enfants DELIVERED venaient de déclencher le réveil). Le « changé depuis l'hibernation » n'est connu que
  // pour un enfant présent dans l'arbre du parent (git diff) ; les autres sont listés avec leur état courant.
  const relBase = path.join('mission', chemin).split(path.sep).join('/');
  let diff;
  try { diff = spawnSync('git', ['diff', '--name-only', hib.sha, '--', `${relBase}/*/STATUS.md`], { cwd: instanceRoot(root, chemin), encoding: 'utf8' }); }
  catch (_) { diff = null; }
  const changes = new Set();
  if (diff && !diff.error && diff.status === 0 && diff.stdout) {
    for (const f of diff.stdout.trim().split('\n').filter(Boolean)) {
      const childName = path.relative(relBase, f).split(path.sep).join('/').split('/')[0];
      if (childName) changes.add(childName);
    }
  }
  const gb = gitBranchesCtx(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md'))));
  const children = reveil.listChildren(root, chemin, gb).map((n) => `${n} → ${readStatusOf(root, `${chemin}/${n}`).etat || '(absent)'}${changes.has(n) ? ' (changé depuis l\'hibernation)' : ''}`);
  lines.push(children.length ? `enfants directs : ${children.join(', ')}` : 'aucun enfant direct');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Construction des prompts
// ---------------------------------------------------------------------------
function fileBlock(rel, content, note) {
  const attrs = note ? ` note="${note}"` : '';
  return `<fichier chemin="${rel}"${attrs}>\n${String(content).replace(/\s+$/, '')}\n</fichier>`;
}

/**
 * Réduit le contenu d'un module à ce qui est effectivement injecté au réveil d'une session (chantier 7,
 * §9.2) : l'en-tête (titre `# Module : …` + lignes de métadonnées `>`) suivi de la seule section
 * `## Règles injectées` — jamais `## Constat` ni `## Ce que ce module ne fait pas` (ni `## Paramètres`,
 * lisibles à la demande sur disque, KERNEL §5.8 ; leurs valeurs effectives sont résumées à part par
 * parametresEffectifs, RAPPORT holarch-delegation §6.1). Repli fail-open : si `## Règles injectées` est
 * introuvable (fixture de test minimale, module non conforme au gabarit), retourne le texte entier
 * plutôt que de faire disparaître le contenu.
 */
function extraireEnTeteEtReglesInjectees(text) {
  const t = String(text || '');
  const lines = t.split('\n');
  let finEntete = lines.findIndex((l) => l.startsWith('## '));
  if (finEntete === -1) return t;
  const entete = lines.slice(0, finEntete).join('\n').replace(/\s+$/, '');
  const debutRegles = lines.findIndex((l) => l.trim() === '## Règles injectées');
  if (debutRegles === -1) return t;
  let finRegles = lines.findIndex((l, i) => i > debutRegles && l.startsWith('## '));
  if (finRegles === -1) finRegles = lines.length;
  const regles = lines.slice(debutRegles, finRegles).join('\n').replace(/\s+$/, '');
  return `${entete}\n\n${regles}`;
}

/** Table compacte des paramètres effectifs des modules actifs (valeur de CONFIG.md sinon défaut du module) : les
 *  règles injectées citent des seuils que l'instance ne pouvait plus connaître une fois « ## Paramètres » retiré du
 *  prompt réduit (RAPPORT holarch-delegation §6.1) — ~1 000 caractères au lieu des ~8 500 des sections entières. */
function parametresEffectifs(root, cfg) {
  const lignes = [];
  const seen = new Set();
  for (const { categorie, module } of (cfg && cfg.modules) || []) {
    const rel = `framework/modules/${categorie}/${module}.md`;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const c = readIf(path.join(root, rel));
    if (c === null) continue;
    const lines = c.split('\n');
    const i = lines.findIndex((l) => l.trim() === '## Paramètres');
    if (i === -1) continue;
    const vals = [];
    for (let k = i + 1; k < lines.length && !lines[k].startsWith('## '); k++) {
      const m = lines[k].match(/^\|\s*`?([a-z_][a-z0-9_]*)`?\s*\|\s*([^|]*?)\s*\|/i);
      if (!m || /^param/i.test(m[1])) continue;
      const nom = m[1];
      const surcharge = cfg.params && cfg.params[nom] !== undefined;
      vals.push(`${nom} = ${surcharge ? `${cfg.params[nom]} (CONFIG.md)` : m[2].replace(/`/g, '')}`);
    }
    if (vals.length) lignes.push(`- ${module} : ${vals.join(' ; ')}`);
  }
  if (!lignes.length) return '';
  return `<parametres-effectifs note="valeurs en vigueur pour cette session — CONFIG.md sinon défaut du module ; les sections ## Paramètres des modules ne sont pas injectées, ceci les résume">\n${lignes.join('\n')}\n</parametres-effectifs>`;
}

/**
 * Retire d'un `CONFIG.md` les sections `## Fournisseurs` et `## Catalogue de modèles` (chantier 9 §11.2).
 * Ces deux tables sont des données du **lanceur** — traduire un identifiant de modèle en modèle réel,
 * calculer un coût, nommer les variables d'environnement d'un jeton — jamais du contrat d'une instance :
 * aucune règle du KERNEL ni d'un module ne s'y réfère, et une instance n'a pas à connaître les tarifs ni
 * les noms de variables de jetons (moindre diffusion, et ~900 caractères de prompt système économisés à
 * chaque réveil). Un `CONFIG.md` sans ces tables (format 1.11) est renvoyé inchangé.
 */
function elaguerSectionsLanceur(text) {
  const estElaguee = (l) => /^##\s+(Fournisseurs|Catalogue de mod[èe]les)\s*$/.test(l.trim());
  const out = [];
  let skip = false;
  for (const l of text.split('\n')) {
    if (/^##\s/.test(l)) {
      skip = estElaguee(l);
      if (skip) while (out.length && out[out.length - 1].trim() === '') out.pop();
    }
    if (!skip) out.push(l);
  }
  const r = out.join('\n');
  return r === '' || r.endsWith('\n') ? r : `${r}\n`;
}

/** Pesée du dernier prompt système assemblé (1.19.5) : `[{ nom, chars }]`, pour que `--dry-run` montre où va le contexte
 *  fixe relu à chaque tour (deux tiers du cache lu de holarch-fournisseurs) — mesure avant tout élagage du contrat. */
let dernierPesage = [];
function pesageSystemPrompt() { return dernierPesage.slice(); }

function buildSystemPrompt(root, cfg, bootstrap) {
  const parts = [];
  const blocs = [];
  const add = (nom, texte) => { parts.push(texte); blocs.push({ nom, chars: texte.length }); };
  parts.push(
    '# Contrat HOLARCH — fourni par le lanceur framework/bin/holarch-spawn.js',
    "Les fichiers ci-dessous sont des copies intégrales et exactes de leur version sur disque : ne les relis pas avec un outil (économie de contexte, KERNEL §5.8). Tout ce qui n'est pas ici (gabarits de framework/templates/, fichiers d'autres instances, registre) se lit à la demande, au moment où c'est utile.",
    '',
  );
  const push = (rel) => {
    const c = readIf(path.join(root, rel));
    add(path.basename(rel, '.md'), c === null ? `<fichier chemin="${rel}" note="INTROUVABLE sur disque"></fichier>` : fileBlock(rel, c));
  };
  const pushReduit = (rel) => {
    const c = readIf(path.join(root, rel));
    add(path.basename(rel, '.md'), c === null ? `<fichier chemin="${rel}" note="INTROUVABLE sur disque"></fichier>` : fileBlock(rel, extraireEnTeteEtReglesInjectees(c), 'en-tête + Règles injectées seulement — texte complet sur disque, chantier 7 §9.2'));
  };
  const pushConfig = () => {
    const rel = 'framework/CONFIG.md';
    const c = readIf(path.join(root, rel));
    if (c === null) { add('CONFIG', `<fichier chemin="${rel}" note="INTROUVABLE sur disque"></fichier>`); return; }
    const reduit = elaguerSectionsLanceur(c);
    add('CONFIG', reduit === c
      ? fileBlock(rel, c)
      : fileBlock(rel, reduit, 'sections « Fournisseurs » et « Catalogue de modèles » retirées : données du lanceur, pas du contrat'));
  };
  if (bootstrap) push('framework/BOOTSTRAP.md');
  push('framework/KERNEL.md');
  pushConfig();
  if (bootstrap) push('framework/MANIFEST.md');
  const seen = new Set();
  for (const { categorie, module } of cfg.modules) {
    const rel = `framework/modules/${categorie}/${module}.md`;
    if (seen.has(rel)) continue;
    seen.add(rel);
    pushReduit(rel);
  }
  const pe = parametresEffectifs(root, cfg);
  if (pe) add('paramètres effectifs', pe);
  dernierPesage = blocs;
  return parts.join('\n');
}

function buildUserPromptDetail(root, chemin, meta, params, bootstrap, cfg, extra) {
  const p = [];
  const blocs = [];
  const num = (k, d) => { const v = Number(params[k]); return Number.isFinite(v) && v > 0 ? v : d; };
  const departPrecedent = bootstrap ? null : lastContexteDepart(root, chemin);
  const harnais = [
    `Harnais de cette session : profil ${meta.profil}, modèle ${meta.modele}, effort ${meta.effort}${meta.origine_effort === 'fiche' ? ' (posé dans ta fiche registre)' : ''}, au plus ${params.max_tours_par_session} tours et ${params.budget_usd_par_session} USD (tarif liste) ; un hook te préviendra si ton contexte dépasse ${Math.round(Number(params.seuil_contexte_tokens) / 1000)}k tokens — tu devras alors hiberner volontairement (KERNEL §5.8 : MEMORY.md complet, STATUS.md laissé à son état réel avec la note « hibernation volontaire (contexte) », commit, fin de session ; le lanceur te ré-incarne avec un contexte neuf tant que chaque session laisse une trace de progrès — une fiche d'unité ou un commit [${chemin}] — au plus ${params.relances_max} session(s) consécutive(s) sans progrès et ${params.sessions_max_par_instance} sessions en tout, après quoi il alerte ton parent).${departPrecedent ? ` Ta session précédente avait démarré avec un contexte de ${departPrecedent} tokens (colonne « Contexte (départ / max) » de registry/SESSIONS.md).` : ''}`,
    `Ton modèle et ton effort sont fixés pour toute cette session ; changer de régime n'est possible qu'entre deux sessions (module d'orchestration, ON_PLAN) : ligne \`Profil\`, \`Effort\` ou \`Modèle\` de ta propre fiche registre, justification dans JOURNAL.md et PROGRESS.md, puis hibernation volontaire avec la note « hibernation volontaire (changement de régime : <ancien> → <nouveau>) » — le lanceur te ré-incarne sur le nouveau régime (au plus ${params.changements_regime_max} fois, décompté à part des ré-incarnations de contexte).`,
    "Commandes Bash exécutables sans approbation : git add/commit/mv/status/log/diff/show/branch/switch/merge (toujours depuis la racine, jamais `git -C`), mkdir, ls, wc, head, tail, grep, find, diff, date, echo, printf, pwd, python3, pytest, node, npm test, npm run, et `node framework/bin/holarch-spawn.js <chemin-enfant>` pour incarner un enfant. Une commande composée (`;`, `&&`, `|`) n'est acceptée que si chacun de ses segments l'est. Toute autre commande est refusée immédiatement (pas de blocage) : adapte-toi au lieu de réessayer. Toute écriture sous framework/ ou dans mission/OBJECTIVE.md est refusée mécaniquement (KERNEL §4).",
    `Horloge du harnais : il est ${nowIso()} (UTC) — date tes messages et tes fiches avec \`date -u +%FT%TZ\`, jamais de mémoire.${bootstrap ? '' : ` Sessions déjà jouées par cette instance : ${countSessions(root, chemin)} ; coût cumulé ${coutCumule(root, chemin).toFixed(2)} USD au tarif liste (registry/SESSIONS.md, tenu par le lanceur).`}`,
    "Un garde-fou empêche la fin de session tant que STATUS.md indique WORKING sans note d'hibernation volontaire, ou tant que des modifications de mission/ ne sont pas committées : passe toujours par ON_SLEEP.",
  ];
  // 1.19.2 : trois enfants sur trois lancés par la passerelle (holarch-modeles, 2026-09-12) ont écrit sous
  // `/workspaces/holon/…` (l'arbre principal, cité par le CLAUDE.md du dépôt que le CLI charge aussi depuis un
  // worktree), se sont fait refuser, et se sont arrêtés. La racine de travail est dite en toutes lettres.
  const ws = extra && extra.workspace;
  if (ws && ws.cwd && path.resolve(ws.cwd) !== path.resolve(root)) {
    harnais.unshift(`Ta racine de travail est \`${ws.cwd}\` — ton worktree, le répertoire courant de cette session. Tous tes chemins sont relatifs à cette racine (\`mission/…\`, \`framework/…\`). N'écris jamais sous \`${root}/…\` : c'est l'arbre principal du dépôt, le garde-fou refuse, et un refus se corrige en reprenant le chemin relatif, pas en attendant une autorisation.`);
  }
  if (bootstrap) {
    p.push(`Tu es la première session de cette mission. Exécute la procédure de framework/BOOTSTRAP.md (fournie dans ton prompt système) : validation, initialisation, création de la racine \`concepteur\`, puis incarnation immédiate. Profil de la racine : ${meta.profil} — écris \`| Profil | conception |\` dans sa fiche registre.`);
    const obj = readIf(path.join(root, 'mission', 'OBJECTIVE.md'));
    p.push(obj === null ? '<fichier chemin="mission/OBJECTIVE.md" note="INTROUVABLE"></fichier>' : fileBlock('mission/OBJECTIVE.md', obj));
    blocs.push({ nom: 'OBJECTIVE', chars: obj === null ? 0 : obj.length, note: '' });
    // Chantier 17, §17.2 : kits de la ligne « Kits » d'OBJECTIVE.md (section Ressources), dès la première session.
    const kitsBoot = require('./kits').blocKits(require('./kits').resoudreKits(root, chemin, { bootstrap: true }));
    if (kitsBoot) {
      if (kitsBoot.texte) p.push(kitsBoot.texte);
      blocs.push({ nom: 'KITS', chars: kitsBoot.chars, note: kitsBoot.note });
    }
    p.push(...harnais);
    return { prompt: p.join('\n\n'), blocs };
  }
  const uniteMode = moduleActive(cfg || {}, 'memoire', 'unites-indexees');
  p.push(`Tu incarnes l'instance \`${chemin}\` (profondeur ${meta.depth}, profil ${meta.profil}). Le KERNEL, CONFIG.md et les modules actifs sont dans ton prompt système. Voici l'état exact de tes fichiers d'instance au réveil — ne les relis pas, ils sont identiques sur disque :`);
  const base = path.join(instanceRoot(root, chemin), 'mission', chemin);
  // Dans les deux cas (unites-indexees actif ou non), l'index est régénéré avant assemblage du prompt
  // s'il existe un répertoire memoire/ (spec §2.3) — écriture du lanceur, pas de l'instance (KERNEL §4).
  const idxCalcule = buildMemoryIndex(root, chemin, { ecrire: !(extra && extra.dryRun) });
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
  const inbox = readInboxOf(root, chemin);
  const sel = (uniteMode && inbox !== null) ? selectInboxMessages(root, chemin, params) : null;
  if (uniteMode) {
    let reveil = describeWakeReason(root, chemin);
    // Affiché dès qu'au moins un message est injecté (pas seulement si verifies+nonVerifies > 0) :
    // le cas verifies=0 ET nonVerifies=0 avec des messages présents est précisément le repli
    // fail-open (Git absent, message-lint introuvable) où l'instance a le plus besoin de savoir
    // que rien n'a été vérifié (M5, TASK correctif MSG-concepteur-002).
    if (sel && parseMessageBlocks(sel.content).msgs.length > 0) {
      reveil += `\n${sel.verifies} messages vérifiés, ${sel.nonVerifies} non vérifiés`;
    }
    p.push(`<reveil>\n${reveil}\n</reveil>`);
    blocs.push({ nom: 'REVEIL', chars: reveil.length, note: '' });
  }
  // Chantier 17, §17.2 : INDEX.md de chaque kit attaché (ligne « Kits »), bloc <kits> après <reveil> ; pesé au dry-run.
  const kitsBloc = require('./kits').blocKits(require('./kits').resoudreKits(root, chemin, { cwd: ws && ws.cwd }));
  if (kitsBloc) {
    if (kitsBloc.texte) p.push(kitsBloc.texte);
    blocs.push({ nom: 'KITS', chars: kitsBloc.chars, note: kitsBloc.note });
  }
  if (inbox === null) {
    p.push(introuvable('INBOX.md'));
    blocs.push({ nom: 'INBOX', chars: 0, note: '' });
  } else if (uniteMode) {
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
    const idx = idxCalcule.contenu ? idxCalcule.contenu : readIf(path.join(base, 'memoire', 'INDEX.md'));
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
// Sous-agent `holarch-unite` (chantier 7, §9.1) : définition --agents, si delegation-intra-session actif
// ---------------------------------------------------------------------------
/**
 * Construit la valeur JSON de l'option `--agents` définissant le sous-agent générique `holarch-unite`
 * (module `extensions/delegation-intra-session`) : le prompt persona vient tel quel de
 * `framework/templates/SOUS-AGENT.template.md` (≤ 2000 caractères, §9.1) — la tâche précise (critère,
 * chemins, interdits) est fournie par l'instance à chaque invocation, dans le prompt de l'outil `Agent`.
 * Retourne null si le gabarit est introuvable (fail-open : pas de --agents plutôt qu'une valeur creuse).
 */
/**
 * Modèle d'un sous-agent (1.19.0). Un sous-agent tourne dans le processus de la session, donc chez son
 * fournisseur : derrière une passerelle (fournisseur à variables), l'identifiant du catalogue est traduit en
 * modèle réel chez ce fournisseur — l'équivalent si l'identifiant vit chez un autre —, sinon la passerelle
 * recevrait « sonnet ». Chez le fournisseur par défaut (le CLI comprend ses alias) et hors catalogue : tel quel.
 */
function modeleSousAgent(cat, id, fournisseur, chemin) {
  if (!id || !fournisseur || !fournisseur.url_var) return id;
  const entree = catalogue.modele(cat, id);
  if (!entree) return id;
  if (entree.fournisseur === fournisseur.nom) return entree.modele_reel;
  const eq = catalogue.equivalentChez(cat, id, fournisseur.nom);
  if (eq) return catalogue.modeleReel(cat, eq);
  process.stderr.write(`HOLARCH ▸ ${chemin} ▸ sous_agent_modele « ${id} » sans équivalent chez « ${fournisseur.nom} » — passé tel quel à la passerelle\n`);
  return id;
}

function buildAgentsOption(root, params) {
  const prompt = readIf(path.join(root, 'framework', 'templates', 'SOUS-AGENT.template.md'));
  if (prompt === null) return null;
  const def = {
    'holarch-unite': {
      description: "Sous-agent générique d'une unité de travail déléguée par une instance HOLARCH (module delegation-intra-session) ; reçoit le prompt de tâche précis (critère, chemins, interdits) à chaque invocation.",
      prompt: prompt.trim(),
      tools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'], // tableau : le CLI refuse une chaîne (1.11.1)
      model: params.sous_agent_modele,
    },
  };
  return JSON.stringify(def);
}

// ---------------------------------------------------------------------------
// Préparation d'un lancement
// ---------------------------------------------------------------------------
function prepareLaunch(root, chemin, opts) {
  const bootstrap = !!opts.bootstrap;
  // 1.13.2 : un lancement neuf efface une demande d'arrêt périmée ; une ré-incarnation (opts.relance) ne touche pas au
  // fichier stop — c'est launchWithRelaunches qui l'a déjà lu et consommé avant de décider de ré-incarner.
  // Un --dry-run n'incarne rien : il ne doit pas non plus consommer une demande d'arrêt en attente (constaté le 2026-09-11).
  if (!opts.relance && !opts.dryRun) { try { fs.unlinkSync(stopPath(root, chemin)); } catch (_) { /* rien à supprimer */ } }
  const cfgTexte = readIf(path.join(root, 'framework', 'CONFIG.md'));
  const cfg = parseConfig(cfgTexte);
  const cat = catalogue.parseCatalogue(cfgTexte);
  const params = resolveParams(cfg);
  const workspace = bootstrap ? { cwd: root, branche: null } : resolveWorkspace(root, chemin, cfg);
  // 1.14.0 : messages committés par le parent pour cet enfant, relayés dans son worktree avant de lire son INBOX.
  if (!bootstrap && workspace.cwd !== root && !opts.dryRun) {
    try {
      const relais = relayInboxFromParent(root, chemin);
      if (relais && relais.relayes.length) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ INBOX : ${relais.relayes.length} message(s) relayé(s) depuis l'arbre de ${relais.parent} (${relais.relayes.map((r) => r.id).join(', ')})\n`);
      if (relais && relais.ignores.length) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ INBOX : ${relais.ignores.length} message(s) non relayé(s), non committé(s) par ${relais.parent} (${relais.ignores.map((r) => r.id).join(', ')})\n`);
    } catch (e) { process.stderr.write(`HOLARCH ▸ ${chemin} ▸ relais INBOX ignoré (${e.message})\n`); }
  }
  const fiche = bootstrap ? parseFiche(null) : parseFiche(readIf(fichePath(root, chemin)));
  const meta = enrichirMeta(resolveProfile(cfg, fiche, chemin, opts), cat, chemin, opts);
  // 1.18.0 : le CLI compacte de lui-même à ≈ 83 % de la fenêtre qu'il prête au modèle (200 000 pour un modèle qu'il
  // ne reconnaît pas, derrière une passerelle : compaction subie à 166 985 tokens sur holarch-passerelle, écart 4 de
  // IMPLEMENTATION.md §12.8), quels que soient --autocompact et seuil_contexte_tokens. Quand le catalogue déclare
  // cette fenêtre (colonne « Fenêtre »), le seuil d'hibernation est plafonné à 80 % d'elle : context-watch parle
  // avant le CLI, et le contexte passe par MEMORY.md au lieu d'être résumé hors contrat.
  const fenetre = meta.tarif && meta.tarif.fenetre;
  if (fenetre) {
    const plafond = Math.floor(fenetre * 0.8);
    if (Number(params.seuil_contexte_tokens) > plafond) {
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ seuil de contexte ${params.seuil_contexte_tokens} plafonné à ${plafond} (80 % de la fenêtre ${fenetre} déclarée au catalogue pour « ${meta.modele} »)\n`);
      params.seuil_contexte_tokens = String(plafond);
      params.seuil_plafonne_par_fenetre = fenetre;
    }
  }
  if (!bootstrap) {
    const base = path.join(workspace.cwd, 'mission', chemin);
    for (const name of ['ROLE.md', 'STATUS.md']) {
      if (!fs.existsSync(path.join(base, name))) throw new Error(`instance ${chemin} : ${name} introuvable (mécanique de spawn KERNEL §9 non faite ?)`);
    }
  }
  // Chantier 17, §17.2 : un kit nommé à la ligne « Kits » mais absent de framework/kits/ refuse le lancement, avant
  // toute session (même logique que les variables de fournisseur ci-dessous) ; le dry-run avertit seulement.
  const refusKit = require('./kits').refusKits(chemin, require('./kits').resoudreKits(root, chemin, { bootstrap, cwd: workspace.cwd }));
  if (refusKit) {
    if (opts.dryRun) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ${refusKit} (un lancement réel serait refusé)\n`);
    else throw new Error(refusKit);
  }
  // Chantier 17, §17.3 : veille bornée — une ligne « Veille » de la fiche registre étend --tools de `outils_veille`
  // pour un profil conception/exploration ; posée sur un autre profil, elle refuse le lancement (le dry-run avertit).
  const veille = require('./veille').resoudreVeille(bootstrap ? null : readIf(fichePath(root, chemin)), meta.profil, params);
  if (veille.refus) {
    if (opts.dryRun) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ${veille.refus} (un lancement réel serait refusé)\n`);
    else throw new Error(veille.refus);
  } else if (veille.lectures) {
    params.outils_cli = veille.outils;
    process.stderr.write(`HOLARCH ▸ ${chemin} ▸ veille : au plus ${veille.lectures} lecture(s), outils ${veille.outils}\n`);
  }
  const permissionMode = opts.permissionMode || params.permission_mode;
  if (!VALID_PERMISSION_MODES.includes(permissionMode)) throw new Error(`permission_mode invalide « ${permissionMode} »`);
  // Chantier 16, §18.2 (docs/IMPLEMENTATION.md) : ligne « Budget USD / session » de la fiche registre —
  // précédence --budget-usd (CLI) > fiche > budget_usd_par_session (CONFIG), bornée par
  // budget_usd_session_max (refus au-delà du plafond, même politique que veille juste au-dessus : le
  // dry-run avertit sur stderr, un lancement réel refuse).
  const budgetInfo = require('./budget-session').resoudreBudget(bootstrap ? null : readIf(fichePath(root, chemin)), opts.budget, params);
  if (budgetInfo.refus) {
    if (opts.dryRun) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ${budgetInfo.refus} (un lancement réel serait refusé)\n`);
    else throw new Error(budgetInfo.refus);
  }
  const budget = budgetInfo.usd;
  process.stderr.write(`HOLARCH ▸ ${chemin} ▸ budget : ${budget} USD (source ${budgetInfo.source})\n`);
  const maxTours = opts.maxTours || params.max_tours_par_session;
  const systemPrompt = buildSystemPrompt(root, cfg, bootstrap);
  const detail = buildUserPromptDetail(root, chemin, meta, Object.assign({}, params, { budget_usd_par_session: budget, max_tours_par_session: maxTours }), bootstrap, cfg, { dryRun: !!opts.dryRun, workspace });
  const prompt = detail.prompt;
  // Motifs RELATIFS à la racine du projet (constat D2, session n°7 de concepteur — sondé en conditions
  // réelles) : les règles de permission de Claude Code s'évaluent en relatif, jamais en absolu. Un motif
  // `Edit(${root}/framework/**)` est donc syntaxiquement valide mais inerte — il ne matche jamais rien,
  // et Write/Edit sous framework/ passent. Défense en profondeur : les mêmes motifs relatifs sont aussi
  // posés en dur dans `permissions.deny` d'`instance-settings.json`, pour ne pas dépendre d'un seul canal.
  // 1.19.3 : motifs ancrés par « / » à la racine du projet (le cwd de la session). Sans ancre, la sémantique
  // gitignore fait refuser tout chemin contenant un segment `tools/` ou `docs/` — `mission/shared/<x>/cible-tools/tools/…`
  // a coûté une délégation entière à holarch-modeles (2026-09-12). Vérifié par sonde (haiku, 1 tour) : `Write(/tools/**)`
  // refuse `tools/b.txt` et laisse passer `mission/shared/x/cible-tools/tools/a.txt`.
  const denied = [
    `Edit(/framework/**)`, `Write(/framework/**)`,
    `Edit(/mission/OBJECTIVE.md)`, `Write(/mission/OBJECTIVE.md)`,
  ];
  const addDirs = (opts.addDir || []).map((d) => path.resolve(d));
  // Exécuteur de ce lancement (chantier 9, volet 1) : la traduction de cette intention en invocation
  // concrète — binaire, arguments, fichier temporaire de prompt système — lui appartient entièrement.
  // Le lanceur n'assemble plus aucune ligne de commande. `fournisseur` vient du catalogue (volet 2)
  // quand l'instance en a un, sinon null.
  const fournisseur = opts.fournisseur || fournisseurPour(cat, meta, process.env);
  const executeur = executeurs.resoudre(opts.executeur || executeurs.nomPour({ env: process.env, fournisseur, params }));
  // 1.16.3 : un fournisseur atteignable par cette session (celui du modèle, ou le secours où le modèle a un
  // équivalent) sans ses variables ⇒ refus AVANT toute session. Deux sessions perdues (4,68 USD) le 2026-09-12 :
  // lancées d'un shell sans les variables, chacune a fini en BLOCKER. `--forcer` passe outre, le dry-run
  // avertit seulement, l'exécuteur factice n'atteint aucun fournisseur.
  const manques = executeur.nom === 'fake' ? [] : fournisseursSansVariables(cat, meta, process.env);
  if (manques.length) {
    const texte = manques.map((m) => `« ${m.nom} » : ${m.variables.join(', ')}`).join(' ; ');
    if (opts.forcer || opts.dryRun) {
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ fournisseur atteignable sans ses variables d'environnement — ${texte}${opts.dryRun ? ' (un lancement réel serait refusé, sauf --forcer)' : ' (--forcer : lancé quand même)'}\n`);
    } else {
      throw new Error(`fournisseur atteignable par cette session sans ses variables d'environnement — ${texte}. Exporte-les dans le shell du lanceur (docs/ENVIRONNEMENT.md §6) ou relance avec --forcer.`);
    }
  }
  // Sous-agents (module delegation-intra-session) : l'option n'est construite que si l'exécuteur sait
  // les porter — un exécuteur sans cette capacité dégrade proprement au lieu de recevoir une option
  // qu'il ignore.
  const agents = moduleActive(cfg, 'extensions', 'delegation-intra-session') && executeur.capacites.sous_agents
    ? buildAgentsOption(root, Object.assign({}, params, { sous_agent_modele: modeleSousAgent(cat, params.sous_agent_modele, fournisseur, chemin) }))
    : null;
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
    HOLARCH_ROOT: workspace.cwd,
    HOLARCH_INSTANCE: chemin,
    HOLARCH_CONTEXT_LIMIT: String(params.seuil_contexte_tokens),
    // Paramètre absent ou vide → `undefined`, jamais '' : Node n'exporte pas une clé `undefined` (et retire donc une
    // valeur héritée de process.env), alors qu'une chaîne vide serait lue comme 0 (MSG-utilisateur-004, point A).
    HOLARCH_BUDGET_USD: budget != null && String(budget).trim() !== '' ? String(budget) : undefined,
    // Catalogue (`cout_*`, USD/Mtok) traduit au format lu par budget-watch.js : modèle de la session (et `defaut`) plus
    // chaque modèle tarifé, pour chiffrer un sous-agent à son propre tarif (revue n° 5).
    HOLARCH_TARIF: require('./budget-session').tarifsBudget(cat, meta),
    HOLARCH_SEUIL_BUDGET_PCT: params.seuil_budget_pct != null && String(params.seuil_budget_pct).trim() !== '' ? String(params.seuil_budget_pct) : undefined,
    HOLARCH_RESERVE_USD: params.reserve_usd != null && String(params.reserve_usd).trim() !== '' && moduleActive(cfg, 'recursion', 'reserve-hibernation') ? String(params.reserve_usd) : undefined,
    HOLARCH_COMMIT: params.commit_par_session,
    HOLARCH_BOOTSTRAP: bootstrap ? '1' : '0',
    // Taille de registry/PROGRESS.md avant ce lancement : baseline de wake-guard (garde-fou ON_ORIENT). Calculée dans
    // le worktree de l'instance (workspace.cwd) : c'est ce fichier-là, relatif à HOLARCH_ROOT, que le hook mesurera
    // pendant la session — cf. holarch-hooks.js, wakeGuard. Calculée ici, pas au premier appel du hook côté session,
    // pour ne pas rater une ligne ON_ORIENT écrite avant toute écriture hors de l'arbre propre de l'instance.
    HOLARCH_PROGRESS_BASELINE: String((readIf(path.join(workspace.cwd, 'mission', 'registry', 'PROGRESS.md')) || '').length),
  });
  // Seconde revue n° 59 : la session n'hérite pas de la tâche de son lanceur — un lancement fait depuis la session
  // (enfant synchrone refusé, commande quelconque) ne clôt ni ne réveille jamais au nom de ce lanceur détaché.
  delete env.HOLARCH_TASK_ID;
  delete env.HOLARCH_TASK_CHEMIN;
  // Intention de session : tout exécuteur lit `meta`, `permissionMode`, `budget`, `maxTours`,
  // `denied`, `addDirs`, `agents`, `env`, `systemPrompt`, `prompt`, `cwd` — aucun de
  // ces champs ne nomme un fournisseur. Le reste (`cfg`, `blocs`, `branche`, `bootstrap`) est au lanceur.
  return { root, chemin, bootstrap, cfg, catalogue: cat, params, meta, permissionMode, budget, maxTours, env, systemPrompt, prompt, blocs: detail.blocs, cwd: workspace.cwd, branche: workspace.branche, denied, addDirs, agents, executeur: executeur.nom, fournisseur };
}

// ---------------------------------------------------------------------------
// Exécution
// ---------------------------------------------------------------------------
/** Compatibilité : lire la sortie d'un fournisseur appartient désormais à son exécuteur
 *  (`normaliser`). Conservée et exportée pour les outils et tests qui l'appellent encore, elle
 *  délègue à l'exécuteur par défaut. */
function parseResultJson(stdout) {
  return executeurs.resoudre(executeurs.DEFAUT).parseResultJson(stdout);
}

function ensureSessionsFile(root, missionName) {
  const p = path.join(root, 'mission', 'registry', 'SESSIONS.md');
  if (!fs.existsSync(p)) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, [
      `# Sessions — mission ${missionName || '(sans nom)'}`,
      '',
      '<!-- Append-only, écrit par framework/bin/holarch-spawn.js après chaque session (aucune instance n\'écrit ici).',
      'Coût = celui rapporté par l\'exécuteur (tarif liste), ou « ≈ » s\'il est calculé par le catalogue de modèles. Tokens : entrée fraîche / lus en cache / écrits en cache / sortie.',
      'Colonne Modèle/effort : un modèle par délégation à un sous-agent Agent le fait apparaître ici avec son coût, ex. "opus-5 1.2900+sonnet-5 0.2700/high" (identifiants réels rapportés par l\'exécuteur). -->',
      '',
      // La colonne « Fournisseur / modèle réel » (1.14, chantier 9) est ajoutée **en fin de ligne**, comme
      // l'a été « Contexte » avant elle : une ligne écrite par une version antérieure garde ainsi son
      // alignement sous cet en-tête, et seule la cellule nouvelle lui manque.
      '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens (entrée / cache lu / cache écrit / sortie) | Coût USD | Durée | Fin | STATUS | Réveil (car. système / utilisateur) | Contexte (départ / max) | Fournisseur / modèle réel |',
      '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
      '',
    ].join('\n'));
  }
  return p;
}

function appendSessionLine(root, missionName, chemin, meta, res, elapsedMs, status, promptChars, logBase) {
  const p = ensureSessionsFile(root, missionName);
  // `res` est le **Resultat normalisé** rendu par l'exécuteur (volet 1), jamais la sortie brute d'un
  // fournisseur : cette fonction ne connaît plus aucun nom de champ propre à un CLI.
  const u = (res && res.tokens) || {};
  const modelEntries = (res && res.modeles) || [];
  // Le coût par modèle n'est accolé au nom que si la session en a utilisé plusieurs (repli, changement
  // de régime) : avec un seul modèle il dupliquerait la colonne « Coût USD ».
  const models = modelEntries
    .map((m) => (modelEntries.length > 1 && typeof m.cout_usd === 'number' ? `${m.id} ${m.cout_usd.toFixed(4)}` : m.id))
    .join('+');
  // Coût : celui rapporté par l'exécuteur, sinon celui que le catalogue permet de calculer à partir des
  // tokens (volet 2), marqué « ≈ » — jamais un 0 inventé : sans tarif ni tokens, la cellule reste « ? ».
  // 1.21.0 (P1 holarch-modeles) : derrière une passerelle, le coût est TOUJOURS recalculé au tarif du catalogue — le CLI
  // tarife au prix liste Anthropic (modèle Claude) ou à celui d'Opus 5 (modèle inconnu), jamais au prix du fournisseur ;
  // les colonnes de deux modèles ne sont comparables que si elles ont la même source.
  let cost = '?';
  const estime = catalogue.coutEstime(meta && meta.tarif, res && res.tokens);
  const auCatalogue = meta && meta.passerelle && estime !== null && estime !== undefined;
  if (res && typeof res.cout_usd === 'number' && !auCatalogue) cost = res.cout_usd.toFixed(4);
  else if (estime !== null && estime !== undefined) cost = `≈ ${estime.toFixed(4)}`;
  const fournisseur = meta && meta.fournisseur ? `${meta.fournisseur} / ${meta.modele_reel || meta.modele}` : '—';
  const fin = [
    !res || res.fin === 'sans_resultat'
      ? 'sans résultat JSON'
      : res.fin === 'limite'
        ? `limite 429 : ${attenteLimite().motifFin(res.texte)}`
        : res && res.sous_type === 'error_max_budget_usd'
          ? `coupée (fusible)${res.refus ? ` · ${res.refus} refus` : ''}`
          : `${res.sous_type || '?'}${res.fin === 'erreur' ? ' (erreur)' : ''}${res.refus ? ` · ${res.refus} refus` : ''}`,
    // Session de repli (volet 3) : la trace du fournisseur quitté vit ici, pas dans un fichier d'état.
    meta && meta.repli_depuis ? `repli depuis ${meta.repli_depuis}` : '',
  ].filter(Boolean).join(' · ');
  // Mesure instantanée (module context-budget, volet 8.1) : le fichier live n'est repris que s'il porte
  // encore le session_id de CETTE session — sinon une session suivante déjà relancée l'aurait déjà réécrit.
  let contexte = '— / —';
  if (res && res.session_id) {
    // Le hook écrit ce fichier sous HOLARCH_ROOT, c'est-à-dire le worktree de l'instance quand elle en a un : le lire à
    // la racine laissait la colonne vide pour toute session isolée (6 sur 7 dans holarch-delegation, 2026-09-11).
    const cfile = contexteLivePath(instanceRoot(root, chemin), chemin);
    try {
      const data = JSON.parse(fs.readFileSync(cfile, 'utf8'));
      if (data.session_id === res.session_id) {
        contexte = `${data.depart ?? '?'} / ${data.max ?? '?'}`;
        fs.unlinkSync(cfile);
      }
    } catch (_) { /* pas de mesure disponible : — / — */ }
  }
  // Chantier 16, §18.1 écart (a)/(b) (docs/IMPLEMENTATION.md) : mission/.holarch/live/<chemin>.budget.json
  // (écrit par budget-watch.js) est lu et consommé ici comme l'est déjà .contexte.json ci-dessus ; son
  // contenu (ou son absence) est répercuté dans le .result.json de la session sous `estimation_budget`,
  // pour la mesure de 18.8.
  let estimationBudget = null;
  if (res && res.session_id) {
    const bfile = require('../hooks/budget-watch').budgetLivePath(instanceRoot(root, chemin), chemin);
    try {
      const data = JSON.parse(fs.readFileSync(bfile, 'utf8'));
      if (data.session_id === res.session_id) {
        estimationBudget = data;
        fs.unlinkSync(bfile);
      }
    } catch (_) { /* pas de mesure disponible : estimation_budget absent */ }
  }
  if (logBase) {
    try {
      const rjson = JSON.parse(fs.readFileSync(`${logBase}.result.json`, 'utf8'));
      if (estimationBudget) rjson.estimation_budget = estimationBudget;
      fs.writeFileSync(`${logBase}.result.json`, JSON.stringify(rjson));
    } catch (_) { /* pas de .result.json exploitable : rien à enrichir */ }
  }
  const line = `| ${nowIso()} | ${chemin} | ${res && res.session_id ? res.session_id : '—'} | ${models || meta.modele}/${meta.effort} | ${res && res.tours !== null && res.tours !== undefined ? res.tours : '?'} | ${u.entree ?? '?'} / ${u.cache_lu ?? '?'} / ${u.cache_ecrit ?? '?'} / ${u.sortie ?? '?'} | ${cost} | ${fmtDuration(elapsedMs)} | ${fin} | ${status || '?'} | ${promptChars ? `${promptChars.systeme} / ${promptChars.utilisateur}` : '—'} | ${contexte} | ${fournisseur} |\n`;
  fs.appendFileSync(p, line);
  return line;
}

/** Exécuteur résolu pour un lancement donné (même ordre de précédence qu'à `prepareLaunch`). */
function executeurDe(launch) {
  return executeurs.resoudre(launch.executeur || executeurs.nomPour({ env: process.env, fournisseur: launch.fournisseur, params: launch.params }));
}

/** Prévisualisation de l'invocation, sans rien exécuter (`--dry-run`, tests) : `{executeur, bin,
 *  args}`. Le fichier temporaire éventuellement créé par `preparer` est nettoyé aussitôt — cette
 *  fonction ne laisse rien derrière elle. */
function apercuCommande(launch) {
  const executeur = executeurDe(launch);
  const prep = executeur.preparer(launch, launch.params);
  try {
    return { executeur: executeur.nom, bin: prep.bin, args: prep.args.slice() };
  } finally {
    if (prep.nettoyer) { try { prep.nettoyer(); } catch (_) { /* ignore */ } }
  }
}

/** Une tentative : `preparer → executer → normaliser` par l'exécuteur du lancement. Le lanceur garde
 *  ce qui ne dépend d'aucun fournisseur — verrou de vivacité, dossier et noms des journaux bruts,
 *  archivage de la sortie telle quelle. `res` est le **Resultat normalisé** (jamais la sortie brute). */
function runOnce(launch, attempt) {
  const executeur = executeurDe(launch);
  const prep = executeur.preparer(launch, launch.params);
  const logDir = path.join(launch.root, 'mission', '.holarch', 'sessions');
  fs.mkdirSync(logDir, { recursive: true });
  const ignore = path.join(launch.root, 'mission', '.holarch', '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n'); // journaux bruts hors Git
  const stamp = nowIso().replace(/[:]/g, '').replace('T', '-').replace('Z', '');
  const logBase = path.join(logDir, `${launch.chemin.replace(/\//g, '-')}-${stamp}-${attempt}`);
  fs.mkdirSync(liveDir(launch.root), { recursive: true });
  ecrireVerrouSession(launch.root, launch.chemin, attempt); // troisième revue n° 74 : sous le jeton de la tenue
  let brut;
  try {
    brut = executeur.executer(prep, { timeoutMs: launch.timeoutMs || undefined });
  } finally {
    finVerrouSession(launch.root, launch.chemin); // troisième revue n° 74 : gardé « entre deux sessions » si tenu
    if (prep.nettoyer) { try { prep.nettoyer(); } catch (_) { /* ignore */ } }
  }
  if (brut.stderr) fs.writeFileSync(`${logBase}.stderr.log`, brut.stderr);
  const res = executeur.normaliser(brut);
  if (brut.stdout) fs.writeFileSync(`${logBase}.result.json`, brut.stdout);
  return { res, elapsedMs: brut.elapsedMs, exitCode: brut.exitCode, signal: brut.signal, error: brut.error, logBase, stderr: brut.stderr || '', executeur: executeur.nom };
}

/** STATUS.md d'une instance : son worktree s'il existe, sinon l'arbre `root`, sinon — git-branches actif, isolation ≠
 *  aucune — sa branche (`git show <branche>:mission/<chemin>/STATUS.md`) : cas d'un enfant spawné (ON_SPAWN a
 *  committé ses fichiers sur sa branche) mais jamais incarné, que le parent revenu sur sa propre branche ne voit
 *  plus sur disque (chantier 3, dogfooding du 2026-09-10). */
function readStatusOf(root, chemin) {
  const texte = readIf(instancePath(root, chemin, 'STATUS.md'));
  if (texte !== null || !chemin.includes('/')) return parseStatus(texte);
  const gb = gitBranchesCtx(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md'))));
  if (!gb) return parseStatus(null);
  const r = spawnSync('git', ['-C', root, 'show', `${gb.prefixe}${chemin.replace(/\//g, '-')}:mission/${chemin}/STATUS.md`], { encoding: 'utf8' });
  return parseStatus(r.status === 0 ? r.stdout : null);
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
// Mesure instantanée (module context-budget, volet 8.1) : fichier écrit par contextWatch (holarch-hooks.js),
// à côté du verrou de vivacité — même convention de nom, suffixe différent.
function contexteLivePath(root, chemin) { return path.join(liveDir(root), `${chemin.replace(/\//g, '-')}.contexte.json`); }
// Attente interruptible d'une limite 429 (chantier 16, §18.3) : verrou informatif « le lanceur
// attend », même répertoire et même convention de nom que liveLockPath/contexteLivePath.
function attenteLockPath(root, chemin) { return path.join(liveDir(root), `${chemin.replace(/\//g, '-')}.attente.json`); }
function isLive(root, chemin) {
  let brut; let data;
  try { brut = fs.readFileSync(liveLockPath(root, chemin), 'utf8'); data = JSON.parse(brut); } catch (_) { return false; }
  if (!data || !data.pid) return false;
  try { process.kill(data.pid, 0); return true; }
  catch (_) { retirerVerrouMort(liveLockPath(root, chemin), brut); return false; }
}
/** lots.js (chantier 16) ou null sur un arbre plus ancien — ses verrous exclusifs servent aussi au verrou live/. */
function lotsOuNull() {
  try { return require('./lots'); } catch (err) { if (err && err.code === 'MODULE_NOT_FOUND') return null; throw err; }
}
/** Seconde revue n° 51 : un verrou live/ au pid mort n'est retiré que sous la marque de reprise de lots.js
 *  (`<f>.reprise-<sha16 du contenu mort>`) et s'il porte encore ce contenu — un `unlink` nu effaçait la réservation
 *  qu'un réveil concurrent venait de poser à sa place (ABA). */
function retirerVerrouMort(f, brut) {
  const lots = lotsOuNull();
  if (!lots) { try { fs.unlinkSync(f); } catch (_) { /* ignore */ } return; }
  const marque = `${f}.reprise-${lots.sha256Texte(brut).slice(0, 16)}`;
  const m = lots.acquerirVerrou(marque, { pid: process.pid, starttime: require('./jobs').starttimeDe(process.pid) });
  if (!m.acquis) return; // un concurrent reprend ce verrou mort : il le retire ou le remplace
  try { if (readIf(f) === brut) fs.unlinkSync(f); } catch (_) { /* déjà retiré */ } finally { lots.libererVerrou(marque); }
}
/** Seconde revue n° 51 : réservation atomique d'une instance avant de la lancer (réveil, reprise) — le verrou live/
 *  est créé en exclusif au nom de l'appelant (pid vivant : aucun concurrent ne l'obtient), un verrou mort est repris
 *  sous marque. `null` si l'instance est déjà tenue par un processus vivant. */
function reserverInstance(root, chemin) {
  const f = liveLockPath(root, chemin);
  const lots = lotsOuNull();
  if (!lots) return isLive(root, chemin) ? null : { jeton: null };
  const jeton = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const r = lots.acquerirVerrou(f, { jeton, pid: process.pid, starttime: require('./jobs').starttimeDe(process.pid), startedAt: nowIso(), reservation: true });
  return r.acquis ? { jeton } : null;
}
function reservationEncoreAMoi(root, chemin, resa) {
  if (!resa || !resa.jeton) return false;
  try { return JSON.parse(fs.readFileSync(liveLockPath(root, chemin), 'utf8')).jeton === resa.jeton; } catch (_) { return false; }
}
/** Rend une réservation non suivie d'un lancement — seulement si le verrou porte encore notre jeton. */
function libererReservation(root, chemin, resa) {
  if (reservationEncoreAMoi(root, chemin, resa)) { try { fs.unlinkSync(liveLockPath(root, chemin)); } catch (_) { /* ignore */ } }
}
/** Passe la réservation au lanceur détaché qu'on vient de créer (il le réécrira au démarrage de sa session) — jamais
 *  par-dessus le verrou qu'il a déjà posé ou retiré lui-même. */
function transmettreReservation(root, chemin, resa, donnees) {
  const f = liveLockPath(root, chemin);
  if (resa && resa.jeton === null) { try { fs.mkdirSync(liveDir(root), { recursive: true }); fs.writeFileSync(f, JSON.stringify(donnees)); } catch (_) { /* fail-open */ } return; }
  if (!reservationEncoreAMoi(root, chemin, resa)) return;
  const tmp = `${f}.${process.pid}.transmis.tmp`;
  try { fs.writeFileSync(tmp, JSON.stringify(donnees)); fs.renameSync(tmp, f); } catch (_) { try { fs.unlinkSync(tmp); } catch (_e) { /* ignore */ } }
}
/** Pid vivant lu dans le verrou `.attente.json` d'un lanceur bloqué dans `attendreInterruptible`
 *  (chantier 16, §18.3) — `null` si absent, illisible, au pid mort ou au pid réutilisé (starttime différent,
 *  MSG-utilisateur-004 point 6). `demanderArret` s'en sert pour compter un lanceur en attente comme vivant
 *  (plus de « rien à arrêter » pendant une attente 429). */
function pidEnAttente(root, chemin) {
  const data = attenteLimite().attenteVivante(attenteLockPath(root, chemin));
  return data ? data.pid : null;
}
/** Troisième revue n° 74 : le processus qui joue les sessions d'une instance (lanceur synchrone ou détaché) en tient le
 *  verrou live/ de son démarrage à sa sortie — `runOnce` le réécrit à son nom pendant la session, puis le rend « entre
 *  deux sessions » au lieu de le supprimer. Un seul prédicat d'occupation : le verrou exclusif (reserverInstance). */
let INSTANCE_TENUE = null;
function lireVerrouLive(root, chemin) { try { return JSON.parse(fs.readFileSync(liveLockPath(root, chemin), 'utf8')); } catch (_) { return null; } }
function ecrireVerrouAtomique(root, chemin, donnees) {
  const f = liveLockPath(root, chemin);
  const tmp = `${f}.${process.pid}.tenue.tmp`;
  fs.mkdirSync(liveDir(root), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(donnees)); fs.renameSync(tmp, f);
}
function tenueDonnees(jeton, extra) {
  return Object.assign({ jeton, pid: process.pid, starttime: require('./jobs').starttimeDe(process.pid), startedAt: nowIso(), tenue: true }, extra);
}
/** Prend l'instance pour ce lanceur : verrou transmis à son pid (réveil, reprise), ou libre. Un réveilleur encore dans
 *  sa section critique (`reservation`, qui va transmettre ou rendre) est attendu au plus 2 s. `null` si un autre
 *  lanceur la tient. */
function tenirInstance(root, chemin) {
  const lots = lotsOuNull();
  const jeton = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  for (let i = 0; i < 100; i++) {
    const v = lireVerrouLive(root, chemin);
    if (v && v.pid === process.pid) { ecrireVerrouAtomique(root, chemin, tenueDonnees(jeton, { entreSessions: true })); INSTANCE_TENUE = { chemin, jeton }; return INSTANCE_TENUE; }
    if (!lots) { if (isLive(root, chemin)) return null; ecrireVerrouAtomique(root, chemin, tenueDonnees(jeton, { entreSessions: true })); INSTANCE_TENUE = { chemin, jeton }; return INSTANCE_TENUE; }
    const r = lots.acquerirVerrou(liveLockPath(root, chemin), tenueDonnees(jeton, { entreSessions: true }));
    if (r.acquis) { INSTANCE_TENUE = { chemin, jeton }; return INSTANCE_TENUE; }
    if (!(r.detenteur && r.detenteur.reservation)) return null;
    attendre(20);
  }
  return null;
}
function tenueDe(chemin) { return INSTANCE_TENUE && INSTANCE_TENUE.chemin === chemin ? INSTANCE_TENUE : null; }
/** runOnce : verrou de session (même jeton si l'instance est tenue), puis rendu « entre deux sessions » à la fin. */
function ecrireVerrouSession(root, chemin, attempt) {
  const t = tenueDe(chemin);
  if (t && reservationEncoreAMoi(root, chemin, t)) { ecrireVerrouAtomique(root, chemin, tenueDonnees(t.jeton, { attempt })); return; }
  fs.writeFileSync(liveLockPath(root, chemin), JSON.stringify({ pid: process.pid, startedAt: nowIso(), attempt }));
}
function finVerrouSession(root, chemin) {
  const t = tenueDe(chemin);
  if (t && reservationEncoreAMoi(root, chemin, t)) { try { ecrireVerrouAtomique(root, chemin, tenueDonnees(t.jeton, { entreSessions: true })); } catch (_) { /* ignore */ } return; }
  try { fs.unlinkSync(liveLockPath(root, chemin)); } catch (_) { /* ignore */ }
}
/** Session réellement en cours (verrou vivant qui n'est pas un lanceur entre deux sessions) — `--arret --immediat`. */
function sessionEnCours(root, chemin) { return isLive(root, chemin) && !((lireVerrouLive(root, chemin) || {}).entreSessions); }
/** Rend l'instance à la sortie du lanceur ; true si ce lanceur la tenait encore. */
function relacherInstance(root, chemin) {
  const t = tenueDe(chemin);
  if (!t) return false;
  INSTANCE_TENUE = null;
  if (!reservationEncoreAMoi(root, chemin, t)) return false;
  try { fs.unlinkSync(liveLockPath(root, chemin)); } catch (_) { /* ignore */ }
  return true;
}
/** Troisième revue n° 72 : un réveilleur qui trouve l'instance occupée laisse une marque, puis retente une fois ; le
 *  lanceur qui la tenait, instance rendue et tâche close, consomme la marque et réévalue lui-même la condition. L'un des
 *  deux voit toujours l'autre : jamais un réveil perdu dans la traîne d'un lanceur. */
function reveilDifferePath(root, chemin) { return path.join(liveDir(root), `${chemin.replace(/\//g, '-')}.reveil-differe`); }
function marquerReveilDiffere(root, chemin) {
  try { fs.mkdirSync(liveDir(root), { recursive: true }); fs.writeFileSync(reveilDifferePath(root, chemin), nowIso()); } catch (_) { /* fail-open */ }
}
function reprendreReveilDiffere(root, chemin) {
  try { fs.unlinkSync(reveilDifferePath(root, chemin)); } catch (_) { return []; }
  for (let i = 0; i < 100; i++) {
    const r = wakeWaiters(root, '(réveil différé)', chemin);
    const v = lireVerrouLive(root, chemin);
    if (r.length || !r.occupes.includes(chemin) || !(v && v.reservation)) return r;
    attendre(20); // un réveilleur est dans sa section critique : il lance ou rend, puis on réévalue
  }
  return [];
}

function tasksDir(root) { return path.join(root, 'mission', '.holarch', 'tasks'); }
function stopPath(root, chemin) { return path.join(root, 'mission', '.holarch', 'stop', chemin.replace(/\//g, '-')); }

function lastStatusCommitIso(root, chemin) {
  const rel = path.join('mission', chemin, 'STATUS.md').split(path.sep).join('/');
  let r;
  try { r = spawnSync('git', ['log', '-1', '--format=%cI', '--', rel], { cwd: instanceRoot(root, chemin), encoding: 'utf8' }); }
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

/** Contexte git-branches pour l'énumération des enfants par le module de réveil (branches d'enfants) — null si le
 *  module est inactif ou en `isolation = aucune`. */
function gitBranchesCtx(cfg) {
  if (!moduleActive(cfg, 'extensions', 'git-branches')) return null;
  const params = resolveParams(cfg);
  if (params.isolation === 'aucune') return null;
  return { prefixe: params.prefixe_branche || 'holarch/' };
}

function wakeWaiters(root, declencheur, pour) {
  const waiters = reveil.listWaiters(root);
  const gitBranches = gitBranchesCtx(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md'))));
  const reveilles = [];
  // Seconde revue n° 52 : instances écartées parce que leur lanceur tourne encore (session, attente 429, tâche détachée
  // vivante) — `--reveil --pour` sort alors en code 3 et le guetteur de jobs.js se ré-arme au lieu de s'éteindre.
  const occupes = [];
  Object.defineProperty(reveilles, 'occupes', { value: occupes, enumerable: false });
  const reveillables = ['WAITING_CHILDREN', 'BLOCKED', 'READY'];
  const now = new Date();
  const readStatus = (chemin) => readStatusOf(root, chemin);
  const readInbox = (chemin) => readInboxOf(root, chemin) || '';
  for (const w0 of waiters) {
    if (w0.chemin === declencheur) continue;
    if (pour && w0.chemin !== pour) continue;
    if (!reveillables.includes(w0.etat)) continue;
    // Seconde revue n° 51 : réservation atomique de l'instance AVANT d'évaluer et de lancer — tester `isLive` puis poser
    // le verrou après `detachLaunch` laissait N réveils simultanés lancer N sessions (--reprendre, jobs groupés).
    // Troisième revue n° 72 : occupée → marque de réveil différé, puis une seconde tentative — le lanceur qui la tient
    // consomme la marque après l'avoir rendue (reprendreReveilDiffere) : l'un des deux voit toujours l'autre.
    let resa = reserverInstance(root, w0.chemin);
    if (!resa) { marquerReveilDiffere(root, w0.chemin); resa = reserverInstance(root, w0.chemin); }
    if (!resa) { occupes.push(w0.chemin); continue; }
    let lance = false;
    try {
      // Sous réservation, l'instantané de départ peut être périmé (une session lancée par un concurrent a pu finir et
      // changer STATUS entre-temps) : on relit l'attente de cette instance.
      const w = reveil.listWaiters(root).find((v) => v.chemin === w0.chemin);
      if (!w || !reveillables.includes(w.etat)) continue;
      // Revue n° 38 : un arrêt reçu pendant une attente laisse son fichier stop — jamais de réveil après un --arret.
      if (fs.existsSync(stopPath(root, w.chemin))) continue;
      // Revue n° 8 et seconde revue n° 8 : un lanceur en attente 429 (`.attente.json`) ou entre deux sessions (tâche
      // détachée « running » au pid vivant, sans verrou live/ pendant quelques dizaines de ms) relancera lui-même.
      // Troisième revue n° 72 : même marque que ci-dessus, puis second regard — une tâche close entre-temps est évaluée ici.
      const occupee = () => pidEnAttente(root, w.chemin) || tacheVivantePour(root, w.chemin);
      if (occupee()) { marquerReveilDiffere(root, w.chemin); if (occupee()) { occupes.push(w.chemin); continue; } }
      const sinceIso = lastStatusCommitIso(root, w.chemin);
      const evalRes = reveil.evalReveil(w.ast, { root, chemin: w.chemin, sinceIso, now, readStatus, readInbox, gitBranches });
      if (!evalRes.satisfied) continue;
      const condition = reveil.formatReveil(w.ast);
      const plafondReveil = require('./budget-session').plafondEffectif(resolveParams(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md')))));
      const { id, pid } = detachLaunch(root, w.chemin, { args: argsDerniereTache(root, w.chemin, { reveil: true, plafond: plafondReveil }) });
      lance = true;
      // Verrou passé au lanceur détaché (qui le réécrira au démarrage de sa session) : sans lui, une seconde évaluation
      // dans les millisecondes qui suivent relançait la même instance (holarch-delegation, 2026-09-11).
      transmettreReservation(root, w.chemin, resa, { pid, startedAt: nowIso(), attempt: 0, reveil: id });
      appendReveilsLine(root, w.chemin, declencheur || '--reveil', condition, id);
      reveilles.push({ chemin: w.chemin, tache: id, condition });
    } finally {
      if (!lance) libererReservation(root, w0.chemin, resa);
    }
  }
  return reveilles;
}

/** Options de ligne de commande à transmettre au lanceur détaché (1.19.1) : tout ce qui change la session — le
 *  `--detach` relançait `[chemin]` nu, et un `--bootstrap --detach` mourait sur « ROLE.md introuvable »
 *  (holarch-modeles, 2026-09-12). Jamais `--detach`, `--dry-run` ni `--json` eux-mêmes. */
function argsRelance(o) {
  const a = [];
  if (!o) return a;
  if (o.bootstrap) a.push('--bootstrap');
  if (o.forcer) a.push('--forcer');
  if (o.profil) a.push('--profil', o.profil);
  if (o.modele) a.push('--modele', o.modele);
  if (o.effort) a.push('--effort', o.effort);
  if (o.budget) a.push('--budget-usd', String(o.budget));
  if (o.maxTours) a.push('--max-tours', String(o.maxTours));
  if (o.permissionMode) a.push('--permission-mode', o.permissionMode);
  if (o.timeoutMin) a.push('--timeout-min', String(o.timeoutMin));
  for (const d of o.addDir || []) a.push('--add-dir', d);
  return a;
}

/** Surcharges de lancement de la dernière tâche de `chemin` (fiche `tasks/*.json`, champ `args`) — reprises par
 *  `--reprendre` et par un réveil (MSG-utilisateur-004 D : `--budget-usd` perdu à la relance). Seules les options à
 *  valeur de session passent ; jamais `--bootstrap` ni `--forcer`, qui ne valent que pour le lancement d'origine.
 *  Revue n° 9 : `--reprendre` continue la même tâche et reprend tout ; un réveil est un lancement neuf — il ne reprend
 *  que `--budget-usd`, et seulement s'il est lisible et sous `opts.plafond` (sinon la fiche, puis CONFIG, décident).
 *  Effort, profil, modèle et mode de permission d'un essai ponctuel ne deviennent jamais permanents. */
const OPTIONS_REPRISES = ['--profil', '--modele', '--effort', '--budget-usd', '--max-tours', '--permission-mode', '--timeout-min', '--add-dir'];
function argsDerniereTache(root, chemin, opts) {
  const o = opts || {};
  const taches = listTaches(root).filter((t) => t.chemin === chemin && Array.isArray(t.args));
  taches.sort((a, b) => String(a.startedAt || '').localeCompare(String(b.startedAt || '')));
  const args = taches.length ? taches[taches.length - 1].args : [];
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (!OPTIONS_REPRISES.includes(args[i]) || i + 1 >= args.length) continue;
    const [option, valeur] = [args[i], String(args[i + 1])];
    i += 1;
    if (o.reveil) {
      if (option !== '--budget-usd') continue;
      // Seconde revue n° 62 : même lecture que le lanceur (virgule décimale), sinon un 16,5 accepté disparaît au réveil.
      const usd = require('./budget-session').lireNombre(valeur);
      if (!(usd > 0) || (Number.isFinite(o.plafond) && usd > o.plafond)) continue;
    }
    out.push(option, valeur);
  }
  return out;
}
function detachLaunch(root, chemin, opts) {
  const dir = tasksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const id = `${chemin.replace(/\//g, '-')}-${Date.now()}`;
  const logPath = path.join(dir, `${id}.log`);
  const jsonPath = path.join(dir, `${id}.json`);
  const fd = fs.openSync(logPath, 'a');
  // Seconde revue n° 59 : la tâche est liée à son instance (HOLARCH_TASK_CHEMIN, lue par tacheDetachee) — une
  // variable HOLARCH_TASK_ID héritée ailleurs ne fait jamais d'un lanceur « le lanceur détaché de cette tâche ».
  // Troisième revue n° 77 : sans HOLARCH_INSTANCE (envSansInstance) — le lancé est relancé par le harnais, pas par
  // l'instance dont la session a lancé ce processus ; ses options ont été contrôlées ici (refusInstance).
  const env = envSansInstance({ HOLARCH_TASK_ID: id, HOLARCH_TASK_CHEMIN: chemin });
  const args = (opts && opts.args) || [];
  const child = spawn(process.execPath, [__filename, chemin, ...args], {
    cwd: root, env, detached: true, stdio: ['ignore', fd, fd],
  });
  fs.writeFileSync(jsonPath, JSON.stringify({
    id, chemin, pid: child.pid, starttime: require('./jobs').starttimeDe(child.pid), startedAt: nowIso(), state: 'running',
    parent: (opts && opts.parent) || 'utilisateur', opts: opts || {}, args,
  }, null, 2));
  child.unref();
  fs.closeSync(fd);
  return { id, pid: child.pid };
}

/** Seconde revue n° 59 : identifiant de la tâche détachée dont CE lanceur est le processus, sinon null.
 *  HOLARCH_TASK_ID seul ne suffit pas (une commande qui l'hérite n'est pas ce lanceur) : detachLaunch pose aussi
 *  HOLARCH_TASK_CHEMIN, qui doit nommer l'instance lancée ; prepareLaunch retire les deux de l'environnement de la
 *  session. Appelants : garde « instance déjà lancée », refus détaché (revue n° 6), finishLaunch. */
function tacheDetachee(chemin) {
  const id = process.env.HOLARCH_TASK_ID;
  return id && process.env.HOLARCH_TASK_CHEMIN === chemin ? id : null;
}

function finishLaunch(root, chemin, code, sessions) {
  const id = tacheDetachee(chemin);
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
  // Journal du lanceur committé par le lanceur lui-même (racine seulement) : la dernière ligne de SESSIONS.md et de
  // REVEILS.md d'une racine est écrite après son commit de clôture et restait non committée jusqu'à un geste humain
  // (archivages du 2026-09-11). Enfant : la racine, qui répond de mission/, les committe à sa session suivante.
  // Troisième revue n° 72 et 74 : instance rendue (tâche déjà close ci-dessus), journal, réveils des autres, puis le
  // réveil différé qu'un réveilleur a laissé pendant que ce lanceur la tenait (jamais perdu dans sa traîne).
  const tenait = relacherInstance(root, chemin);
  if (!chemin.includes('/') && !isLive(root, chemin)) commitJournalLanceur(root, chemin);
  const reveilles = wakeWaiters(root, chemin);
  if (tenait || id) reveilles.push(...reprendreReveilDiffere(root, chemin));
  return reveilles;
}

function commitJournalLanceur(root, chemin) {
  const rels = ['mission/registry/SESSIONS.md', 'mission/registry/REVEILS.md'].filter((r) => fs.existsSync(path.join(root, r)));
  if (!rels.length) return false;
  const st = spawnSync('git', ['-C', root, 'status', '--porcelain', '--', ...rels], { encoding: 'utf8' });
  if (st.status !== 0 || !st.stdout.trim()) return false;
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'HOLARCH', GIT_AUTHOR_EMAIL: 'holarch@localhost', GIT_COMMITTER_NAME: 'HOLARCH', GIT_COMMITTER_EMAIL: 'holarch@localhost' });
  if (spawnSync('git', ['-C', root, 'add', '--', ...rels], { encoding: 'utf8', env }).status !== 0) return false;
  return spawnSync('git', ['-C', root, 'commit', '-q', '-m', `[harnais] journal des sessions et réveils (${chemin})`], { encoding: 'utf8', env }).status === 0;
}

/** Traces de progrès d'une instance — fiches d'unité (`memoire/U<n>-*.md`) et commits `[<chemin>]` — ce qui
 *  distingue une hibernation utile d'une boucle qui relit et hiberne sans rien produire. */
function progressSnapshot(root, chemin) {
  let fiches = 0;
  try { fiches = fs.readdirSync(instancePath(root, chemin, 'memoire')).filter((f) => /^U\d+-.*\.md$/.test(f)).length; } catch (_) { /* pas de mémoire adressée */ }
  let commits = null;
  try {
    const r = spawnSync('git', ['log', '--format=%s', '-500'], { cwd: instanceRoot(root, chemin), encoding: 'utf8' });
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
/** Coût cumulé (colonne « Coût USD ») des sessions journalisées pour l'instance — un enfant n'a pas accès à
 *  registry/SESSIONS.md (racine seule) et ne connaissait ni son coût ni son numéro de session (2026-09-11). */
function coutCumule(root, chemin) {
  const text = readIf(path.join(root, 'mission', 'registry', 'SESSIONS.md')) || '';
  return text.split('\n').filter((l) => /^\| \d{4}-/.test(l) && (l.split('|')[2] || '').trim() === chemin)
    // Un coût calculé par le catalogue (volet 2) est marqué « ≈ » : le signe est retiré avant lecture,
    // l'estimation compte dans le cumul comme un coût rapporté — mieux vaut un ordre de grandeur que zéro.
    .reduce((s, l) => s + (Number((l.split('|')[7] || '').replace('≈', '').trim()) || 0), 0);
}
/** Contexte de départ (colonne 12, module context-budget volet 8.1) de la dernière session journalisée
 *  pour l'instance. null si aucune session, ou si la dernière ligne est antérieure à cette colonne. */
function lastContexteDepart(root, chemin) {
  const text = readIf(path.join(root, 'mission', 'registry', 'SESSIONS.md')) || '';
  const lignes = text.split('\n').filter((l) => /^\| \d{4}-/.test(l) && (l.split('|')[2] || '').trim() === chemin);
  if (!lignes.length) return null;
  const cellules = lignes[lignes.length - 1].split('|').map((c) => c.trim());
  // La cellule est repérée par sa **forme** (`<départ> / <max>`, deux nombres) plutôt que par son rang :
  // SESSIONS.md a gagné des colonnes au fil des versions (Contexte en 1.11, Fournisseur / modèle réel en
  // 1.14) et une ligne ancienne en compte moins qu'une récente. Les colonnes voisines ne peuvent pas être
  // confondues avec celle-ci : Tokens en compte quatre, Fournisseur / modèle réel n'est pas numérique.
  for (let i = cellules.length - 1; i >= 0; i -= 1) {
    const m = /^(\d+)\s*\/\s*(?:\d+|\?)$/.exec(cellules[i]);
    if (m) return m[1];
  }
  return null;
}
/** ALERT du lanceur dans l'INBOX du parent (KERNEL §7, provenance `harnais`) : l'enfant ne sera plus ré-incarné
 *  tout seul, le parent décide — relance détachée, TASK correctif ou FAILED. Rien pour une racine (pas de parent). */
function appendAlertToParent(root, chemin, corps) {
  if (!chemin.includes('/')) return null;
  const parent = chemin.slice(0, chemin.lastIndexOf('/'));
  const p = instancePath(root, parent, 'INBOX.md');
  if (!fs.existsSync(p)) return null;
  const date = nowIso();
  const id = `MSG-harnais-${chemin.replace(/\//g, '-')}-${date.replace(/[^0-9]/g, '').slice(0, 14)}`;
  fs.appendFileSync(p, `\n---\nid: ${id}\nfrom: harnais\nto: ${parent}\ntype: ALERT\nref: —\ndate: ${date}\n---\n${corps}\n`);
  return id;
}

/** Limite de sessions de l'API, telle que la reconnaît l'exécuteur employé (`executeur.limite` :
 *  lui seul sait à quoi elle ressemble chez son fournisseur). La session n'a pas eu lieu : ni progrès,
 *  ni absence de progrès. Retourne null si ce n'est pas ce cas ; sinon
 *  {texte, repriseIso, attenteMs} — attenteMs = délai jusqu'à l'heure de remise à zéro annoncée + 60 s, null si elle est
 *  illisible ou à plus de 6 h. `HOLARCH_ATTENTE_429_MS` force la durée (tests) : commodité du harnais,
 *  appliquée ici pour tous les exécuteurs. Mission holarch-provenance, 2026-09-10 :
 *  trois 429 d'affilée (23 s, 1 s, 1 s) comptés comme « 3 sessions sans progrès » — enfant arrêté à tort. */
function limiteApi(res, nomExecuteur) {
  if (!res) return null;
  const mod = executeurs.resoudre(nomExecuteur || executeurs.DEFAUT);
  // Compatibilité : un appelant (test, outil) peut encore passer l'objet de résultat brut d'un
  // fournisseur ; un Resultat normalisé porte toujours `fin`, un objet brut jamais.
  const resultat = res.fin ? res : (mod.normaliserRes ? mod.normaliserRes(res) : null);
  const lim = mod.limite(resultat);
  if (!lim) return null;
  // `HOLARCH_ATTENTE_429_MS` est une commodité du harnais de test HOLARCH, valable pour tout
  // exécuteur : elle est appliquée ici, au retour de `limite()`, jamais dans l'exécuteur.
  if (process.env.HOLARCH_ATTENTE_429_MS !== undefined) {
    return { texte: lim.texte, repriseIso: 'forcée (HOLARCH_ATTENTE_429_MS)', attenteMs: Number(process.env.HOLARCH_ATTENTE_429_MS) };
  }
  return lim;
}
function attendre(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** Sha qui borne le travail d'une instance : HEAD de **sa propre branche** sous `git-branches`, HEAD du dépôt
 *  sinon. Les bornes `avant`/`apres` du garde (§11.4) doivent encadrer les seuls commits de l'instance : deux
 *  points d'une branche partagée font apparaître les commits d'autrui comme des écritures hors arbre (faux
 *  positifs de règle 1 démontrés au §4 du rapport d'équivalence, MSG-impl-garde-1). Null si la ref est absente
 *  (branche pas encore créée, dépôt inexploitable) : le garde est alors sauté, jamais deviné. */
function shaInstance(root, chemin, cfg) {
  const gb = gitBranchesCtx(cfg || {});
  const ref = gb && chemin.includes('/') ? `${gb.prefixe}${chemin.replace(/\//g, '-')}` : 'HEAD';
  const r = spawnSync('git', ['rev-parse', '--verify', ref], { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? (r.stdout || '').trim() || null : null;
}

/**
 * Garde a posteriori (§11.4), exécuté par le lanceur après **chaque** session, quel que soit l'exécuteur :
 * c'est la garantie portable là où les hooks de Claude Code n'existent pas (`capacites.hooks` faux).
 * - Règles 1 et 3 (écritures hors de l'arbre de l'instance, enfants créés hors budget) : `ALERT` du lanceur
 *   dans l'`INBOX.md` du parent et session marquée `fin = erreur` — elle ne compte donc pas comme un progrès.
 * - Règle 2 (transition de `STATUS.md`) : journalisée seulement. Le lanceur ne réécrit pas l'état qu'une
 *   instance a elle-même déclaré, après sa mort et sur sa branche ; la correction reste au hook `sleep-guard`
 *   tant que l'exécuteur a la capacité `hooks`. Écart assumé au texte de §11.4 (« corrigé … note ajoutée »),
 *   signalé au mainteneur dans le rapport de mission.
 * Fail-open intégral : toute anomalie du dépôt rend une liste d'écarts vide (le garde n'arrête jamais une
 * mission par accident), la sévérité restant portée par les écarts eux-mêmes.
 */
function verifierApresSession(root, chemin, avant, apres, out) {
  if (!avant || !apres) return { ecarts: [], alerte: null };
  let ecarts = [];
  // 1.19.3 : seuls les commits de l'instance sont jugés (sujet `[<chemin>]`, `[bootstrap]`, `[harnais]`, `review(`) — la racine
  // partage l'arbre principal avec la session de maintenance, dont les commits ne sont pas les siens.
  const prefixes = [`[${chemin}]`, '[bootstrap]', '[harnais]', 'review('];
  try { ({ ecarts } = gardeGit.verifierSession(root, chemin, avant, apres, { prefixes })); } catch (_) { return { ecarts: [], alerte: null }; }
  if (!ecarts.length) return { ecarts, alerte: null };
  if (out && out.logBase) {
    try { fs.writeFileSync(`${out.logBase}.garde.json`, `${JSON.stringify({ chemin, avant, apres, ecarts }, null, 2)}\n`); } catch (_) { /* journal best-effort */ }
  }
  const graves = ecarts.filter((e) => e.regle === 1 || e.regle === 3);
  let alerte = null;
  if (graves.length) {
    if (out && out.res) out.res.fin = 'erreur';
    alerte = appendAlertToParent(root, chemin, [
      `Garde a posteriori du lanceur (§11.4) : ${graves.length} écart(s) constaté(s) sur la session de \`${chemin}\` (${avant.slice(0, 7)}..${apres.slice(0, 7)}).`,
      ...graves.map((e) => `- règle ${e.regle} · ${e.chemin} · ${e.detail}`),
      '',
      'La session est marquée `fin = erreur` (elle ne compte pas comme un progrès). À toi de décider : `TASK` correctif, recadrage (KERNEL §10) ou `FAILED`.',
    ].join('\n'));
  }
  const detailRegles = [1, 2, 3].map((r) => `${ecarts.filter((e) => e.regle === r).length}×règle ${r}`).filter((s) => !s.startsWith('0')).join(', ');
  process.stderr.write(`HOLARCH ▸ ${chemin} ▸ garde : ${ecarts.length} écart(s) (${detailRegles})${graves.length ? ` — session en erreur${alerte ? `, ALERT ${alerte} au parent` : ''}` : ' — journalisés (règle 2)'}${out && out.logBase ? ` · ${out.logBase}.garde.json` : ''}\n`);
  return { ecarts, alerte };
}

function launchWithRelaunches(root, chemin, opts, runner) {
  runner = runner || runOnce;
  const sessions = [];
  let attempt = 0;
  let relances = 0; // ré-incarnations de contexte consécutives SANS progrès (relances_max)
  let sansUnite = 0; // sessions consécutives sans nouvelle fiche d'unité, même avec des commits (sessions_sans_unite_max, 1.21.0)
  let attentes429 = 0; // reprises après une limite de sessions de l'API (au plus 3 par invocation)
  let changements = 0; // ré-incarnations après un changement de régime (changements_regime_max)
  // Repli sur limite (volet 3, §11.3) : surcharge d'options appliquée aux tentatives suivantes —
  // `{ modele: <équivalent chez le secours>, repliDepuis: <fournisseur quitté> }`. Elle n'est écrite
  // nulle part sur disque : un nouvel appel au lanceur repart du fournisseur principal, comme le veut
  // §11.3 (« pas de mémoire d'état »). Elle vaut en revanche pour tout le reste de l'invocation : le
  // fournisseur qui vient de refuser une session ne devient pas disponible parce que l'instance a
  // hiberné volontairement entre-temps.
  let repli = null;
  for (;;) {
    attempt += 1;
    // Reconstruit le lancement à chaque tentative : après une hibernation volontaire, MEMORY/STATUS/INBOX/JOURNAL
    // ont changé sur disque (écrits par la session qui vient de se terminer) — les relire ici est ce qui évite
    // d'injecter dans le prompt de la ré-incarnation l'état d'avant cette session (bug constaté en pratique,
    // T4 réel session n°4→5 : la ré-incarnation recevait l'état de la session n°3).
    // Après un --bootstrap, la racine existe (fichiers d'instance, fiche registre) : toute ré-incarnation repart
    // comme instance ordinaire, sans BOOTSTRAP.md — sinon la session ré-incarnée refuse « mission déjà en cours »
    // sans rien faire (dogfooding du chantier 3, 2026-09-10 : trois sessions perdues avant l'arrêt sans progrès).
    const optsCourantes = repli ? Object.assign({}, opts, repli) : opts;
    // 1.16.2 : un --bootstrap dont la session n'a PAS eu lieu (429 puis repli ou attente) reste un bootstrap — la
    // racine n'existe pas encore, et une tentative « ordinaire » plante sur ROLE.md introuvable (holarch-passerelle,
    // 2026-09-11 : premier 429 réel au bootstrap, repli vers OpenRouter perdu sur cette erreur).
    const bootstrapEncore = !!opts.bootstrap && !fs.existsSync(path.join(root, 'mission', chemin, 'ROLE.md'));
    const tentativeOpts = attempt > 1 ? Object.assign({}, optsCourantes, { bootstrap: bootstrapEncore, relance: true }) : optsCourantes;
    // Chantier 16 (revue du J1, point 4) : une ré-incarnation peut être refusée par prepareLaunch — fiche passée
    // au-delà de budget_usd_session_max pendant la session, fiche devenue illisible. Arrêt propre : ALERT au parent,
    // ligne de synthèse, tâche close `failed` par finishLaunch — jamais une exception qui plante le lanceur.
    let launch;
    try { launch = prepareLaunch(root, chemin, tentativeOpts); } catch (e) {
      if (!sessions.length) throw e;
      const arret = { motif: 'relance-refusee', texte: String(e.message || e).slice(0, 300) };
      arret.alerte = appendAlertToParent(root, chemin, `**Enfant \`${chemin}\` arrêté par le lanceur** : ré-incarnation refusée (« ${arret.texte} »). Il ne sera plus ré-incarné tout seul : corrige la cause (fiche registre, CONFIG.md), puis relance-le en tâche détachée (\`node framework/bin/holarch-spawn.js ${chemin} --detach\`), recadre-le (\`TASK\`) ou passe-le \`FAILED\`.`);
      sessions[sessions.length - 1].arret = arret;
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ré-incarnation refusée (${arret.texte})${arret.alerte ? ` — ALERT ${arret.alerte} au parent` : ''}\n`);
      return sessions;
    }
    if (opts.timeoutMin > 0) launch.timeoutMs = opts.timeoutMin * 60 * 1000;
    const avant = progressSnapshot(root, chemin);
    const shaAvant = shaInstance(root, chemin, launch.cfg);
    const out = runner(launch, attempt);
    const status = readStatusOf(root, chemin);
    // Garde a posteriori (§11.4) : avant la ligne de session, qui doit porter le `fin = erreur` d'un écart grave.
    const garde = verifierApresSession(root, chemin, shaAvant, shaInstance(root, chemin, launch.cfg), out);
    const line = appendSessionLine(root, launch.cfg.nom, chemin, launch.meta, out.res, out.elapsedMs, status.etat || '(absent)', { systeme: launch.systemPrompt.length, utilisateur: launch.prompt.length }, out.logBase);
    sessions.push(Object.assign({ status, line, launch, garde }, out));
    // 1.9.0 (maintenance, mission holarch-contexte) : un parent qui attend un message (CLARIFICATION, PROPOSAL, BLOCKER,
    // ALERT) ne doit pas attendre la fin de toute la boucle de ré-incarnation de son enfant — les guetteurs sont évalués
    // après chaque session. Idempotent : un parent vivant ou déjà réveillé est ignoré (isLive), et « récent » signifie
    // postérieur à son dernier commit de STATUS, donc aucun re-réveil en boucle sur le même message. finishLaunch
    // réévalue une dernière fois à la sortie de la boucle (état final de l'enfant : DELIVERED, FAILED…).
    const reveillesSession = wakeWaiters(root, chemin);
    if (reveillesSession.length) process.stderr.write(`HOLARCH ▸ ${chemin} ▸ réveil après la session n° ${attempt} : ${reveillesSession.map((r) => `${r.chemin} (${r.condition})`).join(' ; ')}
`);
    const limite = limiteApi(out.res, out.executeur || launch.executeur);
    if (limite) {
      // Repli sur limite (volet 3, §11.3), avant toute attente : le fournisseur courant déclare-t-il un
      // `Secours` au catalogue, et le modèle demandé a-t-il un `Équivalent` chez ce secours ? Si oui, la
      // session est relancée immédiatement là-bas (même prompt, même fiche, modèle équivalent) — elle n'a
      // pas eu lieu, elle ne compte donc ni comme progrès ni comme relance sans progrès, exactement comme
      // l'attente qu'elle remplace. Un seul repli par invocation : si le secours refuse à son tour, on
      // retombe sur le comportement d'attente ci-dessous plutôt que d'errer de fournisseur en fournisseur.
      const quitte = launch.meta.fournisseur;
      const secours = quitte && !repli ? catalogue.secoursDe(launch.catalogue, quitte) : null;
      const equivalent = secours ? catalogue.equivalentChez(launch.catalogue, launch.meta.modele, secours) : null;
      if (equivalent) {
        repli = { modele: equivalent, repliDepuis: quitte };
        process.stderr.write(`HOLARCH ▸ ${chemin} ▸ limite de sessions de l'API (429) chez « ${quitte} » — repli immédiat sur « ${secours} » (modèle ${launch.meta.modele} → ${equivalent}), sans attente\n`);
        continue;
      }
      attentes429 += 1;
      if (limite.attenteMs !== null && attentes429 <= 3) {
        process.stderr.write(`HOLARCH ▸ ${chemin} ▸ limite de sessions de l'API (429) — la session n'a pas eu lieu ; reprise à ${limite.repriseIso} (attente ${fmtDuration(limite.attenteMs)}, ${attentes429}/3)\n`);
        const issue = attenteLimite().attendreInterruptible({
          ms: limite.attenteMs,
          stopFile: stopPath(root, chemin),
          attenteFile: attenteLockPath(root, chemin),
          info: { motif: attenteLimite().motifFin(limite.texte), tentative: attentes429 },
        });
        if (issue === 'arret') {
          // Revue n° 38 : le fichier stop reste en place — wakeWaiters n'y réveille plus l'instance (READY à la condition
          // encore vraie) ; seul un lancement explicite (prepareLaunch) le retire.
          sessions[sessions.length - 1].arretDemande = true;
          sessions[sessions.length - 1].arret = { motif: 'arret-demande' };
          process.stderr.write(`HOLARCH ▸ ${chemin} ▸ arrêt demandé (--arret) reçu pendant l'attente d'une limite 429 (${attentes429}/3) — pas de ré-incarnation\n`);
          return sessions;
        }
        continue;
      }
      const arret = { motif: 'limite-api', texte: limite.texte };
      arret.alerte = appendAlertToParent(root, chemin, `**Enfant \`${chemin}\` arrêté par le lanceur** : limite de sessions de l'API (429 — « ${limite.texte} »), la session n'a pas eu lieu (ni progrès ni absence de progrès). Relance-le en tâche détachée (\`node framework/bin/holarch-spawn.js ${chemin} --detach\`) après l'heure de remise à zéro.`);
      sessions[sessions.length - 1].arret = arret;
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ ré-incarnations arrêtées (limite de sessions de l'API 429 : ${limite.texte})${arret.alerte ? ` — ALERT ${arret.alerte} au parent` : ''}\n`);
      return sessions;
    }
    const maxRelances = Number(launch.params.relances_max) || 0;
    const maxChangements = Number(launch.params.changements_regime_max) || 0;
    const isArret = /hibernation volontaire \(arrêt demandé\)/i.test(status.note || '');
    const voluntary = status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '') && !isArret;
    if (!voluntary) return sessions;
    // 1.13.2 : --arret posé pendant que la session finissait déjà (ON_SLEEP sur budget ou contexte) — la note ne dit
    // pas « arrêt demandé », mais le fichier stop est là : pas de ré-incarnation (trois arrêts perdus le 2026-09-11,
    // chaque prepareLaunch effaçant le fichier). Consommé ici, jamais à la tentative suivante.
    if (fs.existsSync(stopPath(root, chemin))) {
      try { fs.unlinkSync(stopPath(root, chemin)); } catch (_) { /* déjà retiré */ }
      sessions[sessions.length - 1].arretDemande = true;
      process.stderr.write(`HOLARCH ▸ ${chemin} ▸ arrêt demandé (--arret) reçu pendant la fin de la session n° ${attempt} — pas de ré-incarnation\n`);
      return sessions;
    }
    // Changement de régime (direct-spawn, ON_PLAN) : l'instance a modifié la ligne Profil, Effort ou Modèle de sa fiche
    // registre avant d'hiberner. La fiche est relue ici comme prepareLaunch la relira au tour suivant ; un régime
    // différent est ré-incarné sur le nouveau modèle/effort, décompté à part des ré-incarnations de contexte.
    const regime = (m) => `${m.modele}/${m.effort}`;
    // `optsCourantes` et non `opts` : sous un repli en cours (volet 3), le modèle de la tentative
    // courante est l'équivalent chez le secours — comparer au modèle de la politique ferait voir un
    // changement de régime là où il n'y a qu'un changement de fournisseur décidé par le lanceur.
    const next = resolveMetaFromDisk(root, chemin, Object.assign({}, optsCourantes, { bootstrap: false }));
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
    const apres = progressSnapshot(root, chemin);
    if (hasProgressed(avant, apres)) relances = 0; else relances += 1;
    // P5 (holarch-modeles, 2026-09-12) : mesure-gpt5mini a commité du WIP à chaque session (donc « progrès ») sans jamais
    // clore une unité — 8 sessions, 474 tours avant un arrêt manuel. Une fiche d'unité est la seule preuve de progrès qui
    // compte ici ; les commits gardent leur rôle pour relances_max.
    if (apres.fiches > avant.fiches) sansUnite = 0; else sansUnite += 1;
    const total = countSessions(root, chemin);
    const maxSessions = Number(launch.params.sessions_max_par_instance) || 0;
    const maxSansUnite = Number(launch.params.sessions_sans_unite_max) || 0;
    let arret = null;
    if (maxSessions && total >= maxSessions) arret = { motif: 'plafond', max: maxSessions, total };
    else if (relances > maxRelances) arret = { motif: 'sans-progres', sansProgres: relances, max: maxRelances };
    else if (maxSansUnite && sansUnite >= maxSansUnite) arret = { motif: 'sans-unite', sansUnite, max: maxSansUnite };
    if (arret) {
      const note = (status.note || '').slice(0, 200);
      const suite = `Il ne sera plus ré-incarné tout seul : relance-le en tâche détachée (\`node framework/bin/holarch-spawn.js ${chemin} --detach\`) après lecture de sa mémoire, recadre-le (\`TASK\`), ou passe-le \`FAILED\`.`;
      arret.alerte = appendAlertToParent(root, chemin, arret.motif === 'sans-unite'
        ? `**Enfant \`${chemin}\` arrêté par le lanceur** : ${sansUnite} session(s) consécutive(s) sans nouvelle fiche d'unité (\`memoire/U<n>-*.md\`), malgré d'éventuels commits (\`sessions_sans_unite_max\` = ${maxSansUnite}). Il tourne sans livrer : lis sa mémoire et son journal, puis TASK de recadrage ou FAILED. Dernière note : « ${note} ». ${suite}`
        : arret.motif === 'plafond'
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
  // `s.res` est le Resultat normalisé de la tentative (volet 1) : aucun champ de fournisseur ici.
  const cost = sessions.reduce((a, s) => a + ((s.res && s.res.cout_usd) || 0), 0);
  const turns = sessions.reduce((a, s) => a + ((s.res && s.res.tours) || 0), 0);
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
  const isArret = /hibernation volontaire \(arrêt demandé\)/i.test(status.note || '') || !!last.arretDemande;
  const voluntary = status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '') && !isArret;
  if (!last.res || last.res.fin === 'sans_resultat') {
    const causeExacte = last.error ? ` — cause : ${last.error.code || ''} ${last.error.message || ''}`.trim() : '';
    lines.push(`⚠ aucun résultat exploitable de l'exécuteur (code ${last.exitCode}, signal ${last.signal || '—'})${causeExacte} — voir ${last.logBase}.stderr.log`);
    code = 2;
  }
  else if ((last.res.fin === 'erreur' || last.res.fin === 'limite') && !(last.arret && (last.arret.motif === 'limite-api' || last.arret.motif === 'arret-demande'))) { lines.push(`⚠ fin anormale : ${last.res.sous_type || last.res.fin} — voir ${last.logBase}.result.json`); code = 2; }
  if (isArret) { lines.push('ℹ arrêt propre demandé (--arret) : session terminée sans ré-incarnation.'); }
  else if (last.arret && last.arret.motif === 'limite-api') {
    lines.push(`⚠ limite de sessions de l'API (429 : ${last.arret.texte}) — la session n'a pas eu lieu, STATUS inchangé (${status.etat || '(absent)'}) ; ${last.arret.alerte ? `ALERT ${last.arret.alerte} déposé dans l'INBOX du parent` : 'relancer'} après l'heure de remise à zéro (\`node framework/bin/holarch-spawn.js ${launch.chemin} --detach\`).`);
    code = 3;
  }
  else if (last.arret && last.arret.motif === 'relance-refusee') {
    lines.push(`⚠ ré-incarnation refusée par le lanceur (${last.arret.texte}) — ${last.arret.alerte ? `ALERT ${last.arret.alerte} déposé dans l'INBOX du parent, qui décide (correction de la fiche, relance détachée, TASK, FAILED)` : 'corriger la cause puis relancer'}.`);
    code = 1;
  }
  else if (status.etat === 'WORKING' && !voluntary) { lines.push('⚠ STATUS.md est resté à WORKING : session plantée ou ON_SLEEP non exécuté (direct-spawn : relancer une fois, puis FAILED + recadrage).'); code = 2; }
  else if (voluntary) {
    const a = last.arret || {};
    const decision = a.alerte ? `ALERT ${a.alerte} déposé dans l'INBOX du parent, qui décide (relance détachée, TASK, FAILED)` : 'relancer manuellement (racine sans parent) ou relever le plafond';
    lines.push(a.motif === 'plafond'
      ? `⚠ plafond sessions_max_par_instance (${a.max}) atteint, STATUS encore WORKING (hibernation volontaire) — ${decision}.`
      : a.motif === 'sans-unite' ? `⚠ ${a.sansUnite} session(s) consécutive(s) sans nouvelle fiche d'unité (sessions_sans_unite_max ${a.max}) : l'instance tourne sans livrer${a.alerte ? ` — ALERT ${a.alerte} déposé dans l'INBOX du parent` : ''}`
      : `⚠ ${a.sansProgres || sessions.length} session(s) en hibernation volontaire sans progrès (ni fiche d'unité ni commit [${launch.chemin}] nouveaux) : STATUS encore WORKING — ${decision}.`);
    code = 3;
  }
  // §3.1 : une condition de réveil invalide vaut « aucune condition » — dit ici, sinon l'instance attend sans jamais être réveillée.
  if (status.reveil && status.reveil !== '—' && !reveil.parseReveil(status.reveil)) lines.push(`⚠ ligne Réveil de STATUS.md invalide (« ${status.reveil} ») : traitée comme « aucune condition », le harnais ne réveillera pas cette instance — grammaire dans docs/IMPLEMENTATION.md §3.1.`);
  const denials = sessions.reduce((a, s) => a + ((s.res && s.res.refus) || 0), 0);
  if (denials) lines.push(`ℹ ${denials} appel(s) d'outil refusé(s) par les règles d'autorisation (détail : ${last.logBase}.result.json).`);
  if (status.note) lines.push(`ℹ note STATUS : ${status.note.slice(0, 300)}`);
  lines.push(`ℹ journal des sessions : mission/registry/SESSIONS.md`);
  return { text: lines.join('\n'), code };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { chemin: null, bootstrap: false, dryRun: false, json: false, profil: '', modele: '', effort: '', budget: '', maxTours: '', permissionMode: '', root: '', timeoutMin: 0, addDir: [], detach: false, reveil: false, taches: false, arret: '', nettoyerWorktree: '', reprendre: false, checkEnv: false, controle: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--bootstrap') o.bootstrap = true;
    else if (a === '--dry-run') o.dryRun = true;
    else if (a === '--json') o.json = true;
    // `--model` et `--max-turns` : alias humains historiques des options **du lanceur**, homonymes
    // de celles de Claude Code mais sans lien avec elles — traduits en meta.modele / maxTours, à
    // charge pour l'exécuteur de les exprimer (ou non) dans l'invocation de son fournisseur.
    else if (a === '--profil') o.profil = next();
    else if (a === '--modele' || a === '--model') o.modele = next();
    else if (a === '--effort') o.effort = next();
    // Troisième revue n° 82 : `--budget-usd` sans valeur (fin de ligne) ou vide (`""`) n'est plus ignoré en silence —
    // la valeur témoin est illisible, donc refusée par resoudreBudget (et par refusInstance pour une instance).
    else if (a === '--budget-usd') { const v = next(); o.budget = (v === undefined || String(v).trim() === '') ? '(sans valeur)' : v; }
    else if (a === '--max-tours' || a === '--max-turns') o.maxTours = next();
    else if (a === '--permission-mode') o.permissionMode = next();
    else if (a === '--root') o.root = next();
    else if (a === '--add-dir') o.addDir.push(next());
    else if (a === '--timeout-min') o.timeoutMin = Number(next());
    else if (a === '--detach') o.detach = true;
    else if (a === '--forcer') o.forcer = true;
    else if (a === '--reveil') o.reveil = true;
    else if (a === '--pour') o.pour = next();
    else if (a === '--declencheur') o.declencheur = next();
    else if (a === '--taches') o.taches = true;
    else if (a === '--reprendre') o.reprendre = true;
    else if (a === '--arret') o.arret = next();
    else if (a === '--immediat') o.immediat = true;
    else if (a === '--nettoyer-worktree') o.nettoyerWorktree = next();
    else if (a === '--controle') o.controle = next();
    else if (a === '--check-env') o.checkEnv = true;
    else if (a === '-h' || a === '--help') { o.help = true; }
    else if (a.startsWith('-')) throw new Error(`option inconnue : ${a}`);
    else if (!o.chemin) o.chemin = a.replace(/^mission\//, '').replace(/\/+$/, '');
    else throw new Error(`argument inattendu : ${a}`);
  }
  if (o.bootstrap) o.chemin = 'concepteur';
  return o;
}

/** Vérifie les prérequis de l'Étape 0 de BOOTSTRAP.md avant un lancement réel (`--check-env`) : Node,
 *  CLI `claude` installé et authentifié, `git` disponible — pour un diagnostic HOLARCH explicite plutôt
 *  qu'un `command not found` opaque découvert seulement au premier lancement (constaté en dogfooding
 *  réel, docs/IDEES.md). Ne vérifie pas l'identité Git : le lanceur la pose lui-même dans l'environnement
 *  de chaque session (BOOTSTRAP.md Étape 0, point 3), rien à préparer côté utilisateur. */
function verifierEnv() {
  const lignes = [];
  let ok = true;
  const majeur = Number(process.version.replace(/^v/, '').split('.')[0]);
  if (majeur >= 18) lignes.push(`✓ Node ${process.version} (≥ 18 requis)`);
  else { lignes.push(`✗ Node ${process.version} — 18 ou plus requis`); ok = false; }

  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (!git.error && git.status === 0) lignes.push(`✓ git : ${(git.stdout || '').trim()}`);
  else { lignes.push('✗ git introuvable ou en échec — requis pour les commits de mission'); ok = false; }

  const claudeV = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  const claudeOk = !claudeV.error && claudeV.status === 0;
  if (claudeOk) lignes.push(`✓ claude : ${(claudeV.stdout || '').trim()}`);
  else { lignes.push('✗ CLI `claude` introuvable (npm install -g @anthropic-ai/claude-code) — un lancement réel échouerait en « command not found »'); ok = false; }

  if (claudeOk) {
    const auth = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8' });
    if (!auth.error && auth.status === 0) lignes.push('✓ claude authentifié');
    else { lignes.push(`✗ claude non authentifié (${((auth.stdout || auth.stderr || '').trim().split('\n')[0]) || 'claude auth status a échoué'})`); ok = false; }
  } else {
    lignes.push('  (authentification non vérifiée : claude introuvable)');
  }

  return { ok, lignes };
}

function usage() {
  return [
    'Usage : node framework/bin/holarch-spawn.js <chemin-instance> [options]',
    '        node framework/bin/holarch-spawn.js --bootstrap [options]',
    'Options : --profil <conception|execution|relecture|exploration> --modele <alias|id> --effort <low|medium|high|xhigh|max>',
    '          --budget-usd <n> --max-tours <n> --permission-mode <mode> --timeout-min <n> --root <dir>',
    '          --add-dir <dir> (répétable — dépôt externe accessible en plus de la racine) --dry-run --json',
    '          --forcer (lance même si un fournisseur atteignable n\'a pas ses variables d\'environnement)',
    '          --detach --reveil --taches --reprendre --arret <chemin> [--immediat] (réveil/arrêt/tâches : voir docs/IMPLEMENTATION.md §3.2-§3.5)',
    '          --nettoyer-worktree <chemin> (supprime le worktree d\'une instance déjà fusionnée ; refuse si des changements non committés subsistent,',
    '          sauf --forcer : écrit d\'abord un patch sous mission/.holarch/graveyard/ puis supprime de force)',
          '          --check-env (prérequis d\'Étape 0 de BOOTSTRAP.md : Node, git, CLI claude installée et authentifiée — avant tout lancement réel)',
          '          --controle <chemin> (rejoue la colonne Contrôle du ROLE.md de <chemin> — OBJECTIVE.md pour la racine — dans son espace de travail réel ;',
          '          écrit mission/.holarch/controles/<chemin-tirets>-<ts>.json, sort en 0 ssi tous les contrôles exécutés sont à 0)',
  ].join('\n');
}

function listTaches(root) {
  const dir = tasksDir(root);
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { files = []; }
  return files.sort().map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } }).filter(Boolean);
}
/** Tâche détachée encore vivante pour ce chemin (fiche « running » dont le pid répond), ou null. 1.19.4 : entre deux
 *  sessions d'une ré-incarnation, le verrou `live/` est absent — un second lanceur était accepté et deux sessions de
 *  la même instance ont tourné en parallèle dans le même worktree (holarch-modeles, 2026-09-12, mesure-gpt5mini). */
function tacheVivantePour(root, chemin) {
  for (const t of listTaches(root)) {
    if (t.chemin !== chemin || t.state !== 'running' || !t.pid) continue;
    // Troisième revue n° 73 : pid ET starttime (noté par detachLaunch), comme `.attente.json` — un pid réutilisé après
    // un redémarrage du conteneur ne tient plus l'instance « occupée » pour toujours.
    if (attenteLimite().processusVivant(t.pid, t.starttime)) return t;
  }
  return null;
}

/** Reprise après un arrêt brutal (redémarrage du conteneur, lanceur tué — constaté le 2026-09-11 : un enfant en
 *  hibernation propre est resté à l'arrêt toute une nuit, sa fiche de tâche disant « running » avec un pid mort).
 *  Toute tâche détachée « running » dont le pid est mort est close (« failed », note), et son instance relancée en
 *  détaché si elle est reprenable — READY, ou WORKING avec une note d'hibernation volontaire hors arrêt demandé — et
 *  pas déjà vivante. Idempotent : une seconde invocation ne relance rien. */
function reprendreTaches(root) {
  const lignes = [];
  const relancees = [];
  for (const t of listTaches(root)) {
    if (t.state !== 'running' || !t.pid) continue;
    const vivant = attenteLimite().processusVivant(t.pid, t.starttime); // troisième revue n° 73 : pid et starttime
    if (vivant) continue;
    try {
      t.state = 'failed'; t.finishedAt = nowIso(); t.note = 'lanceur mort, fiche close par --reprendre';
      fs.writeFileSync(path.join(tasksDir(root), `${t.id}.json`), JSON.stringify(t, null, 2));
    } catch (_) { /* fiche illisible : on continue */ }
    const status = readStatusOf(root, t.chemin);
    const arret = /hibernation volontaire \(arrêt demandé\)/i.test(status.note || '');
    const reprenable = status.etat === 'READY' || (status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '') && !arret);
    if (!reprenable) { lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — non relancée : STATUS ${status.etat || '(absent)'}${status.note ? ` (${status.note.slice(0, 60)})` : ''}`); continue; }
    // Seconde revue n° 51 : même réservation atomique que wakeWaiters — un --reprendre concurrent d'un réveil (guetteur
    // d'un job orphelin, autre --reprendre) ne lance plus deux sessions de la même instance.
    const resa = relancees.includes(t.chemin) ? null : reserverInstance(root, t.chemin);
    if (resa && (tacheVivantePour(root, t.chemin) || pidEnAttente(root, t.chemin))) { libererReservation(root, t.chemin, resa); lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — déjà vivante, pas de relance`); continue; }
    if (!resa) { lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — déjà vivante, pas de relance`); continue; }
    let id; let pid;
    try { ({ id, pid } = detachLaunch(root, t.chemin, { parent: 'reprise', args: argsDerniereTache(root, t.chemin) })); }
    catch (err) { libererReservation(root, t.chemin, resa); throw err; }
    transmettreReservation(root, t.chemin, resa, { pid, startedAt: nowIso(), attempt: 0, reprise: id });
    relancees.push(t.chemin);
    lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — relancée en détaché : tâche ${id} (pid ${pid})`);
  }
  try {
    // require paresseux (chantier 16, U9) : un arbre plus ancien sans jobs.js reste utilisable
    // (MODULE_NOT_FOUND ignoré) ; toute autre erreur remonte.
    const { reprendre: reprendreJobs } = require('./jobs');
    const resJobs = reprendreJobs(root);
    if (resJobs && Array.isArray(resJobs.lignes)) lignes.push(...resJobs.lignes);
  } catch (err) {
    if (!err || err.code !== 'MODULE_NOT_FOUND') throw err;
  }
  return { lignes, relancees };
}
/** Descendants d'un pid d'après `ps -eo pid=,ppid=` (profondeur d'abord : les feuilles en premier). */
function descendants(pid) {
  const r = spawnSync('ps', ['-eo', 'pid=,ppid='], { encoding: 'utf8', timeout: 5000 });
  const enfants = new Map();
  for (const l of String(r.stdout || '').split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    if (!enfants.has(m[2])) enfants.set(m[2], []);
    enfants.get(m[2]).push(m[1]);
  }
  const out = [];
  const visiter = (p) => { for (const c of enfants.get(String(p)) || []) { visiter(c); out.push(Number(c)); } };
  visiter(pid);
  return out;
}

/** Arrêt d'une instance (1.13.1). Sans session vivante (verrou absent ou au pid mort, nettoyé par isLive) : rien à
 *  arrêter, aucun fichier stop écrit. Vivante : `immediat` tue l'arbre de processus du lanceur (SIGTERM feuilles
 *  d'abord, SIGKILL après `attenteMs`) — l'état committé reste, ce qui traîne appartient à la session suivante ; sinon
 *  écrit la demande d'arrêt lue par le hook au prochain appel d'outil (ON_SLEEP complet, plusieurs minutes). */
function demanderArret(root, chemin, opts = {}) {
  const enAttente = pidEnAttente(root, chemin);
  if (!isLive(root, chemin) && !enAttente) return { vivant: false, message: `aucune session vivante pour ${chemin} (verrou périmé nettoyé s'il y en avait un) — rien à arrêter` };
  // MSG-utilisateur-004 point 3 : un lanceur en attente 429 n'a aucune session à tuer, et un gestionnaire de SIGTERM
  // n'y tournerait jamais (lanceur synchrone, Atomics.wait). --immediat lui pose donc d'abord le fichier stop, qu'il
  // lit entre deux tranches : il sort de lui-même, verrou retiré, ligne SESSIONS.md et tâche closes. Le signal
  // (plus bas) n'est qu'un repli s'il n'est pas sorti au bout de deux tranches.
  if (opts.immediat && enAttente && !sessionEnCours(root, chemin)) { // n° 74 : le lanceur garde live/ entre deux sessions
    const al = attenteLimite();
    const st = al.starttimeDe(enAttente);
    writeStopRequest(root, chemin);
    const delai = opts.attenteSortieMs || 2 * (Number(process.env.HOLARCH_ATTENTE_TRANCHE_MS) || 5000) + 2000;
    const fin = Date.now() + delai;
    while (Date.now() < fin && al.processusVivant(enAttente, st)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    if (!al.processusVivant(enAttente, st)) return { vivant: true, mode: 'immediat', pids: [enAttente], sigkill: [], message: `lanceur en attente d'une limite 429 (pid ${enAttente}) sorti de lui-même sur le fichier stop — verrou retiré, tâche close, aucune ré-incarnation` };
  }
  if (!opts.immediat) {
    const p = writeStopRequest(root, chemin);
    return { vivant: true, mode: 'propre', chemin: p, message: `arrêt demandé (${p}) — la session hiberne à son prochain appel d'outil, ON_SLEEP compris ; --immediat pour tuer la session tout de suite` };
  }
  let pid = null;
  try { pid = JSON.parse(fs.readFileSync(liveLockPath(root, chemin), 'utf8')).pid; } catch (_) { pid = enAttente; }
  writeStopRequest(root, chemin); // au cas où le lanceur survivrait à son enfant : pas de ré-incarnation
  const cibles = descendants(pid).concat([pid]);
  const signaler = (sig) => cibles.filter((p) => { try { process.kill(p, sig); return true; } catch (_) { return false; } });
  const termes = signaler('SIGTERM');
  const fin = Date.now() + (opts.attenteMs || 5000);
  while (Date.now() < fin && cibles.some((p) => { try { process.kill(p, 0); return true; } catch (_) { return false; } })) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  const tues = signaler('SIGKILL');
  // MSG-utilisateur-004 points 3 et 6 : un lanceur tué ne nettoie rien lui-même. Son verrou d'attente est retiré
  // ici s'il lui appartient encore (pid ET starttime) ; sa tâche est close `failed` avec le motif de l'arrêt, pour
  // que --reprendre (qui ne reprend que les tâches `running` au pid mort) ne relance pas une instance arrêtée.
  {
    let attente = null;
    try { attente = JSON.parse(fs.readFileSync(attenteLockPath(root, chemin), 'utf8')); } catch (_) { attente = null; }
    if (attente && cibles.includes(attente.pid) && !attenteLimite().processusVivant(attente.pid, attente.starttime)) {
      attenteLimite().supprimerSiProprietaire(attenteLockPath(root, chemin), attente.pid, attente.starttime);
    }
    for (const t of listTaches(root)) {
      if (t.state !== 'running' || !cibles.includes(t.pid)) continue;
      try {
        t.state = 'failed'; t.finishedAt = nowIso(); t.note = 'arrêtée par --arret --immediat : non reprise par --reprendre';
        fs.writeFileSync(path.join(tasksDir(root), `${t.id}.json`), JSON.stringify(t, null, 2));
      } catch (_) { /* fiche illisible : on continue */ }
    }
  }
  try { fs.unlinkSync(liveLockPath(root, chemin)); } catch (_) { /* déjà retiré */ }
  return { vivant: true, mode: 'immediat', pids: termes, sigkill: tues, message: `session tuée (SIGTERM ${termes.join(', ') || '—'}${tues.length ? ` ; SIGKILL ${tues.join(', ')}` : ''}) — état committé conservé, fichiers non committés laissés à la session suivante` };
}

function writeStopRequest(root, chemin) {
  const dir = path.join(root, 'mission', '.holarch', 'stop');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, chemin.replace(/\//g, '-'));
  fs.writeFileSync(p, `${nowIso()}\n`);
  return p;
}

/** Troisième revue n° 77, 78 : les refus de `spawn-guard` tenus par le lanceur lui-même, sur les options qu'il a
 *  PARSÉES — une regex sur le texte de la commande ne suit pas bash (guillemets internes, accolades, `\`, ni
 *  `node -e "…execFileSync('node', [...])"`). Actif seulement quand le lanceur trouve HOLARCH_INSTANCE dans son propre
 *  environnement, c.-à-d. lancé depuis la session d'une instance ; ses appelants internes (detachLaunch, donc
 *  wakeWaiters et --reprendre, et le guetteur de jobs.js) la retirent de l'environnement qu'ils passent
 *  (`envSansInstance`). `spawn-guard` reste la première ligne, celle qui explique avant l'appel.
 *  Renvoie le motif du refus, ou '' si l'invocation est permise. */
function refusInstance(root, instance, o) {
  const inst = String(instance || '').replace(/^mission\//, '').replace(/\/+$/, '');
  const norm = (c) => String(c || '').replace(/^mission\//, '').replace(/\/+$/, '');
  if (o.bootstrap) return "--bootstrap : le bootstrap se lance une seule fois, par l'utilisateur";
  const reserves = [['reveil', '--reveil'], ['arret', '--arret'], ['immediat', '--immediat'], ['reprendre', '--reprendre'],
    ['forcer', '--forcer'], ['pour', '--pour'], ['declencheur', '--declencheur']];
  for (const [cle, opt] of reserves) if (o[cle]) return `${opt} est réservé au harnais et à l'utilisateur`;
  if ((o.addDir || []).length) return "--add-dir est réservé à l'utilisateur";
  // --dry-run et --taches ne lancent rien : forme seulement, comme spawn-guard. --controle et --nettoyer-worktree
  // agissent même avec --dry-run : leur cible est contrôlée.
  const cibles = [o.controle, o.nettoyerWorktree].filter(Boolean).map(norm);
  if (o.chemin && !o.dryRun) cibles.push(o.chemin);
  for (const c of cibles) {
    if (!c.startsWith(`${inst}/`) || c.slice(inst.length + 1).includes('/') || c === `${inst}/`) {
      return `tu ne peux agir que sur tes propres enfants directs (\`${inst}/<nom>\`) — cible demandée : \`${c}\` (KERNEL §4)`;
    }
  }
  if (!o.chemin || o.dryRun) return '';
  const params = resolveParams(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md'))));
  const pmax = Number(params.profondeur_max);
  if (pmax > 0 && o.chemin.split('/').length > pmax) return `profondeur ${o.chemin.split('/').length} > profondeur_max ${pmax} (module max-depth)`;
  if (o.budget !== '' && o.budget !== undefined) {
    const bs = require('./budget-session');
    const usd = bs.lireNombre(o.budget);
    const plafond = bs.plafondEffectif(params);
    if (!(usd > 0)) return `--budget-usd illisible (« ${o.budget} ») : un nombre positif attendu (§18.2)`;
    if (usd > plafond) return `--budget-usd ${usd} USD > plafond budget_usd_session_max (${plafond} USD, §18.2) : au-delà, geste du mainteneur seul`;
  }
  return '';
}

/** Vrai si le lanceur agit sur le dépôt de la session qui l'a lancé (HOLARCH_ROOT, son worktree ou l'arbre principal :
 *  même répertoire Git commun). Un banc de test lancé depuis une session vise une racine jetable, autre dépôt : ses
 *  lanceurs sont ceux du mainteneur simulé, pas des gestes de l'instance — sans ce filtre, `npm test` lancé par une
 *  instance rougissait de quatorze tests (--controle, --nettoyer-worktree, permis.js, T-C4.2). HOLARCH_ROOT absent :
 *  vrai (prudence). */
function memeDepotQueSession(root, rootSession) {
  if (!rootSession) return true;
  const commun = (d) => {
    const r = spawnSync('git', ['-C', d, 'rev-parse', '--git-common-dir'], { encoding: 'utf8' });
    const brut = r.status === 0 ? path.resolve(d, r.stdout.trim()) : d;
    try { return fs.realpathSync(brut); } catch (_) { return path.resolve(brut); }
  };
  return commun(root) === commun(rootSession);
}

/** Environnement d'un lanceur relancé par le harnais lui-même (tâche détachée, réveil, reprise) : sans
 *  HOLARCH_INSTANCE, que le processus courant a pu hériter de la session qui l'a lancé — sinon le relancé se
 *  croirait appelé par cette instance et `refusInstance` refuserait un réveil légitime (troisième revue n° 77). */
function envSansInstance(extra) {
  const env = Object.assign({}, process.env, extra || {});
  delete env.HOLARCH_INSTANCE;
  return env;
}

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n${usage()}\n`); process.exit(1); }
  if (o.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  if (o.checkEnv) {
    const r = verifierEnv();
    for (const l of r.lignes) process.stdout.write(`${l}\n`);
    process.stdout.write(r.ok ? '\nprérequis d\'Étape 0 réunis.\n' : '\nprérequis manquants — régler avant un lancement réel (framework/BOOTSTRAP.md Étape 0).\n');
    process.exit(r.ok ? 0 : 1);
  }
  const root = o.root ? path.resolve(o.root) : findRoot(process.cwd());
  if (!root) { process.stderr.write('Racine introuvable : lance depuis un dépôt contenant framework/KERNEL.md et mission/ (ou --root).\n'); process.exit(1); }
  // Troisième revue n° 77, 78 : lancé depuis la session d'une instance, le lanceur applique lui-même les refus de
  // spawn-guard sur ses options parsées, avant toute action (--reprendre, --arret, --reveil, lancement), sur le dépôt
  // de cette session (worktree ou arbre principal).
  if (process.env.HOLARCH_INSTANCE && memeDepotQueSession(root, process.env.HOLARCH_ROOT)) {
    const motif = refusInstance(root, process.env.HOLARCH_INSTANCE, o);
    if (motif) {
      process.stderr.write(`HOLARCH ▸ refus du lanceur (instance ${process.env.HOLARCH_INSTANCE}) : ${motif}.\n`);
      process.exit(1);
    }
  }

  if (o.reprendre) {
    const r = reprendreTaches(root);
    for (const l of r.lignes) process.stdout.write(`${l}\n`);
    if (!r.lignes.length) process.stdout.write('aucune tâche à reprendre.\n');
    return;
  }
  if (o.taches) {
    const taches = listTaches(root);
    if (!taches.length) process.stdout.write('aucune tâche détachée.\n');
    for (const t of taches) process.stdout.write(`${t.id} · ${t.chemin} · ${t.state} · pid ${t.pid}${t.exitCode !== undefined ? ` · exit ${t.exitCode}` : ''}\n`);
    return;
  }
  if (o.arret) {
    const chemin = o.arret.replace(/^mission\//, '').replace(/\/+$/, '');
    const r = demanderArret(root, chemin, { immediat: !!o.immediat });
    process.stdout.write(`HOLARCH ▸ ${chemin} ▸ ${r.message}\n`);
    return;
  }
  if (o.controle) {
    const chemin = o.controle.replace(/^mission\//, '').replace(/\/+$/, '');
    const r = controle(root, chemin);
    if (r.fichier) process.stdout.write(`HOLARCH ▸ ${chemin} ▸ contrôle écrit : ${path.relative(root, r.fichier)}\n`);
    process.exit(r.code);
  }
  if (o.nettoyerWorktree) {
    const chemin = o.nettoyerWorktree.replace(/^mission\//, '').replace(/\/+$/, '');
    const res = removeWorktree(root, chemin, { forcer: !!o.forcer });
    if (res.removed) { process.stdout.write(`HOLARCH ▸ ${chemin} ▸ worktree supprimé${res.patch ? ` (patch écrit : ${res.patch})` : ''}\n`); }
    else { process.stderr.write(`HOLARCH ▸ ${chemin} ▸ worktree non supprimé (${res.reason})\n`); process.exit(1); }
    return;
  }
  if (o.reveil) {
    const now = new Date();
    const readStatus = (chemin) => readStatusOf(root, chemin);
    const readInbox = (chemin) => readInboxOf(root, chemin) || '';
    const waiters = reveil.listWaiters(root);
    if (o.dryRun) {
      if (!waiters.length) process.stdout.write('aucune instance en attente (ligne Réveil non vide).\n');
      for (const w of waiters) {
        const sinceIso = lastStatusCommitIso(root, w.chemin);
        const evalRes = reveil.evalReveil(w.ast, { root, chemin: w.chemin, sinceIso, now, readStatus, readInbox, gitBranches: gitBranchesCtx(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md')))) });
        process.stdout.write(`${w.chemin} · ${reveil.formatReveil(w.ast)} · ${evalRes.satisfied ? 'satisfaite' : 'non satisfaite'}${isLive(root, w.chemin) ? ' · live' : ''}\n`);
        for (const d of evalRes.details) process.stdout.write(`  - ${d.terme} : ${d.vrai ? 'vrai' : 'faux'} (${d.pourquoi})\n`);
      }
      return;
    }
    const pourNormalise = (o.pour || '').replace(/^mission\//, '').replace(/\/+$/, '');
    const reveilles = wakeWaiters(root, o.declencheur || '--reveil', pourNormalise);
    // Seconde revue n° 52 : code 3 = propriétaire occupé (session, attente 429 ou tâche détachée vivante) — le guetteur
    // de jobs.js se ré-arme et relance `--reveil --pour` une fois le lanceur sorti, au lieu de s'éteindre sans réveil.
    if (pourNormalise && !reveilles.length && reveilles.occupes && reveilles.occupes.includes(pourNormalise)) {
      process.stdout.write(`HOLARCH ▸ ${pourNormalise} ▸ occupée (lanceur vivant) : réveil différé\n`);
      process.exitCode = 3;
      return;
    }
    if (!reveilles.length) process.stdout.write('aucun réveil déclenché.\n');
    for (const r of reveilles) process.stdout.write(`HOLARCH ▸ ${r.chemin} ▸ réveillée · tâche ${r.tache} · condition ${r.condition}\n`);
    return;
  }

  if (!o.chemin) { process.stdout.write(`${usage()}\n`); process.exit(1); }

  // 1.19.4 : jamais deux lanceurs pour la même instance — même entre deux sessions d'une ré-incarnation.
  // Pas pour un lanceur déjà détaché (HOLARCH_TASK_ID) : son verrou live/ et sa fiche « running » sont les siens, écrits par
  // detachLaunch avant son démarrage — le contrôle vaut pour la main qui lance, pas pour le processus lancé.
  let deja = (o.dryRun || o.forcer || tacheDetachee(o.chemin)) ? null : (isLive(root, o.chemin) ? { id: 'verrou live/', pid: '?' } : tacheVivantePour(root, o.chemin));
  // Troisième revue n° 74 : le processus qui jouera les sessions (synchrone ou détaché) prend le verrou live/ dès son
  // démarrage et le garde jusqu'à sa sortie (runOnce, finishLaunch) — plus de fenêtre au démarrage, ni entre deux
  // sessions ou pendant une attente 429, où un --reveil lançait un second lanceur. Pris par un autre : refus.
  if (!deja && !o.dryRun && !o.detach && !o.forcer && !tenirInstance(root, o.chemin)) {
    const v = lireVerrouLive(root, o.chemin) || {};
    deja = { id: v.reveil || v.reprise || 'verrou live/', pid: v.pid || '?' };
    if (tacheDetachee(o.chemin)) {
      process.stderr.write(`HOLARCH ▸ ${o.chemin} ▸ refus : instance déjà lancée (tâche ${deja.id}, pid ${deja.pid} vivant) — lanceur détaché sans session, tâche close\n`);
      finishLaunch(root, o.chemin, 1, []);
      process.exit(1);
    }
  }
  if (deja) {
    process.stderr.write(`HOLARCH ▸ ${o.chemin} ▸ refus : instance déjà lancée (tâche ${deja.id}, pid ${deja.pid} vivant) — \`--arret ${o.chemin}\` d'abord, ou \`--forcer\` en connaissance de cause\n`);
    process.exit(1);
  }
  if (o.detach && !o.dryRun) {
    const { id, pid } = detachLaunch(root, o.chemin, { args: argsRelance(o) });
    process.stdout.write(`HOLARCH ▸ ${o.chemin} ▸ détaché · tâche ${id} (pid ${pid})\n`);
    return;
  }

  let launch;
  try { launch = prepareLaunch(root, o.chemin, o); } catch (e) {
    process.stderr.write(`holarch-spawn : ${e.message}\n`);
    // Revue n° 6 : un lanceur détaché (--detach ou réveil) refusé par prepareLaunch (budget de fiche au-delà du plafond,
    // fiche illisible) ne laisse ni tâche « running » au pid mort, ni parent sans nouvelles : ALERT au parent, tâche
    // close `failed` par finishLaunch (qui réveille le parent sur message:ALERT).
    // Seconde revue n° 59 : seulement le lanceur de CETTE tâche (tacheDetachee), jamais une variable héritée.
    if (tacheDetachee(o.chemin) && !o.dryRun) {
      const texte = String(e.message || e).slice(0, 300);
      const alerte = appendAlertToParent(root, o.chemin, `**Enfant \`${o.chemin}\` non lancé** : lancement détaché refusé par le lanceur (« ${texte} »). Corrige la cause (fiche registre, CONFIG.md), puis relance-le (\`node framework/bin/holarch-spawn.js ${o.chemin} --detach\`), recadre-le (\`TASK\`) ou passe-le \`FAILED\`.`);
      if (alerte) process.stderr.write(`HOLARCH ▸ ${o.chemin} ▸ lancement détaché refusé — ALERT ${alerte} au parent\n`);
      finishLaunch(root, o.chemin, 1, []);
    } else if (relacherInstance(root, o.chemin)) reprendreReveilDiffere(root, o.chemin); // troisième revue n° 74
    process.exit(1);
  }

  if (o.detach && o.dryRun) {
    process.stdout.write(`HOLARCH ▸ ${launch.chemin} ▸ détaché (dry-run) · lancerait : node ${__filename} ${launch.chemin} (HOLARCH_TASK_ID=<id>)\n`);
    return;
  }

  if (o.dryRun) {
    if (o.timeoutMin > 0) launch.timeoutMs = o.timeoutMin * 60 * 1000;
    const apercu = apercuCommande(launch);
    process.stdout.write([
      `racine        : ${root}`,
      `instance      : ${launch.chemin}${launch.bootstrap ? ' (bootstrap)' : ''} · profil ${launch.meta.profil} · profondeur ${launch.meta.depth}`,
      `modèle/effort : ${launch.meta.modele} / ${launch.meta.effort} (effort : ${launch.meta.origine_effort})${launch.params.modele_repli ? ` (repli ${launch.params.modele_repli})` : ''}`,
      `fusibles      : ${launch.maxTours} tours · ${launch.budget} USD · contexte ${launch.params.seuil_contexte_tokens} tokens (autocompact ${launch.params.autocompact_tokens}) · relances sans progrès ${launch.params.relances_max} · sessions/instance ${launch.params.sessions_max_par_instance} · changements de régime ${launch.params.changements_regime_max}`,
      `prompt système: ${launch.systemPrompt.length} caractères (KERNEL + CONFIG + ${launch.cfg.modules.length} modules${launch.bootstrap ? ' + BOOTSTRAP + MANIFEST' : ''})`,
      `prompt        : ${launch.prompt.length} caractères (transmis par stdin, pas en argument — voir D41)`,
      `blocs         : ${launch.blocs.map((b) => `${b.nom} ${b.chars}${b.note ? ` (${b.note})` : ''}`).join(' · ')}`,
      `blocs système : ${(() => { const p = pesageSystemPrompt(); const total = p.reduce((s, b) => s + b.chars, 0) || 1; return p.slice().sort((a, b) => b.chars - a.chars).slice(0, 6).map((b) => `${b.nom} ${b.chars} (${Math.round(100 * b.chars / total)} %)`).join(' · '); })()} — les plus lourds, relus à chaque tour`,
      `exécuteur     : ${apercu.executeur}${launch.fournisseur && launch.fournisseur.nom ? ` · fournisseur ${launch.fournisseur.nom}` : ''}`,
      `commande      : ${apercu.bin} ${apercu.args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `'${a}'` : a)).join(' ')} < <prompt sur stdin>`,
      '',
    ].join('\n'));
    // Chantier 16, §18.1 (docs/IMPLEMENTATION.md) : sans tarif résolu au catalogue pour ce modèle, et
    // hors de l'exécuteur claude-code (seul à produire un rappel « USD budget » dans sa transcription),
    // budget-watch ne peut jamais s'activer — le dry-run le dit, comme pour tout autre fusible inerte.
    const tarifResolu = !!(launch.meta.tarif && typeof launch.meta.tarif.cout_entree === 'number' && typeof launch.meta.tarif.cout_sortie === 'number');
    if (!tarifResolu && apercu.executeur !== 'claude-code') {
      process.stdout.write('budget-watch inerte : ni rappel CLI ni tarif\n');
    }
    if (o.json) process.stdout.write(`${JSON.stringify({ root, chemin: launch.chemin, meta: launch.meta, params: launch.params, executeur: apercu.executeur, bin: apercu.bin, args: apercu.args }, null, 2)}\n`);
    // Chantier 15, §16.4 : au dry-run d'une racine (bootstrap, ou chemin sans '/'), répète l'avertissement
    // de brief incomplet que le hook session-start donnera au réveil réel — visible avant tout lancement.
    if (launch.bootstrap || !launch.chemin.includes('/')) {
      const holarchHooks = require('../hooks/holarch-hooks');
      const b = holarchHooks.briefIncomplet(root);
      if (b) process.stderr.write(`HOLARCH ▸ ${launch.chemin} ▸ ${b} (mission/OBJECTIVE.md, §16.4)\n`);
    }
    return;
  }
  const sessions = launchWithRelaunches(root, o.chemin, o);
  const { text, code } = summarize(sessions[sessions.length - 1].launch, sessions);
  process.stdout.write(`${text}\n`);
  if (o.json) process.stdout.write(`${JSON.stringify(sessions.map((s) => ({ session_id: s.res && s.res.session_id, cost: s.res && s.res.cout_usd, turns: s.res && s.res.tours, sous_type: s.res && s.res.sous_type, fin: s.res && s.res.fin, executeur: s.executeur, status: s.status })), null, 2)}\n`);
  finishLaunch(root, o.chemin, code, sessions);
  process.exit(code);
}

module.exports = {
  fournisseursSansVariables, modeleSousAgent, argsRelance,
  parseConfig, parseFiche, parseStatus, resolveParams, resolveProfile, resolveMetaFromDisk,
  buildSystemPrompt, buildUserPrompt, prepareLaunch, parseResultJson, appendSessionLine, summarize, buildAgentsOption, extraireEnTeteEtReglesInjectees, elaguerSectionsLanceur,
  executeurs, executeurDe, apercuCommande, runOnce,
  catalogue, enrichirMeta, fournisseurPour,
  findRoot, launchWithRelaunches, DEFAULTS, DEFAULT_POLICY, tailInboxMessages, INBOX_TAIL_MESSAGES,
  buildUserPromptDetail, tailBounded, tailInboxBounded, moduleActive, parseUniteHeader,
  buildMemoryIndex, lastHibernationCommit, selectInboxMessages, describeWakeReason, readInboxOf, annoterOrigines,
  isLive, tacheVivantePour, pesageSystemPrompt, demanderArret, descendants, wakeWaiters, detachLaunch, finishLaunch, reprendreTaches, coutCumule, countSessions, commitJournalLanceur, lastStatusCommitIso, stopPath, liveLockPath, readStatusOf, gitBranchesCtx, limiteApi,
  verifierSession: gardeGit.verifierSession, verifierApresSession, shaInstance,
  progressSnapshot, hasProgressed, countSessions, appendAlertToParent,
  worktreeDir, hasWorktree, instanceRoot, instancePath, resolveWorkspace, removeWorktree, writeGraveyardPatch, relayInboxFromParent,
  ensureSessionsFile, lastContexteDepart, contexteLivePath,
  verifierEnv,
  argsDerniereTache,
  controle, resolveSourceControle,
};

if (require.main === module) main();
