'use strict';
// Chantier 15, §16.4 : le hook `session-start` répète, au réveil de la racine seulement, l'avertissement
// « brief incomplet : … absentes » quand `mission/OBJECTIVE.md` manque des sections que produit
// `tools/holarch-init` — une CLARIFICATION d'orientation groupée est alors attendue avant toute unité
// de production (typed-escalation, ON_ORIENT). Inerte pour un enfant (instance avec '/'), et si
// `mission/OBJECTIVE.md` est absent.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Même méthode que `framework/tests/path-guard.test.js` : le hook charge `../bin/reveil.js`, absent
 *  du paquet livrable (`cible-framework/framework/` n'a pas de `bin/reveil.js`) — on exerce alors une
 *  copie à l'octet près du hook dans un répertoire temporaire dont `bin/reveil.js` réexporte celui du
 *  dépôt, trouvé par remontée d'ancêtres. Le fichier testé reste le même dans les deux cas. */
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-brief-incomplet-hook-'));
  fs.mkdirSync(path.join(tmp, 'hooks'));
  fs.mkdirSync(path.join(tmp, 'bin'));
  fs.copyFileSync(enPlace, path.join(tmp, 'hooks', 'holarch-hooks.js'));
  fs.writeFileSync(path.join(tmp, 'bin', 'reveil.js'), `module.exports = require(${JSON.stringify(reel)});\n`);
  return { hooks: path.join(tmp, 'hooks', 'holarch-hooks.js'), tmp };
}

const resolu = resolveHooks();
const HOOKS = resolu.hooks;
test.after(() => { if (resolu.tmp) fs.rmSync(resolu.tmp, { recursive: true, force: true }); });

function sessionStart(root, instance) {
  const r = spawnSync('node', [HOOKS, 'session-start'], {
    input: JSON.stringify({ session_id: 's', cwd: root }),
    encoding: 'utf8',
    env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: instance }),
  });
  assert.equal(r.status, 0, r.stderr);
  const j = JSON.parse(r.stdout || '{}');
  return ((j.hookSpecificOutput || {}).additionalContext) || '';
}

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-brief-incomplet-'));
  fs.mkdirSync(path.join(root, 'mission'), { recursive: true });
  return root;
}

const BRIEF_COMPLET = [
  '# Objectif — mission `x`',
  '',
  '## Échéance',
  'vendredi',
  '',
  '### Validations requises',
  '| Porte | Quoi | Par qui | Protège |',
  '|---|---|---|---|',
  '| — | — | — | — |',
  '',
  '## Ressources',
  'aucune',
  '',
].join('\n');

const BRIEF_INCOMPLET = '# Objectif — mission `x`\n\n## Énoncé\ntexte\n';

test('session-start : racine, brief incomplet → additionalContext contient "brief incomplet" et "Échéance"', () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), BRIEF_INCOMPLET);
    const ctx = sessionStart(root, 'concepteur');
    assert.match(ctx, /brief incomplet/);
    assert.match(ctx, /Échéance/);
    assert.match(ctx, /CLARIFICATION/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('session-start : racine, brief complet → additionalContext ne contient pas "brief incomplet"', () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), BRIEF_COMPLET);
    const ctx = sessionStart(root, 'concepteur');
    assert.doesNotMatch(ctx, /brief incomplet/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('session-start : enfant (instance "concepteur/dev"), brief incomplet → inerte quand même (pas de "brief incomplet")', () => {
  const root = tmpRoot();
  try {
    fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), BRIEF_INCOMPLET);
    const ctx = sessionStart(root, 'concepteur/dev');
    assert.doesNotMatch(ctx, /brief incomplet/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('session-start : mission/OBJECTIVE.md absent → pas de plantage, pas de "brief incomplet"', () => {
  const root = tmpRoot();
  try {
    const ctx = sessionStart(root, 'concepteur');
    assert.doesNotMatch(ctx, /brief incomplet/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('briefIncomplet (unitaire) : table Livrables sans colonne Contrôle → "colonne Contrôle" dans le message', () => {
  const hooks = require(HOOKS);
  const root = tmpRoot();
  try {
    const texte = [
      '# Objectif — mission `x`', '',
      '## Échéance', 'x', '',
      '### Validations requises',
      '| Porte | Quoi | Par qui | Protège |', '|---|---|---|---|', '| — | — | — | — |', '',
      '## Ressources', 'x', '',
      '## Critères d\'acceptation',
      '| Livrable | Format | Emplacement |', '|---|---|---|', '| x | y | z |', '',
    ].join('\n');
    fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), texte);
    const b = hooks.briefIncomplet(root);
    assert.match(b, /colonne Contrôle/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
