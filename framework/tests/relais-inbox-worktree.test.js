'use strict';
// 1.14.0 : sous git-branches / isolation = worktree, le parent écrit à son enfant dans mission/<enfant>/INBOX.md de
// SON propre arbre et committe ; le lanceur relaie dans le worktree de l'enfant à l'incarnation suivante, en
// conservant la classe de provenance (sujet du commit de relais). Non committé = non relayé.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const launcher = require('../bin/holarch-spawn.js');

const ENFANT = 'concepteur/enfant';
const CFG = { modules: [{ categorie: 'extensions', module: 'git-branches' }], params: {} };
const msg = (id, from, type) => `---\nid: ${id}\nfrom: ${from}\nto: ${ENFANT}\ntype: ${type}\nref: —\ndate: 2026-09-11T20:00:00Z\n---\ncorps de ${id}\n`;

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-relais-'));
  const w = (rel, c) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, c); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('mission/concepteur/INBOX.md', '# INBOX — concepteur\n');
  w(`mission/${ENFANT}/INBOX.md`, `# INBOX — ${ENFANT}\n\n<!-- Append-only -->\n`);
  w(`mission/${ENFANT}/STATUS.md`, '| État | READY |\n');
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@test' });
  const git = (...a) => { const r = spawnSync('git', ['-C', root, ...a], { encoding: 'utf8', env }); assert.equal(r.status, 0, `git ${a.join(' ')} : ${r.stderr}`); return r.stdout.trim(); };
  git('init', '-q'); git('add', '-A'); git('commit', '-q', '-m', 'base');
  git('branch', 'holarch/concepteur-enfant');
  const wt = launcher.resolveWorkspace(root, ENFANT, CFG);
  return { root, env, git, wt: wt.cwd };
}
const dstText = (t) => fs.readFileSync(path.join(t.wt, 'mission', ENFANT, 'INBOX.md'), 'utf8');
const dstSubject = (t) => spawnSync('git', ['-C', t.wt, 'log', '-1', '--format=%s'], { encoding: 'utf8' }).stdout.trim();

test('message committé par le parent ([concepteur]) : relayé dans le worktree, commit [concepteur], sans doublon au second appel', () => {
  const t = makeRoot();
  fs.appendFileSync(path.join(t.root, 'mission', ENFANT, 'INBOX.md'), msg('MSG-concepteur-1', 'concepteur', 'TASK'));
  t.git('add', '-A'); t.git('commit', '-q', '-m', '[concepteur] TASK à l\'enfant');
  const r1 = launcher.relayInboxFromParent(t.root, ENFANT);
  assert.deepEqual(r1.relayes.map((x) => x.id), ['MSG-concepteur-1']);
  assert.equal(r1.relayes[0].verifie, true);
  assert.match(dstText(t), /id: MSG-concepteur-1/);
  assert.match(dstSubject(t), /^\[concepteur\] relais INBOX MSG-concepteur-1 \(lanceur, depuis l'arbre de concepteur\)$/);
  assert.equal(spawnSync('git', ['-C', t.wt, 'status', '--porcelain'], { encoding: 'utf8' }).stdout.trim(), '', 'worktree propre après relais');
  const r2 = launcher.relayInboxFromParent(t.root, ENFANT);
  assert.equal(r2.relayes.length, 0);
  assert.equal((dstText(t).match(/id: MSG-concepteur-1/g) || []).length, 1);
  // l'INBOX lue par le lanceur pour l'enfant (readInboxOf → worktree) contient le message
  assert.match(launcher.readInboxOf(t.root, ENFANT), /id: MSG-concepteur-1/);
});

test('message non committé : ignoré (motif « non encore committé »), rien d\'écrit ; message humain : relayé sans préfixe', () => {
  const t = makeRoot();
  fs.appendFileSync(path.join(t.root, 'mission', ENFANT, 'INBOX.md'), msg('MSG-concepteur-2', 'concepteur', 'TASK'));
  const r = launcher.relayInboxFromParent(t.root, ENFANT);
  assert.equal(r.relayes.length, 0);
  assert.deepEqual(r.ignores.map((x) => x.id), ['MSG-concepteur-2']);
  assert.doesNotMatch(dstText(t), /MSG-concepteur-2/);
  // commit humain (sans préfixe [..]) → origine utilisateur, vérifiée : sujet de relais sans préfixe
  t.git('add', '-A'); t.git('commit', '-q', '-m', 'Réponse du mainteneur');
  const r2 = launcher.relayInboxFromParent(t.root, ENFANT);
  assert.deepEqual(r2.relayes.map((x) => x.id), ['MSG-concepteur-2']);
  assert.match(dstSubject(t), /^relais INBOX MSG-concepteur-2 \(lanceur, depuis l'arbre de concepteur\)$/);
});

test('sans worktree (racine, ou enfant non incarné) : aucun relais', () => {
  const t = makeRoot();
  assert.equal(launcher.relayInboxFromParent(t.root, 'concepteur'), null);
  assert.equal(launcher.relayInboxFromParent(t.root, 'concepteur/autre'), null);
});
