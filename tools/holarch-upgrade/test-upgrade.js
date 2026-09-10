'use strict';
// Tests de holarch-upgrade — source = copie du périmètre de ce dépôt dans un répertoire jetable, projet = copie altérée.
// Autonomes : ni holarch-publish (absent du modèle publié), ni package.json → holarch.modele (réseau), ni archive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const up = require('./holarch-upgrade');

const ROOT = path.resolve(__dirname, '..', '..');
const BIN = path.join(__dirname, 'holarch-upgrade.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-upgrade-test-'));
const CALME = '1 bash\n2 node tools/x.js';
const MISSION = '1 bash\n2 node framework/bin/holarch-spawn.js concepteur\n3 claude -p --model sonnet';
const GIT_ENV = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost' });
const git = (args, cwd) => { const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV }); assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`); return r.stdout.trim(); };

/** Un « modèle » : le périmètre de ce dépôt (sans node_modules), VERSION 1.1.0, package.json sans source. */
function modele(base) {
  const m = path.join(base, 'modele');
  const filtre = (s) => !/node_modules|__pycache__|\.venv$/.test(s);
  for (const rel of up.PERIMETRE) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(path.dirname(path.join(m, rel)), { recursive: true });
    fs.cpSync(src, path.join(m, rel), { recursive: true, filter: filtre });
  }
  fs.writeFileSync(path.join(m, 'framework', 'VERSION'), '1.1.0\n');
  fs.mkdirSync(path.join(m, 'mission'), { recursive: true });
  fs.writeFileSync(path.join(m, 'mission', 'OBJECTIVE.md'), 'x\n');
  fs.writeFileSync(path.join(m, 'package.json'), JSON.stringify({ name: 'modele-test', private: true, holarch: { modele: '', version: '1.1.0' } }, null, 2) + '\n');
  return m;
}

/** Le modèle et un projet qui en est issu, en v1.0.0, avec un hook modifié, un outil en trop et deux fichiers préservés adaptés. */
function scenario() {
  const base = tmp();
  const m = modele(base);
  const projet = path.join(base, 'projet');
  fs.cpSync(m, projet, { recursive: true });
  fs.writeFileSync(path.join(projet, 'framework', 'VERSION'), '1.0.0\n');
  fs.appendFileSync(path.join(projet, 'framework', 'hooks', 'holarch-hooks.js'), '\n// ancienne version\n');
  fs.writeFileSync(path.join(projet, 'tools', 'vieux.js'), '');
  fs.appendFileSync(path.join(projet, 'framework', 'CONFIG.md'), '\n<!-- réglage propre au projet -->\n');
  fs.writeFileSync(path.join(projet, 'framework', 'claude', 'instance-settings.json'), '{"permissions":{"allow":["Bash(cargo *)"]}}\n');
  git(['init', '-q', projet]);
  return { base, modele: m, projet };
}

test('rapport : version, niveau, diff dans le périmètre, CONFIG.md préservé et validé, code 1', () => {
  const { modele: m, projet } = scenario();
  const r = up.analyser(projet, { source: m, ps: CALME });
  assert.equal(r.statut, 'disponible');
  assert.equal(r.code, 1);
  assert.equal(r.versionLocale, '1.0.0');
  assert.equal(r.niveau, 'mineure');
  assert.deepEqual(r.diff.modifies, ['framework/VERSION', 'framework/hooks/holarch-hooks.js']);
  assert.deepEqual(r.diff.retires, ['tools/vieux.js']);
  assert.deepEqual(r.diff.reconcilier, ['framework/claude/instance-settings.json']);
  assert.ok(!r.diff.modifies.includes('framework/CONFIG.md'));
  assert.equal(r.config.ok, true, r.config.detail);
  const t = up.formater(r, false);
  assert.match(t, /framework local v1\.0\.0 · modèle v1\.1\.0 · changement mineure · mise à jour disponible : 3 fichier/);
  assert.match(t, /à réconcilier à la main/);
  assert.match(t, /préservé : framework\/CONFIG\.md · ✓/);
  assert.match(up.formater(r, true), /^framework local/);
  assert.ok(!up.formater(r, true).includes('\n'));
  assert.equal(fs.readFileSync(path.join(projet, 'framework', 'VERSION'), 'utf8'), '1.0.0\n'); // rien touché
});

test('apply : refusé pendant qu\'une mission tourne (code 2), appliqué sinon sans toucher CONFIG.md ni instance-settings.json', () => {
  const { modele: m, projet } = scenario();
  const refus = up.analyser(projet, { source: m, ps: MISSION, apply: true });
  assert.equal(refus.statut, 'refus-mission-en-cours');
  assert.equal(refus.code, 2);
  assert.equal(fs.readFileSync(path.join(projet, 'framework', 'VERSION'), 'utf8'), '1.0.0\n');
  const ok = up.analyser(projet, { source: m, ps: CALME, apply: true });
  assert.equal(ok.statut, 'applique');
  assert.equal(ok.code, 0);
  assert.equal(fs.readFileSync(path.join(projet, 'framework', 'VERSION'), 'utf8'), '1.1.0\n');
  assert.ok(!fs.existsSync(path.join(projet, 'tools', 'vieux.js')));
  assert.match(fs.readFileSync(path.join(projet, 'framework', 'CONFIG.md'), 'utf8'), /réglage propre au projet/);
  assert.match(fs.readFileSync(path.join(projet, 'framework', 'claude', 'instance-settings.json'), 'utf8'), /cargo/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(projet, 'package.json'), 'utf8')).holarch.version, '1.1.0');
  const apres = up.analyser(projet, { source: m, ps: CALME });
  assert.equal(apres.statut, 'reconcilier'); // seul instance-settings.json diffère encore, volontairement
  assert.equal(apres.code, 0);
});

test('CONFIG.md invalide contre le nouveau MANIFEST : code 3, rien appliqué, avertissement majeure', () => {
  const { modele: m, projet } = scenario();
  fs.writeFileSync(path.join(m, 'framework', 'VERSION'), '2.0.0\n');
  const manifest = path.join(m, 'framework', 'MANIFEST.md');
  fs.writeFileSync(manifest, fs.readFileSync(manifest, 'utf8').split('\n').filter((l) => !l.includes('heartbeat-log')).join('\n'));
  fs.rmSync(path.join(m, 'framework', 'modules', 'observabilite', 'heartbeat-log.md'));
  const r = up.analyser(projet, { source: m, ps: CALME, apply: true });
  assert.equal(r.statut, 'config-invalide');
  assert.equal(r.code, 3);
  assert.equal(r.niveau, 'majeure');
  assert.match(r.config.detail, /heartbeat-log/);
  assert.match(up.formater(r, false), /version majeure : lire framework\/CHANGELOG\.md/);
  assert.equal(fs.readFileSync(path.join(projet, 'framework', 'VERSION'), 'utf8'), '1.0.0\n');
});

test('à jour, projet plus récent que le modèle, et absence de source (jamais de réseau)', () => {
  const { modele: m, projet } = scenario();
  fs.cpSync(m, projet, { recursive: true, force: true });
  fs.rmSync(path.join(projet, 'tools', 'vieux.js'), { force: true });
  assert.equal(up.analyser(projet, { source: m, ps: CALME }).statut, 'a-jour');
  fs.writeFileSync(path.join(projet, 'framework', 'VERSION'), '9.0.0\n');
  const r = up.analyser(projet, { source: m, ps: CALME, apply: true });
  assert.equal(r.statut, 'local-plus-recent');
  assert.equal(fs.readFileSync(path.join(projet, 'framework', 'VERSION'), 'utf8'), '9.0.0\n');
  assert.equal(up.analyser(m, { ps: CALME }).statut, 'sans-source'); // package.json → holarch.modele vide
});

test('source Git : clone par tag v<semver> le plus grand (dépôt nu local), --ref explicite', () => {
  const { base, modele: m, projet } = scenario();
  git(['init', '-q', '-b', 'main', m]);
  git(['add', '-A'], m); git(['commit', '-q', '-m', 'v1.1.0'], m); git(['tag', 'v1.1.0'], m);
  fs.writeFileSync(path.join(m, 'framework', 'VERSION'), '1.2.0\n');
  git(['add', '-A'], m); git(['commit', '-q', '-m', 'v1.2.0'], m); git(['tag', 'v1.2.0'], m);
  const remote = path.join(base, 'remote.git');
  git(['clone', '-q', '--bare', m, remote]);
  assert.equal(up.dernierTag(remote), 'v1.2.0');
  const r = up.analyser(projet, { source: remote, ps: CALME });
  assert.equal(r.versionSource, '1.2.0');
  assert.equal(r.ref, 'v1.2.0');
  const r11 = up.analyser(projet, { source: remote, ref: 'v1.1.0', ps: CALME });
  assert.equal(r11.versionSource, '1.1.0');
});

test('CLI : --bref une ligne et code 1 ; HOLARCH_GARDE_PS simule les processus ; option inconnue = 2', () => {
  const { modele: m, projet } = scenario();
  const r = spawnSync(process.execPath, [BIN, '--racine', projet, '--source', m, '--bref'], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_GARDE_PS: CALME }) });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout.trim(), /^framework local v1\.0\.0 · modèle v1\.1\.0/);
  assert.equal(r.stdout.trim().split('\n').length, 1);
  const refus = spawnSync(process.execPath, [BIN, '--racine', projet, '--source', m, '--apply', '--json'], { encoding: 'utf8', env: Object.assign({}, process.env, { HOLARCH_GARDE_PS: MISSION }) });
  assert.equal(refus.status, 2);
  assert.equal(JSON.parse(refus.stdout).statut, 'refus-mission-en-cours');
  assert.equal(spawnSync(process.execPath, [BIN, '--bidule'], { encoding: 'utf8' }).status, 2);
});
