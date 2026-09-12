#!/usr/bin/env node
'use strict';

/**
 * lecture-openrouter.js
 *
 * Lit un JSON au format de GET https://openrouter.ai/api/v1/models et rend
 * des lignes de catalogue HOLARCH candidates.
 *
 * Usage :
 *   node lecture-openrouter.js --source <fichier.json|url> [--motif <regex>] [--date <AAAA-MM-JJ>]
 * --source accepte un chemin de fichier ou une URL http(s):// (reseau limite a ce cas).
 * --motif filtre sur le champ id ; absent, toutes les entrees sont rendues.
 * --date fixe la date de la source ; absente, le jour courant en UTC.
 */

const fs = require('fs');

/** Tarif USD par token (chaine) -> USD par million de tokens (nombre). */
function versMillions(prixParToken) {
  const n = Number(prixParToken);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 1e12) / 1e6;
}

/** USD par million -> texte a virgule, sans zero inutile ; NaN s'ecrit em dash. */
function formaterCout(valeur) {
  if (!Number.isFinite(valeur)) return '—';
  let s = valeur.toFixed(6);
  if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s.replace('.', ',');
}

/** Date du jour en UTC, format AAAA-MM-JJ. */
function dateDuJourUTC() {
  return new Date().toISOString().slice(0, 10);
}

/** Filtre les entrees sur id par une expression reguliere (chaine). */
function filtrerEntrees(entrees, motif) {
  if (!motif) return entrees.slice();
  const re = new RegExp(motif);
  return entrees.filter(function (entree) { return re.test(String(entree.id)); });
}

/** Ligne d'en-tete du catalogue. */
function ligneEnTete(source, date) {
  return '<!-- source : ' + source + ' · lu le ' + date + ' -->';
}

/** Une ligne de catalogue par entree retenue, au format exact du lot. */
function ligneCatalogue(entree) {
  const id = String(entree.id);
  const identifiant = id.slice(id.lastIndexOf('/') + 1) + '@openrouter';
  const pricing = entree.pricing || {};
  const aCache = ('input_cache_read' in pricing) || ('input_cache_write' in pricing);

  const couts = [
    formaterCout(versMillions(pricing.prompt)),
    formaterCout(versMillions(pricing.completion)),
  ];
  if (aCache) {
    couts.push('input_cache_write' in pricing
      ? formaterCout(versMillions(pricing.input_cache_write))
      : '—');
    couts.push('input_cache_read' in pricing
      ? formaterCout(versMillions(pricing.input_cache_read))
      : '—');
  }

  return '| ' + identifiant + ' | openrouter | ' + id + ' | low…high | ' + couts.join(' / ')
    + ' | — | — | ' + entree.context_length + ' |';
}

/** Rend le catalogue complet (en-tete + lignes), termine par un saut de ligne. */
function rendreCatalogue(donnees, options) {
  const source = options.source;
  const date = options.date || dateDuJourUTC();
  const entrees = Array.isArray(donnees)
    ? donnees
    : ((donnees && Array.isArray(donnees.data)) ? donnees.data : []);
  const retenues = filtrerEntrees(entrees, options.motif);
  const lignes = retenues.map(ligneCatalogue);
  lignes.unshift(ligneEnTete(source, date));
  return lignes.join('\n') + '\n';
}

/** Lit et parse un fichier JSON local (aucun reseau). */
function lireFichier(source) {
  return JSON.parse(fs.readFileSync(source, 'utf8'));
}

/** Lit la source : fichier local, ou URL http(s):// (seul cas avec reseau). */
async function lireSource(source) {
  if (/^https?:\/\//i.test(source)) {
    const reponse = await fetch(source);
    if (!reponse.ok) throw new Error('HTTP ' + reponse.status + ' pour ' + source);
    return await reponse.json();
  }
  return lireFichier(source);
}

/** Analyse les arguments de la ligne de commande. */
function analyserArguments(argv) {
  const options = { source: null, motif: null, date: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') options.source = argv[i + 1];
    else if (arg === '--motif') options.motif = argv[i + 1];
    else if (arg === '--date') options.date = argv[i + 1];
    else if (arg.indexOf('--source=') === 0) options.source = arg.slice(9);
    else if (arg.indexOf('--motif=') === 0) options.motif = arg.slice(8);
    else if (arg.indexOf('--date=') === 0) options.date = arg.slice(7);
  }
  return options;
}

/** Point d'entree CLI. Retourne le code de sortie. */
async function main(argv) {
  const args = argv || process.argv.slice(2);
  const options = analyserArguments(args);
  if (!options.source) {
    process.stderr.write('usage : node lecture-openrouter.js --source <fichier.json|url> '
      + '[--motif <regex>] [--date <AAAA-MM-JJ>]\n');
    return 2;
  }
  const donnees = await lireSource(options.source);
  process.stdout.write(rendreCatalogue(donnees, options));
  return 0;
}

module.exports = {
  versMillions: versMillions,
  formaterCout: formaterCout,
  dateDuJourUTC: dateDuJourUTC,
  filtrerEntrees: filtrerEntrees,
  ligneEnTete: ligneEnTete,
  ligneCatalogue: ligneCatalogue,
  rendreCatalogue: rendreCatalogue,
  lireFichier: lireFichier,
  lireSource: lireSource,
  analyserArguments: analyserArguments,
  main: main,
};

if (require.main === module) {
  main().then(function (code) { process.exitCode = code; })
    .catch(function (erreur) {
      process.stderr.write(erreur.message + '\n');
      process.exitCode = 1;
    });
}
