'use strict';
// Chantier 15, §16.1 : deliver-guard — un message `type: DELIVERABLE` écrit dans un INBOX.md/OUTBOX.md
// doit citer, pour chaque livrable exigé par la table « Livrables » de la source de rôle (ROLE.md d'un
// enfant, OBJECTIVE.md pour l'instance racine), la commande de contrôle déjà lancée avec un code 0, et
// une ligne « Regardé : » attestant une inspection humaine sur pièces. Inerte hors DELIVERABLE, hors
// INBOX.md/OUTBOX.md, ou si la source ne porte pas de colonne « Contrôle » (compatibilité).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Même mécanique que framework/tests/path-guard.test.js : dans le paquet livrable (cible-framework/,
// sans framework/bin/) on exerce une copie à l'octet près du hook dans un répertoire temporaire dont
// bin/reveil.js réexporte le vrai module — le fichier testé reste le même dans les deux cas.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-deliver-guard-hook-'));
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

const ROLE_AVEC_CONTROLE = `# ROLE — x/enfant

## Livrables

| Livrable | Description | Où | Jalon | Contrôle |
|---|---|---|---|---|
| A | Le module A | shared/x/enfant/a.js | J1 | \`node verif-a.js\` |
| B | La note B | shared/x/enfant/b.md | J1 | — |
`;

const ROLE_SANS_CONTROLE = `# ROLE — x/enfant

## Livrables

| Livrable | Description | Où |
|---|---|---|
| A | Le module A | shared/x/enfant/a.js |
`;

/** Fabrique un tmpdir HOLARCH_ROOT avec mission/x/enfant/ROLE.md (et un ROLE.md alternatif si demandé). */
function makeFixture(role) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-deliver-guard-test-'));
  fs.mkdirSync(path.join(tmp, 'mission', 'x', 'enfant'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'mission', 'x', 'enfant', 'ROLE.md'), role);
  return tmp;
}
function ecrireOutbox(tmp, contenu) { return path.join(tmp, 'mission', 'x', 'enfant', 'OUTBOX.md'); }

const ENV = { HOLARCH_INSTANCE: 'x/enfant' };

function deliverable(corps) {
  return `---\nid: MSG-1\nfrom: x/enfant\nto: x\ntype: DELIVERABLE\nref: —\ndate: 2026-09-20\n---\n${corps}\n`;
}

function deliverableAvecId(id, corps) {
  return `---\nid: ${id}\nfrom: x/enfant\nto: x\ntype: DELIVERABLE\nref: —\ndate: 2026-09-20\n---\n${corps}\n`;
}

function taskAvecId(id, corps) {
  return `---\nid: ${id}\nfrom: x/enfant\nto: x\ntype: TASK\nref: —\ndate: 2026-09-20\n---\n${corps}\n`;
}

test('deliver-guard : DELIVERABLE sans section Contrôles — refusé, le message enseigne', () => {
  const tmp = makeFixture(ROLE_AVEC_CONTROLE);
  const contenu = deliverable('Livraison du module A.');
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: ecrireOutbox(tmp), content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /deliver-guard/);
  assert.match(reason(out), /## Contrôles/);
  assert.match(reason(out), /node verif-a\.js/);
  assert.match(reason(out), /Regardé\s*:/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('deliver-guard : commande citée à 0 et ligne Regardé présente — accepté', () => {
  const tmp = makeFixture(ROLE_AVEC_CONTROLE);
  const corps = [
    '## Contrôles',
    '| Livrable | Commande | Code | Rapport |',
    '|---|---|---|---|',
    '| A | `node verif-a.js` | 0 | rapport-a.txt |',
    '',
    'Regardé : planche de 6 vignettes',
  ].join('\n');
  const contenu = deliverable(corps);
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: ecrireOutbox(tmp), content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.notEqual(decision(out), 'deny');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('deliver-guard : commande citée avec un code non nul — refusé, motif « ≠ 0 »', () => {
  const tmp = makeFixture(ROLE_AVEC_CONTROLE);
  const corps = [
    '## Contrôles',
    '| Livrable | Commande | Code | Rapport |',
    '|---|---|---|---|',
    '| A | `node verif-a.js` | 1 | rapport-a.txt |',
    '',
    'Regardé : planche de 6 vignettes',
  ].join('\n');
  const contenu = deliverable(corps);
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: ecrireOutbox(tmp), content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /≠ 0/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('deliver-guard : table complète à 0 mais pas de ligne Regardé — refusé, motif Regardé', () => {
  const tmp = makeFixture(ROLE_AVEC_CONTROLE);
  const corps = [
    '## Contrôles',
    '| Livrable | Commande | Code | Rapport |',
    '|---|---|---|---|',
    '| A | `node verif-a.js` | 0 | rapport-a.txt |',
  ].join('\n');
  const contenu = deliverable(corps);
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: ecrireOutbox(tmp), content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /Regardé/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('deliver-guard : inerte hors périmètre (type PROPOSAL, cible hors INBOX/OUTBOX, ROLE.md sans colonne Contrôle)', () => {
  // (a) type: PROPOSAL — pas un DELIVERABLE
  const tmpA = makeFixture(ROLE_AVEC_CONTROLE);
  const proposal = '---\nid: MSG-1\nfrom: x/enfant\nto: x\ntype: PROPOSAL\nref: —\ndate: 2026-09-20\n---\nUne idée.\n';
  const outA = call('deliver-guard', { session_id: 's', cwd: tmpA, tool_name: 'Write', tool_input: { file_path: ecrireOutbox(tmpA), content: proposal } }, Object.assign({ HOLARCH_ROOT: tmpA }, ENV));
  assert.notEqual(decision(outA), 'deny');
  fs.rmSync(tmpA, { recursive: true, force: true });

  // (b) type: DELIVERABLE écrit hors INBOX.md/OUTBOX.md
  const tmpB = makeFixture(ROLE_AVEC_CONTROLE);
  const contenuB = deliverable('Livraison du module A.');
  const cibleB = path.join(tmpB, 'mission', 'x', 'enfant', 'workspace', 'notes.md');
  fs.mkdirSync(path.dirname(cibleB), { recursive: true });
  const outB = call('deliver-guard', { session_id: 's', cwd: tmpB, tool_name: 'Write', tool_input: { file_path: cibleB, content: contenuB } }, Object.assign({ HOLARCH_ROOT: tmpB }, ENV));
  assert.notEqual(decision(outB), 'deny');
  fs.rmSync(tmpB, { recursive: true, force: true });

  // (c) ROLE.md sans colonne Contrôle — inerte (compatibilité)
  const tmpC = makeFixture(ROLE_SANS_CONTROLE);
  const contenuC = deliverable('Livraison du module A.');
  const outC = call('deliver-guard', { session_id: 's', cwd: tmpC, tool_name: 'Write', tool_input: { file_path: ecrireOutbox(tmpC), content: contenuC } }, Object.assign({ HOLARCH_ROOT: tmpC }, ENV));
  assert.notEqual(decision(outC), 'deny');
  fs.rmSync(tmpC, { recursive: true, force: true });
});

test("deliver-guard : ancien DELIVERABLE valide déjà sur disque + nouveau DELIVERABLE sans contrôles (Write qui réécrit le fichier) — refusé, le motif cite l'id du nouveau seulement", () => {
  const tmp = makeFixture(ROLE_AVEC_CONTROLE);
  const corpsValide = [
    '## Contrôles',
    '| Livrable | Commande | Code | Rapport |',
    '|---|---|---|---|',
    '| A | `node verif-a.js` | 0 | rapport-a.txt |',
    '',
    'Regardé : planche de 6 vignettes',
  ].join('\n');
  const ancien = deliverableAvecId('MSG-x-enfant-1', corpsValide);
  const cible = ecrireOutbox(tmp);
  fs.writeFileSync(cible, ancien);
  const nouveau = deliverableAvecId('MSG-x-enfant-2', 'Livraison du module A.');
  const contenu = ancien + nouveau;
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /MSG-x-enfant-2/);
  assert.doesNotMatch(reason(out), /MSG-x-enfant-1/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('deliver-guard : ancien DELIVERABLE sans contrôles sur disque + TASK ajouté (Write qui réécrit le fichier) — accepté', () => {
  const tmp = makeFixture(ROLE_AVEC_CONTROLE);
  const ancien = deliverableAvecId('MSG-x-enfant-1', 'Livraison du module A.');
  const cible = ecrireOutbox(tmp);
  fs.writeFileSync(cible, ancien);
  const tache = taskAvecId('MSG-x-enfant-2', 'Une tâche.');
  const contenu = ancien + tache;
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.notEqual(decision(out), 'deny');
  fs.rmSync(tmp, { recursive: true, force: true });
});
