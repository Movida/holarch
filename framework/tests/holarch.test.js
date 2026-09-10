'use strict';
// Tests du harnais HOLARCH — `node --test framework/tests/` (Node ≥ 18, aucune dépendance, aucun appel réseau).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const launcher = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));
const HOOKS = path.join(ROOT, 'framework', 'hooks', 'holarch-hooks.js');

const CONFIG = `# Configuration — mission : test-harnais
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | monolithic |
| 4 | recursion | max-depth |
| 5 | registre | sharded-files |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 3 |
| profondeur_max | 2 |
| permission_mode | acceptEdits |
| format_rapport_final | simple |
| max_tours_par_session | 42 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | xhigh |
| execution | sonnet | low |

## Valeurs organisationnelles
- Faire simple.
`;

function fiche(chemin, { profil = '', effort = '', alloue = 2, consomme = 0, statut = 'READY' } = {}) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | x |\n| Statut | ${statut} |\n| Budget alloué / consommé | ${alloue} / ${consomme} |\n| Dépend de | — |\n${profil ? `| Profil | ${profil} |\n` : ''}${effort ? `| Effort | ${effort} |\n` : ''}| Livrables | — |\n| Créée / Archivée | 2026-09-02T00:00:00Z / — |\n`;
}
function status(etat, note = '') {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-02T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n`;
}

/** Construit une racine de mission jetable (framework minimal + instance racine + un enfant). */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-test-'));
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  w('framework/KERNEL.md', '# KERNEL de test\nRègle K1.\n');
  w('framework/CONFIG.md', CONFIG);
  w('framework/MANIFEST.md', '# MANIFEST\n');
  w('framework/BOOTSTRAP.md', '# BOOTSTRAP de test\n');
  w('framework/modules/orchestration/direct-spawn.md', '# Module : direct-spawn\nRègle DS.\n');
  w('framework/modules/synchronisation/fork-join.md', '# Module : fork-join\n');
  w('framework/modules/memoire/monolithic.md', '# Module : monolithic\n');
  w('framework/modules/recursion/max-depth.md', '# Module : max-depth\n');
  w('framework/modules/registre/sharded-files.md', '# Module : sharded-files\n');
  w('framework/claude/instance-settings.json', '{}');
  w('mission/OBJECTIVE.md', 'Objectif de test.\n');
  w('mission/concepteur/ROLE.md', '# Rôle : concepteur\nMission racine de test.\n');
  w('mission/concepteur/MEMORY.md', '# Mémoire\n');
  w('mission/concepteur/STATUS.md', status('WORKING'));
  w('mission/concepteur/INBOX.md', '# Boîte\n');
  w('mission/concepteur/JOURNAL.md', '# Journal\n');
  w('mission/concepteur/enfant/ROLE.md', '# Rôle : enfant\n');
  w('mission/concepteur/enfant/MEMORY.md', '# Mémoire enfant\n');
  w('mission/concepteur/enfant/STATUS.md', status('READY'));
  w('mission/concepteur/enfant/INBOX.md', '# Boîte enfant\n');
  w('mission/registry/instances/concepteur.md', fiche('concepteur', { alloue: 3 }));
  w('mission/registry/instances/concepteur-enfant.md', fiche('concepteur/enfant', { profil: 'execution', alloue: 1 }));
  w('mission/registry/PROGRESS.md', '# Avancement\n2026-09-02T00:00:00Z · concepteur · ON_ORIENT · plan\n2026-09-02T00:01:00Z · autre · ON_ORIENT · autre\n');
  return root;
}

function runHook(event, input, env) {
  const r = spawnSync('node', [HOOKS, event], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env) });
  assert.equal(r.status, 0, `hook ${event} exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

test('parseConfig : modules, paramètres, politique de modèle', () => {
  const cfg = launcher.parseConfig(CONFIG);
  assert.equal(cfg.nom, 'test-harnais');
  assert.deepEqual(cfg.modules.map((m) => m.module), ['direct-spawn', 'fork-join', 'monolithic', 'max-depth', 'sharded-files']);
  assert.equal(cfg.params.profondeur_max, '2');
  assert.equal(cfg.params.max_tours_par_session, '42');
  assert.deepEqual(cfg.policy.execution, { modele: 'sonnet', effort: 'low' });
  assert.equal(cfg.policy.conception.effort, 'xhigh');
});

test('parseFiche / parseStatus', () => {
  const f = launcher.parseFiche(fiche('a/b', { profil: 'Relecture', alloue: 4, consomme: 1 }));
  assert.equal(f.profil, 'relecture');
  assert.equal(f.effort, ''); // ligne Effort absente : effort du profil
  assert.equal(f.alloue, 4);
  assert.equal(f.consomme, 1);
  assert.equal(launcher.parseFiche(fiche('a/b', { profil: 'execution', effort: 'XHigh' })).effort, 'xhigh');
  const s = launcher.parseStatus(status('WORKING', 'hibernation volontaire (contexte)'));
  assert.equal(s.etat, 'WORKING');
  assert.match(s.note, /hibernation volontaire/);
});

test('resolveProfile : précédence option > politique CONFIG > modele_cli > défauts', () => {
  const cfg = launcher.parseConfig(CONFIG);
  const root = launcher.resolveProfile(cfg, launcher.parseFiche(null), 'concepteur', {});
  assert.deepEqual([root.profil, root.modele, root.effort, root.depth], ['conception', 'opus', 'xhigh', 1]);
  const child = launcher.resolveProfile(cfg, launcher.parseFiche(fiche('c/e', { profil: 'execution' })), 'c/e', {});
  assert.deepEqual([child.modele, child.effort], ['sonnet', 'low']);
  const noRow = launcher.resolveProfile(cfg, launcher.parseFiche(fiche('c/r', { profil: 'relecture' })), 'c/r', {});
  assert.deepEqual([noRow.modele, noRow.effort], ['opus', 'medium']); // défaut du module (pas de ligne CONFIG)
  const explicit = launcher.parseConfig(CONFIG.replace('| max_tours_par_session | 42 |', '| max_tours_par_session | 42 |\n| modele_cli | claude-x |\n| effort_cli | max |'));
  const e = launcher.resolveProfile(explicit, launcher.parseFiche(fiche('c/r', { profil: 'relecture' })), 'c/r', {});
  assert.deepEqual([e.modele, e.effort], ['claude-x', 'max']);
  const over = launcher.resolveProfile(cfg, launcher.parseFiche(null), 'c/e', { modele: 'fable', effort: 'medium' });
  assert.deepEqual([over.profil, over.modele, over.effort, over.origine_effort], ['execution', 'fable', 'medium', 'option']);
  assert.throws(() => launcher.resolveProfile(cfg, launcher.parseFiche(null), 'c/e', { effort: 'ultra' }), /effort invalide/);
});

test('resolveProfile : profil exploration (fable/xhigh par défaut) et effort jugé par instance (ligne Effort de la fiche)', () => {
  const cfg = launcher.parseConfig(CONFIG);
  assert.deepEqual(launcher.DEFAULT_POLICY.exploration, { modele: 'fable', effort: 'xhigh' });
  const explo = launcher.resolveProfile(cfg, launcher.parseFiche(fiche('c/x', { profil: 'exploration' })), 'c/x', {});
  assert.deepEqual([explo.profil, explo.modele, explo.effort, explo.origine_effort], ['exploration', 'fable', 'xhigh', 'defaut']); // pas de ligne CONFIG : défaut du module
  const ficheEffort = launcher.resolveProfile(cfg, launcher.parseFiche(fiche('c/e', { profil: 'execution', effort: 'Max' })), 'c/e', {});
  assert.deepEqual([ficheEffort.modele, ficheEffort.effort, ficheEffort.origine_effort], ['sonnet', 'max', 'fiche']); // la fiche prime sur la table CONFIG (execution/low), le modèle reste celui du profil
  const optionPrime = launcher.resolveProfile(cfg, launcher.parseFiche(fiche('c/e', { profil: 'execution', effort: 'max' })), 'c/e', { effort: 'low' });
  assert.deepEqual([optionPrime.effort, optionPrime.origine_effort], ['low', 'option']); // l'option CLI prime sur la fiche
  const ficheInvalide = launcher.resolveProfile(cfg, launcher.parseFiche(fiche('c/e', { profil: 'execution', effort: 'turbo' })), 'c/e', {});
  assert.deepEqual([ficheInvalide.effort, ficheInvalide.origine_effort], ['low', 'config']); // valeur inconnue ignorée (avertissement stderr), effort du profil conservé
  const withConfigRow = launcher.parseConfig(CONFIG.replace('| execution | sonnet | low |', '| execution | sonnet | low |\n| exploration | fable | max |'));
  const e = launcher.resolveProfile(withConfigRow, launcher.parseFiche(fiche('c/x', { profil: 'exploration' })), 'c/x', {});
  assert.deepEqual([e.modele, e.effort, e.origine_effort], ['fable', 'max', 'config']);
});

test('prepareLaunch : arguments CLI, prompts injectés, environnement des hooks', () => {
  const root = makeRoot();
  const l = launcher.prepareLaunch(root, 'concepteur/enfant', {});
  const a = l.args;
  const val = (flag) => a[a.indexOf(flag) + 1];
  assert.equal(val('--model'), 'sonnet');
  assert.equal(val('--effort'), 'low');
  assert.equal(val('--max-turns'), '42');
  assert.equal(val('--max-budget-usd'), '5');
  assert.equal(val('--permission-mode'), 'acceptEdits');
  assert.equal(val('--settings'), path.join(root, 'framework', 'claude', 'instance-settings.json'));
  assert.ok(a.includes('--exclude-dynamic-system-prompt-sections'));
  assert.ok(a.includes('--disable-slash-commands') && a.includes('--strict-mcp-config'));
  assert.match(val('--disallowedTools'), /Edit\(.*framework\/\*\*\)/);
  assert.match(val('--disallowedTools'), /Write\(.*framework\/\*\*\)/); // Write couvert, pas seulement Edit (A3)
  assert.match(val('--disallowedTools'), /Write\(.*mission\/OBJECTIVE\.md\)/);
  assert.equal(val('--disallowedTools').match(/\/\//g), null);
  assert.ok(!a.includes('--fallback-model'));
  assert.equal(l.env.HOLARCH_PROGRESS_BASELINE, String(fs.readFileSync(path.join(root, 'mission/registry/PROGRESS.md'), 'utf8').length));
  assert.match(l.systemPrompt, /Règle K1\./);
  assert.match(l.systemPrompt, /Règle DS\./);
  assert.match(l.systemPrompt, /chemin="framework\/modules\/registre\/sharded-files\.md"/);
  assert.doesNotMatch(l.systemPrompt, /BOOTSTRAP de test/);
  assert.match(l.prompt, /Rôle : enfant/);
  assert.match(l.prompt, /Mémoire enfant/);
  assert.match(l.prompt, /profil execution/);
  assert.doesNotMatch(l.prompt, /autre · ON_ORIENT/);
  assert.equal(l.env.HOLARCH_INSTANCE, 'concepteur/enfant');
  // Identité Git de mission posée par le lanceur, sans toucher à la configuration du dépôt ; valeur exportée respectée.
  assert.equal(l.env.GIT_AUTHOR_NAME, process.env.GIT_AUTHOR_NAME || 'HOLARCH');
  assert.equal(l.env.GIT_COMMITTER_EMAIL, process.env.GIT_COMMITTER_EMAIL || 'holarch@localhost');
  const prevName = process.env.GIT_AUTHOR_NAME;
  process.env.GIT_AUTHOR_NAME = 'Quelqu\'un';
  try { assert.equal(launcher.prepareLaunch(root, 'concepteur/enfant', {}).env.GIT_AUTHOR_NAME, 'Quelqu\'un'); } finally { if (prevName === undefined) delete process.env.GIT_AUTHOR_NAME; else process.env.GIT_AUTHOR_NAME = prevName; }
  assert.equal(l.env.HOLARCH_CONTEXT_LIMIT, '120000');
  const withDirs = launcher.prepareLaunch(root, 'concepteur/enfant', { addDir: ['/tmp/depot-externe', 'relatif'] });
  const dirArgs = withDirs.args.reduce((acc, cur, i) => (withDirs.args[i - 1] === '--add-dir' ? acc.concat(cur) : acc), []);
  assert.deepEqual(dirArgs, ['/tmp/depot-externe', path.resolve('relatif')]);
  assert.deepEqual(launcher.prepareLaunch(root, 'concepteur/enfant', {}).args.filter((x) => x === '--add-dir'), []);
  const b = launcher.prepareLaunch(root, 'concepteur', { bootstrap: true });
  assert.match(b.systemPrompt, /BOOTSTRAP de test/);
  assert.match(b.prompt, /Objectif de test/);
  assert.equal(b.env.HOLARCH_BOOTSTRAP, '1');
  assert.equal(b.meta.modele, 'opus');
  assert.throws(() => launcher.prepareLaunch(root, 'concepteur/inexistant', {}), /ROLE\.md introuvable/);
});

function msg(id) {
  return `---\nid: MSG-x-${id}\nfrom: a\nto: b\ntype: TASK\nref: —\ndate: 2026-09-02T00:00:0${id % 10}Z\n---\nCorps du message ${id}.\n\n`;
}

test('tailInboxMessages : garde les N derniers messages complets, jamais coupés en deux', () => {
  const petite = '# Boîte\n' + msg(1) + msg(2);
  const r1 = launcher.tailInboxMessages(petite, launcher.INBOX_TAIL_MESSAGES);
  assert.equal(r1.hidden, 0);
  assert.equal(r1.content, petite);

  const grosse = '# Boîte\n' + Array.from({ length: 12 }, (_, i) => msg(i + 1)).join('');
  const r2 = launcher.tailInboxMessages(grosse, launcher.INBOX_TAIL_MESSAGES);
  assert.equal(r2.hidden, 12 - launcher.INBOX_TAIL_MESSAGES);
  assert.doesNotMatch(r2.content, /MSG-x-4\n/); // le plus ancien conservé doit être le 5e en partant de la fin
  assert.match(r2.content, /MSG-x-5\n/);
  assert.match(r2.content, /MSG-x-12\n/);
  assert.match(r2.content, /^# Boîte\n/); // en-tête toujours présent
});

test('prepareLaunch : INBOX.md tronqué dans le prompt au-delà du seuil, avec note de rappel', () => {
  const root = makeRoot();
  const grosse = '# Boîte enfant\n' + Array.from({ length: 10 }, (_, i) => msg(i + 1)).join('');
  fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/INBOX.md'), grosse);
  const l = launcher.prepareLaunch(root, 'concepteur/enfant', {});
  assert.doesNotMatch(l.prompt, /MSG-x-1\n/);
  assert.match(l.prompt, /MSG-x-10\n/);
  assert.match(l.prompt, /message\(s\) plus ancien\(s\) masqué/);
});

test('parseResultJson + appendSessionLine', () => {
  const root = makeRoot();
  const res = launcher.parseResultJson('Warning: x\n{"type":"result","subtype":"success","session_id":"abc-123","total_cost_usd":0.5,"num_turns":7,"usage":{"input_tokens":1,"cache_read_input_tokens":2,"cache_creation_input_tokens":3,"output_tokens":4},"modelUsage":{"claude-sonnet-5":{}, "claude-haiku-4-5-20251001":{}},"permission_denials":[],"is_error":false}\n');
  assert.equal(res.session_id, 'abc-123');
  launcher.appendSessionLine(root, 'test-harnais', 'concepteur/enfant', { modele: 'sonnet', effort: 'low' }, res, 65000, 'DELIVERED');
  const s = fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8');
  assert.match(s, /^# Sessions — mission test-harnais/);
  assert.match(s, /\| concepteur\/enfant \| abc-123 \| claude-sonnet-5\/low \| 7 \| 1 \/ 2 \/ 3 \/ 4 \| 0\.5000 \| 1m05s \| success \| DELIVERED \|/);
});

test('appendSessionLine : coût par modèle si une délégation Agent en a introduit un second (haiku filtré)', () => {
  const root = makeRoot();
  const res = launcher.parseResultJson('{"type":"result","subtype":"success","session_id":"xyz-789","total_cost_usd":1.5649,"num_turns":15,"usage":{},"modelUsage":{"claude-opus-5":{"costUSD":1.2936},"claude-sonnet-5":{"costUSD":0.2713},"claude-haiku-4-5-20251001":{"costUSD":0.0001}},"permission_denials":[],"is_error":false}\n');
  launcher.appendSessionLine(root, 'test-harnais', 'concepteur/enfant', { modele: 'opus', effort: 'high' }, res, 1000, 'DELIVERED');
  const s = fs.readFileSync(path.join(root, 'mission', 'registry', 'SESSIONS.md'), 'utf8');
  const row = s.split('\n').find((l) => l.includes('xyz-789'));
  assert.match(row, /\| claude-opus-5 1\.2936\+claude-sonnet-5 0\.2713\/high \|/);
  assert.doesNotMatch(row, /haiku/);
});

test('launchWithRelaunches : reconstruit le lancement (prompt frais) à chaque ré-incarnation', () => {
  const root = makeRoot();
  const prompts = [];
  const res = () => ({ type: 'result', subtype: 'success', session_id: 's', total_cost_usd: 0.1, num_turns: 5, usage: {}, permission_denials: [], is_error: false });
  const runner = (launch, attempt) => {
    prompts.push(launch.prompt);
    if (attempt === 1) {
      // Simule le travail réel de la 1re session : MEMORY.md mis à jour, puis hibernation volontaire.
      fs.writeFileSync(path.join(root, 'mission/concepteur/MEMORY.md'), '# Mémoire\nMarqueur session 1.\n');
      fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WORKING', 'hibernation volontaire (contexte)'));
    } else {
      fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('DELIVERED'));
    }
    return { res: res(), elapsedMs: 10 };
  };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur', {}, runner);
  assert.equal(sessions.length, 2);
  assert.doesNotMatch(prompts[0], /Marqueur session 1/);
  assert.match(prompts[1], /Marqueur session 1/); // le prompt de la ré-incarnation reflète l'état écrit par la session précédente
  assert.equal(sessions[1].status.etat, 'DELIVERED');
});

test('launchWithRelaunches : changement de régime décidé par l\'instance (fiche registre), décompté à part de relances_max, borné par changements_regime_max', () => {
  const root = makeRoot();
  // relances_max = 0 : aucune ré-incarnation de contexte — seule celle du changement de régime doit avoir lieu.
  fs.writeFileSync(path.join(root, 'framework/CONFIG.md'), CONFIG.replace('| max_tours_par_session | 42 |', '| max_tours_par_session | 42 |\n| relances_max | 0 |'));
  const fichePath = path.join(root, 'mission/registry/instances/concepteur.md');
  const res = () => ({ type: 'result', subtype: 'success', session_id: 's', total_cost_usd: 0.1, num_turns: 5, usage: {}, permission_denials: [], is_error: false });
  const regimes = [];
  const runner = (launch, attempt) => {
    regimes.push(`${launch.meta.profil}:${launch.meta.modele}/${launch.meta.effort}`);
    assert.match(launch.prompt, /changement de régime/); // le harnais annonce la procédure à l'instance
    if (attempt === 1) {
      // La session juge que la tâche excède son régime : Profil → exploration, Effort → max, hibernation volontaire.
      fs.writeFileSync(fichePath, fiche('concepteur', { alloue: 3, profil: 'exploration', effort: 'max' }));
      fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WORKING', 'hibernation volontaire (changement de régime : opus/xhigh → fable/max)'));
    } else {
      // Second changement : au-delà de changements_regime_max (1) — pas de ré-incarnation automatique.
      fs.writeFileSync(fichePath, fiche('concepteur', { alloue: 3, profil: 'execution' }));
      fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WORKING', 'hibernation volontaire (changement de régime : fable/max → sonnet/low)'));
    }
    return { res: res(), elapsedMs: 10 };
  };
  const sessions = launcher.launchWithRelaunches(root, 'concepteur', {}, runner);
  assert.deepEqual(regimes, ['conception:opus/xhigh', 'exploration:fable/max']);
  assert.equal(sessions.length, 2);
  assert.equal(sessions[1].launch.meta.origine_effort, 'fiche');
  const journal = fs.readFileSync(path.join(root, 'mission/registry/SESSIONS.md'), 'utf8');
  assert.match(journal, /\| opus\/xhigh \|/);
  assert.match(journal, /\| fable\/max \|/); // trace mécanique du régime de chaque session
  const s = launcher.summarize(sessions[1].launch, sessions);
  assert.match(s.text, /· opus\/xhigh → fable\/max · sessions/);
  assert.match(s.text, /changement de régime décidé par l'instance/);
  assert.equal(s.code, 3); // STATUS encore WORKING : hibernation volontaire non relancée, le parent relance commande_cli
});

test('hook sleep-guard : bloque WORKING, laisse passer les états terminaux et l\'hibernation volontaire', () => {
  const root = makeRoot();
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur', HOLARCH_COMMIT: 'non' };
  const sid = `t-${Date.now()}`;
  let out = runHook('sleep-guard', { session_id: sid, cwd: root, hook_event_name: 'Stop' }, env);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /WORKING/);
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('WORKING', 'hibernation volontaire (contexte)'));
  out = runHook('sleep-guard', { session_id: sid, cwd: root }, env);
  assert.deepEqual(out, {});
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('DELIVERED'));
  out = runHook('sleep-guard', { session_id: sid, cwd: root }, env);
  assert.deepEqual(out, {});
  // inerte sans HOLARCH_INSTANCE
  out = runHook('sleep-guard', { session_id: sid, cwd: root }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: '' });
  assert.deepEqual(out, {});
});

test('hook sleep-guard : plafond de blocages, puis exige le commit quand le dépôt est sale', () => {
  const root = makeRoot();
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur', HOLARCH_COMMIT: 'non' };
  const sid = `t-cap-${Date.now()}`;
  for (let i = 0; i < 3; i++) assert.equal(runHook('sleep-guard', { session_id: sid, cwd: root }, env).decision, 'block');
  assert.deepEqual(runHook('sleep-guard', { session_id: sid, cwd: root }, env), {}); // 4e : on laisse finir
  // dépôt git sale + STATUS terminal → demande de commit
  spawnSync('git', ['-C', root, 'init', '-q']);
  fs.writeFileSync(path.join(root, 'mission/concepteur/STATUS.md'), status('DELIVERED'));
  const out = runHook('sleep-guard', { session_id: `t-git-${Date.now()}`, cwd: root }, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur', HOLARCH_COMMIT: 'oui' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /non committé/);
});

test('hook spawn-guard : refus enfant indirect, budget nul, profondeur, mécanique incomplète ; sinon laisse passer', () => {
  const root = makeRoot();
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' };
  const call = (command, e = env) => runHook('spawn-guard', { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command } }, e);
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;
  assert.deepEqual(call('git status'), {});
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/enfant'), {});
  assert.deepEqual(call('node framework/bin/holarch-spawn.js --profil execution concepteur/enfant --dry-run'), {});
  // Ne déclenche que sur une véritable invocation, pas sur toute commande qui mentionne la sous-chaîne (A5) :
  assert.deepEqual(call('wc -l framework/bin/holarch-spawn.js'), {});
  assert.deepEqual(call('git commit -m "corrige un bug de holarch-spawn.js"'), {});
  assert.deepEqual(call(`node -e 'require("./framework/bin/holarch-spawn.js")'`), {});
  // --dry-run ne lance rien : contrôle de forme seulement, pas les règles d'autorisation (A5) — une instance peut
  // vérifier son propre lancement (chemin qui n'est pourtant pas un « enfant direct » d'elle-même).
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur --dry-run'), {});
  assert.equal(decision(call('node framework/bin/holarch-spawn.js --bootstrap')), 'deny');
  assert.equal(decision(call('node framework/bin/holarch-spawn.js autre/enfant')), 'deny');
  assert.equal(decision(call('node framework/bin/holarch-spawn.js concepteur/enfant/petit')), 'deny');
  assert.equal(decision(call('node framework/bin/holarch-spawn.js concepteur/fantome')), 'deny');
  // profondeur : enfant de l'enfant (profondeur 3 > profondeur_max 2)
  fs.mkdirSync(path.join(root, 'mission/concepteur/enfant/petit'), { recursive: true });
  for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/petit', f), 'x');
  fs.writeFileSync(path.join(root, 'mission/registry/instances/concepteur-enfant-petit.md'), fiche('concepteur/enfant/petit'));
  const deep = call('node framework/bin/holarch-spawn.js concepteur/enfant/petit', { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur/enfant' });
  assert.equal(decision(deep), 'deny');
  assert.match(deep.hookSpecificOutput.permissionDecisionReason, /profondeur/);
  // budget nul
  fs.writeFileSync(path.join(root, 'mission/registry/instances/concepteur.md'), fiche('concepteur', { alloue: 0 }));
  const nul = call('node framework/bin/holarch-spawn.js concepteur/enfant');
  assert.equal(decision(nul), 'deny');
  assert.match(nul.hookSpecificOutput.permissionDecisionReason, /budget/);
  // recompté depuis le disque (constat A2) — la fiche annonce (à tort) 0 consommé, le fusible ne doit plus s'y
  // fier : il recompte les sous-répertoires de mission/concepteur/ qui portent leur propre STATUS.md.
  fs.mkdirSync(path.join(root, 'mission/concepteur/second'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission/concepteur/second/STATUS.md'), status('READY'));
  fs.writeFileSync(path.join(root, 'mission/registry/instances/concepteur.md'), fiche('concepteur', { alloue: 2, consomme: 0 }));
  // Exactement 2 enfants sur disque (enfant, second) pour un budget de 2 : atteint, pas dépassé — (ré)incarner
  // l'un des deux reste autorisé (régression du bug ex->=, RAPPORT-iteration-9 §8, D32).
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/enfant'), {});
  // Un troisième enfant sur disque : là, dépassement réel, recompté depuis le disque et non depuis la fiche.
  fs.mkdirSync(path.join(root, 'mission/concepteur/troisieme'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission/concepteur/troisieme/STATUS.md'), status('READY'));
  const over = call('node framework/bin/holarch-spawn.js concepteur/enfant');
  assert.equal(decision(over), 'deny');
  assert.match(over.hookSpecificOutput.permissionDecisionReason, /recompté/);
});

test('hook spawn-guard : régression — un budget de N autorise bien N enfants, pas N-1 (RAPPORT-iteration-9 §8, D32)', () => {
  const root = makeRoot();
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' };
  const call = (command) => runHook('spawn-guard', { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command } }, env);
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;
  // Budget de 1, un seul enfant déjà existant (mécanique KERNEL §9 déjà faite, comme au moment réel du fusible) :
  // c'est le 1er et unique enfant permis — l'ancien `>=` le refusait à tort (il se comptait lui-même).
  fs.writeFileSync(path.join(root, 'mission/registry/instances/concepteur.md'), fiche('concepteur', { alloue: 1 }));
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/enfant'), {});
  // Un second enfant, distinct, pour le même budget de 1 : celui-là dépasse réellement.
  fs.mkdirSync(path.join(root, 'mission/concepteur/intrus'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission/concepteur/intrus/STATUS.md'), status('READY'));
  const over = call('node framework/bin/holarch-spawn.js concepteur/enfant');
  assert.equal(decision(over), 'deny');
  assert.match(over.hookSpecificOutput.permissionDecisionReason, /recompté/);
});

test('hook wake-guard : refuse la production hors de l\'arbre propre avant STATUS actif + ON_ORIENT frais', () => {
  const root = makeRoot();
  const baseline = fs.readFileSync(path.join(root, 'mission/registry/PROGRESS.md'), 'utf8').length;
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur/enfant', HOLARCH_PROGRESS_BASELINE: String(baseline) };
  const sid = `t-wake-${Date.now()}`;
  const write = (rel, toolName = 'Write') => runHook('wake-guard', { session_id: sid, cwd: root, tool_name: toolName, tool_input: { file_path: path.join(root, rel) } }, env);
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;

  // Bash ou tout autre outil : inerte (seuls Write/Edit sont concernés).
  assert.deepEqual(write('mission/shared/concepteur/enfant/livrable.md', 'Bash'), {});
  // STATUS de l'enfant = READY (pas actif, cf. makeRoot) : produire dans shared/ est refusé.
  assert.equal(decision(write('mission/shared/concepteur/enfant/livrable.md')), 'deny');
  // Écrire dans son propre arbre (mécanique de spawn, scratch) reste toujours permis.
  assert.deepEqual(write('mission/concepteur/enfant/workspace/notes.md'), {});
  assert.deepEqual(write('mission/concepteur/enfant/JOURNAL.md'), {});
  assert.deepEqual(write('mission/registry/instances/concepteur-enfant.md'), {});
  // STATUS passe à WORKING mais sans ligne ON_ORIENT fraîche pour cette instance : toujours refusé.
  fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/STATUS.md'), status('WORKING'));
  assert.equal(decision(write('mission/shared/concepteur/enfant/livrable.md')), 'deny');
  // Ligne ON_ORIENT de CETTE instance ajoutée après le début de la session : la porte s'ouvre.
  fs.appendFileSync(path.join(root, 'mission/registry/PROGRESS.md'), '2026-09-03T00:00:00Z · concepteur/enfant · ON_ORIENT · plan\n');
  assert.deepEqual(write('mission/shared/concepteur/enfant/livrable.md'), {});
  // Instance jamais incarnée (STATUS.md absent) : inerte.
  const fantome = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur/fantome' };
  const writeFantome = (rel) => runHook('wake-guard', { session_id: `t-fantome-${Date.now()}`, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, rel) } }, fantome);
  assert.deepEqual(writeFantome('mission/shared/concepteur/fantome/travail.md'), {});
});

test('hook wake-guard : la baseline vient du lanceur — pas de refus sur la première écriture d\'une instance déjà conforme (régression A6)', () => {
  const root = makeRoot();
  // Le lanceur calcule la baseline AVANT de démarrer la session (holarch-spawn.js, HOLARCH_PROGRESS_BASELINE).
  const baseline = fs.readFileSync(path.join(root, 'mission/registry/PROGRESS.md'), 'utf8').length;
  // L'instance fait, avant tout appel du hook, exactement ce que le KERNEL prescrit (phases 1-2 avant le reste) :
  fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/STATUS.md'), status('WORKING'));
  fs.appendFileSync(path.join(root, 'mission/registry/PROGRESS.md'), '2026-09-03T00:00:00Z · concepteur/enfant · ON_ORIENT · plan\n');
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur/enfant', HOLARCH_PROGRESS_BASELINE: String(baseline) };
  const out = runHook('wake-guard', { session_id: `t-a6-${Date.now()}`, cwd: root, tool_name: 'Write', tool_input: { file_path: path.join(root, 'mission/shared/concepteur/enfant/livrable.md') } }, env);
  assert.deepEqual(out, {}); // permis dès le premier appel, sans aller-retour de refus
});

test('hook context-watch : avertit au-delà du seuil, une fois par palier de 20k', () => {
  const root = makeRoot();
  const transcript = path.join(root, 'transcript.jsonl');
  const line = (ctx) => `${JSON.stringify({ type: 'assistant', message: { usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0, output_tokens: 5 } } })}\n`;
  const env = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur', HOLARCH_CONTEXT_LIMIT: '50000' };
  const sid = `t-ctx-${Date.now()}`;
  fs.writeFileSync(transcript, `${JSON.stringify({ type: 'user', message: {} })}\n${line(30000)}`);
  assert.deepEqual(runHook('context-watch', { session_id: sid, transcript_path: transcript }, env), {});
  fs.appendFileSync(transcript, line(55000));
  const warn = runHook('context-watch', { session_id: sid, transcript_path: transcript }, env);
  assert.match(warn.hookSpecificOutput.additionalContext, /~55k tokens \(seuil 50k\)/);
  assert.doesNotMatch(warn.hookSpecificOutput.additionalContext, /DÉPASSEMENT/);
  fs.appendFileSync(transcript, line(60000));
  assert.deepEqual(runHook('context-watch', { session_id: sid, transcript_path: transcript }, env), {}); // même palier
  fs.appendFileSync(transcript, line(80000));
  const hard = runHook('context-watch', { session_id: sid, transcript_path: transcript }, env);
  assert.match(hard.hookSpecificOutput.additionalContext, /DÉPASSEMENT/);
  assert.deepEqual(runHook('context-watch', { session_id: sid, transcript_path: path.join(root, 'absent.jsonl') }, env), {});
});

// ---------------------------------------------------------------------------
// Chantier 0 — bornes en caractères au réveil (docs/IMPLEMENTATION.md §1, diagnostic 2026-09-09)
// ---------------------------------------------------------------------------
test('tailBounded : borne en caractères sur lignes entières, dernière ligne tronquée seulement si elle dépasse seule', () => {
  const longues = Array.from({ length: 40 }, (_, i) => `ligne ${i + 1} ${'x'.repeat(4990)}`).join('\n');
  const r = launcher.tailBounded(longues, 40, 8000);
  assert.ok(r.content.length <= 8000);
  assert.equal(r.droppedLines, 39);
  assert.equal(r.truncatedLine, false);
  assert.match(r.content, /^ligne 40 /);
  const u = launcher.tailBounded('y'.repeat(20000), 40, 8000);
  assert.equal(u.truncatedLine, true);
  assert.match(u.content, /^… y+$/);
  assert.equal(u.content.length, 8000); // « … » compris dans la borne
  assert.deepEqual(launcher.tailBounded('a\nb\nc', 2, 1000), { content: 'b\nc', droppedLines: 0, truncatedLine: false });
  assert.deepEqual(launcher.tailBounded('', 5, 10), { content: '', droppedLines: 0, truncatedLine: false });
});

test('tailInboxBounded : ne coupe jamais un message, garde le dernier même s\'il dépasse', () => {
  const gros = (id) => `---\nid: MSG-x-${id}\nfrom: a\nto: b\ntype: TASK\nref: —\ndate: 2026-09-02T00:00:00Z\n---\n${'c'.repeat(3000)}\n\n`;
  const boite = '# Boîte\n' + Array.from({ length: 6 }, (_, i) => gros(i + 1)).join('');
  const r = launcher.tailInboxBounded(boite, 8, 7000);
  assert.equal(r.hidden, 4); // deux messages tiennent sous 7 000 caractères, pas trois
  assert.match(r.content, /^# Boîte\n---\nid: MSG-x-5\n/);
  assert.match(r.content, /MSG-x-6\n/);
  const seul = launcher.tailInboxBounded(boite, 8, 100);
  assert.equal(seul.hidden, 5);
  assert.match(seul.content, /MSG-x-6\n/);
  assert.deepEqual(launcher.tailInboxBounded('# Boîte\n', 8, 100), { content: '# Boîte\n', hidden: 0 });
});

test('buildUserPromptDetail : blocs mesurés, notes de troncature sur JOURNAL et PROGRESS, surcharge par CONFIG.md', () => {
  const root = makeRoot();
  const ligne = (i) => `## Session ${i} — ${'récit '.repeat(800)}`; // ≈ 4 800 caractères par ligne
  fs.writeFileSync(path.join(root, 'mission/concepteur/enfant/JOURNAL.md'), '# Journal\n' + Array.from({ length: 30 }, (_, i) => ligne(i + 1)).join('\n') + '\n');
  const progress = '# Avancement\n' + Array.from({ length: 12 }, (_, i) => `2026-09-02T00:0${i % 10}:00Z · concepteur/enfant · ON_ORIENT · ${'plan '.repeat(180)}`).join('\n') + '\n';
  fs.writeFileSync(path.join(root, 'mission/registry/PROGRESS.md'), progress);
  const l = launcher.prepareLaunch(root, 'concepteur/enfant', {});
  const bloc = (nom) => l.blocs.find((b) => b.nom === nom);
  assert.deepEqual(l.blocs.map((b) => b.nom), ['ROLE', 'MEMORY', 'STATUS', 'INBOX', 'JOURNAL', 'PROGRESS']);
  assert.ok(bloc('JOURNAL').chars <= 8000);
  assert.ok(bloc('PROGRESS').chars <= 4000);
  assert.match(bloc('PROGRESS').note, /ligne\(s\) retirée\(s\)/);
  assert.match(l.prompt, /40 dernières lignes, bornées à 8000 caractères \(\d+ ligne\(s\) retirée\(s\)\)/);
  assert.match(l.prompt, /10 dernières, bornées à 4000 caractères/);
  assert.match(l.prompt, /Session 30 —/);
  assert.doesNotMatch(l.prompt, /Session 1 —/);
  assert.ok(l.prompt.length < 30000, `prompt de ${l.prompt.length} caractères`);
  fs.writeFileSync(path.join(root, 'framework/CONFIG.md'), CONFIG.replace('| max_tours_par_session | 42 |', '| max_tours_par_session | 42 |\n| reveil_journal_chars | 2000 |'));
  assert.ok(launcher.prepareLaunch(root, 'concepteur/enfant', {}).blocs.find((b) => b.nom === 'JOURNAL').chars <= 2000);
});

const ARCHIVE_V2 = path.join(ROOT, 'docs', 'archive', 'mission-holon-v2');
test('buildUserPrompt sur le corpus archivé (concepteur de holon-v2, état final) : moins de 60 000 caractères', { skip: !fs.existsSync(ARCHIVE_V2) && 'docs/archive/ absent (modèle publié, sans archive)' }, () => {
  const root = makeRoot();
  const archive = ARCHIVE_V2;
  for (const f of ['ROLE.md', 'MEMORY.md', 'STATUS.md', 'INBOX.md', 'JOURNAL.md']) fs.copyFileSync(path.join(archive, 'concepteur', f), path.join(root, 'mission/concepteur', f));
  fs.copyFileSync(path.join(archive, 'registry', 'PROGRESS.md'), path.join(root, 'mission/registry/PROGRESS.md'));
  fs.writeFileSync(path.join(root, 'mission/registry/instances/concepteur.md'), fiche('concepteur', { profil: 'conception', alloue: 30 }));
  const l = launcher.prepareLaunch(root, 'concepteur', {});
  assert.ok(l.prompt.length < 60000, `prompt de ${l.prompt.length} caractères`);
  for (const sec of ['## État courant', '## Décisions prises', '## Prochaines actions', '## Points de vigilance']) assert.ok(l.prompt.includes(sec), `section ${sec} absente`);
  const tailles = Object.fromEntries(l.blocs.map((b) => [b.nom, b.chars]));
  assert.ok(tailles.JOURNAL <= 8000 && tailles.PROGRESS <= 4000 && tailles.INBOX <= 12000, JSON.stringify(tailles));
});

test('appendSessionLine : colonne de réveil (caractères système / utilisateur), en-tête à onze colonnes sur fichier neuf', () => {
  const root = makeRoot();
  const res = launcher.parseResultJson('{"type":"result","subtype":"success","session_id":"col-11","total_cost_usd":0.1,"num_turns":1,"usage":{},"permission_denials":[],"is_error":false}\n');
  const meta = { modele: 'opus', effort: 'high' };
  launcher.appendSessionLine(root, 'test-harnais', 'concepteur', meta, res, 10, 'DELIVERED', { systeme: 66804, utilisateur: 4107 });
  const p = path.join(root, 'mission', 'registry', 'SESSIONS.md');
  const s = fs.readFileSync(p, 'utf8');
  const entete = s.split('\n').find((l) => l.startsWith('| Date (UTC)'));
  assert.equal(entete.split('|').length - 2, 11);
  assert.match(entete, /\| Réveil \(car\. système \/ utilisateur\) \|$/);
  assert.match(s.split('\n').find((l) => l.includes('col-11')), /\| DELIVERED \| 66804 \/ 4107 \|$/);
  launcher.appendSessionLine(root, 'test-harnais', 'concepteur', meta, res, 10, 'DELIVERED');
  assert.match(fs.readFileSync(p, 'utf8').trim().split('\n').pop(), /\| DELIVERED \| — \|$/);
});
