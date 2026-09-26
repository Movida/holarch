#!/usr/bin/env node
'use strict';
/**
 * holarch-job.js — CLI mince du chantier 16 (docs/IMPLEMENTATION.md §18.4) : toute la logique vit
 * dans `jobs.js` (module require-able, testé directement) ; ce fichier ne fait qu'analyser argv,
 * appeler jobs.js et formater la sortie.
 */

const jobs = require('./jobs');
const lots = require('./lots');

const AIDE = `holarch-job — jobs asynchrones du harnais HOLARCH (docs/IMPLEMENTATION.md §18.4)

Usage :
  holarch-job lancer <nom> [--lourd] [--sortie <chemin>]... [--valider '<commande {fichier}>']
                       [--progression <fichier>] [--reprenable] -- <commande...>
  holarch-job superviser <id>          (usage interne ; jamais à lancer à la main)
  holarch-job etat <id>
  holarch-job liste [--proprietaire <chemin>] [--vivants]
  holarch-job journal <id> [--lignes <n>]
  holarch-job arreter <id>
  holarch-job reprendre
  holarch-job lot <fichier.json> [--devis] [--plafond <usd>]   (chantier 16 §18.6, lots payants)
  holarch-job jouer-lot <fichier.json> --cle <cle>     (usage interne ; jamais à lancer à la main)

--valider est découpé en argv SANS shell : les espaces séparent les arguments, un guillemet simple
ou double groupe un argument (les guillemets ne sont pas conservés), aucun échappement ni aucune
expansion (variables, glob) n'est reconnu.
`;

function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(AIDE);
    process.exit(0);
    return;
  }
  const sousCommande = argv[0];
  const reste = argv.slice(1);
  const root = jobs.racine(process.cwd());

  if (sousCommande === 'lancer') {
    let opts;
    try {
      opts = jobs.parseLancerArgs(reste);
    } catch (err) {
      process.stderr.write(`erreur d'usage : ${err.message}\n`);
      process.exit(2);
      return;
    }
    opts.cwd = process.cwd();
    // Troisième revue n° 85 : un refus de jobs.lancer (n° 37, 55) est un message et le code 2, pas une pile.
    let id;
    try { ({ id } = jobs.lancer(opts)); } catch (err) {
      process.stderr.write(`holarch-job : lancement refusé : ${err.message}\n`);
      process.exit(2);
      return;
    }
    process.stdout.write(`${id}\n`);
    return;
  }

  if (sousCommande === 'superviser') {
    const id = reste[0];
    if (!id) { process.stderr.write('id requis\n'); process.exit(2); return; }
    // superviser() est asynchrone (§18.5, admission d'un job lourd) : un rejet non rattrapé
    // terminerait ce processus détaché sans jamais écrire d'état terminal — filet de sécurité.
    jobs.superviser(root, id).catch((err) => {
      try { process.stderr.write(`[job] erreur superviseur : ${(err && err.stack) || err}\n`); } catch (_err2) { /* ignore */ }
      process.exit(1);
    });
    return;
  }

  if (sousCommande === 'etat') {
    const id = reste[0];
    if (!id) { process.stderr.write('id requis\n'); process.exit(2); return; }
    const etat = jobs.lireEtat(root, id);
    if (!etat) { process.stderr.write(`job inconnu : ${id}\n`); process.exit(1); return; }
    process.stdout.write(`${JSON.stringify(etat, null, 2)}\n`);
    return;
  }

  if (sousCommande === 'liste') {
    let proprietaire = null;
    let vivants = false;
    for (let i = 0; i < reste.length; i += 1) {
      if (reste[i] === '--proprietaire') { proprietaire = reste[i + 1]; i += 1; } else if (reste[i] === '--vivants') vivants = true;
    }
    process.stdout.write(`${JSON.stringify(jobs.listerJobs(root, { proprietaire, vivants }), null, 2)}\n`);
    return;
  }

  if (sousCommande === 'journal') {
    const id = reste[0];
    if (!id) { process.stderr.write('id requis\n'); process.exit(2); return; }
    let n = null;
    for (let i = 1; i < reste.length; i += 1) if (reste[i] === '--lignes') n = Number(reste[i + 1]);
    process.stdout.write(jobs.lireJournal(root, id, n));
    return;
  }

  if (sousCommande === 'arreter') {
    const id = reste[0];
    if (!id) { process.stderr.write('id requis\n'); process.exit(2); return; }
    const appelant = jobs.proprietaireActuel();
    const r = jobs.arreterJob(root, id, appelant);
    if (!r.ok) { process.stderr.write(`${r.message}\n`); process.exit(r.code); return; }
    process.stdout.write(`${r.message}\n`);
    return;
  }

  if (sousCommande === 'reprendre') {
    const r = jobs.reprendre(root);
    for (const l of r.lignes) process.stdout.write(`${l}\n`);
    return;
  }

  if (sousCommande === 'lot') {
    const fichier = reste[0];
    if (!fichier) { process.stderr.write('fichier de lot requis\n'); process.exit(2); return; }
    let devis = false;
    let plafond;
    // Seconde revue n° 66 : option inconnue (`--plafond=1`, `--devi`) ou `--plafond` répété → refus, comme `lancer`
    // (jobs.js) — jamais ignorée, sinon le lot est joué sans la borne ou sans le devis que l'appelant croyait demander.
    for (let i = 1; i < reste.length; i += 1) {
      if (reste[i] === '--devis') devis = true;
      else if (reste[i] === '--plafond' && plafond === undefined) { plafond = lots.nombreUsd(reste[i + 1]); i += 1; }
      else if (reste[i] === '--plafond') { process.stderr.write('--plafond répété\n'); process.exit(2); return; }
      else { process.stderr.write(`option inconnue : ${reste[i]} (lot <fichier> [--devis] [--plafond <usd>])\n`); process.exit(2); return; }
    }
    // Revue n° 23 : un plafond illisible ou négatif est refusé, jamais ignoré (le lot serait joué sans borne).
    if (plafond !== undefined && !(plafond >= 0)) {
      process.stderr.write('--plafond : montant USD attendu (ex. 0.5 ou 0,5)\n'); process.exit(2); return;
    }
    const r = lots.lot(fichier, { devis, plafond: Number.isFinite(plafond) ? plafond : undefined, cwd: process.cwd() });
    if (!r.ok) { process.stderr.write(`${r.message}\n`); process.exit(r.code); return; }
    if (devis) {
      process.stdout.write(`devis ${r.devis} USD (cumul ${r.cumul} USD, budget ${r.budget} USD)\n`);
      return;
    }
    process.stdout.write(`${r.id}\n`);
    return;
  }

  if (sousCommande === 'jouer-lot') {
    const fichier = reste[0];
    let cle = null;
    let jobId = null;
    for (let i = 1; i < reste.length; i += 1) {
      if (reste[i] === '--cle') { cle = reste[i + 1]; i += 1; } else if (reste[i] === '--job') { jobId = reste[i + 1]; i += 1; }
    }
    lots.jouerLot(fichier, cle, { cwd: process.cwd(), job: jobId })
      .then((code) => process.exit(code))
      .catch((err) => {
        try { process.stderr.write(`erreur jouer-lot : ${(err && err.stack) || err}\n`); } catch (_err2) { /* ignore */ }
        process.exit(1);
      });
    return;
  }

  process.stderr.write(`sous-commande inconnue : ${sousCommande}\n\n${AIDE}`);
  process.exit(2);
}

main();
