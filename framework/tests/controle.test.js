'use strict';
// --controle <chemin> (chantier 15, §16.2) : rejeu de la colonne Contrôle d'un ROLE.md (ou
// OBJECTIVE.md pour la racine) dans l'espace de travail réel de l'instance. Test à sec (sans clé,
// sans réseau) sur un dépôt jetable monté sous os.tmpdir(), modèle graveyard-forcer.test.js. Exerce
// mission/shared/concepteur/cible-framework/framework/bin/holarch-spawn.js — jamais
// framework/bin/holarch-spawn.js (fragment non promu).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Racine du dépôt HOLARCH — même idiome que graveyard-forcer.test.js : `framework/KERNEL.md` +
 *  `framework/bin/reveil.js` (jamais copié dans cible-framework/framework/bin/). */
function trouverRacine(depart) {
  let dir = path.resolve(depart);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md')) && fs.existsSync(path.join(dir, 'framework', 'bin', 'reveil.js'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('racine du dépôt HOLARCH introuvable (framework/KERNEL.md et framework/bin/reveil.js attendus)');
}

const ROOT = trouverRacine(__dirname);
const FRAGMENT_SPAWN = path.join(__dirname, '..', 'bin', 'holarch-spawn.js'); // fragment, jamais le promu
const FRAGMENT_HOOKS = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js'); // fragment : porte parseLivrables

/** Dépôt jetable : framework/bin/ (copie du vrai, holarch-spawn.js remplacé par le fragment),
 *  framework/hooks/holarch-hooks.js (fragment, porte parseLivrables), framework/KERNEL.md, mission/.
 *  Aucun `git init` : --controle ne l'exige que pour son repli « branche », non exercé ici. */
function construireRacineJetable() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-controle-'));
  fs.cpSync(path.join(ROOT, 'framework', 'bin'), path.join(root, 'framework', 'bin'), { recursive: true });
  fs.copyFileSync(FRAGMENT_SPAWN, path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  fs.mkdirSync(path.join(root, 'framework', 'hooks'), { recursive: true });
  fs.copyFileSync(FRAGMENT_HOOKS, path.join(root, 'framework', 'hooks', 'holarch-hooks.js'));
  fs.writeFileSync(path.join(root, 'framework', 'KERNEL.md'), '# KERNEL de test (dépôt jetable)\n');
  fs.mkdirSync(path.join(root, 'mission'), { recursive: true });
  return root;
}
function nettoyer(root) { try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ } }
function cliPath(root) { return path.join(root, 'framework', 'bin', 'holarch-spawn.js'); }

const ROLE_ENFANT = `# ROLE — x/enfant

## Livrables

| Livrable | Format | Emplacement | Critères d'acceptation | Contrôle |
|---|---|---|---|---|
| A | code | shared/x/enfant/a.js | fonctionne | \`node -e "process.exit(0)"\` |
| B | code | shared/x/enfant/b.js | fonctionne | \`node -e "console.log('KO'); process.exit(1)"\` |
`;

const ROLE_SANS_COLONNE = `# ROLE — x/enfant

## Livrables

| Livrable | Format | Emplacement |
|---|---|---|
| A | code | shared/x/enfant/a.js |
`;

const OBJECTIVE_RACINE = `# Objectif — mission \`x\`

## Livrables

| Livrable | Format | Emplacement | Critères d'acceptation | Contrôle |
|---|---|---|---|---|
| A | code | shared/a.js | fonctionne | \`node -e "process.exit(0)"\` |
`;

test("--controle <enfant> : deux commandes, l'une à 0 l'autre à 1 → sortie 1, fichier JSON écrit", () => {
  const root = construireRacineJetable();
  try {
    fs.mkdirSync(path.join(root, 'mission', 'x', 'enfant'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mission', 'x', 'enfant', 'ROLE.md'), ROLE_ENFANT);
    const res = spawnSync(process.execPath, [cliPath(root), '--controle', 'x/enfant', '--root', root], { encoding: 'utf8' });
    assert.equal(res.status, 1, `sortie 1 attendue : ${JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })}`);
    const dir = path.join(root, 'mission', '.holarch', 'controles');
    const fichiers = fs.readdirSync(dir).filter((f) => f.startsWith('x-enfant-'));
    assert.equal(fichiers.length, 1, `un seul fichier de contrôle attendu : ${fichiers.join(', ')}`);
    const payload = JSON.parse(fs.readFileSync(path.join(dir, fichiers[0]), 'utf8'));
    assert.equal(payload.chemin, 'x/enfant');
    assert.deepEqual(payload.controles.map((c) => c.code), [0, 1]);
    assert.equal(payload.tousAZero, false);
    assert.equal(payload.espace, 'disque');
  } finally {
    nettoyer(root);
  }
});

test('--controle : ROLE.md sans colonne Contrôle → sortie 0, aucun fichier écrit', () => {
  const root = construireRacineJetable();
  try {
    fs.mkdirSync(path.join(root, 'mission', 'x', 'enfant'), { recursive: true });
    fs.writeFileSync(path.join(root, 'mission', 'x', 'enfant', 'ROLE.md'), ROLE_SANS_COLONNE);
    const res = spawnSync(process.execPath, [cliPath(root), '--controle', 'x/enfant', '--root', root], { encoding: 'utf8' });
    assert.equal(res.status, 0, `sortie 0 attendue : ${JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })}`);
    assert.match(res.stdout, /aucune colonne Contrôle/);
    const dir = path.join(root, 'mission', '.holarch', 'controles');
    assert.ok(!fs.existsSync(dir) || fs.readdirSync(dir).length === 0, 'aucun fichier de contrôle attendu');
  } finally {
    nettoyer(root);
  }
});

test('--controle <racine, sans /> : lit mission/OBJECTIVE.md, une ligne à 0 → sortie 0, fichier écrit', () => {
  const root = construireRacineJetable();
  try {
    fs.writeFileSync(path.join(root, 'mission', 'OBJECTIVE.md'), OBJECTIVE_RACINE);
    const res = spawnSync(process.execPath, [cliPath(root), '--controle', 'x', '--root', root], { encoding: 'utf8' });
    assert.equal(res.status, 0, `sortie 0 attendue : ${JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })}`);
    const dir = path.join(root, 'mission', '.holarch', 'controles');
    const fichiers = fs.readdirSync(dir).filter((f) => f.startsWith('x-'));
    assert.equal(fichiers.length, 1, `un fichier de contrôle attendu : ${fichiers.join(', ')}`);
    const payload = JSON.parse(fs.readFileSync(path.join(dir, fichiers[0]), 'utf8'));
    assert.equal(payload.source, path.join('mission', 'OBJECTIVE.md'));
    assert.equal(payload.tousAZero, true);
  } finally {
    nettoyer(root);
  }
});

test('--controle <chemin inexistant> : source introuvable (ni worktree, ni disque, ni branche) → sortie 2', () => {
  const root = construireRacineJetable();
  try {
    const res = spawnSync(process.execPath, [cliPath(root), '--controle', 'x/absent', '--root', root], { encoding: 'utf8' });
    assert.equal(res.status, 2, `sortie 2 attendue : ${JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })}`);
    assert.match(res.stderr, /source introuvable/);
  } finally {
    nettoyer(root);
  }
});
