#!/usr/bin/env node
'use strict';
// Promotion d'un paquet de changements (produit ailleurs) vers le dépôt réel, en passant d'abord par
// une copie fraîche jetable. Ne committe jamais (contrat) : le mainteneur relit le diff et committe
// lui-même. Voir MANIFEST.json / appliquer.js pour le contrat du paquet.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { executer, arbrePropre } = require('./lib/commun.js');

const VERSIONS_VALIDES = ['patch', 'mineure', 'auto'];
const PREFIXES_PATCH = ['framework/bin', 'framework/hooks', 'framework/claude', 'framework/tests', 'tools/'];

function usage() {
  return 'usage : node promote.js <dossier-paquet> [--copie <dir>] [--appliquer] '
    + '[--version patch|mineure|auto] [--garder]';
}

function analyserArgs(argv) {
  const args = { dossierPaquet: null, copie: null, appliquer: false, version: 'auto', garder: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--copie') { args.copie = argv[++i]; }
    else if (a === '--appliquer') { args.appliquer = true; }
    else if (a === '--version') { args.version = argv[++i]; }
    else if (a === '--garder') { args.garder = true; }
    else if (args.dossierPaquet === null) { args.dossierPaquet = a; }
  }
  return args;
}

/** Extrait {pass, fail} d'une sortie TAP de `node --test` (motifs `# pass N` / `# fail N`). 0/0 si
 *  absents. */
function compterTests(sortie) {
  // TAP (`# pass N`) ou rapporteur spec de Node ≥ 20 (`ℹ pass N`, ce que `npm test` imprime en Node 24 — maintenance 1.12.0).
  const mp = sortie.match(/(?:#|ℹ) pass (\d+)/);
  const mf = sortie.match(/(?:#|ℹ) fail (\d+)/);
  return {
    pass: mp ? parseInt(mp[1], 10) : 0,
    fail: mf ? parseInt(mf[1], 10) : 0,
  };
}

/** Ensemble des noms de tests en échec (`not ok N - <nom>`) dans une sortie TAP. */
function extraireEchecs(sortie) {
  const noms = new Set();
  for (const m of sortie.matchAll(/^(?:not ok \d+ - |✖ )(.+?)(?: \(\d[\d.]*ms\))?$/gm)) {
    noms.add(m[1]);
  }
  return noms;
}

function executerNpmTest(cwd) {
  const r = executer('npm', ['test'], { cwd, doitReussir: false });
  const sortie = `${r.stdout}\n${r.stderr}`;
  return { ...compterTests(sortie), echecs: extraireEchecs(sortie) };
}

/** Insère les lignes d'`lignesEntree` juste avant la première ligne `## ...` du CHANGELOG (pas après
 *  une ancre fixe : insererSquelette de lib/commun.js ne convient pas à ce besoin). */
function insererEntreeChangelog(cheminFichier, lignesEntree) {
  const contenu = fs.readFileSync(cheminFichier, 'utf8');
  const lignes = contenu.split('\n');
  let idx = lignes.findIndex((l) => /^## /.test(l));
  if (idx === -1) idx = lignes.length;
  lignes.splice(idx, 0, ...lignesEntree);
  fs.writeFileSync(cheminFichier, lignes.join('\n'));
}

function imprimerDiffTests(avant, apres) {
  console.log(`Tests avant : ${avant.pass}/${avant.pass + avant.fail}`);
  console.log(`Tests après : ${apres.pass}/${apres.pass + apres.fail}`);
  const memes = avant.echecs.size === apres.echecs.size
    && [...avant.echecs].every((n) => apres.echecs.has(n));
  if (!memes) {
    const nouvEnEchec = [...apres.echecs].filter((n) => !avant.echecs.has(n));
    const nouvPassants = [...avant.echecs].filter((n) => !apres.echecs.has(n));
    console.log(`Nouvellement en échec : ${nouvEnEchec.join(', ')}`);
    console.log(`Nouvellement passants : ${nouvPassants.join(', ')}`);
  }
}

function main() {
  const args = analyserArgs(process.argv.slice(2));

  if (!VERSIONS_VALIDES.includes(args.version)) {
    process.stderr.write(`--version invalide : ${args.version} (attendu patch|mineure|auto)\n`);
    process.exitCode = 1;
    return;
  }

  if (!args.dossierPaquet) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const dossierPaquetAbsolu = path.resolve(process.cwd(), args.dossierPaquet);
  const cheminManifest = path.join(dossierPaquetAbsolu, 'MANIFEST.json');
  const cheminAppliquer = path.join(dossierPaquetAbsolu, 'appliquer.js');
  if (!fs.existsSync(cheminManifest) || !fs.existsSync(cheminAppliquer)) {
    process.stderr.write(`paquet incomplet dans ${dossierPaquetAbsolu} : MANIFEST.json et appliquer.js requis\n`);
    process.exitCode = 1;
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(cheminManifest, 'utf8'));
  } catch (e) {
    process.stderr.write(`MANIFEST.json invalide : ${e.message}\n`);
    process.exitCode = 1;
    return;
  }
  if (typeof manifest.shaBase !== 'string' || manifest.shaBase.length === 0) {
    process.stderr.write('MANIFEST.json invalide : shaBase manquant ou vide\n');
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(manifest.cibles) || manifest.cibles.length === 0) {
    process.stderr.write('MANIFEST.json invalide : cibles manquantes ou vides\n');
    process.exitCode = 1;
    return;
  }

  // P2 (rapport holarch-fournisseurs, 2026-09-11) : réconciliation manifeste ↔ fichiers du paquet. Un fichier ajouté sous
  // cible-*/ mais oublié dans cibles[] passait en silence, dry-run vert compris (le test du câblage du garde a failli ne
  // jamais être promu). cible-docs/ compris (É2 holarch-modeles : un fragment oublié passait en silence ; le mode `fragment` de
  // l'appliquer.js de référence l'insère lui-même).
  const declares = new Set(manifest.cibles.map((c) => c.depuis));
  const oublies = [];
  const marcher = (dir, rel) => { for (const ent of fs.readdirSync(dir, { withFileTypes: true })) { const r = `${rel}/${ent.name}`; if (ent.isDirectory()) marcher(path.join(dir, ent.name), r); else if (!declares.has(r)) oublies.push(r); } };
  for (const ent of fs.readdirSync(dossierPaquetAbsolu, { withFileTypes: true })) if (ent.isDirectory() && ent.name.startsWith('cible-')) marcher(path.join(dossierPaquetAbsolu, ent.name), ent.name);
  const introuvables = manifest.cibles.filter((c) => !fs.existsSync(path.join(dossierPaquetAbsolu, c.depuis))).map((c) => c.depuis);
  if (oublies.length || introuvables.length) {
    process.stderr.write(`MANIFEST.json désaccordé avec le paquet : ${oublies.length ? `${oublies.length} fichier(s) sous cible-*/ absent(s) de cibles[] (${oublies.join(', ')})` : ''}${oublies.length && introuvables.length ? ' ; ' : ''}${introuvables.length ? `${introuvables.length} cible(s) sans fichier dans le paquet (${introuvables.join(', ')})` : ''}\n`);
    process.exitCode = 1;
    return;
  }
  const depotReel = process.cwd();

  const catFile = executer('git', ['cat-file', '-e', manifest.shaBase], { cwd: depotReel });
  if (catFile.code !== 0) {
    process.stderr.write(`shaBase inatteignable dans le dépôt réel : ${manifest.shaBase}\n`);
    process.exitCode = 1;
    return;
  }

  // Copie fraîche à chemin court : /home/vscode dans le devcontainer (un chemin long fait échouer les tests MCP de
  // tools/holarch-d — socket Unix), sinon os.tmpdir() (CI GitHub : /home/vscode n'existe pas, run 2026-09-11 rouge).
  const baseCopie = process.env.HOLARCH_PROMOTE_BASE || (fs.existsSync('/home/vscode') ? '/home/vscode' : os.tmpdir());
  const copieDir = args.copie || path.join(baseCopie, `holarch-promote-${Date.now()}`);

  executer('git', ['clone', depotReel, copieDir], { doitReussir: true });
  const aUnLock = fs.existsSync(path.join(copieDir, 'package-lock.json'))
    || fs.existsSync(path.join(copieDir, 'npm-shrinkwrap.json'));
  if (aUnLock) {
    executer('npm', ['ci'], { cwd: copieDir, doitReussir: true });
  } else {
    console.log('aucun package-lock.json : repli sur npm install');
    executer('npm', ['install', '--no-audit', '--no-fund'], { cwd: copieDir, doitReussir: true });
  }

  const avant = executerNpmTest(copieDir);

  const appliqueCopie = executer(
    'node',
    [cheminAppliquer, '--depot', copieDir],
    { doitReussir: false, cwd: copieDir }, // É1 holarch-modeles : un appliquer.js qui ne lirait que le cwd écrirait dans le dépôt réel
  );
  if (appliqueCopie.code !== 0) {
    process.stderr.write(`${appliqueCopie.stderr}\n`);
    process.stderr.write(`Copie conservée pour inspection : ${copieDir}\n`);
    process.exitCode = 1;
    return;
  }

  const apres = executerNpmTest(copieDir);

  const lintCopie = executer('npm', ['run', 'lint'], { cwd: copieDir, doitReussir: false });
  const dryRunCopie = executer(
    'node',
    ['framework/bin/holarch-spawn.js', 'concepteur', '--dry-run'],
    { cwd: copieDir, doitReussir: false },
  );

  imprimerDiffTests(avant, apres);
  console.log(`Lint (copie) : code ${lintCopie.code}`);
  const mPrompt = dryRunCopie.stdout.match(/prompt système\s*:\s*(\d+)/);
  console.log(`Taille du prompt --dry-run (copie) : ${mPrompt ? `${mPrompt[1]} caractères (système)` : `non mesurée (code ${dryRunCopie.code})`}`);

  if (!args.garder) {
    fs.rmSync(copieDir, { recursive: true, force: true });
  }

  if (!args.appliquer) {
    console.log('Jamais de commit (contrat).');
    return;
  }

  const { propre, sales } = arbrePropre(depotReel, ['mission/']);
  if (!propre) {
    process.stderr.write(`Dépôt réel sale hors mission/, refus : ${sales.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const appliqueReel = executer(
    'node',
    [cheminAppliquer, '--depot', depotReel],
    { doitReussir: false, cwd: depotReel },
  );
  if (appliqueReel.code !== 0) {
    process.stderr.write(`${appliqueReel.stderr}\n`);
    process.exitCode = 1;
    return;
  }

  const testsReel = executerNpmTest(depotReel);
  console.log(`Tests (dépôt réel) : ${testsReel.pass}/${testsReel.pass + testsReel.fail}`);
  const lintReel = executer('npm', ['run', 'lint'], { cwd: depotReel, doitReussir: false });
  console.log(`Lint (dépôt réel) : code ${lintReel.code}`);

  const cheminVersion = path.join(depotReel, 'framework', 'VERSION');
  const contenuVersion = fs.readFileSync(cheminVersion, 'utf8');
  const finLigne = contenuVersion.endsWith('\n');
  const m = contenuVersion.trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) {
    process.stderr.write(`framework/VERSION illisible : ${JSON.stringify(contenuVersion)}\n`);
    process.exitCode = 1;
    return;
  }
  const x = parseInt(m[1], 10);
  const y = parseInt(m[2], 10);
  const z = parseInt(m[3], 10);

  let type;
  if (args.version === 'patch' || args.version === 'mineure') {
    type = args.version;
  } else {
    type = manifest.cibles.every((c) => PREFIXES_PATCH.some((p) => c.vers.startsWith(p)))
      ? 'patch'
      : 'mineure';
  }

  let nouvelleVersion;
  if (type === 'patch') {
    nouvelleVersion = `${x}.${y}.${z + 1}`;
  } else {
    nouvelleVersion = `${x}.${y + 1}.0`;
  }
  fs.writeFileSync(cheminVersion, finLigne ? `${nouvelleVersion}\n` : nouvelleVersion);

  const date = new Date().toISOString().slice(0, 10);
  const horodatage = new Date().toISOString();
  const typeLabel = type === 'patch' ? 'Patch' : 'Mineure';
  const listeCibles = manifest.cibles.map((c) => c.vers).join(', ');
  const lignesEntree = [
    `## ${nouvelleVersion} — ${date}`,
    '',
    `${typeLabel} :`,
    `- **${horodatage}** : promotion automatique via \`promote.js\` — cibles :`,
    `  ${listeCibles}. <!-- à compléter -->`,
    '',
  ];
  insererEntreeChangelog(path.join(depotReel, 'framework', 'CHANGELOG.md'), lignesEntree);

  console.log('Fichiers transverses à vérifier : voir docs/ENVIRONNEMENT.md §12 (correspondance'
    + ' changement → fichiers).');
  console.log('Jamais de commit (contrat) — relis le diff avant de committer.');
}

main();
