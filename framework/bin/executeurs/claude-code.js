'use strict';
/**
 * Exécuteur `claude-code` — le CLI Claude Code, exécuteur historique et par défaut de HOLARCH.
 *
 * Chantier 9, volet 1 (`docs/IMPLEMENTATION.md` §11.1) : tout ce qui est propre à ce CLI — noms
 * d'arguments, nom du binaire, champs du JSON de résultat, motif de la limite 429 — vit dans ce
 * fichier et nulle part ailleurs. Le lanceur (`bin/holarch-spawn.js`) ne connaît que le contrat
 * `{ nom, capacites, preparer, executer, normaliser, limite }` décrit dans `executeurs/index.js`.
 *
 * Comportement strictement identique à celui du lanceur d'avant extraction (holarch-spawn.js
 * 1.13.x, lignes 863-908, 914-921, 975-1008, 1215-1235).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const nom = 'claude-code';

const capacites = {
  sous_agents: true,           // option `--agents` (module delegation-intra-session)
  hooks: true,                 // fichier `--settings` et ses hooks (context-watch, framework-guard)
  prompt_systeme_fichier: true, // `--append-system-prompt-file`
  transcription: true,          // transcript lisible par les hooks (mesure de contexte)
};

// ---------------------------------------------------------------------------
// preparer : intention de session → invocation concrète
// ---------------------------------------------------------------------------

/** Arguments du CLI. `sysFile` est le fichier temporaire de prompt système créé par `preparer`
 *  (la sentinelle `<SYSTEM_PROMPT_FILE>` de `runOnce` n'existe plus : elle n'a plus de raison d'être).
 *  `modele` est passé à part pour que `passerelle` puisse y substituer le modèle réel du catalogue. */
function construireArgs(launch, params, sysFile, modele) {
  const meta = launch.meta || {};
  const denied = launch.denied || [];
  // `-p` sans valeur : le prompt est transmis par stdin (`Prep.stdin`), pas comme argument de ligne
  // de commande. Motif D41 (2026-09-09) : Linux limite un argument individuel de execve() à
  // MAX_ARG_STRLEN (128 Ko) — un prompt utilisateur qui grossit avec la mission finit par la
  // dépasser et le lancement échoue en E2BIG, silencieusement. stdin n'a pas cette limite.
  const args = [
    '-p',
    '--model', modele || meta.modele,
    '--effort', meta.effort,
    '--permission-mode', launch.permissionMode,
    '--output-format', 'json',
    '--max-turns', String(launch.maxTours),
    '--max-budget-usd', String(launch.budget),
    '--append-system-prompt-file', sysFile,
    '--exclude-dynamic-system-prompt-sections',
    // Le fichier de réglages (permissions, hooks) est au format `settings.json` de Claude Code :
    // son chemin appartient donc à cet exécuteur, pas à l'intention de session.
    '--settings', path.join(launch.root, 'framework', 'claude', 'instance-settings.json'),
    '--tools', params.outils_cli,
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--autocompact', String(params.autocompact_tokens),
    '--disallowedTools', denied.join(','),
    '-n', `holarch:${launch.chemin}`,
  ];
  if (params.modele_repli) args.push('--fallback-model', params.modele_repli);
  // `launch.agents` : JSON de l'option `--agents`, calculé par le lanceur (module
  // delegation-intra-session actif) et déjà filtré par `capacites.sous_agents`.
  if (launch.agents) {
    args.push('--agents', typeof launch.agents === 'string' ? launch.agents : JSON.stringify(launch.agents));
  }
  for (const d of launch.addDirs || []) args.push('--add-dir', d);
  return args;
}

/** Écrit le prompt système dans un répertoire temporaire du système (jamais sous `mission/`) et
 *  retourne `{ sysFile, nettoyer }` — `nettoyer` est appelé par le lanceur dans un `finally`. */
function fichierPromptSysteme(systemPrompt) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-spawn-'));
  const sysFile = path.join(tmp, 'system-prompt.md');
  fs.writeFileSync(sysFile, systemPrompt || '');
  return { sysFile, nettoyer: () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* ignore */ } } };
}

function preparer(launch, params) {
  params = params || launch.params || {};
  const { sysFile, nettoyer } = fichierPromptSysteme(launch.systemPrompt);
  return {
    bin: 'claude',
    args: construireArgs(launch, params, sysFile),
    env: Object.assign({}, launch.env || process.env),
    cwd: launch.cwd,
    stdin: launch.prompt || '',
    nettoyer,
  };
}

// ---------------------------------------------------------------------------
// executer : lance et collecte, sans rien interpréter
// ---------------------------------------------------------------------------
function executer(prep, opts) {
  opts = opts || {};
  const t0 = Date.now();
  const r = spawnSync(prep.bin, prep.args, {
    cwd: prep.cwd,
    env: prep.env,
    encoding: 'utf8',
    input: prep.stdin,
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
    timeout: opts.timeoutMs || undefined,
    killSignal: 'SIGTERM',
  });
  return {
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    exitCode: r.status,
    signal: r.signal,
    error: r.error,
    elapsedMs: Date.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// normaliser : sortie du CLI → Resultat commun
// ---------------------------------------------------------------------------

/** Première ligne JSON de la sortie portant `type: "result"` (format `--output-format json`). */
function parseResultJson(stdout) {
  for (const line of String(stdout || '').split('\n')) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try { const d = JSON.parse(t); if (d && d.type === 'result') return d; } catch (_) { /* ligne suivante */ }
  }
  return null;
}

function texteBorne(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

/** Resultat « vide » : tous les champs de la forme commune sont toujours présents. */
function resultatVide(texte) {
  return {
    session_id: null,
    tours: null,
    cout_usd: null,
    tokens: { entree: null, cache_lu: null, cache_ecrit: null, sortie: null },
    modeles: [],
    fin: 'sans_resultat',
    sous_type: null,
    refus: 0,
    statut_http: null,
    texte: texteBorne(texte),
    brut: null,
  };
}

/** Objet de résultat du CLI → Resultat. Exporté hors contrat : le lanceur s'en sert pour sa
 *  compatibilité ascendante (`limiteApi(res)`), et les tests pour normaliser une fixture. */
function normaliserRes(res) {
  if (!res) return resultatVide('');
  const u = res.usage || {};
  // Modèles haiku filtrés : bruit d'appels internes du CLI, jamais le modèle de la session.
  const modeles = res.modelUsage
    ? Object.entries(res.modelUsage)
      .filter(([m]) => !/haiku/i.test(m))
      .map(([id, mu]) => ({ id, cout_usd: mu && typeof mu.costUSD === 'number' ? mu.costUSD : null }))
    : [];
  const statutHttp = res.api_error_status === undefined || res.api_error_status === null
    ? null
    : Number(res.api_error_status);
  let fin = 'success';
  if (res.is_error && statutHttp === 429) fin = 'limite';
  else if (res.is_error) fin = 'erreur';
  return {
    session_id: res.session_id || null,
    tours: typeof res.num_turns === 'number' ? res.num_turns : null,
    cout_usd: typeof res.total_cost_usd === 'number' ? res.total_cost_usd : null,
    tokens: {
      entree: u.input_tokens ?? null,
      cache_lu: u.cache_read_input_tokens ?? null,
      cache_ecrit: u.cache_creation_input_tokens ?? null,
      sortie: u.output_tokens ?? null,
    },
    modeles,
    fin,
    sous_type: res.subtype || null,
    refus: Array.isArray(res.permission_denials) ? res.permission_denials.length : 0,
    statut_http: statutHttp,
    texte: texteBorne(res.result || res.error || ''),
    brut: res,
  };
}

function normaliser(brut) {
  const res = parseResultJson(brut && brut.stdout);
  if (!res) return resultatVide((brut && brut.error && brut.error.message) || '');
  return normaliserRes(res);
}

// ---------------------------------------------------------------------------
// limite : reconnaissance d'une limite de forfait
// ---------------------------------------------------------------------------

/** Limite de sessions de l'API (forfait : `api_error_status: 429`, « You've hit your session limit ·
 *  resets H:MMam (UTC) »). La session n'a pas eu lieu : ni progrès, ni absence de progrès.
 *  Retourne null si ce n'est pas ce cas ; sinon `{texte, repriseIso, attenteMs}` — `attenteMs` =
 *  délai jusqu'à l'heure de remise à zéro annoncée + 60 s, null si elle est illisible ou à plus de
 *  6 h. L'override de test `HOLARCH_ATTENTE_429_MS` est appliqué par le lanceur au retour de cette
 *  fonction (commodité du harnais HOLARCH, valable pour tous les exécuteurs, pas une propriété du
 *  fournisseur). Mission holarch-provenance, 2026-09-10 : trois 429 d'affilée comptés comme
 *  « 3 sessions sans progrès » — enfant arrêté à tort. */
function limite(resultat) {
  if (!resultat || resultat.fin !== 'limite') return null;
  const texte = texteBorne(resultat.texte);
  let attenteMs = null;
  let repriseIso = '?';
  const m = texte.match(/resets?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (m) {
    let h = Number(m[1]);
    const mn = Number(m[2] || 0);
    const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    const now = new Date();
    const cible = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, mn, 0));
    if (cible.getTime() <= now.getTime()) cible.setUTCDate(cible.getUTCDate() + 1);
    const ms = cible.getTime() - now.getTime() + 60000;
    if (ms <= 6 * 3600 * 1000) { attenteMs = ms; repriseIso = cible.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  }
  return { texte, repriseIso, attenteMs };
}

module.exports = {
  nom, capacites, preparer, executer, normaliser, limite,
  // hors contrat, réutilisés par `fake`, `passerelle`, le lanceur et les tests :
  construireArgs, fichierPromptSysteme, parseResultJson, normaliserRes, resultatVide, texteBorne,
};
