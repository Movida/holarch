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
  w('framework/CONFIG.md', '# Configuration — mission : test-etat\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| mode_attente | detache |\n| budget_usd_par_session | 8 |\n| max_tours_par_session | 200 |\n');
  w('mission/OBJECTIVE.md', 'x\n');
  w('docs/IDEES.md', '# Idées\n\n| Date | Idée | Gain | Effort | État |\n|---|---|---|---|---|\n| 2026-09-11 | une idée | x | y | ouverte |\n| 2026-09-10 | une autre | x | y | faite |\n');
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
    mtimePassation: () => new Date('2026-09-11T18:00:00Z'),
    maintenant: () => new Date('2026-09-11T21:00:00Z'),
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
  assert.equal(e.passationHeures, 3);
  assert.equal(e.ideesOuvertes, 1);
  assert.match(t, /suivi : dernière passation en mémoire il y a 3 h · 1 idée\(s\) ouverte\(s\) dans docs\/IDEES\.md/);
  assert.match(t, /paramètres : mode_attente=detache · isolation=worktree \(défaut\) · 8 USD\/session · 200 tours · seuil contexte \? \(défaut\) · relances sans progrès 2 \(défaut\)/);
  assert.match(t, /framework v\S+ · gh authentifié \(Movida\) · Claude Code 2\.1\.263 · Node v24\.20\.0 · remotes : holon-v2 https:\/\/x\/holon-v2\.git/);
  const calme = etat.formater(etat.collecter(root, Object.assign({}, deps, { ps: () => PS_CALME, hostsYml: () => null })), false);
  assert.match(calme, /aucune session de mission en cours/);
  assert.match(calme, /gh non authentifié/);
  assert.match(calme, /  · mission\/concepteur\/enfant\/MEMORY\.md/);
});

test('etat : fournisseurs à variables — absentes du shell signalées par leur nom, présentes reconnues, rien sans table', () => {
  const root = makeRoot();
  const cfgPath = path.join(root, 'framework', 'CONFIG.md');
  const deps = {
    git: () => '', ps: () => PS_CALME, hostsYml: () => null, versionClaude: () => '2.1.263', versionNode: () => 'v24.20.0',
    mtimePassation: () => null, maintenant: () => new Date('2026-09-12T10:00:00Z'),
  };
  // Sans table Fournisseurs : aucune ligne.
  assert.doesNotMatch(etat.formater(etat.collecter(root, deps), false), /fournisseurs à variables/);
  fs.appendFileSync(cfgPath, '\n## Fournisseurs\n| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |\n|---|---|---|---|---|\n| anthropic | claude-code | — | — | — |\n| routeur-test | passerelle | HOLARCH_FOURNISSEUR_ROUTEURTEST_URL | HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON | — |\n');
  delete process.env.HOLARCH_FOURNISSEUR_ROUTEURTEST_URL; delete process.env.HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON;
  const e = etat.collecter(root, deps);
  assert.deepEqual(e.fournisseurs, [{ nom: 'routeur-test', variables: ['HOLARCH_FOURNISSEUR_ROUTEURTEST_URL', 'HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON'], absentes: ['HOLARCH_FOURNISSEUR_ROUTEURTEST_URL', 'HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON'] }]);
  const t = etat.formater(e, false);
  assert.match(t, /fournisseurs à variables : routeur-test — HOLARCH_FOURNISSEUR_ROUTEURTEST_URL, HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON ABSENTE\(S\) de ce shell/);
  process.env.HOLARCH_FOURNISSEUR_ROUTEURTEST_URL = 'https://routeur.invalid'; process.env.HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON = 'jeton-de-test';
  try {
    const t2 = etat.formater(etat.collecter(root, deps), false);
    assert.match(t2, /fournisseurs à variables : routeur-test — variables présentes/);
    assert.doesNotMatch(t2, /jeton-de-test|routeur\.invalid/, 'jamais une valeur');
  } finally { delete process.env.HOLARCH_FOURNISSEUR_ROUTEURTEST_URL; delete process.env.HOLARCH_FOURNISSEUR_ROUTEURTEST_JETON; }
});

test('etat --hook-prompt : réinjecte seulement quand la clé stable change ; --hook note la clé au départ', () => {
  const root = makeRoot();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-home-'));
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, HOME: home });
  delete env.HOLARCH_INSTANCE;
  const sid = JSON.stringify({ session_id: 'sess-test' });
  const depart = JSON.parse(spawnSync('node', [ETAT, '--hook'], { encoding: 'utf8', env, input: sid }).stdout);
  assert.equal(depart.hookSpecificOutput.hookEventName, 'SessionStart');
  // Rien n'a changé : silence.
  assert.equal(spawnSync('node', [ETAT, '--hook-prompt'], { encoding: 'utf8', env, input: sid }).stdout, '{}');
  // La mission est archivée entre-temps : réinjection, étiquetée UserPromptSubmit.
  fs.rmSync(path.join(root, 'mission'), { recursive: true, force: true });
  const apres = JSON.parse(spawnSync('node', [ETAT, '--hook-prompt'], { encoding: 'utf8', env, input: sid }).stdout);
  assert.equal(apres.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(apres.hookSpecificOutput.additionalContext, /changé depuis la dernière injection[\s\S]*aucune mission ouverte/);
  // Puis silence à nouveau, et une autre session repart de zéro (clé par session).
  assert.equal(spawnSync('node', [ETAT, '--hook-prompt'], { encoding: 'utf8', env, input: sid }).stdout, '{}');
  assert.notEqual(spawnSync('node', [ETAT, '--hook-prompt'], { encoding: 'utf8', env, input: JSON.stringify({ session_id: 'autre' }) }).stdout, '{}');
  // Une instance : inerte.
  assert.equal(spawnSync('node', [ETAT, '--hook-prompt'], { encoding: 'utf8', env: Object.assign({}, env, { HOLARCH_INSTANCE: 'concepteur' }), input: sid }).stdout, '{}');
  // La clé stable ignore durées, pids et tokens.
  assert.equal(etat.cleStable('branche main · 3 fichier(s) non committé(s)\nmission x : concepteur WORKING · session vivante (pid 12, 5 min, 88k tokens)\nderniers commits : abc'), 'branche main\nmission x : concepteur WORKING · session vivante (pid N, N min, Nk tokens)');
  fs.rmSync(home, { recursive: true, force: true });
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
  // 2026-09-12 : jamais de commit enchaîné derrière un test filtré.
  assert.equal(garde.analyserBash('npm test 2>&1 | grep pass && git add x && git commit -m y', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('node --test a.test.js; git commit -am y', ctx).decision, 'deny');
  assert.equal(garde.analyserBash('npm test', ctx).decision, 'ok');
  assert.equal(garde.analyserBash('git add x && git commit -m y', ctx).decision, 'ok');
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

test('garde : messageAvance nomme les commits étrangers et les fichiers touchés ; historique réécrit sans commit', () => {
  const m = garde.messageAvance('aaaaaaa1', 'bbbbbbb2', ['bbbbbbb2 [concepteur] U1 : cadrage', 'ccccccc3 Test découplé'], ['framework/tests/x.test.js', 'docs/ROADMAP.md']);
  assert.match(m, /aaaaaaa → bbbbbbb/);
  assert.match(m, /2 commit\(s\)/);
  assert.match(m, /\[concepteur\] U1/);
  assert.match(m, /fichiers touchés \(2\) : framework\/tests\/x\.test\.js, docs\/ROADMAP\.md/);
  assert.match(m, /Relis/);
  assert.match(garde.messageAvance('a', 'b', [], []), /historique réécrit ou branche changée/);
});

test('garde (intégration) : HEAD noté au premier appel, commit d\'une autre session signalé en additionalContext au suivant, puis silence', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-garde-git-'));
  const g = (...a) => spawnSync('git', ['-C', root, ...a], { encoding: 'utf8' });
  g('init', '-q'); g('config', 'user.email', 't@t'); g('config', 'user.name', 't');
  fs.writeFileSync(path.join(root, 'a.md'), 'a\n'); g('add', '-A'); g('commit', '-q', '-m', 'init');
  const sid = `test-${process.pid}-${Date.now()}`;
  try { fs.unlinkSync(garde.etatPath(sid)); } catch (_) { /* absent */ }
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, HOLARCH_GARDE_PS: PS_CALME });
  delete env.HOLARCH_INSTANCE;
  const appel = (evt, tool, extra) => JSON.parse(spawnSync('node', [GARDE], { encoding: 'utf8', env, input: JSON.stringify(Object.assign({ session_id: sid, hook_event_name: evt, tool_name: tool, cwd: root }, extra || {})) }).stdout || '{}');
  // 1. premier PreToolUse : note HEAD, rien à signaler
  assert.deepEqual(appel('PreToolUse', 'Bash', { tool_input: { command: 'ls' } }), {});
  // 2. une autre session committe
  fs.writeFileSync(path.join(root, 'b.md'), 'b\n'); g('add', '-A'); g('commit', '-q', '-m', 'Commit étranger');
  const o = appel('PreToolUse', 'Edit', { tool_input: { file_path: path.join(root, 'b.md') } });
  assert.equal(o.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(o.hookSpecificOutput.permissionDecision, undefined); // jamais bloquant
  assert.match(o.hookSpecificOutput.additionalContext, /Commit étranger/);
  assert.match(o.hookSpecificOutput.additionalContext, /b\.md/);
  // 3. signalé une seule fois
  assert.deepEqual(appel('PreToolUse', 'Bash', { tool_input: { command: 'ls' } }), {});
  // 4. un commit de cette session (noté par PostToolUse) ne déclenche rien
  fs.writeFileSync(path.join(root, 'c.md'), 'c\n'); g('add', '-A'); g('commit', '-q', '-m', 'Mon commit');
  assert.deepEqual(appel('PostToolUse', 'Bash', { tool_input: { command: 'git commit' } }), {});
  assert.deepEqual(appel('PreToolUse', 'Bash', { tool_input: { command: 'ls' } }), {});
  // 5. la décision existante (ask sous mission/) coexiste avec le contexte
  fs.writeFileSync(path.join(root, 'd.md'), 'd\n'); g('add', '-A'); g('commit', '-q', '-m', 'Encore étranger');
  const o2 = appel('PreToolUse', 'Write', { tool_input: { file_path: path.join(root, 'mission/concepteur/INBOX.md') } });
  assert.equal(o2.hookSpecificOutput.permissionDecision, 'ask');
  assert.match(o2.hookSpecificOutput.additionalContext, /Encore étranger/);
  // 6. inerte dans une session d'instance
  const inst = spawnSync('node', [GARDE], { encoding: 'utf8', env: Object.assign({}, env, { HOLARCH_INSTANCE: 'concepteur' }), input: '{"hook_event_name":"PreToolUse","tool_name":"Bash"}' });
  assert.equal(inst.stdout, '{}');
  fs.unlinkSync(garde.etatPath(sid));
});

test('passation --hook-precompact : consigne JSON hors instance, {} dans une session d\'instance ; refus : formes', () => {
  const PASSATION = path.join(__dirname, 'passation.js');
  const out = spawnSync('node', [PASSATION, '--hook-precompact'], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_INSTANCE: '' }) });
  const j = JSON.parse(out.stdout);
  assert.equal(j.hookSpecificOutput.hookEventName, 'PreCompact');
  assert.match(j.hookSpecificOutput.additionalContext, /gestes réservés au mainteneur en attente/);
  const inst = spawnSync('node', [PASSATION, '--hook-precompact'], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_INSTANCE: 'concepteur' }) });
  assert.equal(inst.stdout, '{}');
  const refus = require('./refus.js');
  assert.equal(refus.forme({ tool_name: 'Bash', tool_input: { command: "cat >> mission/x/JOURNAL.md <<'EOF'\nx\nEOF" } }), 'Bash · écriture par redirection (>, >>, heredoc)');
  assert.equal(refus.forme({ tool_name: 'Bash', tool_input: { command: "wc -l a.md && awk '{ if (length($0) > 200) print NR }' a.md" } }), 'Bash · wc');
  assert.equal(refus.forme({ tool_name: 'Bash', tool_input: { command: 'git -C /tmp/x log --oneline' } }), 'Bash · git -C <dir> log');
  assert.equal(refus.forme({ tool_name: 'Read', tool_input: { file_path: '/workspaces/holon/mission/concepteur/enfant/STATUS.md' } }), 'Read · mission/concepteur');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-refus-'));
  fs.writeFileSync(path.join(dir, 'a-1.result.json'), JSON.stringify({ num_turns: 10, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'echo x > f' } }, { tool_name: 'Read', tool_input: { file_path: '/w/framework/tests/t.js' } }] }));
  const r = refus.relever(dir);
  assert.equal(r.totalRefus, 2); assert.equal(r.totalTours, 10); assert.equal(r.formes[0].n, 1);
  assert.match(refus.formater(r, 5), /1 session\(s\) · 10 tours · 2 refus \(20\.0 % des tours\)/);
});
