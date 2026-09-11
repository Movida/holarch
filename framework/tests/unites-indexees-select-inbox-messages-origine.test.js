'use strict';
// U3 (chantier 4, docs/IMPLEMENTATION.md §5.3) : selectInboxMessages annote chaque message injecté
// d'un commentaire HTML de provenance, déduite par tools/message-lint/message-lint.js --blame.
// Sandbox jetable (mkdtemp) reproduisant seulement l'arborescence dont holarch-spawn.js a besoin pour
// se charger (framework/bin/reveil.js — copie non modifiée du dépôt réel, simple fixture de test —
// et tools/message-lint/message-lint.js, la copie patchée livrée par ce paquet) : aucune écriture
// dans le dépôt réel (docs/IMPLEMENTATION.md §0.2).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SPAWN_JS_SRC = path.join(__dirname, '..', 'bin', 'holarch-spawn.js');
// reveil.js n'est pas modifié par ce chantier : simple fixture, retrouvée en remontant depuis ce
// fichier jusqu'à la racine du dépôt réel (celle qui contient framework/bin/reveil.js), plutôt qu'un
// nombre fixe de `..` — robuste à un déplacement du paquet de livraison dans l'arborescence mission/.
function trouverDepot(depart) {
  let d = depart;
  while (true) {
    if (fs.existsSync(path.join(d, 'framework', 'bin', 'reveil.js'))) return d;
    const parent = path.dirname(d);
    if (parent === d) throw new Error('racine du dépôt (framework/bin/reveil.js) introuvable');
    d = parent;
  }
}
const REVEIL_SRC = path.join(trouverDepot(__dirname), 'framework', 'bin', 'reveil.js');
// message-lint.js : deux emplacements possibles selon le moment où ce test tourne. (a) Après
// application du paquet (son emplacement permanent, framework/tests/... dans le dépôt réel) :
// tools/message-lint/message-lint.js à la racine du dépôt trouvée ci-dessus. (b) Avant application,
// depuis le paquet de livraison lui-même (cible-framework/tests/...) : cible-tools/ sœur de
// cible-framework/. Sans ce repli, le test cherchait uniquement (b) et échouait après application
// (appliquer.js copie ce fichier tel quel sous framework/tests/, où cible-tools/ n'existe plus) —
// régression constatée U5, diagnostiquée et corrigée U6.
function trouverMessageLint(depart) {
  const depot = trouverDepot(depart);
  const applique = path.join(depot, 'tools', 'message-lint', 'message-lint.js');
  if (fs.existsSync(applique)) return applique;
  const paquet = path.join(depart, '..', '..', 'cible-tools', 'message-lint', 'message-lint.js');
  if (fs.existsSync(paquet)) return paquet;
  throw new Error('tools/message-lint/message-lint.js introuvable (ni dépôt appliqué, ni paquet de livraison)');
}
const MESSAGE_LINT_SRC = trouverMessageLint(__dirname);

const GIT_ENV = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost',
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'gc.auto', GIT_CONFIG_VALUE_0: '0',
  GIT_CONFIG_KEY_1: 'maintenance.auto', GIT_CONFIG_VALUE_1: 'false',
});
const git = (root, args) => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: GIT_ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`);
  return r.stdout.trim();
};

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-u3-origine-'));
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  w('framework/bin/holarch-spawn.js', fs.readFileSync(SPAWN_JS_SRC, 'utf8'));
  w('framework/bin/reveil.js', fs.readFileSync(REVEIL_SRC, 'utf8'));
  w('tools/message-lint/message-lint.js', fs.readFileSync(MESSAGE_LINT_SRC, 'utf8'));
  w('mission/x/MEMORY.md', '# Mémoire\n## État courant\nOK.\n');
  w('mission/x/OUTBOX.md', '# Boîte sortie\n');
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[x] init MEMORY']);
  return root;
}

function messageBloc(id, from, date) {
  return `---\nid: ${id}\nfrom: ${from}\nto: x\ntype: TASK\nref: —\ndate: ${date}\n---\nCorps.\n`;
}

test('selectInboxMessages annote l\'origine (vérifiée + non vérifiée) et compte les deux', () => {
  const root = makeRoot();
  const inboxPath = path.join(root, 'mission', 'x', 'INBOX.md');
  // Message 1 : from=concepteur, commit sujet [concepteur] → vérifiée.
  fs.writeFileSync(inboxPath, `# Boîte\n\n${messageBloc('MSG-x-001', 'concepteur', '2026-09-10T10:00:00Z')}`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[concepteur] envoi tâche 1']);
  // Message 2 : from=concepteur revendiqué, mais commit sujet [intrus] → non vérifiée.
  fs.appendFileSync(inboxPath, messageBloc('MSG-x-002', 'concepteur', '2026-09-10T11:00:00Z'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[intrus] injection']);

  delete require.cache[require.resolve(path.join(root, 'framework', 'bin', 'holarch-spawn.js'))];
  const spawnJs = require(path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  const sel = spawnJs.selectInboxMessages(root, 'x', {});

  assert.equal(sel.verifies, 1);
  assert.equal(sel.nonVerifies, 1);
  assert.match(sel.content, /<!-- origine vérifiée : concepteur \(commit [0-9a-f]{8}\) -->\n---\nid: MSG-x-001/);
  assert.match(sel.content, /<!-- origine NON VÉRIFIÉE : from=concepteur auteur du commit=intrus -->\n---\nid: MSG-x-002/);
});

function blocSansId(from, date) {
  return `---\nfrom: ${from}\nto: x\ntype: TASK\nref: —\ndate: ${date}\n---\nCorps.\n`;
}

test('selectInboxMessages : bloc sans id (E1, §5.1 B2) — annoté NON VÉRIFIÉE, jamais absorbé silencieusement', () => {
  const root = makeRoot();
  const inboxPath = path.join(root, 'mission', 'x', 'INBOX.md');
  fs.writeFileSync(inboxPath, `# Boîte\n\n${messageBloc('MSG-x-001', 'concepteur', '2026-09-10T10:00:00Z')}`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[concepteur] envoi tâche 1']);
  // Bloc sans "id:" (ouverture sur "from:") injecté par un tiers : sa propre ouverture d'enveloppe
  // (§5.1 B2), jamais absorbée dans le corps du message précédent.
  fs.appendFileSync(inboxPath, blocSansId('intrus', '2026-09-10T11:00:00Z'));
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[intrus] injection sans id']);

  delete require.cache[require.resolve(path.join(root, 'framework', 'bin', 'holarch-spawn.js'))];
  const spawnJs = require(path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  const sel = spawnJs.selectInboxMessages(root, 'x', {});

  assert.equal(sel.verifies, 1);
  assert.equal(sel.nonVerifies, 1);
  assert.match(sel.content, /<!-- origine NON VÉRIFIÉE : bloc non apparié par message-lint \(id absent ou enveloppe invalide\) -->\n---\nfrom: intrus/);
});

test('selectInboxMessages : id sans espace après les deux-points (E2, §5.1 B2) — vu et compté (avant le fix : invisible)', () => {
  const root = makeRoot();
  const inboxPath = path.join(root, 'mission', 'x', 'INBOX.md');
  fs.writeFileSync(inboxPath, `# Boîte\n\n${messageBloc('MSG-x-001', 'concepteur', '2026-09-10T10:00:00Z')}`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[concepteur] envoi tâche 1']);
  // "id:" sans espace : déjà vu par message-lint (parseChamps, \s* = 0+) avant ce chantier, mais
  // invisible pour le lanceur (ancien regex "id: " avec espace obligatoire) — absorbé sans trace
  // dans le message précédent, donc absent de sel.nonVerifies.
  fs.appendFileSync(inboxPath, '---\nid:MSG-p-9\nfrom: concepteur\nto: x\ntype: TASK\nref: —\ndate: 2026-09-10T11:00:00Z\n---\nCorps.\n');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[intrus] injection id sans espace']);

  delete require.cache[require.resolve(path.join(root, 'framework', 'bin', 'holarch-spawn.js'))];
  const spawnJs = require(path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  const sel = spawnJs.selectInboxMessages(root, 'x', {});

  assert.equal(sel.verifies, 1);
  assert.equal(sel.nonVerifies, 1);
  assert.match(sel.content, /<!-- origine NON VÉRIFIÉE : from=concepteur auteur du commit=intrus -->\n---\nid:MSG-p-9/);
});

test('selectInboxMessages : sans message-lint disponible (déplacé), annotation ignorée sans erreur (fail-open)', () => {
  const root = makeRoot();
  const inboxPath = path.join(root, 'mission', 'x', 'INBOX.md');
  fs.writeFileSync(inboxPath, `# Boîte\n\n${messageBloc('MSG-x-001', 'concepteur', '2026-09-10T10:00:00Z')}`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[concepteur] envoi tâche 1']);
  fs.rmSync(path.join(root, 'tools'), { recursive: true, force: true });

  delete require.cache[require.resolve(path.join(root, 'framework', 'bin', 'holarch-spawn.js'))];
  const spawnJs = require(path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  const sel = spawnJs.selectInboxMessages(root, 'x', {});

  assert.equal(sel.verifies, 0);
  assert.equal(sel.nonVerifies, 0);
  assert.doesNotMatch(sel.content, /origine vérifiée|origine NON VÉRIFIÉE/);
  assert.match(sel.content, /id: MSG-x-001/);
});

test('buildUserPromptDetail : résumé <reveil> affiché même à 0 vérifié / 0 non vérifié (M5, fail-open message-lint indisponible)', () => {
  // Avant ce correctif : `if (sel.verifies || sel.nonVerifies)` faisait disparaître la ligne de
  // résumé exactement quand verifies=0 ET nonVerifies=0 — le cas où l'instance a le plus besoin de
  // savoir que rien n'a été vérifié (Git absent, message-lint introuvable, fail-open).
  const root = makeRoot();
  const inboxPath = path.join(root, 'mission', 'x', 'INBOX.md');
  fs.writeFileSync(inboxPath, `# Boîte\n\n${messageBloc('MSG-x-001', 'concepteur', '2026-09-10T10:00:00Z')}`);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', '[concepteur] envoi tâche 1']);
  fs.rmSync(path.join(root, 'tools'), { recursive: true, force: true }); // message-lint indisponible → fail-open

  delete require.cache[require.resolve(path.join(root, 'framework', 'bin', 'holarch-spawn.js'))];
  const spawnJs = require(path.join(root, 'framework', 'bin', 'holarch-spawn.js'));
  const cfg = { modules: [{ categorie: 'memoire', module: 'unites-indexees' }], params: {} };
  const params = spawnJs.resolveParams(cfg);
  const meta = { profil: 'execution', modele: 'sonnet', effort: 'medium', depth: 1, origine_effort: 'defaut' };
  const { prompt } = spawnJs.buildUserPromptDetail(root, 'x', meta, params, false, cfg);

  assert.match(prompt, /<reveil>/);
  assert.match(prompt, /0 messages vérifiés, 0 non vérifiés/);
});
