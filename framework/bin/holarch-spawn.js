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
  max_tours_par_session: '200',
  seuil_contexte_tokens: '240000', // 1.13.0 : p90 198 602 mesuré sur holarch-outillage (docs/diagnostics/2026-09-11-seuil-contexte-240k.md)
  autocompact_tokens: '400000',
  outils_cli: 'Read,Write,Edit,Bash,Glob,Grep,Agent,TodoWrite',
  relances_max: '2',
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
/** `--nettoyer-worktree <chemin>` : git worktree remove (refuse si des changements non committés subsistent). */
function removeWorktree(root, chemin) {
  const dir = worktreeDir(root, chemin);
  if (!fs.existsSync(dir)) return { removed: false, reason: 'absent' };
  const status = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' });
  if (status.status === 0 && status.stdout.trim()) return { removed: false, reason: 'changements non committés' };
  const rm = spawnSync('git', ['worktree', 'remove', dir], { cwd: root, encoding: 'utf8' });
  if (rm.status !== 0) return { removed: false, reason: (rm.stderr || '').trim() || 'échec git worktree remove' };
  return { removed: true };
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
  return Object.assign({}, DEFAULTS, cfg.params || {});
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
  meta.tarif = entree || null;
  // Marque portée par la session de repli (volet 3) jusqu'à la colonne « Fin » de SESSIONS.md.
  meta.repli_depuis = (opts && opts.repliDepuis) || null;
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
  const pushReduit = (rel) => {
    const c = readIf(path.join(root, rel));
    parts.push(c === null ? `<fichier chemin="${rel}" note="INTROUVABLE sur disque"></fichier>` : fileBlock(rel, extraireEnTeteEtReglesInjectees(c), 'en-tête + Règles injectées seulement — texte complet sur disque, chantier 7 §9.2'));
  };
  const pushConfig = () => {
    const rel = 'framework/CONFIG.md';
    const c = readIf(path.join(root, rel));
    if (c === null) { parts.push(`<fichier chemin="${rel}" note="INTROUVABLE sur disque"></fichier>`); return; }
    const reduit = elaguerSectionsLanceur(c);
    parts.push(reduit === c
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
  if (pe) parts.push(pe);
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
  if (!bootstrap) {
    const base = path.join(workspace.cwd, 'mission', chemin);
    for (const name of ['ROLE.md', 'STATUS.md']) {
      if (!fs.existsSync(path.join(base, name))) throw new Error(`instance ${chemin} : ${name} introuvable (mécanique de spawn KERNEL §9 non faite ?)`);
    }
  }
  const permissionMode = opts.permissionMode || params.permission_mode;
  if (!VALID_PERMISSION_MODES.includes(permissionMode)) throw new Error(`permission_mode invalide « ${permissionMode} »`);
  const budget = opts.budget || params.budget_usd_par_session;
  const maxTours = opts.maxTours || params.max_tours_par_session;
  const systemPrompt = buildSystemPrompt(root, cfg, bootstrap);
  const detail = buildUserPromptDetail(root, chemin, meta, Object.assign({}, params, { budget_usd_par_session: budget, max_tours_par_session: maxTours }), bootstrap, cfg, { dryRun: !!opts.dryRun });
  const prompt = detail.prompt;
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
  // Exécuteur de ce lancement (chantier 9, volet 1) : la traduction de cette intention en invocation
  // concrète — binaire, arguments, fichier temporaire de prompt système — lui appartient entièrement.
  // Le lanceur n'assemble plus aucune ligne de commande. `fournisseur` vient du catalogue (volet 2)
  // quand l'instance en a un, sinon null.
  const fournisseur = opts.fournisseur || fournisseurPour(cat, meta, process.env);
  if (fournisseur && fournisseur.url_var && !fournisseur.url) {
    process.stderr.write(`HOLARCH ▸ ${chemin} ▸ fournisseur « ${fournisseur.nom} » : variable ${fournisseur.url_var} absente de l'environnement — l'exécuteur partira sur son URL par défaut\n`);
  }
  const executeur = executeurs.resoudre(opts.executeur || executeurs.nomPour({ env: process.env, fournisseur, params }));
  // Sous-agents (module delegation-intra-session) : l'option n'est construite que si l'exécuteur sait
  // les porter — un exécuteur sans cette capacité dégrade proprement au lieu de recevoir une option
  // qu'il ignore.
  const agents = moduleActive(cfg, 'extensions', 'delegation-intra-session') && executeur.capacites.sous_agents
    ? buildAgentsOption(root, params)
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
    HOLARCH_COMMIT: params.commit_par_session,
    HOLARCH_BOOTSTRAP: bootstrap ? '1' : '0',
    // Taille de registry/PROGRESS.md avant ce lancement : baseline de wake-guard (garde-fou ON_ORIENT). Calculée dans
    // le worktree de l'instance (workspace.cwd) : c'est ce fichier-là, relatif à HOLARCH_ROOT, que le hook mesurera
    // pendant la session — cf. holarch-hooks.js, wakeGuard. Calculée ici, pas au premier appel du hook côté session,
    // pour ne pas rater une ligne ON_ORIENT écrite avant toute écriture hors de l'arbre propre de l'instance.
    HOLARCH_PROGRESS_BASELINE: String((readIf(path.join(workspace.cwd, 'mission', 'registry', 'PROGRESS.md')) || '').length),
  });
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

function appendSessionLine(root, missionName, chemin, meta, res, elapsedMs, status, promptChars) {
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
  let cost = '?';
  if (res && typeof res.cout_usd === 'number') cost = res.cout_usd.toFixed(4);
  else {
    const estime = catalogue.coutEstime(meta && meta.tarif, res && res.tokens);
    if (estime !== null && estime !== undefined) cost = `≈ ${estime.toFixed(4)}`;
  }
  const fournisseur = meta && meta.fournisseur ? `${meta.fournisseur} / ${meta.modele_reel || meta.modele}` : '—';
  const fin = [
    !res || res.fin === 'sans_resultat'
      ? 'sans résultat JSON'
      : `${res.sous_type || '?'}${res.fin === 'erreur' || res.fin === 'limite' ? ' (erreur)' : ''}${res.refus ? ` · ${res.refus} refus` : ''}`,
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
  fs.writeFileSync(liveLockPath(launch.root, launch.chemin), JSON.stringify({ pid: process.pid, startedAt: nowIso(), attempt }));
  let brut;
  try {
    brut = executeur.executer(prep, { timeoutMs: launch.timeoutMs || undefined });
  } finally {
    try { fs.unlinkSync(liveLockPath(launch.root, launch.chemin)); } catch (_) { /* ignore */ }
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

function wakeWaiters(root, declencheur) {
  const waiters = reveil.listWaiters(root);
  const gitBranches = gitBranchesCtx(parseConfig(readIf(path.join(root, 'framework', 'CONFIG.md'))));
  const reveilles = [];
  const now = new Date();
  const readStatus = (chemin) => readStatusOf(root, chemin);
  const readInbox = (chemin) => readInboxOf(root, chemin) || '';
  for (const w of waiters) {
    if (w.chemin === declencheur) continue;
    if (!['WAITING_CHILDREN', 'BLOCKED', 'READY'].includes(w.etat)) continue;
    if (isLive(root, w.chemin)) continue;
    const sinceIso = lastStatusCommitIso(root, w.chemin);
    const evalRes = reveil.evalReveil(w.ast, { root, chemin: w.chemin, sinceIso, now, readStatus, readInbox, gitBranches });
    if (!evalRes.satisfied) continue;
    const condition = reveil.formatReveil(w.ast);
    const { id, pid } = detachLaunch(root, w.chemin, {});
    // Verrou de vivacité posé tout de suite au nom du réveillé (pid du lanceur détaché, qui le réécrira au démarrage
    // de sa session) : sans lui, une seconde évaluation dans les millisecondes qui suivent — wakeWaiters après la
    // dernière session d'un enfant, puis finishLaunch — relançait la même instance deux fois (deux sessions concurrentes
    // du concepteur, constaté le 2026-09-11 sur holarch-delegation).
    try { fs.mkdirSync(liveDir(root), { recursive: true }); fs.writeFileSync(liveLockPath(root, w.chemin), JSON.stringify({ pid, startedAt: nowIso(), attempt: 0, reveil: id })); } catch (_) { /* fail-open */ }
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
  // Journal du lanceur committé par le lanceur lui-même (racine seulement) : la dernière ligne de SESSIONS.md et de
  // REVEILS.md d'une racine est écrite après son commit de clôture et restait non committée jusqu'à un geste humain
  // (archivages du 2026-09-11). Enfant : la racine, qui répond de mission/, les committe à sa session suivante.
  if (!chemin.includes('/') && !isLive(root, chemin)) commitJournalLanceur(root, chemin);
  return wakeWaiters(root, chemin);
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
  try { ({ ecarts } = gardeGit.verifierSession(root, chemin, avant, apres)); } catch (_) { return { ecarts: [], alerte: null }; }
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
    const tentativeOpts = attempt > 1 ? Object.assign({}, optsCourantes, { bootstrap: false, relance: true }) : optsCourantes;
    const launch = prepareLaunch(root, chemin, tentativeOpts);
    if (opts.timeoutMin > 0) launch.timeoutMs = opts.timeoutMin * 60 * 1000;
    const avant = progressSnapshot(root, chemin);
    const shaAvant = shaInstance(root, chemin, launch.cfg);
    const out = runner(launch, attempt);
    const status = readStatusOf(root, chemin);
    // Garde a posteriori (§11.4) : avant la ligne de session, qui doit porter le `fin = erreur` d'un écart grave.
    const garde = verifierApresSession(root, chemin, shaAvant, shaInstance(root, chemin, launch.cfg), out);
    const line = appendSessionLine(root, launch.cfg.nom, chemin, launch.meta, out.res, out.elapsedMs, status.etat || '(absent)', { systeme: launch.systemPrompt.length, utilisateur: launch.prompt.length });
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
        attendre(limite.attenteMs);
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
  else if ((last.res.fin === 'erreur' || last.res.fin === 'limite') && !(last.arret && last.arret.motif === 'limite-api')) { lines.push(`⚠ fin anormale : ${last.res.sous_type || last.res.fin} — voir ${last.logBase}.result.json`); code = 2; }
  if (isArret) { lines.push('ℹ arrêt propre demandé (--arret) : session terminée sans ré-incarnation.'); }
  else if (last.arret && last.arret.motif === 'limite-api') {
    lines.push(`⚠ limite de sessions de l'API (429 : ${last.arret.texte}) — la session n'a pas eu lieu, STATUS inchangé (${status.etat || '(absent)'}) ; ${last.arret.alerte ? `ALERT ${last.arret.alerte} déposé dans l'INBOX du parent` : 'relancer'} après l'heure de remise à zéro (\`node framework/bin/holarch-spawn.js ${launch.chemin} --detach\`).`);
    code = 3;
  }
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
  const o = { chemin: null, bootstrap: false, dryRun: false, json: false, profil: '', modele: '', effort: '', budget: '', maxTours: '', permissionMode: '', root: '', timeoutMin: 0, addDir: [], detach: false, reveil: false, taches: false, arret: '', nettoyerWorktree: '', reprendre: false };
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
    else if (a === '--budget-usd') o.budget = next();
    else if (a === '--max-tours' || a === '--max-turns') o.maxTours = next();
    else if (a === '--permission-mode') o.permissionMode = next();
    else if (a === '--root') o.root = next();
    else if (a === '--add-dir') o.addDir.push(next());
    else if (a === '--timeout-min') o.timeoutMin = Number(next());
    else if (a === '--detach') o.detach = true;
    else if (a === '--reveil') o.reveil = true;
    else if (a === '--taches') o.taches = true;
    else if (a === '--reprendre') o.reprendre = true;
    else if (a === '--arret') o.arret = next();
    else if (a === '--immediat') o.immediat = true;
    else if (a === '--nettoyer-worktree') o.nettoyerWorktree = next();
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
    '          --detach --reveil --taches --reprendre --arret <chemin> [--immediat] (réveil/arrêt/tâches : voir docs/IMPLEMENTATION.md §3.2-§3.5)',
    '          --nettoyer-worktree <chemin> (supprime le worktree d\'une instance déjà fusionnée ; refuse si des changements non committés subsistent)',
  ].join('\n');
}

function listTaches(root) {
  const dir = tasksDir(root);
  let files;
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { files = []; }
  return files.sort().map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { return null; } }).filter(Boolean);
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
    let vivant = true;
    try { process.kill(t.pid, 0); } catch (_) { vivant = false; }
    if (vivant) continue;
    try {
      t.state = 'failed'; t.finishedAt = nowIso(); t.note = 'lanceur mort, fiche close par --reprendre';
      fs.writeFileSync(path.join(tasksDir(root), `${t.id}.json`), JSON.stringify(t, null, 2));
    } catch (_) { /* fiche illisible : on continue */ }
    const status = readStatusOf(root, t.chemin);
    const arret = /hibernation volontaire \(arrêt demandé\)/i.test(status.note || '');
    const reprenable = status.etat === 'READY' || (status.etat === 'WORKING' && /hibernation volontaire/i.test(status.note || '') && !arret);
    if (!reprenable) { lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — non relancée : STATUS ${status.etat || '(absent)'}${status.note ? ` (${status.note.slice(0, 60)})` : ''}`); continue; }
    if (relancees.includes(t.chemin) || isLive(root, t.chemin)) { lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — déjà vivante, pas de relance`); continue; }
    const { id, pid } = detachLaunch(root, t.chemin, { parent: 'reprise' });
    try { fs.mkdirSync(liveDir(root), { recursive: true }); fs.writeFileSync(liveLockPath(root, t.chemin), JSON.stringify({ pid, startedAt: nowIso(), attempt: 0, reprise: id })); } catch (_) { /* fail-open */ }
    relancees.push(t.chemin);
    lignes.push(`HOLARCH ▸ ${t.chemin} ▸ tâche ${t.id} close (pid ${t.pid} mort) — relancée en détaché : tâche ${id} (pid ${pid})`);
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
  if (!isLive(root, chemin)) return { vivant: false, message: `aucune session vivante pour ${chemin} (verrou périmé nettoyé s'il y en avait un) — rien à arrêter` };
  if (!opts.immediat) {
    const p = writeStopRequest(root, chemin);
    return { vivant: true, mode: 'propre', chemin: p, message: `arrêt demandé (${p}) — la session hiberne à son prochain appel d'outil, ON_SLEEP compris ; --immediat pour tuer la session tout de suite` };
  }
  let pid = null;
  try { pid = JSON.parse(fs.readFileSync(liveLockPath(root, chemin), 'utf8')).pid; } catch (_) { pid = null; }
  writeStopRequest(root, chemin); // au cas où le lanceur survivrait à son enfant : pas de ré-incarnation
  const cibles = descendants(pid).concat([pid]);
  const signaler = (sig) => cibles.filter((p) => { try { process.kill(p, sig); return true; } catch (_) { return false; } });
  const termes = signaler('SIGTERM');
  const fin = Date.now() + (opts.attenteMs || 5000);
  while (Date.now() < fin && cibles.some((p) => { try { process.kill(p, 0); return true; } catch (_) { return false; } })) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  const tues = signaler('SIGKILL');
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

function main() {
  let o;
  try { o = parseArgs(process.argv.slice(2)); } catch (e) { process.stderr.write(`${e.message}\n${usage()}\n`); process.exit(1); }
  if (o.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  const root = o.root ? path.resolve(o.root) : findRoot(process.cwd());
  if (!root) { process.stderr.write('Racine introuvable : lance depuis un dépôt contenant framework/KERNEL.md et mission/ (ou --root).\n'); process.exit(1); }

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
  if (o.nettoyerWorktree) {
    const chemin = o.nettoyerWorktree.replace(/^mission\//, '').replace(/\/+$/, '');
    const res = removeWorktree(root, chemin);
    if (res.removed) { process.stdout.write(`HOLARCH ▸ ${chemin} ▸ worktree supprimé\n`); }
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
    const apercu = apercuCommande(launch);
    process.stdout.write([
      `racine        : ${root}`,
      `instance      : ${launch.chemin}${launch.bootstrap ? ' (bootstrap)' : ''} · profil ${launch.meta.profil} · profondeur ${launch.meta.depth}`,
      `modèle/effort : ${launch.meta.modele} / ${launch.meta.effort} (effort : ${launch.meta.origine_effort})${launch.params.modele_repli ? ` (repli ${launch.params.modele_repli})` : ''}`,
      `fusibles      : ${launch.maxTours} tours · ${launch.budget} USD · contexte ${launch.params.seuil_contexte_tokens} tokens (autocompact ${launch.params.autocompact_tokens}) · relances sans progrès ${launch.params.relances_max} · sessions/instance ${launch.params.sessions_max_par_instance} · changements de régime ${launch.params.changements_regime_max}`,
      `prompt système: ${launch.systemPrompt.length} caractères (KERNEL + CONFIG + ${launch.cfg.modules.length} modules${launch.bootstrap ? ' + BOOTSTRAP + MANIFEST' : ''})`,
      `prompt        : ${launch.prompt.length} caractères (transmis par stdin, pas en argument — voir D41)`,
      `blocs         : ${launch.blocs.map((b) => `${b.nom} ${b.chars}${b.note ? ` (${b.note})` : ''}`).join(' · ')}`,
      `exécuteur     : ${apercu.executeur}${launch.fournisseur && launch.fournisseur.nom ? ` · fournisseur ${launch.fournisseur.nom}` : ''}`,
      `commande      : ${apercu.bin} ${apercu.args.map((a) => (/\s/.test(a) && !a.startsWith('"') ? `'${a}'` : a)).join(' ')} < <prompt sur stdin>`,
      '',
    ].join('\n'));
    if (o.json) process.stdout.write(`${JSON.stringify({ root, chemin: launch.chemin, meta: launch.meta, params: launch.params, executeur: apercu.executeur, bin: apercu.bin, args: apercu.args }, null, 2)}\n`);
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
  parseConfig, parseFiche, parseStatus, resolveParams, resolveProfile, resolveMetaFromDisk,
  buildSystemPrompt, buildUserPrompt, prepareLaunch, parseResultJson, appendSessionLine, summarize, buildAgentsOption, extraireEnTeteEtReglesInjectees, elaguerSectionsLanceur,
  executeurs, executeurDe, apercuCommande, runOnce,
  catalogue, enrichirMeta, fournisseurPour,
  findRoot, launchWithRelaunches, DEFAULTS, DEFAULT_POLICY, tailInboxMessages, INBOX_TAIL_MESSAGES,
  buildUserPromptDetail, tailBounded, tailInboxBounded, moduleActive, parseUniteHeader,
  buildMemoryIndex, lastHibernationCommit, selectInboxMessages, describeWakeReason, readInboxOf, annoterOrigines,
  isLive, demanderArret, descendants, wakeWaiters, detachLaunch, finishLaunch, reprendreTaches, coutCumule, countSessions, commitJournalLanceur, lastStatusCommitIso, stopPath, liveLockPath, readStatusOf, gitBranchesCtx, limiteApi,
  verifierSession: gardeGit.verifierSession, verifierApresSession, shaInstance,
  progressSnapshot, hasProgressed, countSessions, appendAlertToParent,
  worktreeDir, hasWorktree, instanceRoot, instancePath, resolveWorkspace, removeWorktree, relayInboxFromParent,
  ensureSessionsFile, lastContexteDepart, contexteLivePath,
};

if (require.main === module) main();
