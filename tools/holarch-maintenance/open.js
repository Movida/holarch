#!/usr/bin/env node
'use strict';
// Ouverture d'une nouvelle mission. Préconditions (dans l'ordre, arrêt au premier refus) : mission/
// contient déjà autre chose que mission/.holarch/ (résidu jetable, non significatif), aucune tâche
// détachée vivante. Si tout passe : mission/OBJECTIVE.md depuis framework/templates/OBJECTIVE.template.md,
// framework/CONFIG.md réécrit (ligne de nom + table Paramètres depuis le preset choisi, surchargée par
// --param), lignes « en cours » dans docs/ROADMAP.md et README.md, commit (sauf --sans-commit), puis
// affichage des commandes de vérification et de bootstrap. Jamais de bootstrap réel.
const fs = require('fs');
const path = require('path');
const {
  tacheDetacheeVivante, insererSquelette, verifierAncres, commitStandard,
} = require('./lib/commun.js');

function usage() {
  return 'usage : node open.js <nom> --chantier <n> [--param cle=valeur…] [--sans-commit]';
}

function analyserArgs(argv) {
  const args = { nom: null, chantier: null, params: {}, sansCommit: false };
  const positionnels = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--chantier') { args.chantier = argv[++i]; }
    else if (a === '--param') {
      const kv = argv[++i] || '';
      const idx = kv.indexOf('=');
      if (idx === -1) continue;
      args.params[kv.slice(0, idx)] = kv.slice(idx + 1);
    } else if (a === '--sans-commit') { args.sansCommit = true; }
    else if (a === '--help' || a === '-h') { process.stdout.write(`${usage()}\n`); process.exit(0); }
    else { positionnels.push(a); }
  }
  args.nom = positionnels[0] || null;
  return args;
}

/** Extrait le contenu du bloc fenced ```markdown d'un fichier preset (entre les deux lignes de
 *  balise, balises exclues). */
function extraireBlocPreset(texteBrutPreset) {
  const m = texteBrutPreset.match(/```markdown\n([\s\S]*?)\n```/);
  if (!m) throw new Error('bloc ```markdown``` introuvable dans le preset');
  return m[1];
}

/** Délimite la section `## Paramètres` d'un bloc (lignes de la ligne d'en-tête jusqu'à la ligne juste
 *  avant le prochain `## `, ou fin du bloc). Retourne {debut, fin} en indices de lignes. */
function bornesSectionParametres(lignes) {
  const debut = lignes.findIndex((l) => l.trim() === '## Paramètres');
  if (debut === -1) throw new Error('section ## Paramètres introuvable');
  let fin = lignes.findIndex((l, i) => i > debut && /^##\s/.test(l));
  if (fin === -1) fin = lignes.length;
  return { debut, fin };
}

/** Surcharge la table `## Paramètres` d'un bloc de preset avec `params` (cle -> valeur) : remplace la
 *  valeur d'une ligne `| cle | valeur |` existante, ajoute une ligne en fin de table sinon. Même
 *  mécanique de correspondance ligne-à-ligne que `lireParamMission` de lib/commun.js, en écriture. */
function appliquerParametres(bloc, params) {
  const lignes = bloc.split('\n');
  const { debut, fin } = bornesSectionParametres(lignes);
  const avant = lignes.slice(0, debut + 1);
  const table = lignes.slice(debut + 1, fin);
  const apres = lignes.slice(fin);

  const restants = { ...params };
  const nouvelleTable = table.map((l) => {
    const m = l.match(/^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*$/);
    if (!m) return l;
    const cle = m[1];
    if (Object.prototype.hasOwnProperty.call(restants, cle)) {
      const valeur = restants[cle];
      delete restants[cle];
      return `| ${cle} | ${valeur} |`;
    }
    return l;
  });
  const ajouts = Object.keys(restants).map((cle) => `| ${cle} | ${restants[cle]} |`);
  return [...avant, ...nouvelleTable, ...ajouts, ...apres].join('\n');
}

/** Réécrit dans `cheminConfig` (framework/CONFIG.md réel) UNIQUEMENT la ligne de nom et la section
 *  `## Paramètres`, à partir du bloc de preset déjà préparé (`blocFinal`). Le reste du fichier existant
 *  (Modules actifs, Politique de modèle, Valeurs organisationnelles, ligne « Preset de base ») est
 *  préservé tel quel. */
function reecrireConfigReel(cheminConfig, blocFinal) {
  const texteExistant = fs.readFileSync(cheminConfig, 'utf8');
  const nouvelleLigneNom = blocFinal.match(/^# Configuration — mission : .*/m)[0];
  const texteAvecNom = texteExistant.replace(/^# Configuration — mission : .*/m, nouvelleLigneNom);

  const lignesBloc = blocFinal.split('\n');
  const bornesBloc = bornesSectionParametres(lignesBloc);
  const nouvelleTableLignes = lignesBloc.slice(bornesBloc.debut, bornesBloc.fin);

  const lignesExistant = texteAvecNom.split('\n');
  const bornesExist = bornesSectionParametres(lignesExistant);

  const resultat = [
    ...lignesExistant.slice(0, bornesExist.debut),
    ...nouvelleTableLignes,
    ...lignesExistant.slice(bornesExist.fin),
  ].join('\n');

  fs.writeFileSync(cheminConfig, resultat);
}

function main() {
  const args = analyserArgs(process.argv.slice(2));
  const cheminDepot = process.cwd();

  if (!args.nom || !args.chantier) {
    process.stderr.write(`nom de mission et --chantier requis.\n${usage()}\n`);
    process.exitCode = 1;
    return;
  }

  const cheminMission = path.join(cheminDepot, 'mission');
  // mission/.holarch/ seul (résidu jetable, non versionné) ne compte pas comme « mission existante » :
  // seule la présence d'autre chose (OBJECTIVE.md, etc.) déclenche ce refus.
  let contenuMission = [];
  try { contenuMission = fs.readdirSync(cheminMission); } catch (_) { contenuMission = []; }
  if (contenuMission.some((f) => f !== '.holarch')) {
    process.stderr.write(`mission/ existe déjà (${cheminMission}), refus.\n`);
    process.exitCode = 1;
    return;
  }

  const { vivante: tacheVivante, taches } = tacheDetacheeVivante(cheminDepot);
  if (tacheVivante) {
    process.stderr.write(`Tâche(s) détachée(s) vivante(s), refus : pid ${taches.map((t) => t.pid).join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  const nomPreset = args.params.preset || 'solo-light';
  const dirPresets = path.join(cheminDepot, 'framework', 'presets');
  const cheminPreset = path.join(dirPresets, `${nomPreset}.md`);
  if (!fs.existsSync(cheminPreset)) {
    let disponibles = [];
    try {
      disponibles = fs.readdirSync(dirPresets).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''));
    } catch (_) { disponibles = []; }
    process.stderr.write(`Preset "${nomPreset}" introuvable. Presets disponibles : ${disponibles.join(', ')}\n`);
    process.exitCode = 1;
    return;
  }

  // Transactionnel (maintenance 1.12.0) : ancres structurelles vérifiées AVANT d'écrire CONFIG.md et OBJECTIVE.md.
  const dateJour = new Date().toISOString().slice(0, 10);
  const ligneRoadmap = `| \`${args.nom}\` (**ouverte** le ${dateJour}, \`mission/OBJECTIVE.md\`, à lancer) | Chantier ${args.chantier} — <!-- à relire --> | <!-- à relire --> |`;
  const ligneReadme = `  - Mission \`${args.nom}\` (chantier ${args.chantier}) — en cours <!-- à relire -->`;
  const transverses = [
    { fichier: path.join(cheminDepot, 'docs', 'ROADMAP.md'), ancre: /^\| Programme DEMIURGE/, texte: ligneRoadmap, options: { avant: true } },
    { fichier: path.join(cheminDepot, 'README.md'), ancre: /^- \*\*Missions\*\* :/, texte: ligneReadme, options: {} },
  ];
  const manquantes = verifierAncres(transverses);
  if (manquantes.length) {
    process.stderr.write(`Ancre(s) introuvable(s), rien n'a été écrit :\n${manquantes.map((m) => `  ${m.fichier} : ${String(m.ancre)}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  const texteBrutPreset = fs.readFileSync(cheminPreset, 'utf8');
  let bloc = extraireBlocPreset(texteBrutPreset);
  bloc = bloc.replace(/^# Configuration — mission : .*/m, `# Configuration — mission : ${args.nom}`);

  const paramsSurcharge = { ...args.params };
  delete paramsSurcharge.preset;
  bloc = appliquerParametres(bloc, paramsSurcharge);

  const cheminConfig = path.join(cheminDepot, 'framework', 'CONFIG.md');
  reecrireConfigReel(cheminConfig, bloc);

  const cheminTemplate = path.join(cheminDepot, 'framework', 'templates', 'OBJECTIVE.template.md');
  const texteTemplate = fs.readFileSync(cheminTemplate, 'utf8');
  const objectif = texteTemplate
    .replace(/\{\{NOM\}\}/g, args.nom)
    .replace(/\{\{CHANTIER\}\}/g, args.chantier);
  fs.mkdirSync(cheminMission, { recursive: true });
  fs.writeFileSync(path.join(cheminMission, 'OBJECTIVE.md'), objectif);

  for (const { fichier, ancre, texte, options } of transverses) insererSquelette(fichier, ancre, texte, options);

  if (!args.sansCommit) {
    commitStandard(
      cheminDepot,
      ['mission/OBJECTIVE.md', 'framework/CONFIG.md', 'docs/ROADMAP.md', 'README.md'],
      `[open] mission ${args.nom} ouverte (chantier ${args.chantier})`,
    );
  }

  console.log('Mission prête. Pour vérifier :');
  console.log('  npm run dry-run   (ou : node framework/bin/holarch-spawn.js concepteur --dry-run)');
  console.log('Pour démarrer :');
  console.log('  node framework/bin/holarch-spawn.js --bootstrap');
}

main();
