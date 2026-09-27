'use strict';
// Mode « solo d'abord » (refonte du 2026-09-27, docs/diagnostics/2026-09-27-refonte-apres-releves.md) :
// contrat SOLO.md au lieu du KERNEL, racine créée par le lanceur, cloison entre la racine et la contre-épreuve,
// livraison hors de mission/, contre-épreuve qui renvoie la racine au travail sur un verdict ko.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');

const solo = require('../bin/solo.js');
const spawnMod = require('../bin/holarch-spawn.js');
const HOOKS = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js');
const FAKE = path.join(__dirname, 'fake-claude.js');
const LINT = path.join(__dirname, '..', '..', 'tools', 'config-lint', 'config-lint.js');
const DEPOT = path.join(__dirname, '..', '..');

function blocPreset(nom) {
  const src = fs.readFileSync(path.join(__dirname, '..', 'presets', `${nom}.md`), 'utf8');
  const b = src.slice(src.indexOf('```markdown') + 12);
  return b.slice(0, b.indexOf('\n```'));
}
function configSolo(extra = {}) {
  let t = blocPreset('solo').replace('<nom de la mission>', 'essai-solo');
  for (const [k, v] of Object.entries(extra)) t = t.replace(new RegExp(`^\\| ${k} \\| .*\\|$`, 'm'), `| ${k} | ${v} |`);
  return t;
}
process.env.HOLARCH_CONTRE_EPREUVES = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-ce-etat-'));
function makeRoot(cfg) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-solo-'));
  fs.mkdirSync(path.join(root, 'framework'), { recursive: true });
  fs.writeFileSync(path.join(root, 'framework', 'KERNEL.md'), '# KERNEL (stub)\n');
  fs.copyFileSync(path.join(__dirname, '..', 'SOLO.md'), path.join(root, 'framework', 'SOLO.md'));
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), cfg || configSolo({ livraison_hors_mission: 'src ; README.md' }));
  fs.mkdirSync(path.join(root, 'mission'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), '# Objectif — essai\n\nÉcrire src/f.js qui double un nombre.\n');
  for (const a of [['init', '-q'], ['config', 'user.email', 't@t.t'], ['config', 'user.name', 't'], ['add', '-A'], ['commit', '-q', '-m', 'init']]) execFileSync('git', a, { cwd: root });
  return root;
}
function hook(event, root, instance, tool_name, tool_input) {
  const r = spawnSync('node', [HOOKS, event], { input: JSON.stringify({ session_id: 's', cwd: root, tool_name, tool_input }), encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_INSTANCE: instance, HOLARCH_ROOT: root }) });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout || '{}');
  return j.hookSpecificOutput && j.hookSpecificOutput.permissionDecision === 'deny' ? 'deny' : 'ok';
}

const RES = { type: 'result', subtype: 'success', session_id: 's', total_cost_usd: 0.001, num_turns: 1, usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 }, is_error: false };
const VERDICT = 'mission/.holarch/contre-epreuve/VERDICT.md';
function jouer(root, etapes, opts = {}) {
  const sc = path.join(root, '..', `${path.basename(root)}-scenario.json`);
  fs.writeFileSync(sc, JSON.stringify({ etapes }));
  const avant = { c: process.env.HOLARCH_FAKE_CLAUDE, s: process.env.HOLARCH_FAKE_SCENARIO };
  process.env.HOLARCH_FAKE_CLAUDE = FAKE; process.env.HOLARCH_FAKE_SCENARIO = sc;
  try { spawnMod.launchWithRelaunches(root, 'concepteur', Object.assign({ bootstrap: true }, opts)); } finally {
    if (avant.c === undefined) delete process.env.HOLARCH_FAKE_CLAUDE; else process.env.HOLARCH_FAKE_CLAUDE = avant.c;
    if (avant.s === undefined) delete process.env.HOLARCH_FAKE_SCENARIO; else process.env.HOLARCH_FAKE_SCENARIO = avant.s;
  }
  let n = 0; try { n = Number(fs.readFileSync(`${sc}.attempt`, 'utf8')); } catch (_) { /* aucune session */ }
  return n;
}
const statut = (root) => (fs.readFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), 'utf8').match(/\| État \| (\w+)/) || [])[1];
const livre = (contenu) => ({ statusApres: 'DELIVERED', note: '—', ecrire: [{ chemin: 'src/f.js', contenu }], commit: true, result: RES });
const verdict = (v, extra = '') => ({ statusApres: 'DELIVERED', note: '—', ecrire: [{ chemin: VERDICT, contenu: `Verdict : ${v}\n\n## Synthèse\n3/10 cas échouent (nombres négatifs).${extra}\n\n## Cas\n-7 → attendu -14\n` }], commit: true, result: RES });

test('livraisonHorsMission / cheminLivrable : préfixe de répertoire, instances nommées, racine par défaut', () => {
  const e = solo.livraisonHorsMission('src ; README.md, tests@concepteur+contre-epreuve ; —');
  assert.deepEqual(e.map((x) => x.chemin), ['src', 'README.md', 'tests']);
  assert.ok(solo.cheminLivrable(e, 'src/a/b.js', 'concepteur'));
  assert.ok(solo.cheminLivrable(e, './src', 'concepteur'));
  assert.ok(!solo.cheminLivrable(e, 'srcx/a.js', 'concepteur'), 'préfixe de répertoire, pas de chaîne');
  assert.ok(!solo.cheminLivrable(e, 'src/../framework/x', 'concepteur'), '.. refusé');
  assert.ok(!solo.cheminLivrable(e, 'src/a.js', 'contre-epreuve'), 'sans @ : racine seulement');
  assert.ok(solo.cheminLivrable(e, 'tests/t.js', 'contre-epreuve'));
});

test('git-guard (solo) : chemins de livraison_hors_mission stageables par la racine seulement ; -A et hors liste refusés', () => {
  const root = makeRoot();
  for (const c of ['git add src/f.js', 'git add README.md mission/concepteur/MEMORY.md', 'git add -A src']) assert.equal(hook('git-guard', root, 'concepteur', 'Bash', { command: c }), 'ok', c);
  for (const c of ['git add -A', 'git add framework/x.js', 'git add srcx/a.js', 'git add .', 'git commit -am x']) assert.equal(hook('git-guard', root, 'concepteur', 'Bash', { command: c }), 'deny', c);
  assert.equal(hook('git-guard', root, 'contre-epreuve', 'Bash', { command: 'git add src/f.js' }), 'deny', 'instance non nommée');
});

test('spawn-guard (solo) : aucune instance enfant, --dry-run permis ; inerte en mode équipe', () => {
  const root = makeRoot();
  assert.equal(hook('spawn-guard', root, 'concepteur', 'Bash', { command: 'node framework/bin/holarch-spawn.js concepteur/aide --detach' }), 'deny');
  assert.equal(hook('spawn-guard', root, 'concepteur', 'Bash', { command: 'node framework/bin/holarch-spawn.js concepteur --dry-run' }), 'ok');
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), configSolo({ mode: 'equipe' }));
  const r = spawnSync('node', [HOOKS, 'spawn-guard'], { input: JSON.stringify({ session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: 'node framework/bin/holarch-spawn.js concepteur/aide --detach' } }), encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: root }) });
  assert.doesNotMatch(r.stdout, /mode solo/, 'mode équipe : la règle solo ne s\'applique pas');
});

test('path-guard (solo) : la racine ne lit pas la contre-épreuve, la contre-épreuve ne lit pas la racine', () => {
  const root = makeRoot();
  assert.equal(hook('path-guard', root, 'concepteur', 'Read', { file_path: `${root}/mission/contre-epreuve/VERDICT.md` }), 'deny');
  assert.equal(hook('path-guard', root, 'concepteur', 'Read', { file_path: 'mission/contre-epreuve/cas/1.json' }), 'deny');
  assert.equal(hook('path-guard', root, 'concepteur', 'Grep', { pattern: 'x', path: 'mission/contre-epreuve' }), 'deny');
  assert.equal(hook('path-guard', root, 'concepteur', 'Bash', { command: 'cat mission/contre-epreuve/VERDICT.md' }), 'deny');
  assert.equal(hook('path-guard', root, 'concepteur', 'Read', { file_path: 'mission/concepteur/MEMORY.md' }), 'ok');
  assert.equal(hook('path-guard', root, 'concepteur', 'Read', { file_path: 'mission/contre-epreuvex/a' }), 'ok', 'préfixe exact');
  assert.equal(hook('path-guard', root, 'contre-epreuve', 'Read', { file_path: 'mission/concepteur/MEMORY.md' }), 'deny');
  assert.equal(hook('path-guard', root, 'contre-epreuve', 'Bash', { command: 'ls mission/concepteur/' }), 'deny');
  assert.equal(hook('path-guard', root, 'contre-epreuve', 'Read', { file_path: 'src/f.js' }), 'ok');
  // hors mode solo : inerte
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), configSolo({ mode: 'equipe' }));
  assert.equal(hook('path-guard', root, 'concepteur', 'Read', { file_path: 'mission/contre-epreuve/VERDICT.md' }), 'ok');
});

test('config-lint : preset solo conforme ; mode, contre_epreuve_max et livraison_hors_mission validés', () => {
  const lint = (cfg) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-solo-lint-'));
    fs.writeFileSync(path.join(d, 'CONFIG.md'), cfg);
    return spawnSync('node', [LINT, path.join(d, 'CONFIG.md'), '--manifest', path.join(DEPOT, 'framework', 'MANIFEST.md'), '--modules-dir', path.join(DEPOT, 'framework', 'modules')], { encoding: 'utf8' });
  };
  const okr = lint(configSolo({ livraison_hors_mission: 'src ; README.md' }));
  assert.equal(okr.status, 0, okr.stdout + okr.stderr);
  assert.doesNotMatch(okr.stdout, /avertissement\(s\)[^0]*[1-9]/);
  for (const [k, v, motif] of [['mode', 'duo', /mode/], ['contre_epreuve_max', '9', /contre_epreuve_max/], ['livraison_hors_mission', 'framework/bin', /interdit/], ['livraison_hors_mission', 'src ; ../x', /relatif/], ['livraison_hors_mission', 'mission/shared', /interdit/]]) {
    const r = lint(configSolo({ [k]: v }));
    assert.notEqual(r.status, 0, `${k}=${v} devrait échouer`);
    assert.match(r.stdout + r.stderr, motif);
  }
});

test('prompt système solo : SOLO.md et CONFIG seulement, sans KERNEL ni modules ; bien plus court', () => {
  const root = makeRoot();
  const cfg = spawnMod.parseConfig(fs.readFileSync(path.join(root, 'framework', 'CONFIG.md'), 'utf8'));
  const sys = spawnMod.buildSystemPrompt(root, cfg, false);
  assert.match(sys, /framework\/SOLO\.md/);
  assert.doesNotMatch(sys, /framework\/KERNEL\.md|framework\/modules\//);
  assert.ok(sys.length < 15000, `prompt système solo : ${sys.length} caractères`);
});

test('cycle solo : racine créée sans bootstrap, ko → renvoi avec rapport agrégé, relivraison, ok ; cas jamais dans le dépôt', () => {
  const root = makeRoot();
  const n = jouer(root, [livre('module.exports = (x) => x + x;\n'), verdict('ko'), livre('module.exports = (x) => 2 * x;\n'), verdict('ok')]);
  assert.equal(n, 4, 'quatre sessions : racine, contre-épreuve ko, racine, contre-épreuve ok');
  const log = execFileSync('git', ['log', '--format=%s'], { cwd: root, encoding: 'utf8' });
  assert.match(log, /\[bootstrap\] racine solo créée par le lanceur/);
  assert.match(log, /contre-épreuve ko \(manche 1\)/);
  assert.match(log, /contre-épreuve ok \(manche 2\)/);
  const inbox = fs.readFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), 'utf8');
  assert.match(inbox, /type: ALERT/);
  assert.match(inbox, /3\/10 cas échouent/, 'rapport agrégé transmis');
  assert.doesNotMatch(inbox, /-7 → attendu -14/, 'le détail des cas reste caché');
  assert.equal(statut(root), 'DELIVERED');
  // Cloison physique : aucun cas dans l'arbre ni dans l'historique, archive hors du dépôt.
  assert.ok(!fs.existsSync(path.join(root, VERDICT)), 'TRAVAIL déplacé hors du dépôt');
  assert.doesNotMatch(execFileSync('git', ['log', '-p', '--all'], { cwd: root, encoding: 'utf8' }), /-7 → attendu -14/, 'jamais committé');
  const etat = solo.lireEtat(root, 'essai-solo');
  assert.deepEqual(etat.manches.map((m) => m.verdict), ['ko', 'ok']);
  assert.match(fs.readFileSync(path.join(etat.manches[0].archive, 'VERDICT.md'), 'utf8'), /-7 → attendu -14/, 'le mainteneur garde les cas');
});

test('la racine ne saute pas la contre-épreuve en écrivant le journal du registre', () => {
  const root = makeRoot();
  const faux = { statusApres: 'DELIVERED', note: '—', ecrire: [{ chemin: 'mission/registry/CONTRE-EPREUVES.md', contenu: '| 1 | x | ok | — | — |\n| 2 | x | ok | — | — |\n' }, { chemin: 'src/f.js', contenu: 'x' }], commit: true, result: RES };
  const n = jouer(root, [faux, verdict('ok')]);
  assert.equal(n, 2, 'la contre-épreuve a quand même tourné');
  assert.equal(solo.manchesJouees(root, 'essai-solo'), 1);
});

test('ko à la dernière manche : la racine passe BLOCKED (jamais un faux succès)', () => {
  const root = makeRoot(configSolo({ contre_epreuve_max: '1', livraison_hors_mission: 'src' }));
  jouer(root, [livre('x'), verdict('ko')]);
  assert.equal(statut(root), 'BLOCKED');
  assert.match(fs.readFileSync(path.join(root, 'mission', 'concepteur', 'OUTBOX.md'), 'utf8'), /non acceptée par la contre-épreuve/);
});

test('vérificateur planté : manche non jouée, non comptée, racine BLOCKED avec la commande de reprise', () => {
  const root = makeRoot();
  jouer(root, [livre('x'), { crash: { stderr: 'plantage simulé', exitCode: 1 } }]);
  assert.equal(statut(root), 'BLOCKED');
  assert.match(fs.readFileSync(path.join(root, 'mission', 'concepteur', 'STATUS.md'), 'utf8'), /--contre-epreuve/);
  assert.equal(solo.manchesJouees(root, 'essai-solo'), 0, 'une manche non jouée ne compte pas');
});

test('verdict : seule la première ligne compte ; manches étanches (TRAVAIL vidé à chaque manche)', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, solo.TRAVAIL), { recursive: true });
  fs.writeFileSync(path.join(root, VERDICT), 'Synthèse d\'abord\n\n## Cas\nVerdict : ok\n');
  assert.equal(solo.lireVerdict(root).verdict, null);
  fs.writeFileSync(path.join(root, solo.TRAVAIL, 'cas-manche-1.json'), '{}');
  solo.preparerVerificateur(root, 'essai-solo', 2, 'maintenant', 'src');
  assert.deepEqual(fs.readdirSync(path.join(root, solo.TRAVAIL)), []);
});

test('contre_epreuve = non : la livraison termine sans instance neuve', () => {
  const root = makeRoot(configSolo({ contre_epreuve: 'non' }));
  assert.equal(jouer(root, [livre('x')]), 1);
  assert.ok(!fs.existsSync(path.join(root, 'mission', 'contre-epreuve')));
});

test('git-guard : stage, update-index, commit <chemin>, .. et chemins absolus ; guillemets', () => {
  const root = makeRoot();
  const g = (c, inst = 'concepteur') => hook('git-guard', root, inst, 'Bash', { command: c });
  for (const c of ['git stage framework/x', 'git update-index --add src/x', 'git commit framework/x -m a', 'git commit -i framework/x -m a', 'git add mission/../framework/x', `git add ${root}/framework/x`, 'git add ":(glob)**"']) assert.equal(g(c), 'deny', c);
  for (const c of ['git add "src/x y.js"', `git add ${root}/src/x.js`, 'git commit -m "[concepteur] a b" mission/concepteur/MEMORY.md', 'git commit -q -m "x y"', 'git stage src/a.js']) assert.equal(g(c), 'ok', c);
});

test('path-guard (solo) : chemins non normalisés et lien symbolique refusés ; NotebookEdit couvert', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'mission', 'contre-epreuve'), { recursive: true });
  fs.symlinkSync(path.join(root, 'mission', 'contre-epreuve'), path.join(root, 'lien'));
  for (const fp of [`${root}/mission//contre-epreuve/V.md`, `${root}/mission/./contre-epreuve/V.md`, `${root}/mission/concepteur/../contre-epreuve/V.md`, `${root}/lien/V.md`, `${root}/mission/.holarch/contre-epreuve/VERDICT.md`]) {
    assert.equal(hook('path-guard', root, 'concepteur', 'Read', { file_path: fp }), 'deny', fp);
  }
  assert.equal(hook('path-guard', root, 'concepteur', 'NotebookEdit', { notebook_path: 'mission/contre-epreuve/n.ipynb' }), 'deny');
  assert.equal(hook('path-guard', root, 'concepteur', 'Bash', { command: 'cat mission//contre-epreuve/x' }), 'deny');
  assert.equal(hook('path-guard', root, 'concepteur', 'Bash', { command: 'cat docs/mission/contre-epreuve/x' }), 'ok', 'plus de faux positif sur un chemin qui contient le segment');
});

test('lanceur (solo) : une instance ne lance aucune instance, quelle que soit la forme', () => {
  const root = makeRoot();
  const r = spawnSync('node', [path.join(__dirname, '..', 'bin', 'holarch-spawn.js'), 'concepteur/aide', '--root', root], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_INSTANCE: 'concepteur', HOLARCH_ROOT: root }) });
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /mode solo : une instance n'en lance aucune autre/);
  assert.equal(hook('spawn-guard', root, 'concepteur', 'Bash', { command: 'npm run mission -- x' }), 'deny');
});
