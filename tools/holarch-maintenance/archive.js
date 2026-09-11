#!/usr/bin/env node
'use strict';
// Archivage d'une mission terminée. Préconditions (dans l'ordre, arrêt au premier refus) : arbre Git
// propre (hors mission/registry/), STATUS.md racine à DELIVERED, aucune tâche détachée vivante, aucun
// processus de mission vivant. Si tout passe : tag `mission-<nom>-final`, déplacement de
// mission/.holarch/ vers un répertoire résidus, `git mv mission docs/archive/mission-<nom>`, insertion
// de 6 squelettes `<!-- à relire -->` dans des fichiers transverses, commit final (sauf --sans-commit).
// Jamais de push.
const fs = require('fs');
const path = require('path');
const {
  executer, arbrePropre, tacheDetacheeVivante, processusMissionVivant, lireNomMission, verifierAncres,
  insererSquelette, commitStandard,
} = require('./lib/commun.js');

function usage() {
  return 'usage : node archive.js [--residus <dir>] [--sans-commit]';
}

function analyserArgs(argv) {
  const args = { residus: null, sansCommit: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--residus') { args.residus = argv[++i]; }
    else if (a === '--sans-commit') { args.sansCommit = true; }
    else if (a === '--help' || a === '-h') { process.stdout.write(`${usage()}\n`); process.exit(0); }
  }
  return args;
}

/** Lit l'état déclaré dans un STATUS.md (ligne `| État | <valeur> |`). Retourne la valeur ou null si
 *  le fichier est absent ou la ligne introuvable. */
function lireEtatStatus(cheminStatus) {
  let texte;
  try { texte = fs.readFileSync(cheminStatus, 'utf8'); } catch (_) { return null; }
  const m = texte.match(/^\|\s*État\s*\|\s*(.*?)\s*\|\s*$/m);
  return m ? m[1] : null;
}

const SQUELETTE_TEXTE = '<!-- à relire -->';

/** Fichiers transverses à compléter après archivage, avec des ancres STRUCTURELLES (maintenance 1.12.0 : les ancres
 *  littérales sur des lignes d'une mission précise cassaient dès que ces lignes bougeaient) :
 *  docs/archive/README.md → fin du fichier (les entrées sont chronologiques) ; docs/ENVIRONNEMENT.md → après la
 *  dernière puce `/home/vscode/archive-…-residus` (§10) ; docs/ROADMAP.md → après la ligne de tableau de la mission
 *  (§5) ; docs/IMPLEMENTATION.md → après la ligne `**État :` qui cite la mission ; README.md → après la puce
 *  `**Missions**` ; CLAUDE.md → après la puce qui présente `docs/archive/`. */
function fichiersTransverses(cheminDepot, nom) {
  const n = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [
    { fichier: path.join(cheminDepot, 'docs', 'archive', 'README.md'), ancre: null },
    { fichier: path.join(cheminDepot, 'docs', 'ENVIRONNEMENT.md'), ancre: /^- `\/home\/vscode\/archive-[^`]+-residus/, options: { dernier: true } },
    { fichier: path.join(cheminDepot, 'docs', 'ROADMAP.md'), ancre: new RegExp(`^\\| \`${n}\` \\(`) },
    { fichier: path.join(cheminDepot, 'docs', 'IMPLEMENTATION.md'), ancre: new RegExp(`^\\*\\*État :.*\`${n}\``) },
    { fichier: path.join(cheminDepot, 'README.md'), ancre: /^- \*\*Missions\*\* :/ },
    { fichier: path.join(cheminDepot, 'CLAUDE.md'), ancre: /`docs\/archive\/` est l'histoire/ },
  ];
}

function main() {
  const args = analyserArgs(process.argv.slice(2));
  const cheminDepot = process.cwd();

  const { propre, sales } = arbrePropre(cheminDepot, ['mission/registry/']);
  if (!propre) {
    process.stderr.write(`Arbre sale hors mission/registry/, refus : ${sales.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const cheminStatus = path.join(cheminDepot, 'mission', 'concepteur', 'STATUS.md');
  const etat = lireEtatStatus(cheminStatus);
  if (etat !== 'DELIVERED') {
    const trouve = etat === null ? 'absent' : etat;
    process.stderr.write(`STATUS.md racine (${cheminStatus}) absent ou état != DELIVERED (trouvé : ${trouve})\n`);
    process.exitCode = 1;
    return;
  }

  const { vivante: tacheVivante, taches } = tacheDetacheeVivante(cheminDepot);
  if (tacheVivante) {
    process.stderr.write(`Tâche(s) détachée(s) vivante(s), refus : pid ${taches.map((t) => t.pid).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  // Point d'injection de test uniquement : HOLARCH_PS_TEXT_TEST simule la sortie de `ps` pour éviter
  // tout appel `ps` réel pendant les tests (jamais utilisé en usage réel — variable non documentée
  // ailleurs que dans ce commentaire et dans test-archive.js).
  const psTextTest = process.env.HOLARCH_PS_TEXT_TEST;
  if (processusMissionVivant(psTextTest, cheminDepot)) {
    process.stderr.write('Processus de mission vivant détecté, refus.\n');
    process.exitCode = 1;
    return;
  }

  const cheminConfig = path.join(cheminDepot, 'framework', 'CONFIG.md');
  const nom = lireNomMission(cheminConfig);
  if (!nom) {
    process.stderr.write(`Nom de mission introuvable dans ${cheminConfig} (titre « # Configuration — mission : <nom> », ou clé nom_mission / Nom)\n`);
    process.exitCode = 1;
    return;
  }

  // Transactionnel : tag déjà posé et ancres des fichiers transverses vérifiés AVANT toute écriture.
  const nomTag = `mission-${nom}-final`;
  if (executer('git', ['tag', '-l', nomTag], { cwd: cheminDepot }).stdout.trim() === nomTag) {
    process.stderr.write(`Le tag ${nomTag} existe déjà, refus (mission déjà archivée ?).\n`);
    process.exitCode = 1;
    return;
  }
  const transverses = fichiersTransverses(cheminDepot, nom);
  const manquantes = verifierAncres(transverses);
  if (manquantes.length) {
    process.stderr.write(`Ancre(s) introuvable(s), rien n'a été écrit :\n${manquantes.map((m) => `  ${m.fichier} : ${String(m.ancre)}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  const statutRegistry = executer('git', ['status', '--porcelain', '--', 'mission/registry/'], { cwd: cheminDepot });
  const cibleRegistry = [];
  if (statutRegistry.stdout.includes('mission/registry/SESSIONS.md')) {
    cibleRegistry.push('mission/registry/SESSIONS.md');
  }
  if (statutRegistry.stdout.includes('mission/registry/REVEILS.md')) {
    cibleRegistry.push('mission/registry/REVEILS.md');
  }
  if (cibleRegistry.length > 0) {
    commitStandard(cheminDepot, cibleRegistry, '[registry] journal du lanceur avant archivage');
  }

  executer('git', ['tag', nomTag], { cwd: cheminDepot, doitReussir: true });

  const dirResidus = args.residus || `/home/vscode/archive-${nom}-residus/`;
  const cheminHolarch = path.join(cheminDepot, 'mission', '.holarch');
  if (fs.existsSync(cheminHolarch)) {
    fs.mkdirSync(dirResidus, { recursive: true });
    fs.cpSync(cheminHolarch, path.join(dirResidus, '.holarch'), { recursive: true });
    fs.rmSync(cheminHolarch, { recursive: true, force: true });
  }

  const cheminArchiveMission = path.join('docs', 'archive', `mission-${nom}`);
  fs.mkdirSync(path.join(cheminDepot, 'docs', 'archive'), { recursive: true });
  executer('git', ['mv', 'mission', cheminArchiveMission], { cwd: cheminDepot, doitReussir: true });

  for (const { fichier, ancre, options } of transverses) {
    insererSquelette(fichier, ancre, SQUELETTE_TEXTE, options || {});
  }

  if (!args.sansCommit) {
    const cibleFichiers = [
      cheminArchiveMission,
      'docs/archive/README.md',
      'docs/ENVIRONNEMENT.md',
      'docs/ROADMAP.md',
      'docs/IMPLEMENTATION.md',
      'README.md',
      'CLAUDE.md',
    ];
    commitStandard(cheminDepot, cibleFichiers, `[archive] mission ${nom} archivée`);
  }

  console.log(`Mission ${nom} archivée : tag ${nomTag}, ${cheminArchiveMission}, résidus dans ${dirResidus}.`);
}

main();
