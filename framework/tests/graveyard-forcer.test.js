'use strict';
// Test à sec (sans clé, sans réseau) de `--nettoyer-worktree <chemin> --forcer` — chantier 14, volet 4,
// U8 (spec : docs/IMPLEMENTATION.md §15.4). Exerce
// mission/shared/concepteur/cible-framework/framework/bin/holarch-spawn.js — jamais
// framework/bin/holarch-spawn.js (fragment non promu) — sur un dépôt Git jetable monté sous
// os.tmpdir() : aucun chemin absolu du dépôt HOLARCH n'est écrit en dur, aucune variable
// HOLARCH_*/ANTHROPIC_* n'est lue ni nécessaire.
// Idiome calqué sur cible-framework/framework/tests/permis-tirages-sec.test.js (node:test +
// assert/strict, chemin sous cible-framework/, jamais le fichier promu).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/** Racine du dépôt HOLARCH — remontée indépendante de la profondeur, durcie au-delà de
 *  permis-tirages-sec.test.js : `framework/KERNEL.md` + `framework/bin/holarch-spawn.js` s'arrêteraient
 *  désormais à tort sur `cible-framework/` (ce fragment y vit aussi, unité U8), il faut en plus
 *  `framework/bin/reveil.js`, jamais copié dans `cible-framework/framework/bin/`. */
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
const FRAGMENT = path.join(__dirname, '..', 'bin', 'holarch-spawn.js'); // fragment sous cible-framework/, jamais le promu

function run(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(res.status, 0, `git ${args.join(' ')} a échoué (${cwd}) : ${res.stderr || res.stdout}`);
  return res;
}

/** Monte un dépôt Git jetable sous os.tmpdir() : framework/bin/ (copie du vrai, holarch-spawn.js
 *  remplacé par le fragment), framework/KERNEL.md, mission/ — marqueurs de racine attendus par
 *  `findRoot`/`worktreeDir` du lanceur, et dépôt Git initialisé avec un commit initial. */
function construireRacineJetable() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-graveyard-forcer-'));
  fs.cpSync(path.join(ROOT, 'framework', 'bin'), path.join(root, 'framework', 'bin'), { recursive: true });
  fs.copyFileSync(FRAGMENT, path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  fs.writeFileSync(path.join(root, 'framework', 'KERNEL.md'), '# KERNEL de test (dépôt jetable)\n');
  fs.mkdirSync(path.join(root, 'mission'), { recursive: true });
  run(root, ['init', '-q']);
  run(root, ['config', 'user.email', 'test-holarch@example.com']);
  run(root, ['config', 'user.name', 'Test HOLARCH']);
  run(root, ['add', '-A']);
  run(root, ['commit', '-q', '-m', 'init']);
  return root;
}

/** Crée le worktree d'une instance (branche `holarch/<chemin>`, dossier attendu par `worktreeDir`)
 *  puis le salit : un fichier suivi modifié, un fichier non suivi ajouté. */
function creerWorktreeSale(root, chemin) {
  const branche = `holarch/${chemin}`;
  const dir = path.join(root, 'mission', '.holarch', 'worktrees', chemin);
  run(root, ['branch', branche]);
  run(root, ['worktree', 'add', dir, branche]);
  fs.appendFileSync(path.join(dir, 'framework', 'KERNEL.md'), 'ligne ajoutée par le worktree sale\n');
  fs.writeFileSync(path.join(dir, 'nouveau-fichier-untracked.txt'), 'contenu non suivi\n');
  return { dir, branche };
}

function cliPath(root) { return path.join(root, 'framework', 'bin', 'holarch-spawn.js'); }

function nettoyerRacine(root) {
  try { spawnSync('git', ['worktree', 'prune'], { cwd: root, encoding: 'utf8' }); } catch (_) { /* best-effort */ }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* best-effort */ }
}

// ------------------------------------------------------- (1) sans --forcer : comportement inchangé

test('--nettoyer-worktree sans --forcer : refus, worktree conservé, aucun patch', () => {
  const root = construireRacineJetable();
  try {
    const chemin = 'inst-sans-forcer';
    const { dir } = creerWorktreeSale(root, chemin);
    const res = spawnSync(process.execPath, [cliPath(root), '--nettoyer-worktree', chemin, '--root', root], { encoding: 'utf8' });
    assert.notEqual(res.status, 0, `code de sortie non nul attendu : ${JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })}`);
    assert.match(res.stderr, /changements non committés/, `message de refus attendu : ${res.stderr}`);
    assert.ok(fs.existsSync(dir), 'le worktree doit rester présent sans --forcer');
    const graveyard = path.join(root, 'mission', '.holarch', 'graveyard');
    assert.ok(!fs.existsSync(graveyard) || fs.readdirSync(graveyard).length === 0, 'aucun patch attendu sans --forcer');
  } finally {
    nettoyerRacine(root);
  }
});

// -------------------------------------------------------------- (2) avec --forcer : patch + suppression

test('--nettoyer-worktree --forcer : worktree supprimé, un patch écrit contenant les deux fichiers', () => {
  const root = construireRacineJetable();
  try {
    const chemin = 'inst-avec-forcer';
    const { dir } = creerWorktreeSale(root, chemin);
    const res = spawnSync(process.execPath, [cliPath(root), '--nettoyer-worktree', chemin, '--forcer', '--root', root], { encoding: 'utf8' });
    assert.equal(res.status, 0, `code de sortie attendu 0 : ${JSON.stringify({ status: res.status, stdout: res.stdout, stderr: res.stderr })}`);
    assert.ok(!fs.existsSync(dir), 'le worktree doit avoir été supprimé de force');
    const graveyard = path.join(root, 'mission', '.holarch', 'graveyard');
    const fichiers = fs.readdirSync(graveyard);
    assert.equal(fichiers.length, 1, `exactement un patch attendu sous mission/.holarch/graveyard/ : ${fichiers.join(', ')}`);
    const contenu = fs.readFileSync(path.join(graveyard, fichiers[0]), 'utf8');
    assert.match(contenu, /KERNEL\.md/, `patch attendu mentionnant le fichier suivi modifié : ${contenu.slice(0, 800)}`);
    assert.match(contenu, /nouveau-fichier-untracked\.txt/, `patch attendu mentionnant le fichier non suivi : ${contenu.slice(0, 800)}`);
    assert.match(res.stdout, /patch écrit/, `sortie attendue mentionnant le patch écrit : ${res.stdout}`);
  } finally {
    nettoyerRacine(root);
  }
});

// ------------------------------------------------------- (3) index réel du worktree non pollué

test('--forcer : le patch est écrit sans modifier l\'index réel du worktree (git status inchangé)', () => {
  const root = construireRacineJetable();
  try {
    const chemin = 'inst-index-intact';
    const { dir } = creerWorktreeSale(root, chemin);
    const lanceur = require(cliPath(root));
    const statusAvant = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
    const gitPathRes = spawnSync('git', ['-C', dir, 'rev-parse', '--git-path', 'index'], { encoding: 'utf8' });
    assert.equal(gitPathRes.status, 0, `git rev-parse --git-path index a échoué : ${gitPathRes.stderr}`);
    const indexRel = gitPathRes.stdout.trim();
    const indexAbs = path.isAbsolute(indexRel) ? indexRel : path.join(dir, indexRel);
    const indexAvant = fs.readFileSync(indexAbs);

    const patch = lanceur.writeGraveyardPatch(root, chemin, dir);

    const statusApres = spawnSync('git', ['-C', dir, 'status', '--porcelain'], { encoding: 'utf8' }).stdout;
    const indexApres = fs.readFileSync(indexAbs);
    assert.equal(statusApres, statusAvant, `git status --porcelain doit rester inchangé après écriture du patch : avant=${JSON.stringify(statusAvant)} après=${JSON.stringify(statusApres)}`);
    assert.ok(indexAvant.equals(indexApres), 'l\'index réel du worktree doit être identique octet à octet avant/après l\'écriture du patch');
    assert.ok(patch && typeof patch === 'string', `un chemin de patch relatif attendu : ${JSON.stringify(patch)}`);
    assert.ok(fs.existsSync(path.join(root, patch)), `le patch retourné doit exister sous la racine : ${patch}`);

    fs.rmSync(dir, { recursive: true, force: true }); // suppression manuelle : removeWorktree déjà couvert par (2)
  } finally {
    nettoyerRacine(root);
  }
});
