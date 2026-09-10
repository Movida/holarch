'use strict';
// Tests de etat.js et garde.js — racine jetable, aucun processus réel, aucun réseau.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const etat = require('./etat');
const garde = require('./garde');

const GARDE = path.join(__dirname, 'garde.js');
const ETAT = path.join(__dirname, 'etat.js');

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-session-'));
  const w = (rel, c) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w('framework/KERNEL.md', '# K\n');
  w('framework/CONFIG.md', '# Configuration — mission : test-etat\n');
  w('mission/OBJECTIVE.md', 'x\n');
  w('mission/concepteur/STATUS.md', '| Champ | Valeur |\n|---|---|\n| État | WORKING |\n| Note | hibernation volontaire (contexte) |\n');
  w('mission/concepteur/enfant/STATUS.md', '| Champ | Valeur |\n|---|---|\n| État | READY |\n| Note |  |\n');
  w('mission/registry/SESSIONS.md', '| Date (UTC) | Instance | Session | Modèle / effort | Tours | Tokens | Coût USD | Durée | Fin | STATUS | Réveil |\n|---|---|---|---|---|---|---|---|---|---|---|\n| 2026-09-09T06:11:48Z | concepteur | a983001d | claude-opus-5/high | 11 | 18 / 1 / 2 / 3 | 1.9889 | 4m12s | success | WORKING | 49000 / 44000 |\n');
  return root;
}

const PS_MISSION = '  1 /sbin/init\n 59956 /x/native-binary/claude --output-format stream-json --replay-user-messages\n 81532 node framework/bin/holarch-spawn.js --bootstrap\n 81539 claude -p --model opus --effort high\n';
const PS_CALME = '  1 /sbin/init\n 59956 /x/native-binary/claude --output-format stream-json --replay-user-messages\n';

test('etat : collecte et formate branche, fichiers d\'instance, mission, processus, sessions, gh, versions', () => {
  const root = makeRoot();
  const deps = {
    git: (args) => ({ 'branch --show-current': 'main', 'status --short --untracked-files=all': 'M mission/concepteur/enfant/MEMORY.md\n M README.md\n?? tools/x.js', 'log --oneline -5': 'abc1234 Un commit\ndef5678 Un autre', 'remote -v': 'holon-v2\thttps://x/holon-v2.git (fetch)\nholon-v2\thttps://x/holon-v2.git (push)' }[args.join(' ')] || ''),
    ps: () => PS_MISSION,
    hostsYml: () => 'github.com:\n    user: Movida\n',
    versionClaude: () => '2.1.263 (Claude Code)',
    versionNode: () => 'v24.20.0',
  };
  const e = etat.collecter(root, deps);
  assert.equal(e.branche, 'main');
  assert.deepEqual(e.fichiersInstance, ['mission/concepteur/enfant/MEMORY.md']);
  assert.equal(e.mission, 'test-etat');
  assert.equal(e.racine.etat, 'WORKING');
  assert.deepEqual(e.enfants, [{ nom: 'enfant', etat: 'READY' }]);
  assert.equal(e.processus.length, 2); // lanceur + claude -p, jamais la session interactive
  assert.equal(e.sessions.length, 1);
  assert.match(e.gh, /Movida/);
  const t = etat.formater(e, true);
  assert.match(t, /branche main · 3 fichier\(s\) non committé\(s\) dont 1 d'instance/);
  assert.match(t, /mission test-etat : concepteur WORKING \(hibernation volontaire \(contexte\)\) · enfants : enfant READY/);
  assert.match(t, /⚠ 2 processus de mission en cours/);
  assert.match(t, /framework v\S+ · gh authentifié \(Movida\) · Claude Code 2\.1\.263 · Node v24\.20\.0 · remotes : holon-v2 https:\/\/x\/holon-v2\.git/);
  const calme = etat.formater(etat.collecter(root, Object.assign({}, deps, { ps: () => PS_CALME, hostsYml: () => null })), false);
  assert.match(calme, /aucune session de mission en cours/);
  assert.match(calme, /gh non authentifié/);
  assert.match(calme, /  · mission\/concepteur\/enfant\/MEMORY\.md/);
});

test('etat --hook : JSON additionalContext hors instance, {} dans une session d\'instance', () => {
  const root = makeRoot();
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, HOLARCH_INSTANCE: '' });
  delete env.HOLARCH_INSTANCE;
  const r = spawnSync('node', [ETAT, '--hook'], { encoding: 'utf8', env, input: '{}' });
  const o = JSON.parse(r.stdout);
  assert.equal(o.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(o.hookSpecificOutput.additionalContext, /mission test-etat/);
  const inst = spawnSync('node', [ETAT, '--hook'], { encoding: 'utf8', env: Object.assign({}, env, { HOLARCH_INSTANCE: 'concepteur' }), input: '{}' });
  assert.equal(inst.stdout, '{}');
});

test('garde : git push — origin refusé, force refusé, sans remote refusé, holon-v2 accepté', () => {
  const ctx = { missionEnCours: false };
  assert.equal(garde.analyserBash('git push origin main', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('git push holon-v2 main --force', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('git push -f holon-v2 main', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('git push holon-v2 +main', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('git push', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('git add -A && git commit -m x && git push holon-v2 main', ctx).decision, 'ok');
  assert.equal(garde.analyserBash('git push holon-v2 main mission-holon-v2-final', ctx).decision, 'ok');
  assert.equal(garde.analyserBash('git push --dry-run holon-v2 main', ctx).decision, 'ok');
  assert.equal(garde.analyserBash('echo "git push origin"', ctx).decision, 'ok'); // pas une invocation de git
});

test('garde : changement d\'arbre de travail refusé seulement pendant une mission', () => {
  const calme = { missionEnCours: false };
  const occupe = { missionEnCours: true };
  for (const c of ['git switch holarch', 'git checkout main', 'git reset --hard HEAD~1', 'git clean -fd', 'git stash', 'git worktree remove /x']) {
    assert.equal(garde.analyserBash(c, calme).decision, 'ok', c);
    assert.equal(garde.analyserBash(c, occupe).decision, 'deny', c);
  }
  assert.equal(garde.analyserBash('git checkout -- mission/x/STATUS.md', occupe).decision, 'ok'); // restauration d'un fichier, pas de bascule
  assert.equal(garde.analyserBash('git status --short && git log --oneline -3', occupe).decision, 'ok');
  assert.equal(garde.missionEnCours(PS_MISSION), true);
  assert.equal(garde.missionEnCours(PS_CALME), false);
});

test('garde : Write/Edit dans mission/<instance> demande confirmation, OBJECTIVE.md et le reste passent', () => {
  const root = '/depot';
  assert.equal(garde.analyserEcriture('/depot/mission/concepteur/MEMORY.md', root).decision, 'ask');
  assert.equal(garde.analyserEcriture('/depot/mission/registry/DECISIONS.md', root).decision, 'ask');
  assert.equal(garde.analyserEcriture('/depot/mission/OBJECTIVE.md', root).decision, 'ok');
  assert.equal(garde.analyserEcriture('/depot/docs/ROADMAP.md', root).decision, 'ok');
  assert.equal(garde.analyserEcriture('', root).decision, 'ok');
});

test('garde (processus) : hook inerte pour une instance, deny JSON pour un push origin, ok sinon', () => {
  const call = (input, env) => JSON.parse(spawnSync('node', [GARDE], { encoding: 'utf8', input: JSON.stringify(input), env: Object.assign({}, process.env, { HOLARCH_GARDE_PS: PS_CALME }, env || {}) }).stdout);
  assert.deepEqual(call({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } }, { HOLARCH_INSTANCE: 'concepteur' }), {});
  const d = call({ tool_name: 'Bash', tool_input: { command: 'git push origin main' } });
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(d.hookSpecificOutput.permissionDecisionReason, /lecture seule/);
  assert.deepEqual(call({ tool_name: 'Bash', tool_input: { command: 'ls -la' } }), {});
  const sw = call({ tool_name: 'Bash', tool_input: { command: 'git switch main' } }, { HOLARCH_GARDE_PS: PS_MISSION });
  assert.equal(sw.hookSpecificOutput.permissionDecision, 'deny');
  const w = call({ tool_name: 'Write', tool_input: { file_path: '/depot/mission/concepteur/STATUS.md' }, cwd: '/depot' }, { CLAUDE_PROJECT_DIR: '/depot' });
  assert.equal(w.hookSpecificOutput.permissionDecision, 'ask');
});
