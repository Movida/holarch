'use strict';
/**
 * Tests de spaces.js — espaces, racines lisibles, mémoire par spécialiste, DECISIONS.md, DIGEST.md.
 *
 * Tout est hors ligne : aucun `claude -p`, aucun sous-processus autre que `git` sur un dépôt
 * temporaire créé ici même. `HOLARCH_HOME` est isolé dans un répertoire temporaire à chaque test
 * (convention de test-ledger.js / test-tasks.js) : rien n'est jamais écrit dans le vrai `~/.holarch/`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const espaces = require('./spaces');

function racineTemporaire() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-spaces-')));
  process.env.HOLARCH_HOME = d;
  return d;
}

/** Un répertoire quelconque, utilisable comme racine déclarée. */
function dossierTemporaire(prefixe = 'holarch-d-racine-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefixe)));
}

/** Un vrai petit dépôt Git : `digestPerime` interroge `git`, on ne le simule pas. */
function depotTemporaire() {
  const d = dossierTemporaire('holarch-d-depot-');
  const git = (...args) => execFileSync('git', ['-C', d, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q');
  git('config', 'user.email', 'test@holon.local');
  git('config', 'user.name', 'test');
  fs.writeFileSync(path.join(d, 'a.txt'), 'a\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'un');
  return { dossier: d, git, head: () => git('rev-parse', 'HEAD').trim() };
}

// --- Déclaration et lecture d'un espace ---------------------------------

test('creerEspace écrit un SPACE.md relu à l\'identique par lireEspace', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  const cree = espaces.creerEspace({
    nom: 'projet-x', racines: [racine], description: 'Le projet X.',
  });
  assert.strictEqual(cree.name, 'projet-x');
  assert.deepStrictEqual(cree.roots, [racine]);
  assert.strictEqual(cree.repo, racine, 'le dépôt de référence retombe sur la première racine');
  assert.match(cree.description, /Le projet X\./);
  assert.ok(cree.created, 'la date de création est renseignée');

  const relu = espaces.lireEspace('projet-x');
  assert.deepStrictEqual(relu, cree, 'lireEspace relit exactement ce que creerEspace a écrit');
  assert.ok(fs.existsSync(espaces.cheminSpaceMd('projet-x')));
  assert.ok(fs.existsSync(path.join(espaces.cheminEspace('projet-x'), 'specialists')));
});

test('lireEspace renvoie null pour un espace non déclaré', () => {
  racineTemporaire();
  assert.strictEqual(espaces.lireEspace('jamais-declare'), null);
  assert.strictEqual(espaces.existe('jamais-declare'), false);
});

test('un nom d\'espace qui tenterait une évasion de chemin est refusé', () => {
  racineTemporaire();
  for (const mauvais of ['../evasion', 'a/b', '/absolu', '', '.cache', 'nom avec espaces']) {
    assert.throws(() => espaces.validerNom(mauvais), /nom d'espace/i, `« ${mauvais} » aurait dû être refusé`);
  }
  assert.strictEqual(espaces.validerNom('projet-x_2.1'), 'projet-x_2.1');
});

test('une racine inexistante est refusée à la déclaration, pas plus tard', () => {
  racineTemporaire();
  assert.throws(
    () => espaces.creerEspace({ nom: 'faute-de-frappe', racines: ['/n/existe/pas/du/tout'] }),
    /racine inexistante/,
  );
  assert.strictEqual(espaces.existe('faute-de-frappe'), false, 'aucun espace à moitié créé ne subsiste');
});

test('redéclarer un espace exige --force, et préserve alors la date de création', () => {
  racineTemporaire();
  const r1 = dossierTemporaire();
  const r2 = dossierTemporaire();
  const premier = espaces.creerEspace({ nom: 'projet-x', racines: [r1] });
  assert.throws(() => espaces.creerEspace({ nom: 'projet-x', racines: [r2] }), /existe déjà/);

  const redeclare = espaces.creerEspace({ nom: 'projet-x', racines: [r1, r2], ecraser: true });
  assert.deepStrictEqual(redeclare.roots, [r1, r2]);
  assert.strictEqual(redeclare.created, premier.created);
});

test('listerEspaces renvoie tous les espaces déclarés', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  espaces.creerEspace({ nom: 'alpha', racines: [racine] });
  espaces.creerEspace({ nom: 'beta', racines: [] });
  const noms = espaces.listerEspaces().map((e) => e.name).sort();
  assert.deepStrictEqual(noms, ['alpha', 'beta']);
});

test('assurerEspaceDefaut crée un espace « default » sans racine, donc entièrement fermé', () => {
  racineTemporaire();
  espaces.assurerEspaceDefaut();
  const defaut = espaces.lireEspace(espaces.ESPACE_DEFAUT);
  assert.ok(defaut);
  assert.deepStrictEqual(defaut.roots, [], 'aucune racine : aucun outil de lecture accordé (D17)');
  espaces.assurerEspaceDefaut(); // idempotent
  assert.strictEqual(espaces.listerEspaces().length, 1);
});

// --- normaliserChemin : primitive de refus hors racines (§11) ----------
// Testée d'avance : aucun chemin d'exécution ne l'appelle à l'Étape 2 (le refus §11 y est tenu par
// le bornage d'outils du CLI). Ces tests sont le contrat qu'elle devra honorer quand une entrée
// portera un chemin — voir README, divergence n° 7.

test('normaliserChemin accepte un chemin relatif à la première racine', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  fs.writeFileSync(path.join(racine, 'fichier.txt'), 'x\n');
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });

  assert.strictEqual(espaces.normaliserChemin('projet-x', 'fichier.txt'), path.join(racine, 'fichier.txt'));
  assert.strictEqual(
    espaces.normaliserChemin('projet-x', 'pas/encore/la.txt'),
    path.join(racine, 'pas/encore/la.txt'),
    'un chemin inexistant mais sous racine est accepté (on écrit parfois avant de lire)',
  );
});

test('normaliserChemin accepte un chemin absolu sous une racine secondaire', () => {
  racineTemporaire();
  const r1 = dossierTemporaire();
  const r2 = dossierTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [r1, r2] });
  fs.writeFileSync(path.join(r2, 'b.txt'), 'b\n');
  assert.strictEqual(espaces.normaliserChemin('projet-x', path.join(r2, 'b.txt')), path.join(r2, 'b.txt'));
});

test('normaliserChemin refuse une évasion par « .. »', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });
  assert.throws(() => espaces.normaliserChemin('projet-x', '../../etc/passwd'), /hors des racines déclarées/);
  assert.throws(() => espaces.normaliserChemin('projet-x', 'sous/../../dehors.txt'), /hors des racines déclarées/);
});

test('normaliserChemin refuse un chemin absolu hors racine', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });
  assert.throws(() => espaces.normaliserChemin('projet-x', '/etc/passwd'), /hors des racines déclarées/);
  assert.throws(
    () => espaces.normaliserChemin('projet-x', `${racine}-voisin/fichier.txt`),
    /hors des racines déclarées/,
    'un répertoire dont le nom commence par celui de la racine n\'est pas dans la racine',
  );
});

test('normaliserChemin refuse un lien symbolique qui sort de la racine', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  const dehors = dossierTemporaire('holarch-d-dehors-');
  fs.writeFileSync(path.join(dehors, 'secret.txt'), 'secret\n');
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });
  fs.symlinkSync(path.join(dehors, 'secret.txt'), path.join(racine, 'piege.txt'));

  // Le chemin passe la vérification lexicale (il est bien sous la racine) et doit échouer sur realpath.
  assert.throws(() => espaces.normaliserChemin('projet-x', 'piege.txt'), /lien symbolique/);
});

test('un espace sans racine refuse tout accès fichier (défaut fermé)', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'sans-racine', racines: [] });
  assert.throws(() => espaces.normaliserChemin('sans-racine', 'quoi-que-ce-soit.txt'), /aucune racine déclarée/);
});

test('normaliserChemin refuse un espace inconnu et un chemin vide', () => {
  racineTemporaire();
  const racine = dossierTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });
  assert.throws(() => espaces.normaliserChemin('inconnu', 'a.txt'), /espace inconnu/);
  assert.throws(() => espaces.normaliserChemin('projet-x', '   '), /chemin requis/);
});

// --- Mémoire par spécialiste (D8, gabarit §7) ---------------------------

test('la mémoire d\'un spécialiste est réécrite intégralement, jamais accumulée (D8)', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  assert.strictEqual(espaces.lireMemoire('projet-x', 'architecte'), null, 'pas de mémoire au départ');

  espaces.ecrireMemoire('projet-x', 'architecte', '## Ce que je sais du projet\n\nPremière version.');
  espaces.ecrireMemoire('projet-x', 'architecte', '## Ce que je sais du projet\n\nSeconde version.');
  const memoire = espaces.lireMemoire('projet-x', 'architecte');
  assert.match(memoire, /Seconde version/);
  assert.doesNotMatch(memoire, /Première version/, 'la réécriture remplace, elle n\'ajoute pas');
});

test('la mémoire est tronquée au plafond, avec une marque visible plutôt qu\'en silence', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const enorme = 'x'.repeat(espaces.MAX_CARACTERES_MEMOIRE + 5000);
  espaces.ecrireMemoire('projet-x', 'architecte', enorme);
  const memoire = espaces.lireMemoire('projet-x', 'architecte');
  assert.match(memoire, /mémoire tronquée à 6000 caractères/);
  assert.ok(memoire.length < espaces.MAX_CARACTERES_MEMOIRE + 200);
});

test('le gabarit de mémoire porte les quatre sections imposées par §7', () => {
  const gabarit = espaces.gabaritMemoire();
  assert.deepStrictEqual(espaces.SECTIONS_MEMOIRE.length, 4);
  for (const section of espaces.SECTIONS_MEMOIRE) {
    assert.ok(gabarit.includes(`## ${section}`), `section manquante : ${section}`);
  }
});

test('la mémoire est cloisonnée par espace et par spécialiste', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'a', racines: [] });
  espaces.creerEspace({ nom: 'b', racines: [] });
  espaces.ecrireMemoire('a', 'architecte', 'mémoire A/architecte');
  espaces.ecrireMemoire('a', 'testeur', 'mémoire A/testeur');
  espaces.ecrireMemoire('b', 'architecte', 'mémoire B/architecte');

  assert.match(espaces.lireMemoire('a', 'architecte'), /A\/architecte/);
  assert.match(espaces.lireMemoire('a', 'testeur'), /A\/testeur/);
  assert.match(espaces.lireMemoire('b', 'architecte'), /B\/architecte/);
});

// --- DECISIONS.md (§13.2) ----------------------------------------------

test('ajouterDecision crée l\'en-tête une seule fois puis ajoute en append', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  assert.strictEqual(espaces.lireDecisions('projet-x'), null);

  espaces.ajouterDecision('projet-x', { taskId: 't-1', verdict: 'adopte', note: 'première' });
  espaces.ajouterDecision('projet-x', { taskId: 't-2', verdict: 'rejete', note: 'seconde' });
  const texte = espaces.lireDecisions('projet-x');

  assert.strictEqual(texte.match(/# Décisions — espace projet-x/g).length, 1, 'en-tête écrit une seule fois');
  assert.match(texte, /tâche t-1 · verdict adopte/);
  assert.match(texte, /tâche t-2 · verdict rejete/);
  assert.match(texte, /note : première/);
  assert.ok(texte.indexOf('t-1') < texte.indexOf('t-2'), 'chronologique : on ajoute à la fin');
});

test('ajouterDecision consigne specialist, supersedes et les décisions en liste', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  const entree = espaces.ajouterDecision('projet-x', {
    taskId: 't-3',
    verdict: 'adopte-partiellement',
    specialist: 'architecte',
    supersedes: 't-1',
    decisions: ['on garde SQLite', 'on abandonne le cache mémoire', '   '],
  });
  const texte = espaces.lireDecisions('projet-x');
  assert.match(texte, /- spécialiste : architecte/);
  assert.match(texte, /- supersedes : t-1/);
  assert.match(texte, /- on garde SQLite/);
  assert.match(texte, /- on abandonne le cache mémoire/);
  assert.ok(entree.date, 'l\'entrée renvoyée est datée');
});

test('une note multiligne est aplatie pour ne pas casser la structure du fichier', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  espaces.ajouterDecision('projet-x', { taskId: 't-4', verdict: 'adopte', note: 'ligne 1\nligne 2' });
  const texte = espaces.lireDecisions('projet-x');
  assert.match(texte, /- note : ligne 1 ligne 2/);
});

// --- DIGEST.md (§13.1) --------------------------------------------------

test('ecrireDigest pose un front-matter relu par metaDigest', () => {
  racineTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [] });
  assert.strictEqual(espaces.lireDigest('projet-x'), null);
  assert.strictEqual(espaces.metaDigest('projet-x'), null);

  espaces.ecrireDigest('projet-x', { corps: '# Carte\n\nUn démon, une porte MCP.', commit: 'abc1234', cout: 0.42 });
  const texte = espaces.lireDigest('projet-x');
  assert.match(texte, /^---\n/);
  assert.match(texte, /Un démon, une porte MCP\./);

  const meta = espaces.metaDigest('projet-x');
  assert.strictEqual(meta.commit, 'abc1234');
  assert.strictEqual(String(meta.cost_usd), '0.42');
  assert.ok(meta.date);
});

test('digestPerime : absent, à jour, puis périmé au-delà du seuil de commits', () => {
  racineTemporaire();
  const depot = depotTemporaire();
  espaces.creerEspace({ nom: 'projet-x', racines: [depot.dossier] });

  assert.deepStrictEqual(espaces.digestPerime('projet-x').perime, true);
  assert.match(espaces.digestPerime('projet-x').motif, /aucun digest/);

  // `headDepot` renvoie le hash court (comme `commitFramework`) : c'est lui qui fait foi.
  const head = espaces.headDepot('projet-x');
  assert.ok(depot.head().startsWith(head), 'headDepot est bien le HEAD du dépôt, en forme courte');
  espaces.ecrireDigest('projet-x', { corps: 'carte', commit: head });

  const aJour = espaces.digestPerime('projet-x');
  assert.strictEqual(aJour.perime, false);
  assert.strictEqual(aJour.distance, 0);

  // Deux commits plus loin : HEAD a bougé, mais pas assez pour périmer une carte.
  for (const n of [2, 3]) {
    fs.writeFileSync(path.join(depot.dossier, `f${n}.txt`), `${n}\n`);
    depot.git('add', '-A');
    depot.git('commit', '-q', '-m', `commit ${n}`);
  }
  const peuLoin = espaces.digestPerime('projet-x');
  assert.strictEqual(peuLoin.perime, false, '2 commits ne périment pas une carte');
  assert.strictEqual(peuLoin.distance, 2);

  // Le seuil est un paramètre : la même distance périme avec un seuil de 2.
  const seuilBas = espaces.digestPerime('projet-x', { seuil: 2 });
  assert.strictEqual(seuilBas.perime, true);
  assert.match(seuilBas.motif, /2 commits depuis le digest \(seuil 2\)/);
});

test('digestPerime ne bloque pas un espace sans dépôt Git de référence', () => {
  racineTemporaire();
  const racine = dossierTemporaire(); // un répertoire, pas un dépôt
  espaces.creerEspace({ nom: 'projet-x', racines: [racine] });
  espaces.ecrireDigest('projet-x', { corps: 'carte', commit: null });
  const etat = espaces.digestPerime('projet-x');
  assert.strictEqual(etat.perime, false);
  assert.match(etat.motif, /pas de dépôt Git de référence/);
});
