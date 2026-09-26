'use strict';
// Chantier 15, §16.3 : gate-guard — une section « Validations requises » de ROLE.md/OBJECTIVE.md
// déclare des portes de validation ; tant qu'une porte n'a pas été franchie (RESPONSE de l'INBOX.md
// portant `porte: V<n>`), toute écriture sous un chemin qu'elle protège est refusée (hook gate-guard),
// et tout DELIVERABLE d'un livrable qu'elle protège est refusé par deliver-guard. Inerte si la source
// ne porte pas de section Validations requises.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// Même mécanique que framework/tests/deliver-guard.test.js : dans le paquet livrable (cible-framework/,
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-gate-guard-hook-'));
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

const ROLE_AVEC_PORTE = `# ROLE — x/enfant

## Livrables

| Livrable | Description | Où | Jalon | Contrôle |
|---|---|---|---|---|
| film | Le film monté | shared/x/enfant/final/film.mp4 | J1 | \`node verif-film.js\` |

## Validations requises

| Porte | Quoi | Par qui | Protège |
|---|---|---|---|
| V1 | échantillon de 30 s validé | utilisateur (organisateur) | shared/x/enfant/final/ ; DELIVERABLE « film » |
`;

const ROLE_SANS_PORTE = `# ROLE — x/enfant

## Livrables

| Livrable | Description | Où | Jalon | Contrôle |
|---|---|---|---|---|
| film | Le film monté | shared/x/enfant/final/film.mp4 | J1 | \`node verif-film.js\` |
`;

/** Fabrique un tmpdir HOLARCH_ROOT avec mission/x/enfant/ROLE.md (et INBOX.md optionnel). */
function makeFixture(role, inbox) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-gate-guard-test-'));
  fs.mkdirSync(path.join(tmp, 'mission', 'x', 'enfant'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'mission', 'x', 'enfant', 'ROLE.md'), role);
  if (inbox !== undefined) fs.writeFileSync(path.join(tmp, 'mission', 'x', 'enfant', 'INBOX.md'), inbox);
  return tmp;
}

const ENV = { HOLARCH_INSTANCE: 'x/enfant' };

function response(porte) {
  return `---\nid: MSG-x-1\nfrom: x\nto: x/enfant\ntype: RESPONSE\nref: —\ndate: 2026-09-20\nporte: ${porte}\n---\nAccord.\n`;
}

test('gate-guard : Write sous un chemin protégé sans RESPONSE — refusé, motif cite la porte et le responsable', () => {
  const tmp = makeFixture(ROLE_AVEC_PORTE);
  const cible = path.join(tmp, 'shared', 'x', 'enfant', 'final', 'a.mp4');
  const out = call('gate-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: 'x' } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /gate-guard/);
  assert.match(reason(out), /V1/);
  assert.match(reason(out), /utilisateur \(organisateur\)/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('gate-guard : même Write, INBOX.md porte une RESPONSE `porte: V1` — accepté', () => {
  const tmp = makeFixture(ROLE_AVEC_PORTE, response('V1'));
  const cible = path.join(tmp, 'shared', 'x', 'enfant', 'final', 'a.mp4');
  const out = call('gate-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: 'x' } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.notEqual(decision(out), 'deny');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('gate-guard : Write sous un chemin non protégé (brouillon/) — inerte', () => {
  const tmp = makeFixture(ROLE_AVEC_PORTE);
  const cible = path.join(tmp, 'shared', 'x', 'enfant', 'brouillon', 'a.mp4');
  const out = call('gate-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: 'x' } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.notEqual(decision(out), 'deny');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('gate-guard : DELIVERABLE du livrable protégé « film » sans RESPONSE — refusé (via deliver-guard), motif cite le livrable et la porte', () => {
  const tmp = makeFixture(ROLE_AVEC_PORTE);
  const corps = [
    '## Contrôles',
    '| Livrable | Commande | Code | Rapport |',
    '|---|---|---|---|',
    '| film | `node verif-film.js` | 0 | rapport-film.txt |',
    '',
    'Regardé : lecture complète du montage',
    '',
    'Livrables couverts : film',
  ].join('\n');
  const contenu = `---\nid: MSG-1\nfrom: x/enfant\nto: x\ntype: DELIVERABLE\nref: —\ndate: 2026-09-20\n---\n${corps}\n`;
  const cible = path.join(tmp, 'mission', 'x', 'enfant', 'OUTBOX.md');
  const out = call('deliver-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: contenu } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.equal(decision(out), 'deny');
  assert.match(reason(out), /gate-guard/);
  assert.match(reason(out), /film/);
  assert.match(reason(out), /V1/);
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('gate-guard : ROLE.md sans section Validations requises — Write sous final/ accepté', () => {
  const tmp = makeFixture(ROLE_SANS_PORTE);
  const cible = path.join(tmp, 'shared', 'x', 'enfant', 'final', 'a.mp4');
  const out = call('gate-guard', { session_id: 's', cwd: tmp, tool_name: 'Write', tool_input: { file_path: cible, content: 'x' } }, Object.assign({ HOLARCH_ROOT: tmp }, ENV));
  assert.notEqual(decision(out), 'deny');
  fs.rmSync(tmp, { recursive: true, force: true });
});
