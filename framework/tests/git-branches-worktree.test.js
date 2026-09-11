'use strict';
// Tests du chantier 3 « un worktree par instance » (docs/IMPLEMENTATION.md §4.4).
// `node --test framework/tests/git-branches-worktree.test.js` (Node ≥ 18, aucune dépendance, aucun réseau).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const launcher = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));
const HOOKS = path.join(ROOT, 'framework', 'hooks', 'holarch-hooks.js');

function status(etat, note = '') {
  return `# Statut — x\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | 2026-09-10T00:00:00Z |\n| Posé par | soi |\n| Note | ${note} |\n`;
}

function runHook(event, input, env) {
  const r = spawnSync('node', [HOOKS, event], { input: JSON.stringify(input), encoding: 'utf8', env: Object.assign({}, process.env, env) });
  assert.equal(r.status, 0, `hook ${event} exit ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout || '{}');
}

/** Racine de dépôt Git jetable, avec un premier commit (framework/KERNEL.md minimal + mission/ minimale). */
function makeGitRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-worktree-test-'));
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  w('framework/KERNEL.md', '# KERNEL de test\n');
  w('mission/registry/PROGRESS.md', '# Avancement\n');
  w('mission/concepteur/enfant/STATUS.md', status('READY'));
  w('mission/concepteur/enfant/INBOX.md', '# Boîte enfant\n');
  const env = Object.assign({}, process.env, { GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 't@test', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 't@test' });
  spawnSync('git', ['-C', root, 'init', '-q'], { env });
  spawnSync('git', ['-C', root, 'config', 'user.email', 't@test'], { env });
  spawnSync('git', ['-C', root, 'config', 'user.name', 'Test'], { env });
  spawnSync('git', ['-C', root, 'add', '-A'], { env });
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', 'base'], { env });
  const base = spawnSync('git', ['-C', root, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8', env }).stdout.trim();
  return { root, env, base };
}

const CFG_WORKTREE = { modules: [{ categorie: 'extensions', module: 'git-branches' }], params: {} };
const CFG_INACTIF = { modules: [], params: {} };

test('resolveWorkspace : crée le worktree à la première incarnation, le réutilise, erreur explicite si la branche est absente', () => {
  const { root, env } = makeGitRoot();

  // Branche absente : erreur explicite, rien de créé.
  assert.throws(() => launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE), /spawn incomplet : branche absente \(holarch\/concepteur-enfant\)/);
  assert.equal(fs.existsSync(launcher.worktreeDir(root, 'concepteur/enfant')), false);

  // La branche existe (mécanique ON_SPAWN, hors périmètre de resolveWorkspace) : première incarnation → création.
  spawnSync('git', ['-C', root, 'branch', 'holarch/concepteur-enfant'], { env });
  const w1 = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  assert.equal(w1.branche, 'holarch/concepteur-enfant');
  assert.equal(w1.cwd, launcher.worktreeDir(root, 'concepteur/enfant'));
  assert.ok(fs.existsSync(path.join(w1.cwd, 'framework/KERNEL.md')), 'le worktree contient tout le dépôt, pas seulement mission/');

  // Réutilisation : un second appel ne recrée rien et ne perd rien de ce que la session précédente y a écrit.
  fs.writeFileSync(path.join(w1.cwd, 'mission/concepteur/enfant/MEMORY.md'), 'preuve de continuité');
  const w2 = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  assert.equal(w2.cwd, w1.cwd);
  assert.equal(fs.readFileSync(path.join(w2.cwd, 'mission/concepteur/enfant/MEMORY.md'), 'utf8'), 'preuve de continuité');

  // Instance racine (pas de '/' dans le chemin) : jamais de worktree.
  assert.deepEqual(launcher.resolveWorkspace(root, 'concepteur', CFG_WORKTREE), { cwd: root, branche: null });
  // git-branches inactif : jamais de worktree non plus.
  assert.deepEqual(launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_INACTIF), { cwd: root, branche: null });
});

test('instancePath : bascule de la racine du dépôt vers le worktree après resolveWorkspace', () => {
  const { root, env } = makeGitRoot();
  assert.equal(launcher.instancePath(root, 'concepteur/enfant', 'ROLE.md'), path.join(root, 'mission/concepteur/enfant/ROLE.md'));

  spawnSync('git', ['-C', root, 'branch', 'holarch/concepteur-enfant'], { env });
  const w = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  const apres = launcher.instancePath(root, 'concepteur/enfant', 'ROLE.md');
  assert.equal(apres, path.join(w.cwd, 'mission/concepteur/enfant/ROLE.md'));
  assert.notEqual(apres, path.join(root, 'mission/concepteur/enfant/ROLE.md'));
});

test('merge=union : INBOX.md d\'un parent alimenté par deux enfants fusionne sans marqueur de conflit', () => {
  const { root, env, base } = makeGitRoot();
  // Les six lignes merge=union du §4.3 (dupliquées ici : la racine de ce test est jetable, pas le dépôt réel).
  fs.writeFileSync(path.join(root, '.gitattributes'),
    'mission/**/INBOX.md      merge=union\n'
    + 'mission/**/OUTBOX.md     merge=union\n'
    + 'mission/registry/PROGRESS.md   merge=union\n'
    + 'mission/registry/SESSIONS.md   merge=union\n'
    + 'mission/registry/REVEILS.md    merge=union\n'
    + 'mission/registry/DECISIONS.md  merge=union\n');
  fs.mkdirSync(path.join(root, 'mission/parent'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mission/parent/INBOX.md'), '# Inbox — parent\n\n<!-- Append-only. -->\n');
  spawnSync('git', ['-C', root, 'add', '-A'], { env });
  spawnSync('git', ['-C', root, 'commit', '-q', '-m', 'base : .gitattributes + INBOX.md parent'], { env });
  // Les deux branches enfants partent du MÊME point, avant tout ajout (ON_SPAWN, git-branches §ON_SPAWN).
  spawnSync('git', ['-C', root, 'branch', 'holarch/parent-a'], { env });
  spawnSync('git', ['-C', root, 'branch', 'holarch/parent-b'], { env });

  const appendOn = (branche, texte) => {
    spawnSync('git', ['-C', root, 'switch', '-q', branche], { env });
    fs.appendFileSync(path.join(root, 'mission/parent/INBOX.md'), texte);
    spawnSync('git', ['-C', root, 'add', '-A'], { env });
    spawnSync('git', ['-C', root, 'commit', '-q', '-m', `[${branche}] message`], { env });
  };
  appendOn('holarch/parent-a', '\n--- MSG-a ---\nmessage de a\n');
  appendOn('holarch/parent-b', '\n--- MSG-b ---\nmessage de b\n');

  spawnSync('git', ['-C', root, 'switch', '-q', base], { env });
  const m1 = spawnSync('git', ['-C', root, 'merge', '--no-ff', '-m', 'review(accept): parent-a', 'holarch/parent-a'], { encoding: 'utf8', env });
  assert.equal(m1.status, 0, `fusion a: ${m1.stdout}${m1.stderr}`);
  const m2 = spawnSync('git', ['-C', root, 'merge', '--no-ff', '-m', 'review(accept): parent-b', 'holarch/parent-b'], { encoding: 'utf8', env });
  assert.equal(m2.status, 0, `fusion b (celle qui exerce réellement merge=union): ${m2.stdout}${m2.stderr}`);

  const final = fs.readFileSync(path.join(root, 'mission/parent/INBOX.md'), 'utf8');
  assert.ok(!final.includes('<<<<<<<'), 'aucun marqueur de conflit attendu (merge=union)');
  assert.match(final, /MSG-a/);
  assert.match(final, /MSG-b/);
  const st = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8', env });
  assert.equal(st.stdout.trim(), '', 'arbre de travail propre après les deux fusions');
});

test('wake-guard sous worktree : écriture dans son propre arbre autorisée, hors arbre refusée sans STATUS actif + ON_ORIENT frais (§4.4)', () => {
  const { root, env } = makeGitRoot();
  spawnSync('git', ['-C', root, 'branch', 'holarch/concepteur-enfant'], { env });
  const w = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  const baseline = fs.readFileSync(path.join(w.cwd, 'mission/registry/PROGRESS.md'), 'utf8').length;
  // Le lanceur positionne HOLARCH_ROOT sur le worktree de l'instance (holarch-spawn.js, prepareLaunch) :
  // c'est ce root-là, pas la racine du dépôt, que le hook doit mesurer pendant la session.
  const henv = { HOLARCH_ROOT: w.cwd, HOLARCH_INSTANCE: 'concepteur/enfant', HOLARCH_PROGRESS_BASELINE: String(baseline) };
  const sid = `t-wake-worktree-${Date.now()}`;
  const write = (rel) => runHook('wake-guard', { session_id: sid, cwd: w.cwd, tool_name: 'Write', tool_input: { file_path: path.join(w.cwd, rel) } }, henv);
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;

  // Dans son propre arbre, sous le worktree : toujours permis, même STATUS=READY (mécanique de spawn, scratch).
  assert.deepEqual(write('mission/concepteur/enfant/workspace/notes.md'), {});
  // Hors de son arbre, STATUS=READY (pas actif) : refusé.
  assert.equal(decision(write('mission/shared/concepteur/enfant/livrable.md')), 'deny');
  // STATUS passe à WORKING, mais pas de ligne ON_ORIENT fraîche pour cette instance : refusé encore.
  fs.writeFileSync(path.join(w.cwd, 'mission/concepteur/enfant/STATUS.md'), status('WORKING'));
  assert.equal(decision(write('mission/shared/concepteur/enfant/livrable.md')), 'deny');
  // Ligne ON_ORIENT ajoutée après le début de session, dans le PROGRESS.md DU WORKTREE : la porte s'ouvre.
  fs.appendFileSync(path.join(w.cwd, 'mission/registry/PROGRESS.md'), '2026-09-10T00:00:00Z · concepteur/enfant · ON_ORIENT · plan\n');
  assert.deepEqual(write('mission/shared/concepteur/enfant/livrable.md'), {});
});

test('wake-guard : un enfant ne peut pas écrire hors de son propre arbre par script, au sein du même worktree — limite documentée (découverte U9)', () => {
  const { root, env } = makeGitRoot();
  spawnSync('git', ['-C', root, 'branch', 'holarch/concepteur-enfant'], { env });
  const w = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  const baseline = fs.readFileSync(path.join(w.cwd, 'mission/registry/PROGRESS.md'), 'utf8').length;
  const henv = { HOLARCH_ROOT: w.cwd, HOLARCH_INSTANCE: 'concepteur/enfant', HOLARCH_PROGRESS_BASELINE: String(baseline) };
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;

  // Garantie réelle : un script qui tente d'écrire ailleurs SOUS LE MÊME WORKTREE (ex. la fiche d'un autre
  // chemin de mission/) sans avoir ouvert la porte (STATUS actif + ON_ORIENT frais) est refusé — même mécanisme
  // que le test précédent, revérifié avec un session_id neuf dédié à ce cas.
  const sid1 = `t-evasion-interne-${Date.now()}`;
  const out1 = runHook('wake-guard', { session_id: sid1, cwd: w.cwd, tool_name: 'Write', tool_input: { file_path: path.join(w.cwd, 'mission/concepteur/ROLE.md') } }, henv);
  assert.equal(decision(out1), 'deny');

  // Limite documentée (memoire/U9-appliquer-decouverte-wakeguard.md, RAPPORT.md) : `wakeGuard` calcule
  // `path.relative(root, cible)` ; si la cible est un chemin absolu totalement hors de `root` (ici : la racine
  // du dépôt réel, PAS le worktree), le relatif commence par `..` et la ligne « hors mission/ » du hook (pensée
  // pour --add-dir) le traite comme hors périmètre du garde-fou : AUTORISÉ. Cette assertion ne prouve pas une
  // protection — elle verrouille mécaniquement le comportement actuel pour qu'un futur changement de wakeGuard
  // soit conscient, pas silencieux. La protection réelle contre ce cas précis vient du bac à sable du CLI Claude
  // Code (répertoires de travail liés au cwd/--add-dir de la session), non testable ici sans session réelle
  // (HOLARCH_E2E=1, hors périmètre de ce chantier).
  const sid2 = `t-evasion-absolue-${Date.now()}`;
  const evasion = path.join(root, 'mission/concepteur/enfant/evasion.md'); // même position relative, hors du worktree
  const out2 = runHook('wake-guard', { session_id: sid2, cwd: w.cwd, tool_name: 'Write', tool_input: { file_path: evasion } }, henv);
  assert.deepEqual(out2, {}, 'comportement actuel non-protecteur, verrouillé volontairement (honnêteté, KERNEL §5.4)');
});

test('non-régression T4 (réduite) : une instance tuée dans son worktree reprend via son état committé sur sa branche', () => {
  const { root, env } = makeGitRoot();
  spawnSync('git', ['-C', root, 'branch', 'holarch/concepteur-enfant'], { env });

  // "Session 1" : incarnation, travail, hibernation volontaire simulée par un commit sur SA branche.
  const w1 = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  fs.writeFileSync(path.join(w1.cwd, 'mission/concepteur/enfant/MEMORY.md'), 'U1 fait, U2 à faire');
  spawnSync('git', ['-C', w1.cwd, 'add', '-A'], { env });
  spawnSync('git', ['-C', w1.cwd, 'commit', '-q', '-m', '[concepteur/enfant] hibernation volontaire (contexte)'], { env });

  // "Session 2" (relance après crash ou hibernation, sans qu'on ait jamais supprimé le worktree) :
  // resolveWorkspace réutilise le MÊME worktree — ni recréation, ni perte.
  const w2 = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  assert.equal(w2.cwd, w1.cwd);
  const memoire = fs.readFileSync(launcher.instancePath(root, 'concepteur/enfant', 'MEMORY.md'), 'utf8');
  assert.equal(memoire, 'U1 fait, U2 à faire');

  // Le contenu committé vit sur la branche, pas seulement dans le worktree : il survivrait même à la
  // suppression du worktree lui-même (graveyard, --nettoyer-worktree).
  const show = spawnSync('git', ['-C', root, 'show', 'holarch/concepteur-enfant:mission/concepteur/enfant/MEMORY.md'], { encoding: 'utf8', env });
  assert.equal(show.stdout.trim(), 'U1 fait, U2 à faire');

  // Portée assumée : ceci vérifie la garantie mécanique worktree+branche, pas tout `launchWithRelaunches` —
  // voir RAPPORT.md.
});

test('non-régression D1 : progressSnapshot/hasProgressed lisent le worktree d\'une instance (fiche ou commit), pas root', () => {
  const { root, env } = makeGitRoot();
  spawnSync('git', ['-C', root, 'branch', 'holarch/concepteur-enfant'], { env });
  const w = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);

  // Cas 1 : une fiche mémoire écrite (et committée) dans le worktree.
  const avant1 = launcher.progressSnapshot(root, 'concepteur/enfant');
  assert.equal(avant1.fiches, 0, 'aucune fiche avant travail');
  assert.equal(fs.existsSync(path.join(root, 'mission/concepteur/enfant/memoire')), false, 'rien sur la racine du dépôt : le progrès vit dans le worktree');
  fs.mkdirSync(path.join(w.cwd, 'mission/concepteur/enfant/memoire'), { recursive: true });
  fs.writeFileSync(path.join(w.cwd, 'mission/concepteur/enfant/memoire/U1-test.md'), '# U1\n');
  spawnSync('git', ['-C', w.cwd, 'add', '-A'], { env });
  spawnSync('git', ['-C', w.cwd, 'commit', '-q', '-m', '[concepteur/enfant] U1 : test'], { env });
  const apres1 = launcher.progressSnapshot(root, 'concepteur/enfant');
  assert.equal(apres1.fiches, 1, 'la fiche écrite dans le worktree doit être comptée (D1)');
  assert.ok(launcher.hasProgressed(avant1, apres1), 'une fiche sous worktree doit être détectée comme un progrès (D1)');

  // Cas 2 : un commit [<chemin>] sans nouvelle fiche (ex. correctif de code) doit aussi compter.
  const avant2 = launcher.progressSnapshot(root, 'concepteur/enfant');
  fs.writeFileSync(path.join(w.cwd, 'mission/concepteur/enfant/JOURNAL.md'), 'note');
  spawnSync('git', ['-C', w.cwd, 'add', '-A'], { env });
  spawnSync('git', ['-C', w.cwd, 'commit', '-q', '-m', '[concepteur/enfant] correctif sans nouvelle fiche'], { env });
  const apres2 = launcher.progressSnapshot(root, 'concepteur/enfant');
  assert.equal(apres2.fiches, avant2.fiches, 'aucune nouvelle fiche dans ce second cas');
  assert.ok(launcher.hasProgressed(avant2, apres2), 'un commit [<chemin>] seul, sur la branche, doit aussi compter comme un progrès (D1)');
});

// --- 1.7.0 : spawn-guard sous isolation = worktree ------------------------------------------------------------
// Dogfooding du 2026-09-10 : ON_SPAWN commit les fichiers de l'enfant SUR SA BRANCHE puis le parent revient sur
// la sienne — sur disque, dans l'arbre du parent, `mission/<enfant>/ROLE.md` n'existe pas, et le fusible refusait
// tout lancement (« ROLE.md absent — applique d'abord la mécanique structurelle du spawn »). Le fusible résout
// désormais disque → worktree → branche, et recompte les enfants par union du disque et des branches.
test('hook spawn-guard : sous worktree, un enfant dont les fichiers ne vivent que sur sa branche (ou dans son worktree) est lançable ; le budget recompte les branches', () => {
  const { root, env, base } = makeGitRoot();
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env }); assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`); return r.stdout; };
  const fiche = (chemin, alloue) => `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Statut | READY |\n| Budget alloué / consommé | ${alloue} / 0 |\n| Profil | execution |\n`;
  w('framework/CONFIG.md', '# Configuration — mission : test\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | orchestration | direct-spawn |\n| 2 | extensions | git-branches |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| profondeur_max | 2 |\n| isolation | worktree |\n');
  w('mission/registry/instances/concepteur.md', fiche('concepteur', 3));
  git('add', '-A'); git('commit', '-q', '-m', 'config');
  // Mécanique ON_SPAWN de git-branches : fichiers de l'enfant et fiche registre sur SA branche, retour sur la base.
  const spawnSurBranche = (nom, fichiers) => {
    git('switch', '-q', '-c', `holarch/concepteur-${nom}`);
    for (const f of fichiers) w(`mission/concepteur/${nom}/${f}`, f === 'STATUS.md' ? status('READY') : `# ${f}\n`);
    w(`mission/registry/instances/concepteur-${nom}.md`, fiche(`concepteur/${nom}`, 1));
    git('add', '-A'); git('commit', '-q', '-m', `[concepteur] spawn ${nom}`);
    git('switch', '-q', base);
  };
  spawnSurBranche('alpha', ['ROLE.md', 'STATUS.md', 'MEMORY.md']);
  spawnSurBranche('beta', ['ROLE.md', 'STATUS.md']); // MEMORY.md manquant sur la branche
  assert.equal(fs.existsSync(path.join(root, 'mission/concepteur/alpha')), false, 'rien sur disque dans l\'arbre du parent');

  const hookEnv = { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' };
  const call = (command) => runHook('spawn-guard', { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command } }, hookEnv);
  const decision = (o) => (o.hookSpecificOutput || {}).permissionDecision;
  const reason = (o) => (o.hookSpecificOutput || {}).permissionDecisionReason || '';

  // alpha : complet sur sa branche → lançable (détaché ou non).
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/alpha --detach'), {});
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/alpha'), {});
  // fantôme : ni disque, ni worktree, ni branche → refus qui nomme les trois lieux.
  const fantome = call('node framework/bin/holarch-spawn.js concepteur/fantome');
  assert.equal(decision(fantome), 'deny');
  assert.match(reason(fantome), /ni sur disque, ni dans son worktree, ni sur sa branche `holarch\/concepteur-fantome`/);
  // beta : MEMORY.md absent de la branche → refus ; présent (non committé) dans son worktree → lançable.
  const beta = call('node framework/bin/holarch-spawn.js concepteur/beta');
  assert.equal(decision(beta), 'deny');
  assert.match(reason(beta), /MEMORY\.md absent/);
  launcher.resolveWorkspace(root, 'concepteur/beta', CFG_WORKTREE);
  fs.writeFileSync(path.join(launcher.worktreeDir(root, 'concepteur/beta'), 'mission/concepteur/beta/MEMORY.md'), '# Mémoire\n');
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/beta'), {});

  // Budget recompté par union disque + branches : enfant (disque, base) + alpha + beta (branches) = 3 = alloué → OK ;
  // alloué 2 → dépassement, motivé par les branches.
  assert.deepEqual(call('node framework/bin/holarch-spawn.js concepteur/alpha'), {});
  w('mission/registry/instances/concepteur.md', fiche('concepteur', 2));
  const over = call('node framework/bin/holarch-spawn.js concepteur/alpha');
  assert.equal(decision(over), 'deny');
  assert.match(reason(over), /3 enfant\(s\).*> alloué 2.*branches d'enfants/);
});

// --- 1.7.0 : module de réveil sous isolation = worktree ------------------------------------------------------
// Dogfooding du 2026-09-10 : deux enfants détachés avaient livré dans leurs worktrees, et `enfants:DELIVERED` du
// parent restait « faux (aucun enfant incarné) » — `listChildren` ne regardait que l'arbre du parent. Le parent
// n'a jamais été réveillé.
test('reveil : enfants:ETAT énumère les enfants depuis les worktrees et les branches ; listWaiters lit une instance en attente dans son worktree, sans doublon', () => {
  const reveil = require(path.join(ROOT, 'framework', 'bin', 'reveil.js'));
  const { root, env, base } = makeGitRoot();
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env }); assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`); return r.stdout; };
  // Le parent `concepteur` attend ses enfants, sur la base ; ses enfants ne vivent que sur leurs branches.
  w('mission/concepteur/STATUS.md', status('WAITING_CHILDREN').replace('| Note |  |', '| Note |  |\n| Réveil | enfants:DELIVERED |'));
  fs.rmSync(path.join(root, 'mission/concepteur/enfant'), { recursive: true }); // makeGitRoot en pose un sur disque : pas ici
  git('add', '-A'); git('commit', '-q', '-m', 'parent en attente');
  for (const nom of ['alpha', 'beta']) {
    git('switch', '-q', '-c', `holarch/concepteur-${nom}`);
    w(`mission/concepteur/${nom}/STATUS.md`, status('READY'));
    git('add', '-A'); git('commit', '-q', '-m', `[concepteur] spawn ${nom}`);
    git('switch', '-q', base);
  }
  const gb = { prefixe: 'holarch/' };
  // Lecteur d'état du lanceur (worktree → disque → branche) ; il lit git-branches dans framework/CONFIG.md.
  w('framework/CONFIG.md', '# Configuration — mission : test\n\n## Modules actifs\n| # | Catégorie | Module |\n|---|---|---|\n| 1 | extensions | git-branches |\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| isolation | worktree |\n');
  const readStatus = (chemin) => launcher.readStatusOf(root, chemin);
  const ctx = { root, chemin: 'concepteur', readStatus, readInbox: () => '', gitBranches: gb };
  const ev = (txt) => reveil.evalReveil(reveil.parseReveil(txt), ctx);

  // Rien sur disque dans l'arbre du parent, mais deux enfants spawnés sur leurs branches : énumérés, pas DELIVERED.
  assert.deepEqual(reveil.listChildren(root, 'concepteur'), [], 'sans contexte git-branches : rien (comportement 1.6.0)');
  assert.deepEqual(reveil.listChildren(root, 'concepteur', gb), ['alpha', 'beta']);
  let r = ev('enfants:DELIVERED');
  assert.equal(r.satisfied, false);
  assert.match(r.details[0].pourquoi, /enfants \[alpha, beta\] états \[READY, READY\]/);

  // alpha incarné : worktree, STATUS DELIVERED écrit dans le worktree (non committé) — vu ; beta encore READY sur sa branche.
  const wa = launcher.resolveWorkspace(root, 'concepteur/alpha', CFG_WORKTREE);
  fs.writeFileSync(path.join(wa.cwd, 'mission/concepteur/alpha/STATUS.md'), status('DELIVERED'));
  r = ev('enfants:DELIVERED');
  assert.equal(r.satisfied, false, 'beta, spawné mais jamais incarné, retient le réveil');
  assert.match(r.details[0].pourquoi, /états \[DELIVERED, READY\]/);
  // beta incarné et livré : condition satisfaite.
  const wb = launcher.resolveWorkspace(root, 'concepteur/beta', CFG_WORKTREE);
  fs.writeFileSync(path.join(wb.cwd, 'mission/concepteur/beta/STATUS.md'), status('DELIVERED'));
  assert.equal(ev('enfants:DELIVERED').satisfied, true);
  // Même sans contexte git-branches, les worktrees suffisent une fois les deux incarnés.
  assert.deepEqual(reveil.listChildren(root, 'concepteur'), ['alpha', 'beta']);

  // listWaiters : alpha passe en attente d'un petit-enfant DANS SON WORKTREE ; la copie périmée de concepteur/STATUS.md
  // que contient ce worktree (branche créée depuis la base) ne doit pas produire un second waiter `concepteur`.
  fs.writeFileSync(path.join(wa.cwd, 'mission/concepteur/alpha/STATUS.md'), status('WAITING_CHILDREN').replace('| Note |  |', '| Note |  |\n| Réveil | enfant:gamma:DELIVERED |'));
  const waiters = reveil.listWaiters(root).map((x) => `${x.chemin} · ${reveil.formatReveil(x.ast)}`).sort();
  assert.deepEqual(waiters, ['concepteur · enfants:DELIVERED', 'concepteur/alpha · enfant:gamma:DELIVERED']);
});

// --- 1.7.1 : INBOX d'un parent lue en union avec les worktrees de ses enfants -------------------------------------
// Mission holarch-provenance (2026-09-10) : l'implémenteur écrit un ALERT dans SA copie de mission/concepteur/INBOX.md
// (worktree, branche) ; sur main, l'INBOX de la racine ne le contient pas avant la fusion — `message:ALERT` de sa
// condition de réveil restait faux, et le message n'était pas injecté à son réveil.
test('readInboxOf : messages écrits par un enfant dans son worktree vus par le parent (dédoublonnés, marqués non fusionnés) ; message:ALERT les voit', () => {
  const reveil = require(path.join(ROOT, 'framework', 'bin', 'reveil.js'));
  const { root, env, base } = makeGitRoot();
  const w = (rel, content) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); };
  const git = (...args) => { const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env }); assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`); return r.stdout; };
  const msg = (id, from, type) => `---\nid: ${id}\nfrom: ${from}\nto: concepteur\ntype: ${type}\nref: —\ndate: 2026-09-10T12:00:00Z\n---\ncorps de ${id}\n`;
  w('mission/concepteur/INBOX.md', `# INBOX — concepteur\n\n${msg('MSG-utilisateur-001', 'utilisateur', 'TASK')}`);
  git('add', '-A'); git('commit', '-q', '-m', 'inbox racine');
  git('branch', 'holarch/concepteur-enfant');
  const we = launcher.resolveWorkspace(root, 'concepteur/enfant', CFG_WORKTREE);
  // L'enfant ajoute un ALERT à SA copie de l'INBOX du parent (non committé, non fusionné).
  fs.appendFileSync(path.join(we.cwd, 'mission/concepteur/INBOX.md'), msg('MSG-enfant-001', 'concepteur/enfant', 'ALERT'));
  // Un worktree étranger (pas un descendant) qui contiendrait une copie ne compte pas.
  w('mission/.holarch/worktrees/autre-instance/mission/concepteur/INBOX.md', msg('MSG-intrus-001', 'autre', 'BLOCKER'));

  const texte = launcher.readInboxOf(root, 'concepteur');
  assert.equal((texte.match(/^id: MSG-utilisateur-001$/gm) || []).length, 1, 'le message déjà présent n\'est pas dupliqué');
  assert.equal((texte.match(/^id: MSG-enfant-001$/gm) || []).length, 1, 'le message de l\'enfant est ajouté une fois');
  assert.match(texte, /<!-- non fusionné : lu depuis le worktree concepteur-enfant -->/);
  assert.doesNotMatch(texte, /MSG-intrus-001/);
  assert.equal(fs.readFileSync(path.join(root, 'mission/concepteur/INBOX.md'), 'utf8').includes('MSG-enfant-001'), false, 'lecture seule : rien n\'est écrit dans l\'INBOX du parent');
  // Le terme message:ALERT du parent le voit ; message:BLOCKER (intrus, hors descendants) non.
  const ctx = { root, chemin: 'concepteur', readStatus: () => null, readInbox: (c) => launcher.readInboxOf(root, c) || '', sinceIso: null };
  assert.equal(reveil.evalReveil(reveil.parseReveil('message:ALERT'), ctx).satisfied, true);
  assert.equal(reveil.evalReveil(reveil.parseReveil('message:BLOCKER'), ctx).satisfied, false);
  // Injection au réveil (1.8.x) : le bloc non fusionné est annoté NON VÉRIFIÉE avec un motif explicite, pas « auteur=? ».
  fs.appendFileSync(path.join(root, 'mission/concepteur/MEMORY.md'), 'x\n'); git('add', '-A'); git('commit', '-q', '-m', '[concepteur] hibernation volontaire (contexte)');
  const sel = launcher.selectInboxMessages(root, 'concepteur', { reveil_inbox_messages: 8, reveil_inbox_chars: 12000 });
  assert.match(sel.content, /<!-- origine NON VÉRIFIÉE : non fusionné, lu depuis le worktree concepteur-enfant \(vérifiable à la fusion de sa branche\) -->\n---\nid: MSG-enfant-001/);
  assert.equal(sel.nonVerifies, 1);
  // Sans worktree : comportement inchangé (fichier seul), null si absent partout.
  assert.equal(launcher.readInboxOf(root, 'concepteur/inexistant'), null);
});
