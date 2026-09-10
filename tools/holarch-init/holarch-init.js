#!/usr/bin/env node
/**
 * holarch-init — setup guidé d'une mission HOLARCH (« session RH »)
 *
 * Priorité 3.4 de shared/concepteur/SYNTHESE-HOLON-V2.md : l'objectif O6
 * (« un utilisateur non expert démarre via un preset en moins de 5 minutes »)
 * n'est aujourd'hui vrai que pour qui sait déjà éditer un tableau markdown de
 * CONFIG.md. Cet outil pose des questions en langue naturelle et produit
 * OBJECTIVE.md + CONFIG.md — puis les valide mécaniquement.
 *
 * Deux modes :
 *   node holarch-init.js --out <dir>                        dialogue interactif
 *   node holarch-init.js --reponses <f.json> --out <dir>    non interactif (tests, CI)
 *
 * Node pur, aucune dépendance.
 * Codes de sortie : 0 succès · 1 configuration produite non conforme · 2 erreur d'usage.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

/* ------------------------------------------------------------------ *
 * Connaissance du catalogue : ce que l'utilisateur n'a pas à connaître.
 * Ordre des catégories = ordre d'écriture dans CONFIG.md.
 * ------------------------------------------------------------------ */

const ORDRE_CATEGORIES = [
  'orchestration', 'synchronisation', 'memoire',
  'recursion', 'conflits', 'registre', 'extensions', 'observabilite',
];

const QUESTIONS = [
  {
    cle: 'mission',
    texte: 'Nom court de la mission (kebab-case, ex. « refonte-site ») :',
    valide: (v) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(v) || 'kebab-case attendu : minuscules, chiffres et tirets.',
  },
  {
    cle: 'objectif',
    texte: 'En une phrase, que doit accomplir cette mission ?',
    valide: (v) => v.trim().length >= 10 || 'Trop court : une phrase complète aide toutes les instances à s\'orienter.',
  },
  {
    cle: 'reussite',
    texte: 'À quoi verras-tu que c\'est réussi ? (une ligne, facultatif — Entrée pour passer)',
    facultatif: true,
  },
  {
    cle: 'ampleur',
    texte: 'Ampleur du travail ?\n    1) une tâche cadrée, menée seul ou presque\n    2) un projet à plusieurs étapes et plusieurs rôles',
    choix: { 1: 'solo', 2: 'equipe' },
  },
  {
    cle: 'dependances',
    texte: 'Les tâches dépendent-elles les unes des autres (l\'une attend le résultat de l\'autre) ? [o/N]',
    booleen: true,
    defaut: false,
  },
  {
    cle: 'audit',
    texte: 'Auras-tu besoin de rejouer le détail des décisions a posteriori (audit fin) ? [o/N]',
    booleen: true,
    defaut: false,
  },
  {
    cle: 'suivi',
    texte: 'Veux-tu suivre l\'avancement en direct, même si une session est interrompue ? [O/n]',
    booleen: true,
    defaut: true,
  },
];

/* ------------------------------------------------------------------ *
 * Dérivation : réponses -> modules + paramètres.
 * ------------------------------------------------------------------ */

function deriver(r) {
  const equipe = r.ampleur === 'equipe';
  const modules = [];
  const push = (categorie, nom, pourquoi) => modules.push({ categorie, nom, pourquoi });

  push('orchestration', 'direct-spawn', 'seul module d\'orchestration du catalogue v1.1');
  r.dependances
    ? push('synchronisation', 'dependency-graph', 'des tâches attendent le résultat d\'autres tâches')
    : push('synchronisation', 'fork-join', 'les tâches sont indépendantes : tout le monde démarre, on attend la fin');
  r.audit
    ? push('memoire', 'journal-synthesis', 'audit fin demandé : journal append-only détaillé')
    : push('memoire', 'unites-indexees', 'pas d\'audit fin demandé : mémoire adressée — fiches d\'unité immuables, MEMORY.md court, index régénéré au réveil (défaut des presets depuis le framework 1.4.0)');

  push('recursion', 'self-assessment', 'garde-fou obligatoire avant tout spawn');
  push('recursion', 'max-depth', 'fusible contre l\'explosion de la holarchie');
  push('recursion', 'context-budget', 'fusible contre la dérive de contexte en session longue');
  if (equipe) push('recursion', 'instance-budget', 'projet à plusieurs rôles : le budget doit être réparti à chaque spawn');

  push('conflits', 'typed-escalation', 'règles d\'escalade typées');
  if (equipe) push('conflits', 'graveyard-handover', 'plusieurs niveaux : un recadrage doit pouvoir archiver proprement');

  push('registre', 'sharded-files', 'une fiche par instance : pas de conflit d\'écriture');
  if (r.suivi) push('observabilite', 'heartbeat-log', 'progression visible même si une session est tuée');

  modules.sort((a, b) => ORDRE_CATEGORIES.indexOf(a.categorie) - ORDRE_CATEGORIES.indexOf(b.categorie));

  const parametres = {
    budget_instances_total: r.budget_instances_total ?? (equipe ? 15 : 5),
    profondeur_max: r.profondeur_max ?? (equipe ? 3 : 2),
    langue_de_travail: r.langue_de_travail ?? 'fr',
    commit_par_session: 'oui',
    permission_mode: 'acceptEdits',
    format_rapport_final: equipe ? 'executive-summary' : 'simple',
    budget_usd_par_session: r.budget_usd_par_session ?? (equipe ? 8 : 5),
    max_tours_par_session: equipe ? 300 : 200,
    seuil_contexte_tokens: 120000,
  };

  return { modules, parametres, preset: equipe ? 'team-standard' : 'solo-light' };
}

/* ------------------------------------------------------------------ *
 * Rendu des deux fichiers.
 * ------------------------------------------------------------------ */

function rendreConfig(r, d) {
  const lignes = [];
  lignes.push(`# Configuration — mission : ${r.mission}`);
  lignes.push(`> Preset de base : ${d.preset} · Framework : v1.1`);
  lignes.push('> Généré par holarch-init (setup guidé). Modifiable à la main : ce fichier n\'a rien de spécial.');
  lignes.push('');
  lignes.push('## Modules actifs');
  lignes.push('| # | Catégorie | Module |');
  lignes.push('|---|---|---|');
  d.modules.forEach((m, i) => lignes.push(`| ${i + 1} | ${m.categorie} | ${m.nom} |`));
  lignes.push('');
  lignes.push('## Paramètres');
  lignes.push('| Paramètre | Valeur |');
  lignes.push('|---|---|');
  for (const [k, v] of Object.entries(d.parametres)) lignes.push(`| ${k} | ${v} |`);
  lignes.push('');
  lignes.push('## Politique de modèle');
  lignes.push('| Profil | Modèle | Effort |');
  lignes.push('|---|---|---|');
  lignes.push('| conception | opus | high |');
  lignes.push('| execution | sonnet | medium |');
  lignes.push('| relecture | opus | medium |');
  lignes.push('| exploration | fable | xhigh |');
  lignes.push('');
  lignes.push('## Valeurs organisationnelles');
  if (d.preset === 'solo-light') {
    lignes.push('- Préfère une organisation plate : ne décompose que si le questionnaire `self-assessment` le justifie clairement.');
    lignes.push('- En cas de doute entre faire seul et spawner, faire seul.');
  } else {
    lignes.push('- La qualité d\'un livrable d\'enfant prime sur la vitesse : ne jamais accepter un livrable non conforme pour "avancer".');
    lignes.push('- Toute décomposition doit rester justifiable par le questionnaire `self-assessment`, même dans une organisation à plusieurs niveaux.');
  }
  lignes.push('');
  lignes.push('## Pourquoi ces modules (trace du setup guidé)');
  for (const m of d.modules) lignes.push(`- \`${m.nom}\` — ${m.pourquoi}`);
  lignes.push('');
  return lignes.join('\n');
}

function rendreObjective(r) {
  const lignes = [];
  lignes.push(`# Objectif — mission : ${r.mission}`);
  lignes.push('');
  lignes.push('## Énoncé');
  lignes.push(r.objectif.trim());
  lignes.push('');
  lignes.push('## Critères de réussite');
  lignes.push(r.reussite && r.reussite.trim()
    ? r.reussite.trim()
    : '_Non précisés au setup._ L\'instance racine doit les expliciter à `ON_ORIENT` et, en cas d\'ambiguïté bloquante, demander une `CLARIFICATION` à l\'utilisateur (KERNEL §6.1).');
  lignes.push('');
  lignes.push('## Périmètre');
  lignes.push(`Ampleur déclarée au setup : **${r.ampleur === 'equipe' ? 'projet à plusieurs étapes et plusieurs rôles' : 'tâche cadrée, menée seul ou presque'}**.`);
  lignes.push('Les contraintes opérationnelles (budget d\'instances, profondeur, plafonds de session) sont dans `framework/CONFIG.md`.');
  lignes.push('');
  lignes.push('---');
  lignes.push('> Ce fichier est en lecture seule pour toute instance (KERNEL §4) : seul l\'utilisateur le modifie.');
  lignes.push('');
  return lignes.join('\n');
}

/* ------------------------------------------------------------------ *
 * Validation de la configuration produite, via module-forge.
 * ------------------------------------------------------------------ */

function validerConfigProduite(fichierConfig, options = {}) {
  const chemin = options.validateur || path.join(__dirname, '..', 'module-forge', 'validate-module.js');
  if (!fs.existsSync(chemin)) return { disponible: false, erreurs: [], avertissements: [] };
  const v = require(chemin);
  const ctx = v.construireContexte({
    extras: [],
    manifest: options.manifest || '',
    modulesDir: options.modulesDir || '',
  });
  const r = v.validerConfig(fichierConfig, ctx);
  return { disponible: true, erreurs: r.erreurs, avertissements: r.avertissements || [] };
}

/* ------------------------------------------------------------------ *
 * Écriture — avec le garde-fou de cloisonnement KERNEL §4.
 * ------------------------------------------------------------------ */

function ecrire(reponses, options) {
  const d = deriver(reponses);
  const sortie = path.resolve(options.out);

  // KERNEL §4 : framework/ et OBJECTIVE.md ne sont pas écrits à l'aveugle par un outil.
  // On refuse d'écraser un CONFIG.md/OBJECTIVE.md existant sans --force explicite.
  fs.mkdirSync(sortie, { recursive: true });
  const fConfig = path.join(sortie, 'CONFIG.md');
  const fObjectif = path.join(sortie, 'OBJECTIVE.md');
  for (const f of [fConfig, fObjectif]) {
    if (fs.existsSync(f) && !options.force) {
      throw new Error(`${path.relative(process.cwd(), f)} existe déjà — relance avec --force pour l'écraser.`);
    }
  }

  fs.writeFileSync(fConfig, rendreConfig(reponses, d));
  fs.writeFileSync(fObjectif, rendreObjective(reponses));
  return { fConfig, fObjectif, derive: d };
}

/* ------------------------------------------------------------------ *
 * Dialogue.
 * ------------------------------------------------------------------ */

function normaliser(q, brut) {
  const v = (brut || '').trim();
  if (q.booleen) {
    if (!v) return q.defaut;
    return /^(o|oui|y|yes)$/i.test(v);
  }
  if (q.choix) return q.choix[v] || null;
  return v;
}

async function dialogue() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const demander = (t) => new Promise((res) => rl.question(t, res));
  const reponses = {};

  process.stdout.write('\nholarch-init — mise en route d\'une mission HOLARCH\n');
  process.stdout.write('7 questions, puis les deux fichiers de démarrage sont écrits et vérifiés.\n\n');

  for (const q of QUESTIONS) {
    for (;;) {
      const brut = await demander(`  ${q.texte}\n  > `);
      const v = normaliser(q, brut);
      if (q.facultatif && (v === '' || v === undefined)) { reponses[q.cle] = ''; break; }
      if (q.choix && !v) { process.stdout.write('  ↳ Réponds par le numéro du choix.\n'); continue; }
      if (q.valide) {
        const ok = q.valide(v);
        if (ok !== true) { process.stdout.write(`  ↳ ${ok}\n`); continue; }
      }
      reponses[q.cle] = v;
      break;
    }
    process.stdout.write('\n');
  }
  rl.close();
  return reponses;
}

/* ------------------------------------------------------------------ *
 * Entrée.
 * ------------------------------------------------------------------ */

function usage() {
  process.stdout.write([
    'holarch-init — setup guidé d\'une mission HOLARCH (« session RH »)',
    '',
    '  node holarch-init.js --out <dir>                       dialogue interactif',
    '  node holarch-init.js --reponses <f.json> --out <dir>   non interactif',
    '',
    'Options : --force (écraser) --sans-validation --manifest <f> --modules-dir <d>',
    '',
    'Produit <dir>/OBJECTIVE.md et <dir>/CONFIG.md, puis valide la configuration',
    'avec module-forge (validate-module.js). Ne modifie jamais framework/.',
    '',
  ].join('\n'));
}

async function main(argv) {
  const o = { out: '', reponses: '', force: false, valider: true, manifest: '', modulesDir: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') o.out = argv[++i];
    else if (a === '--reponses') o.reponses = argv[++i];
    else if (a === '--force') o.force = true;
    else if (a === '--sans-validation') o.valider = false;
    else if (a === '--manifest') o.manifest = argv[++i];
    else if (a === '--modules-dir') o.modulesDir = argv[++i];
    else if (a === '-h' || a === '--help') { usage(); return 0; }
    else { usage(); return 2; }
  }
  if (!o.out) { usage(); return 2; }

  let reponses;
  if (o.reponses) {
    reponses = JSON.parse(fs.readFileSync(o.reponses, 'utf8'));
    for (const q of QUESTIONS) {
      if (q.facultatif) continue;
      if (reponses[q.cle] === undefined) {
        process.stderr.write(`réponse manquante : « ${q.cle} »\n`);
        return 2;
      }
    }
  } else {
    reponses = await dialogue();
  }

  let res;
  try { res = ecrire(reponses, o); }
  catch (e) { process.stderr.write(`${e.message}\n`); return 2; }

  process.stdout.write(`\n  ✓ ${path.relative(process.cwd(), res.fObjectif)}\n`);
  process.stdout.write(`  ✓ ${path.relative(process.cwd(), res.fConfig)}  (${res.derive.modules.length} modules, preset ${res.derive.preset})\n`);

  if (!o.valider) { process.stdout.write('\n  (validation ignorée : --sans-validation)\n\n'); return 0; }

  const v = validerConfigProduite(res.fConfig, o);
  if (!v.disponible) {
    process.stdout.write('\n  ! validate-module.js introuvable : configuration non vérifiée.\n\n');
    return 0;
  }
  if (v.erreurs.length) {
    process.stdout.write(`\n  ✗ configuration produite NON conforme (${v.erreurs.length} erreur(s)) :\n`);
    for (const e of v.erreurs) process.stdout.write(`      ${e}\n`);
    process.stdout.write('\n');
    return 1;
  }
  process.stdout.write('  ✓ configuration validée par module-forge : 0 erreur\n');
  process.stdout.write('\n  Prochaine étape : copie CONFIG.md vers framework/CONFIG.md et OBJECTIVE.md vers\n');
  process.stdout.write('  mission/OBJECTIVE.md, puis lance le bootstrap (framework/BOOTSTRAP.md).\n\n');
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then((c) => process.exit(c));
}

module.exports = { deriver, rendreConfig, rendreObjective, ecrire, validerConfigProduite, normaliser, QUESTIONS };
