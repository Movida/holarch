#!/usr/bin/env node
'use strict';
/**
 * garde.js — garde-fous d'une session de maintenance (hook PreToolUse de .claude/settings.json),
 * symétriques de ceux des instances (framework/hooks/holarch-hooks.js). Ils rendent mécaniques
 * trois règles de docs/ENVIRONNEMENT.md §7 et §8 :
 *   - Bash `git push` : refusé vers `origin` (lecture seule), refusé en force, refusé sans remote
 *     explicite (l'amont de `main` peut pointer `origin`) — `git push holon-v2 <branche>` passe ;
 *   - Bash `git switch` / `checkout` / `reset --hard` / `clean` / `stash` / `worktree remove`
 *     pendant qu'une mission tourne : refusé (une instance écrit dans l'arbre de travail) ;
 *   - Write/Edit dans `mission/<instance>/…` (tout sauf `mission/OBJECTIVE.md`) : demande de
 *     confirmation — le mainteneur ne committe ni n'écrit les fichiers d'une instance (KERNEL §4).
 * Quatrième règle (§8, ajoutée le 2026-09-11 après une édition à l'aveugle) : les sessions concurrentes
 * committent dans le même arbre. HEAD est noté après chaque Bash (PostToolUse) ; avant tout Bash, Write ou
 * Edit, si HEAD a bougé sans passer par cette session, les commits étrangers et les fichiers qu'ils touchent
 * sont injectés en contexte (additionalContext) — jamais bloquant : relire avant d'éditer est la parade.
 * Inerte ({}) dans une session d'instance (HOLARCH_INSTANCE posée : elles ont leurs propres hooks).
 * Fail-open : toute erreur interne laisse l'action se faire.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

function emit(o) { process.stdout.write(JSON.stringify(o)); }
function ok() { emit({}); }
function deny(reason) { emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `[HOLARCH · garde de maintenance] ${reason}` } }); }
function ask(reason) { emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: `[HOLARCH · garde de maintenance] ${reason}` } }); }

/** Processus de mission en cours, d'après une sortie `ps -eo pid,args` (injectable par HOLARCH_GARDE_PS dans les tests). */
function missionEnCours(psText) {
  return String(psText || '').split('\n').some((l) => /holarch-spawn\.js|claude -p\b/.test(l) && !/--replay-user-messages|grep/.test(l));
}

/** Analyse d'une commande Bash : retourne {decision: 'ok'|'deny', reason}. Pure. */
function analyserBash(cmd, ctx) {
  const segments = String(cmd || '').split(/&&|\|\||;|\|/).map((s) => s.trim()).filter(Boolean);
  // 2026-09-12 : un commit enchaîné derrière `npm test | grep …` est parti rouge (le grep masquait le code de sortie).
  // Les tests se lisent dans une commande, le commit vient dans la suivante.
  const lanceTests = segments.some((s) => /^(npm test|npm run test|node --test)\b/.test(s));
  const committe = segments.some((s) => /^git\s+(-C\s+\S+\s+)?commit\b/.test(s));
  if (lanceTests && committe) return { decision: 'deny', reason: 'tests et `git commit` dans la même commande : lance les tests seuls, lis leur code de sortie, puis committe dans une commande séparée (un commit rouge est parti le 2026-09-12 derrière `npm test | grep`)' };
  for (const seg of segments) {
    const tokens = seg.replace(/^(?:\S+=\S*\s+)*/, '').split(/\s+/);
    if (tokens[0] !== 'git') continue;
    const sub = tokens.slice(1).find((t) => !t.startsWith('-')); // première sous-commande (saute -C <dir> ? non : -C prend une valeur)
    const args = tokens.slice(tokens.indexOf(sub) + 1);
    if (sub === 'push') {
      if (args.some((a) => a === '--force' || a === '-f' || a.startsWith('--force-with-lease') || a.startsWith('+'))) return { decision: 'deny', reason: 'push forcé réservé au mainteneur (docs/ENVIRONNEMENT.md §7).' };
      const positionnels = args.filter((a) => !a.startsWith('-'));
      if (positionnels.includes('origin')) return { decision: 'deny', reason: '`origin` (Movida/holon, ancien nom) est en lecture seule : `git push holon-v2 <branche>` (docs/ENVIRONNEMENT.md §3).' };
      if (!positionnels.length) return { decision: 'deny', reason: 'précise le remote et la branche — `git push holon-v2 main` — l\'amont implicite peut pointer `origin` (docs/ENVIRONNEMENT.md §3).' };
    }
    const touchePlan = sub === 'switch' || (sub === 'checkout' && !args.includes('--') && args.some((a) => !a.startsWith('-'))) || (sub === 'reset' && args.includes('--hard')) || sub === 'clean' || sub === 'stash' || (sub === 'worktree' && args.includes('remove'));
    if (touchePlan && ctx.missionEnCours) return { decision: 'deny', reason: `une mission tourne (processus holarch-spawn / claude -p) : pas de \`git ${sub}\` qui change l'arbre de travail pendant qu'une instance y écrit — arrêter d'abord (skill holarch-pause, docs/ENVIRONNEMENT.md §8).` };
  }
  return { decision: 'ok' };
}

/** Analyse d'un Write/Edit : {decision: 'ok'|'ask', reason}. Pure. */
function analyserEcriture(filePath, root) {
  if (!filePath) return { decision: 'ok' };
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  if (rel.startsWith('mission/') && rel !== 'mission/OBJECTIVE.md') {
    return { decision: 'ask', reason: `\`${rel}\` est un fichier de mission : le mainteneur n'écrit ni ne committe les fichiers d'une instance (KERNEL §4, docs/ENVIRONNEMENT.md §7) — confirme seulement si c'est délibéré (ex. dépôt d'une TASK dans un INBOX en tant qu'utilisateur).` };
  }
  return { decision: 'ok' };
}

// --- Éditions concurrentes : HEAD noté par session, commits étrangers signalés ---------------------------
function git(root, args) {
  const r = spawnSync('git', ['-C', root].concat(args), { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? String(r.stdout || '').trim() : '';
}
function etatPath(sessionId) { return path.join(os.tmpdir(), `holarch-garde-${String(sessionId || 'sans-session').replace(/[^A-Za-z0-9_-]/g, '_')}.json`); }
function lireHeadNote(sessionId) { try { return JSON.parse(fs.readFileSync(etatPath(sessionId), 'utf8')).head || null; } catch (_) { return null; } }
function noterHead(sessionId, head) { try { fs.writeFileSync(etatPath(sessionId), JSON.stringify({ head, at: new Date().toISOString() })); } catch (_) { /* fail-open */ } }

/** Message injecté quand HEAD a bougé hors de cette session. Pure : commits = lignes `sha sujet`, fichiers = chemins. */
function messageAvance(avant, apres, commits, fichiers) {
  const lc = (commits || []).filter(Boolean); const lf = (fichiers || []).filter(Boolean);
  const tete = `[HOLARCH · garde de maintenance] HEAD a bougé hors de cette session (${String(avant).slice(0, 7)} → ${String(apres).slice(0, 7)}) : ${lc.length ? lc.length + ' commit(s) d\'une autre session ou d\'une instance' : 'historique réécrit ou branche changée'}.`;
  const corps = lc.slice(0, 8).map((c) => `  - ${c}`).join('\n');
  const touches = lf.length ? `  fichiers touchés (${lf.length}) : ${lf.slice(0, 20).join(', ')}${lf.length > 20 ? ', …' : ''}` : '';
  return [tete, corps, touches, '  Relis (sed -n, cat) tout fichier de cette liste avant de l\'éditer : une version lue plus tôt n\'est plus la bonne (docs/ENVIRONNEMENT.md §8).'].filter(Boolean).join('\n');
}

/** Avant un outil : contexte à injecter si HEAD a bougé depuis la dernière note de cette session, sinon null. Note HEAD. */
function contexteAvance(root, sessionId) {
  const head = git(root, ['rev-parse', 'HEAD']);
  if (!head) return null;
  const avant = lireHeadNote(sessionId);
  noterHead(sessionId, head);
  if (!avant || avant === head) return null;
  const commits = git(root, ['log', '--format=%h %s', `${avant}..${head}`]).split('\n');
  const fichiers = git(root, ['diff', '--name-only', avant, head]).split('\n');
  return messageAvance(avant, head, commits, fichiers);
}

function emitAvecContexte(decision, reason, contexte) {
  const h = { hookEventName: 'PreToolUse' };
  if (decision === 'deny' || decision === 'ask') { h.permissionDecision = decision; h.permissionDecisionReason = `[HOLARCH · garde de maintenance] ${reason}`; }
  if (contexte) h.additionalContext = contexte;
  return Object.keys(h).length > 1 ? emit({ hookSpecificOutput: h }) : ok();
}

function main() {
  if (process.env.HOLARCH_INSTANCE) return ok();
  let input = {};
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch (_) { input = {}; }
  try {
    const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
    if (input.hook_event_name === 'PostToolUse' || input.hook_event_name === 'PostToolUseFailure') { const head = git(root, ['rev-parse', 'HEAD']); if (head) noterHead(input.session_id, head); return ok(); }
    const contexte = contexteAvance(root, input.session_id);
    if (input.tool_name === 'Bash') {
      const cmd = String((input.tool_input && input.tool_input.command) || '');
      if (!/\bgit\b/.test(cmd)) return emitAvecContexte('ok', '', contexte);
      const ps = process.env.HOLARCH_GARDE_PS !== undefined ? process.env.HOLARCH_GARDE_PS : (spawnSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8', timeout: 5000 }).stdout || '');
      const r = analyserBash(cmd, { missionEnCours: missionEnCours(ps) });
      return emitAvecContexte(r.decision, r.reason, contexte);
    }
    if (input.tool_name === 'Write' || input.tool_name === 'Edit') {
      const r = analyserEcriture((input.tool_input && input.tool_input.file_path) || '', root);
      return emitAvecContexte(r.decision, r.reason, contexte);
    }
    return emitAvecContexte('ok', '', contexte);
  } catch (e) {
    process.stderr.write(`garde.js : ${e && e.message}\n`);
    return ok();
  }
}

module.exports = { analyserBash, analyserEcriture, missionEnCours, messageAvance, contexteAvance, etatPath };
if (require.main === module) main();
