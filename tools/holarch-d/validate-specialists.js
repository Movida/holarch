'use strict';

const fs = require('fs');
const path = require('path');

const NOMS_CATALOGUE = [
  'architecte-logiciel',
  'relecteur-code',
  'analyste-securite',
  'redacteur-technique',
  'strategiste-produit',
  'generaliste',
];

const PROFILS = ['triage', 'conception', 'execution', 'relecture'];
const OUTILS = ['none', 'read'];

const SECTIONS_ATTENDUES = [
  'Spécialité',
  'Quand me solliciter',
  'Posture',
  'Méthode',
  'Format de réponse',
  'Hors périmètre',
];

const MAX_LIGNES_FICHE = 110;
const MAX_CARACTERES_SOLLICITER = 200;

// --- Parsing -----------------------------------------------------------

function parseFrontMatter(bloc) {
  const meta = {};
  const lignes = bloc.split('\n');
  for (const ligne of lignes) {
    if (!ligne.trim()) continue;
    const idx = ligne.indexOf(':');
    if (idx === -1) continue;
    const cle = ligne.slice(0, idx).trim();
    let valeur = ligne.slice(idx + 1).trim();
    if (valeur.startsWith('[') && valeur.endsWith(']')) {
      const interieur = valeur.slice(1, -1).trim();
      valeur = interieur === ''
        ? []
        : interieur.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
    }
    meta[cle] = valeur;
  }
  return meta;
}

function parseFiche(texte, nomFichier) {
  const lignes = texte.split('\n');

  let meta = {};
  let corpsDebut = 0;
  if (lignes[0] !== undefined && lignes[0].trim() === '---') {
    const finIdx = lignes.indexOf('---', 1);
    if (finIdx !== -1) {
      meta = parseFrontMatter(lignes.slice(1, finIdx).join('\n'));
      corpsDebut = finIdx + 1;
    }
  }

  const sections = {};
  let titreCourant = null;
  let contenuCourant = [];
  const ordreTitres = [];

  for (let i = corpsDebut; i < lignes.length; i += 1) {
    const ligne = lignes[i];
    const m = /^##\s+(.+?)\s*$/.exec(ligne);
    if (m) {
      if (titreCourant !== null) {
        sections[titreCourant] = contenuCourant.join('\n').trim();
      }
      titreCourant = m[1];
      ordreTitres.push(titreCourant);
      contenuCourant = [];
    } else if (titreCourant !== null) {
      contenuCourant.push(ligne);
    }
  }
  if (titreCourant !== null) {
    sections[titreCourant] = contenuCourant.join('\n').trim();
  }

  return { meta, sections, lignes, _ordreTitres: ordreTitres, _nomFichier: nomFichier };
}

// --- Validation d'une fiche isolée -------------------------------------

function validerFiche(texte, nomFichier) {
  const erreurs = [];
  const nomAttendu = nomFichier.replace(/\.md$/, '');
  const { meta, sections, lignes, _ordreTitres } = parseFiche(texte, nomFichier);

  if (!meta.name) {
    erreurs.push(`${nomFichier} : champ "name" manquant dans le front-matter.`);
  } else if (meta.name !== nomAttendu) {
    erreurs.push(`${nomFichier} : "name" (${meta.name}) ne correspond pas au nom du fichier (${nomAttendu}).`);
  }

  if (!meta.profile_default) {
    erreurs.push(`${nomFichier} : champ "profile_default" manquant.`);
  } else if (!PROFILS.includes(meta.profile_default)) {
    erreurs.push(`${nomFichier} : "profile_default" (${meta.profile_default}) doit être l'un de ${PROFILS.join(' | ')}.`);
  }

  if (!meta.tools) {
    erreurs.push(`${nomFichier} : champ "tools" manquant.`);
  } else if (!OUTILS.includes(meta.tools)) {
    erreurs.push(`${nomFichier} : "tools" (${meta.tools}) doit être l'un de ${OUTILS.join(' | ')}.`);
  }

  if (meta.panel_affinity === undefined) {
    erreurs.push(`${nomFichier} : champ "panel_affinity" manquant.`);
  } else if (!Array.isArray(meta.panel_affinity)) {
    erreurs.push(`${nomFichier} : "panel_affinity" doit être une liste plate [a, b, c].`);
  } else {
    if (meta.panel_affinity.length < 1 || meta.panel_affinity.length > 3) {
      erreurs.push(`${nomFichier} : "panel_affinity" doit contenir de 1 à 3 noms (trouvé ${meta.panel_affinity.length}).`);
    }
    if (meta.name && meta.panel_affinity.includes(meta.name)) {
      erreurs.push(`${nomFichier} : "panel_affinity" ne peut pas se citer elle-même (${meta.name}).`);
    }
    for (const cible of meta.panel_affinity) {
      if (cible !== meta.name && !NOMS_CATALOGUE.includes(cible)) {
        erreurs.push(`${nomFichier} : "panel_affinity" référence "${cible}", absent du catalogue.`);
      }
    }
  }

  // Sections : présence, ordre, titre exact
  for (const titre of SECTIONS_ATTENDUES) {
    if (!(titre in sections)) {
      erreurs.push(`${nomFichier} : section "## ${titre}" manquante.`);
    }
  }
  const ordrePertinent = _ordreTitres.filter((t) => SECTIONS_ATTENDUES.includes(t));
  const ordreAttenduPresent = SECTIONS_ATTENDUES.filter((t) => ordrePertinent.includes(t));
  for (let i = 0; i < ordrePertinent.length; i += 1) {
    if (ordrePertinent[i] !== ordreAttenduPresent[i]) {
      erreurs.push(`${nomFichier} : les sections ne sont pas dans l'ordre imposé (attendu : ${SECTIONS_ATTENDUES.join(' · ')}).`);
      break;
    }
  }

  // "Quand me solliciter" a sa propre contrainte (une phrase, une ligne) : le minimum
  // général de 3 lignes ne s'applique qu'aux cinq autres sections.
  for (const titre of SECTIONS_ATTENDUES) {
    if (titre === 'Quand me solliciter') continue;
    const contenu = sections[titre];
    if (contenu === undefined) continue;
    const lignesNonVides = contenu.split('\n').filter((l) => l.trim().length > 0);
    if (lignesNonVides.length < 3) {
      erreurs.push(`${nomFichier} : section "## ${titre}" doit contenir au moins 3 lignes non vides (trouvé ${lignesNonVides.length}).`);
    }
  }

  const quandMeSolliciter = sections['Quand me solliciter'];
  if (quandMeSolliciter !== undefined) {
    const nbLignes = quandMeSolliciter.split('\n').filter((l) => l.trim().length > 0).length;
    if (nbLignes > 1) {
      erreurs.push(`${nomFichier} : "## Quand me solliciter" doit tenir sur une seule phrase (sur une seule ligne), trouvé ${nbLignes} lignes.`);
    }
    if (quandMeSolliciter.length > MAX_CARACTERES_SOLLICITER) {
      erreurs.push(`${nomFichier} : "## Quand me solliciter" dépasse ${MAX_CARACTERES_SOLLICITER} caractères (${quandMeSolliciter.length}).`);
    }
  }

  const nbLignesFiche = lignes.length;
  if (nbLignesFiche > MAX_LIGNES_FICHE) {
    erreurs.push(`${nomFichier} : fiche trop longue (${nbLignesFiche} lignes, max ${MAX_LIGNES_FICHE}).`);
  }

  return { nom: nomAttendu, meta, sections, erreurs };
}

// --- Catalogue -----------------------------------------------------------

function chargerCatalogue(repertoire) {
  const erreurs = [];
  const fiches = new Map();

  let entrees = [];
  try {
    entrees = fs.readdirSync(repertoire).filter((f) => f.endsWith('.md'));
  } catch (e) {
    erreurs.push(`Impossible de lire le répertoire "${repertoire}" : ${e.message}`);
    return { fiches, erreurs };
  }

  for (const nomFichier of entrees) {
    const cheminComplet = path.join(repertoire, nomFichier);
    const texte = fs.readFileSync(cheminComplet, 'utf8');
    const ficheValidee = validerFiche(texte, nomFichier);
    if (ficheValidee.erreurs.length > 0) {
      erreurs.push(...ficheValidee.erreurs);
      continue;
    }
    fiches.set(ficheValidee.nom, ficheValidee);
  }

  return { fiches, erreurs };
}

function validerCatalogue(repertoire) {
  const { fiches, erreurs } = chargerCatalogue(repertoire);

  for (const nomAttendu of NOMS_CATALOGUE) {
    if (!fiches.has(nomAttendu)) {
      erreurs.push(`Fiche manquante dans le catalogue : "${nomAttendu}".`);
    }
  }
  for (const nom of fiches.keys()) {
    if (!NOMS_CATALOGUE.includes(nom)) {
      erreurs.push(`Fiche en trop, hors catalogue v1 : "${nom}".`);
    }
  }

  // La cohérence de "panel_affinity" avec le catalogue (noms valides, pas d'auto-citation)
  // est déjà vérifiée fiche par fiche dans validerFiche, contre la liste statique
  // NOMS_CATALOGUE — inutile de la refaire ici.

  return { ok: erreurs.length === 0, fiches: Array.from(fiches.values()), erreurs };
}

// --- CLI -------------------------------------------------------------

function main() {
  const repertoire = process.argv[2] || './specialists';
  const resultat = validerCatalogue(repertoire);

  const parFiche = new Map();
  for (const erreur of resultat.erreurs) {
    const m = /^([\w.-]+\.md)\s*:/.exec(erreur);
    const cle = m ? m[1] : '(catalogue)';
    if (!parFiche.has(cle)) parFiche.set(cle, []);
    parFiche.get(cle).push(erreur);
  }

  for (const fiche of resultat.fiches) {
    console.log(`OK   ${fiche.nom}.md`);
  }
  for (const [cle, erreurs] of parFiche.entries()) {
    console.log(`ERR  ${cle}`);
    for (const e of erreurs) console.log(`     - ${e}`);
  }

  console.log('');
  console.log(resultat.ok
    ? `Catalogue valide : ${resultat.fiches.length} fiche(s).`
    : `Catalogue invalide : ${resultat.erreurs.length} erreur(s).`);

  process.exitCode = resultat.ok ? 0 : 1;
}

if (require.main === module) {
  main();
}

module.exports = {
  NOMS_CATALOGUE,
  PROFILS,
  parseFiche,
  validerFiche,
  chargerCatalogue,
  validerCatalogue,
};
