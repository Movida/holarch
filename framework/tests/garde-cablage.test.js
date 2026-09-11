'use strict';
/**
 * Câblage du garde a posteriori (IMPLEMENTATION §11.4, chantier 9 volet 4) dans le lanceur du paquet —
 * U16. `mission/shared/concepteur/chantier-9-fournisseurs/RAPPORT.md` documente les règles elles-mêmes
 * (`bin/gardes/git.js`, testées unitairement par `verifier-session.test.js`) ; ce fichier prouve la
 * COUTURE : que `launchWithRelaunches` appelle réellement `verifierApresSession` autour de chaque
 * tentative, avant `appendSessionLine`, avec les bons shas de bornage (HEAD de la branche de
 * l'instance, `shaInstance`).
 *
 * Fixture : un dépôt Git jetable sous `os.tmpdir()`, module `extensions/git-branches` actif
 * (isolation par défaut = `worktree`) — même mécanique que `git-branches-worktree.test.js` : la
 * branche `holarch/concepteur-enfant` est créée AVANT l'appel à `launchWithRelaunches` (comme le
 * ferait ON_SPAWN), et c'est elle que `shaInstance` observe. Le 4ᵉ argument de `launchWithRelaunches`
 * (`runner`) remplace entièrement `runOnce` : le runner factice écrit et commite directement dans
 * `launch.cwd` (le worktree de l'instance, déjà créé par `prepareLaunch` → `resolveWorkspace`), sans
 * exécuter aucun exécuteur réel — aucune clé, aucun réseau.
 *
 * Un seul essai par cas : chaque runner factice fait finir STATUS.md à `DELIVERED`, un état qui n'est
 * jamais « hibernation volontaire (…) » — `launchWithRelaunches` sort donc de sa boucle après la
 * première tentative (`voluntary` faux), qu'il y ait ou non un écart grave.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const { launchWithRelaunches } = require(path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js'));

const CHEMIN = 'concepteur/enfant';
const BRANCHE = 'holarch/concepteur-enfant';

const CONFIG = `# Configuration — mission : test-garde-cablage
> Preset de base : solo-light · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | extensions | git-branches |

## Paramètres
| Paramètre | Valeur |
|---|---|
| profondeur_max | 2 |
| commit_par_session | non |
`;

const GIT_ENV = Object.assign({}, process.env, {
  GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@localhost',
  GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@localhost',
});
function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: GIT_ENV });
}

function statusMd(etat, note, reveilTxt = '—') {
  return `# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Note | ${note} |\n| Réveil | ${reveilTxt} |\n`;
}

function fiche(profil) {
  return `# concepteur/enfant\n| Champ | Valeur |\n|---|---|\n| Rôle | test |\n| Parent | concepteur |\n`
    + `| Statut | READY |\n| Budget alloué / consommé | 3 / 0 |\n| Dépend de | — |\n| Profil | ${profil} |\n`
    + '| Livrables | — |\n| Créée / Archivée | 2026-01-01T00:00:00Z / — |\n';
}

/** Dépôt jetable : commit initial (STATUS.md à WORKING, « hibernation volontaire (init) », transition
 *  admise vers DELIVERED — KERNEL §3), puis branche `holarch/concepteur-enfant` créée dessus, comme le
 *  ferait ON_SPAWN avant toute incarnation. */
function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-garde-cablage-'));
  const w = (rel, content) => {
    const p = path.join(root, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  };
  w('framework/KERNEL.md', '# KERNEL\n(stub de test — présence seule requise par findRoot)\n');
  w('framework/CONFIG.md', CONFIG);
  w('mission/OBJECTIVE.md', 'Objectif de test.\n');
  w('mission/concepteur/INBOX.md', '# Boîte entrante — concepteur\n');
  w(`mission/${CHEMIN}/ROLE.md`, '# Rôle\nEnfant de test (garde-cablage).\n');
  w(`mission/${CHEMIN}/MEMORY.md`, '# Mémoire\n(vide)\n');
  w(`mission/${CHEMIN}/STATUS.md`, statusMd('WORKING', 'hibernation volontaire (init)'));
  w(`mission/${CHEMIN}/JOURNAL.md`, '## init\nRAS.\n');
  w(`mission/${CHEMIN}/INBOX.md`, '# Boîte entrante\n');
  w(`mission/${CHEMIN}/OUTBOX.md`, '# Boîte sortante\n');
  w('mission/registry/instances/concepteur-enfant.md', fiche('execution'));
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'init']);
  git(root, ['branch', BRANCHE]); // mécanique ON_SPAWN : la branche existe avant toute incarnation
  return root;
}

/** Résultat normalisé minimal (contrat `Resultat` de `bin/executeurs/index.js`), identique pour les
 *  deux runners factices : c'est le garde, pas le contenu du résultat, qui doit faire la différence. */
function resFactice(sessionId) {
  return {
    res: {
      session_id: sessionId,
      tours: 1,
      cout_usd: 0.001,
      tokens: { entree: 100, cache_lu: 0, cache_ecrit: 0, sortie: 50 },
      modeles: [],
      fin: 'success',
      sous_type: 'success',
      refus: 0,
      statut_http: null,
      texte: '',
      brut: null,
    },
    elapsedMs: 10,
    exitCode: 0,
    signal: null,
    error: null,
    logBase: null,
    stderr: '',
    // Pas de nom d'exécuteur ici : `limiteApi` retombe sur `launch.executeur` (résolu par
    // `prepareLaunch`, défaut `claude-code`) — un nom inventé n'est pas dans `executeurs.resoudre`.
    executeur: undefined,
  };
}

/** Runner factice « sale » : commite, en plus de la fin normale de session (STATUS → DELIVERED, dans
 *  l'arbre de l'instance), un fichier hors de cet arbre (`docs/`, racine du harnais — framework-guard). */
function runnerSale(launch, attempt) {
  const cwd = launch.cwd; // worktree de l'instance, déjà créé par prepareLaunch → resolveWorkspace
  fs.writeFileSync(path.join(cwd, 'mission', CHEMIN, 'STATUS.md'), statusMd('DELIVERED', 'terminé (sale, test)'));
  fs.mkdirSync(path.join(cwd, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'docs', 'intrus.md'), "# Intrusion\nÉcriture hors de l'arbre de l'instance (test garde-cablage).\n");
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', `[${CHEMIN}] session sale (test garde-cablage)`]);
  return resFactice(`sale-${attempt}`);
}

/** Runner factice « propre » : ne commite que dans son propre arbre (STATUS → DELIVERED, MEMORY.md
 *  mis à jour). */
function runnerPropre(launch, attempt) {
  const cwd = launch.cwd;
  fs.writeFileSync(path.join(cwd, 'mission', CHEMIN, 'STATUS.md'), statusMd('DELIVERED', 'terminé (propre, test)'));
  fs.writeFileSync(path.join(cwd, 'mission', CHEMIN, 'MEMORY.md'), '# Mémoire\nMise à jour propre (test garde-cablage).\n');
  git(cwd, ['add', '-A']);
  git(cwd, ['commit', '-q', '-m', `[${CHEMIN}] session propre (test garde-cablage)`]);
  return resFactice(`propre-${attempt}`);
}

test('garde câblé (cas sale) : écriture hors arbre → ALERT dans l\'INBOX du parent et session marquée fin = erreur', () => {
  const root = makeRoot();
  try {
    const sessions = launchWithRelaunches(root, CHEMIN, {}, runnerSale);
    assert.equal(sessions.length, 1, 'STATUS finit à DELIVERED : un seul essai, pas de ré-incarnation');
    assert.ok(sessions[0].garde.ecarts.some((e) => e.regle === 1), 'un écart de règle 1 (hors arbre) doit être détecté');
    assert.ok(sessions[0].garde.alerte, 'un identifiant de message ALERT doit être renvoyé par le garde');
    assert.equal(sessions[0].res.fin, 'erreur', 'la règle 1 est grave : la session ne compte pas comme un progrès');
    const inboxParent = fs.readFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), 'utf8');
    assert.match(inboxParent, /type: ALERT/);
    assert.match(inboxParent, /from: harnais/);
    assert.match(inboxParent, /Garde a posteriori du lanceur/);
    assert.match(inboxParent, /règle 1 · docs\/intrus\.md/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('garde câblé (cas propre) : écritures dans l\'arbre de l\'instance seulement → aucun écart, aucune ALERT, fin inchangée', () => {
  const root = makeRoot();
  try {
    const sessions = launchWithRelaunches(root, CHEMIN, {}, runnerPropre);
    assert.equal(sessions.length, 1, 'STATUS finit à DELIVERED : un seul essai, pas de ré-incarnation');
    assert.deepEqual(sessions[0].garde.ecarts, [], 'aucun écart pour une session propre');
    assert.equal(sessions[0].garde.alerte, null, 'aucune ALERT sans écart grave');
    assert.equal(sessions[0].res.fin, 'success', 'fin inchangée : le garde ne touche à `res.fin` que sur écart grave');
    const inboxParent = fs.readFileSync(path.join(root, 'mission', 'concepteur', 'INBOX.md'), 'utf8');
    assert.doesNotMatch(inboxParent, /type: ALERT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
