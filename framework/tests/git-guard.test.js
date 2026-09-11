'use strict';
// 1.15.1 : git-guard — une instance ne stage que sous mission/ et ne committe jamais avec -a.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const HOOKS = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js');
const env = { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: '/tmp/x' };
function call(command, e = env) {
  const r = spawnSync('node', [HOOKS, 'git-guard'], { input: JSON.stringify({ session_id: 's', cwd: '/tmp/x', tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8', env: Object.assign({}, process.env, e) });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout || '{}');
  return j.hookSpecificOutput ? j.hookSpecificOutput.permissionDecision : 'ok';
}
test('git-guard : refuse git add -A/./-u sans pathspec, chemins hors mission/, git commit -a', () => {
  for (const c of ['git add -A', 'git add .', 'git add -u', 'git add --all', 'git add :/', 'git add -A && git commit -q -m x',
    'git add tools/holarch-observe/collecte.js', 'git add mission/concepteur/JOURNAL.md framework/VERSION', 'git commit -a -m x', 'git commit -am x', 'git commit --all -m x',
    'cd /tmp/x && git add -A', 'GIT_AUTHOR_NAME=x git add .']) {
    assert.equal(call(c), 'deny', `attendu deny : ${c}`);
  }
});
test('git-guard : laisse passer git add restreint à mission/, git commit sans -a, les autres commandes git, et reste inerte hors instance', () => {
  for (const c of ['git add -A mission/', 'git add mission/concepteur/JOURNAL.md mission/registry/PROGRESS.md', 'git add ./mission/shared/x.md',
    'git add -A mission/ && git commit -q -m "[concepteur] U3"', 'git commit -q -m x', 'git commit --amend --no-edit', 'git status', 'git log --oneline -3',
    'git add -- mission/x.md', 'grep -n "git add -A" docs/holarch.md', 'git -C /tmp/x add mission/x.md']) {
    assert.equal(call(c), 'ok', `attendu ok : ${c}`);
  }
  assert.equal(call('git add -A', { HOLARCH_INSTANCE: '', HOLARCH_ROOT: '/tmp/x' }), 'ok', 'hors instance : inerte');
});
