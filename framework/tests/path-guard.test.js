'use strict';
// Chantier 14, §15.1 : path-guard — un chemin absolu qui pointe l'arbre principal du dépôt (sous
// isolation = worktree) porte des données périmées pour la session ; refus avec le chemin relatif à
// reprendre. Inerte dans l'arbre principal (cwd = racine).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Le hook charge `../bin/reveil.js`. Appliqué à sa place réelle (`framework/tests/`), ce fichier est là :
 * on exerce le hook en place. Dans le paquet livrable (`cible-framework/framework/tests/`, qui ne porte
 * pas de `framework/bin/`), il n'y est pas : on exerce alors une copie à l'octet près du hook dans un
 * répertoire temporaire dont `bin/reveil.js` réexporte celui du dépôt. Le fichier testé est le même dans
 * les deux cas, et le harnais n'est pas modifié pour les besoins de son test (pas de require fail-open).
 */
function resolveHooks() {
  const enPlace = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js');
  if (fs.existsSync(path.join(__dirname, '..', 'bin', 'reveil.js'))) return { hooks: enPlace, tmp: null };
  let d = __dirname; let reel = null;
  for (let i = 0; i < 12 && !reel; i++) {
    const p = path.join(d, 'framework', 'bin', 'reveil.js');
    if (fs.existsSync(p)) { reel = p; break; }
    const parent = path.dirname(d);
    if (parent === d) break;
    d = parent;
  }
  assert.ok(reel, 'framework/bin/reveil.js introuvable dans les répertoires ancêtres');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-path-guard-hook-'));
  fs.mkdirSync(path.join(tmp, 'hooks'));
  fs.mkdirSync(path.join(tmp, 'bin'));
  fs.copyFileSync(enPlace, path.join(tmp, 'hooks', 'holarch-hooks.js'));
  fs.writeFileSync(path.join(tmp, 'bin', 'reveil.js'), `module.exports = require(${JSON.stringify(reel)});\n`);
  return { hooks: path.join(tmp, 'hooks', 'holarch-hooks.js'), tmp };
}

const resolu = resolveHooks();
const HOOKS = resolu.hooks;
test.after(() => { if (resolu.tmp) fs.rmSync(resolu.tmp, { recursive: true, force: true }); });

function call(event, input, env) {
  const r = spawnSync('node', [HOOKS, event], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env) });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout || '{}');
  return j;
}
function decision(o) { return (o.hookSpecificOutput || {}).permissionDecision; }
function reason(o) { return (o.hookSpecificOutput || {}).permissionDecisionReason || ''; }

/** Fabrique un faux worktree : <tmp>/principal/ (arbre principal) et
 *  <tmp>/principal/mission/.holarch/worktrees/concepteur/ (worktree), dont le fichier `.git` référence
 *  l'arbre principal comme le fait `git worktree add`. */
function makeFakeWorktree() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-path-guard-test-'));
  const principal = path.join(tmp, 'principal');
  const worktree = path.join(principal, 'mission', '.holarch', 'worktrees', 'concepteur');
  fs.mkdirSync(worktree, { recursive: true });
  fs.mkdirSync(path.join(principal, 'mission', 'shared', 'concepteur'), { recursive: true });
  fs.writeFileSync(path.join(worktree, '.git'), `gitdir: ${principal}/.git/worktrees/concepteur\n`);
  return { tmp, principal, worktree };
}

test('path-guard : Write hors worktree (arbre principal) refusé avec le relatif et la racine de session', () => {
  const { tmp, principal, worktree } = makeFakeWorktree();
  const cible = path.join(principal, 'mission/shared/concepteur/x.md');
  const out = call('path-guard', { session_id: 's', cwd: worktree, tool_name: 'Write', tool_input: { file_path: cible } }, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: worktree });
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /\[HOLARCH · garde-fou path-guard\]/);
  assert.match(reason(out), /mission\/shared\/concepteur\/x\.md/);
  assert.ok(reason(out).includes(worktree), 'la racine de session doit apparaître dans le message');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('path-guard : Write absolu dans le worktree accepté', () => {
  const { tmp, worktree } = makeFakeWorktree();
  const cible = path.join(worktree, 'mission/shared/concepteur/x.md');
  const out = call('path-guard', { session_id: 's', cwd: worktree, tool_name: 'Write', tool_input: { file_path: cible } }, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: worktree });
  assert.deepEqual(out, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('path-guard : Write avec chemin relatif accepté', () => {
  const { tmp, worktree } = makeFakeWorktree();
  const out = call('path-guard', { session_id: 's', cwd: worktree, tool_name: 'Write', tool_input: { file_path: 'mission/shared/concepteur/x.md' } }, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: worktree });
  assert.deepEqual(out, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('path-guard : cwd = racine (arbre principal, pas de worktree) — hook inerte quel que soit le chemin', () => {
  const { tmp, principal } = makeFakeWorktree();
  const cible = path.join(principal, 'mission/shared/concepteur/x.md');
  const out = call('path-guard', { session_id: 's', cwd: principal, tool_name: 'Write', tool_input: { file_path: cible } }, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: principal });
  assert.deepEqual(out, {});
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('path-guard : Bash citant deux chemins absolus dont un du principal — refus mentionnant le relatif', () => {
  const { tmp, principal, worktree } = makeFakeWorktree();
  const a = path.join(worktree, 'a.txt');
  const b = path.join(principal, 'mission/shared/concepteur/b.txt');
  const out = call('path-guard', { session_id: 's', cwd: worktree, tool_name: 'Bash', tool_input: { command: `diff ${a} ${b}` } }, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: worktree });
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /mission\/shared\/concepteur\/b\.txt/);
  fs.rmSync(tmp, { recursive: true, force: true });
});
