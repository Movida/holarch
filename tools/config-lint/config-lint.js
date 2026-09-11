#!/usr/bin/env node
'use strict';
/**
 * config-lint — validation mécanique de `framework/CONFIG.md` contre `framework/MANIFEST.md`.
 *
 * Mécanise l'Étape 1.3 de `framework/BOOTSTRAP.md` (test d'acceptation T1), aujourd'hui
 * effectuée à la main par la session de bootstrap. N'invente aucune règle : chaque contrôle
 * ci-dessous cite la ligne de BOOTSTRAP.md ou du module actif dont il découle.
 *
 * Usage :
 *   node config-lint.js [chemin/CONFIG.md] [--manifest chemin/MANIFEST.md]
 *                       [--modules-dir framework/modules] [--bootstrap-check] [--json]
 *
 * Codes de sortie : 0 = aucune erreur (des avertissements sont possibles), 1 = au moins une erreur.
 *
 * Sans dépendance, sur le modèle de `tools/module-lint/module-lint.js`.
 */

const fs = require('fs');
const path = require('path');

const CATEGORIES_OBLIGATOIRES = ['orchestration', 'synchronisation', 'memoire', 'registre'];
const PERMISSION_MODES = ['acceptEdits', 'default', 'manual', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];
const FORMATS_RAPPORT = ['simple', 'executive-summary'];
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PROFILS = ['conception', 'execution', 'relecture', 'exploration'];
const ENTIERS_POSITIFS = ['budget_usd_par_session', 'max_tours_par_session', 'seuil_contexte_tokens', 'autocompact_tokens'];

// Paramètres transverses reconnus, non portés par un module en particulier
// (`CONFIG.md` de référence + BOOTSTRAP.md étape 1.3 + étape 3).
const PARAMETRES_TRANSVERSES = [
  'budget_instances_total', 'langue_de_travail', 'commit_par_session',
  'permission_mode', 'format_rapport_final',
];

// Chemins pré-bootstrap dont l'existence signale une mission déjà en cours (BOOTSTRAP.md étape 1.2).
const MARQUEURS_MISSION = ['mission/registry', 'mission/concepteur', 'mission/shared', 'mission/graveyard'];

const VIDE = new Set(['', '—', '-', '–']);
const estVide = (v) => VIDE.has(String(v == null ? '' : v).trim());

/** Découpe un texte markdown en sections `## Titre` (le titre est normalisé en minuscules sans accents). */
function sections(texte) {
  const out = new Map();
  let courante = null;
  const lignes = [];
  for (const ligne of String(texte).split('\n')) {
    const m = /^##\s+(.+?)\s*$/.exec(ligne);
    if (m) {
      if (courante !== null) out.set(courante, lignes.splice(0).join('\n'));
      courante = normaliser(m[1]);
      lignes.length = 0;
    } else if (courante !== null) {
      lignes.push(ligne);
    }
  }
  if (courante !== null) out.set(courante, lignes.join('\n'));
  return out;
}

function normaliser(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/**
 * Lit la première table markdown d'un texte et renvoie ses lignes sous forme d'objets
 * indexés par en-tête normalisé. Les lignes de séparation (`|---|`) sont ignorées.
 */
function table(texte) {
  const lignes = String(texte).split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  const cellules = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const utiles = lignes.filter((l) => !/^\|[\s:|-]+\|?$/.test(l));
  if (utiles.length === 0) return [];
  const entetes = cellules(utiles[0]).map(normaliser);
  return utiles.slice(1).map((l) => {
    const c = cellules(l);
    const o = {};
    entetes.forEach((e, i) => { o[e] = c[i] === undefined ? '' : c[i]; });
    return o;
  });
}

/** Extrait un nom de module d'une cellule éventuellement formatée en lien markdown. */
function nomModule(cellule) {
  const m = /^\[([^\]]+)\]\(([^)]*)\)$/.exec(String(cellule).trim());
  return (m ? m[1] : String(cellule)).trim().replace(/`/g, '');
}

function liste(cellule) {
  if (estVide(cellule)) return [];
  return String(cellule).split(/[,;]/).map((x) => nomModule(x)).filter((x) => !estVide(x));
}

/** Contenu d'une cellule de table, débarrassé des accents graves du markdown. */
const texteCellule = (v) => String(v == null ? '' : v).replace(/`/g, '').trim();

/**
 * Cellule « Efforts » du catalogue → { permis[], invalides[] } (chantier 9, §11.2).
 * Formes acceptées : intervalle `low…max` sur l'ordre canonique, liste `low, high`, ou vide (`—`)
 * qui signifie « pas de contrainte connue » — et non « aucun effort permis » : un fournisseur dont
 * on ignore les paliers ne doit pas faire échouer le lint.
 * Volontairement dupliqué de `framework/bin/catalogue.js` (même règle, deux lectures indépendantes) :
 * config-lint valide un texte et ne dépend d'aucun fichier de `framework/bin/`.
 */
function effortsDeCellule(cellule) {
  const out = { permis: [], invalides: [] };
  if (estVide(cellule)) return out;
  const brut = String(cellule).replace(/`/g, '').trim();
  const intervalle = /^([^\s…]+)\s*(?:…|\.\.\.|\.\.|–|—|-)\s*([^\s…]+)$/.exec(brut);
  if (intervalle) {
    const a = EFFORTS.indexOf(normaliser(intervalle[1]));
    const b = EFFORTS.indexOf(normaliser(intervalle[2]));
    if (a >= 0 && b >= a) out.permis = EFFORTS.slice(a, b + 1);
    else out.invalides.push(brut);
    return out;
  }
  for (const e of liste(brut)) {
    const n = normaliser(e);
    if (EFFORTS.includes(n)) out.permis.push(n); else out.invalides.push(e);
  }
  return out;
}

/** MANIFEST.md → Map(nom → { categorie, version, requiert[], incompatible[] }). */
function parseManifest(texte) {
  const modules = new Map();
  for (const ligne of table(texte)) {
    const nom = nomModule(ligne['module'] || '');
    if (estVide(nom) || nom.toLowerCase() === 'module') continue;
    modules.set(nom, {
      nom,
      categorie: normaliser(ligne['categorie'] || ''),
      version: (ligne['version'] || '').trim(),
      requiert: liste(ligne['requiert']),
      incompatible: liste(ligne['incompatible avec']),
    });
  }
  return modules;
}

/** CONFIG.md → { actifs[], parametres: Map, politique[], aPolitique }. */
function parseConfig(texte) {
  const sec = sections(texte);
  const actifs = [];
  for (const ligne of table(sec.get('modules actifs') || '')) {
    const nom = nomModule(ligne['module'] || '');
    if (estVide(nom)) continue;
    actifs.push({ nom, categorie: normaliser(ligne['categorie'] || '') });
  }
  const parametres = new Map();
  for (const ligne of table(sec.get('parametres') || '')) {
    const nom = String(ligne['parametre'] || '').replace(/`/g, '').trim();
    if (estVide(nom)) continue;
    parametres.set(nom, String(ligne['valeur'] || '').replace(/`/g, '').trim());
  }
  const aPolitique = sec.has('politique de modele');
  const politique = [];
  for (const ligne of table(sec.get('politique de modele') || '')) {
    politique.push({
      profil: normaliser(ligne['profil'] || ''),
      modele: String(ligne['modele'] || '').replace(/`/g, '').trim(),
      effort: normaliser(ligne['effort'] || ''),
    });
  }
  // Chantier 9, volet 2 (§11.2) : deux tables FACULTATIVES. Leur absence n'est jamais une erreur —
  // un `CONFIG.md` 1.11 doit passer ce lint sans la moindre modification (compatibilité ascendante,
  // critère d'acceptation du chantier). Les drapeaux `a…` distinguent « table absente » de « table
  // présente mais vide », qui est une faute de configuration.
  const aFournisseurs = sec.has('fournisseurs');
  const fournisseurs = [];
  for (const ligne of table(sec.get('fournisseurs') || '')) {
    const nom = texteCellule(ligne['nom']);
    if (estVide(nom)) continue;
    fournisseurs.push({
      nom,
      executeur: texteCellule(ligne['executeur']),
      url: texteCellule(ligne['url (variable)']),
      jeton: texteCellule(ligne['jeton (variable)']),
      secours: texteCellule(ligne['secours']),
    });
  }
  // L'en-tête de la colonne de coût a deux formes selon que le catalogue écrit les tarifs de cache
  // ou non (« Coût entrée / sortie … » ou « Coût entrée / sortie [/ cache écrit / cache lu] … ») :
  // on la retrouve par son préfixe plutôt que par son libellé exact, pour lire les deux.
  const celluleCout = (ligne) => {
    const cle = Object.keys(ligne).find((k) => k.startsWith('cout'));
    return cle === undefined ? '' : ligne[cle];
  };
  const aCatalogue = sec.has('catalogue de modeles');
  const catalogue = [];
  for (const ligne of table(sec.get('catalogue de modeles') || '')) {
    const id = texteCellule(ligne['identifiant']);
    if (estVide(id)) continue;
    catalogue.push({
      id,
      fournisseur: texteCellule(ligne['fournisseur']),
      reel: texteCellule(ligne['modele reel']),
      efforts: texteCellule(ligne['efforts']),
      cout: texteCellule(celluleCout(ligne)),
      aptitudes: liste(ligne['aptitudes']),
      equivalent: liste(ligne['equivalent']),
    });
  }
  return { actifs, parametres, politique, aPolitique, fournisseurs, catalogue, aFournisseurs, aCatalogue };
}

/**
 * Section `## Paramètres` d'un module → [{ nom, requis, heriteDe }].
 * Heuristique assumée (voir « Limites » du README) : un paramètre est requis dans `CONFIG.md`
 * si sa cellule « Défaut » est vide ; si elle est de la forme *(hérité de `CONFIG.md` → `X`)*,
 * c'est `X` qui est requis. Tout autre défaut rend le paramètre optionnel
 * (BOOTSTRAP.md 1.3 : « ou ont une valeur par défaut explicite dans le module »).
 */
function parseModuleParams(texte) {
  const sec = sections(texte);
  const brut = sec.get('parametres');
  if (brut === undefined) return [];
  const out = [];
  for (const ligne of table(brut)) {
    const nom = String(ligne['parametre'] || '').replace(/`/g, '').trim();
    if (estVide(nom)) continue;
    const defaut = String(ligne['defaut'] || '').trim();
    const herite = /h[ée]rit[ée]\s+de\s+`?CONFIG\.md`?\s*(?:→|->)\s*`?([A-Za-z0-9_]+)`?/i.exec(defaut);
    out.push({
      nom,
      requis: estVide(defaut.replace(/^\*+|\*+$/g, '')),
      heriteDe: herite ? herite[1] : null,
    });
  }
  return out;
}

/**
 * Cœur du lint.
 * @param {{configText:string, manifestText:string, moduleTexts?:Map<string,string>, racine?:string, bootstrapCheck?:boolean}} entree
 * @returns {{erreurs:string[], avertissements:string[], config:object}}
 */
function lintConfig(entree) {
  const erreurs = [];
  const avertissements = [];
  const err = (m) => erreurs.push(m);
  const avert = (m) => avertissements.push(m);

  const manifest = parseManifest(entree.manifestText || '');
  const config = parseConfig(entree.configText || '');
  const moduleTexts = entree.moduleTexts || new Map();

  if (manifest.size === 0) err('MANIFEST.md : aucun module lisible (table absente ou colonnes inattendues).');
  if (config.actifs.length === 0) err('CONFIG.md : section "## Modules actifs" absente ou vide.');

  // 1.3.a — chaque module actif existe dans le MANIFEST (« un module absent est inutilisable »).
  const connus = [];
  const vus = new Set();
  for (const actif of config.actifs) {
    if (vus.has(actif.nom)) err(`module actif en double : "${actif.nom}".`);
    vus.add(actif.nom);
    const fiche = manifest.get(actif.nom);
    if (!fiche) {
      err(`module actif inconnu du MANIFEST : "${actif.nom}".`);
      continue;
    }
    if (actif.categorie && fiche.categorie && actif.categorie !== fiche.categorie) {
      err(`module "${actif.nom}" : catégorie "${actif.categorie}" dans CONFIG.md, "${fiche.categorie}" dans le MANIFEST.`);
    }
    connus.push(fiche);
  }

  // 1.3.b — exactement un module actif par catégorie obligatoire.
  for (const categorie of CATEGORIES_OBLIGATOIRES) {
    const n = connus.filter((m) => m.categorie === categorie);
    if (n.length === 0) err(`catégorie obligatoire "${categorie}" : aucun module actif.`);
    else if (n.length > 1) err(`catégorie obligatoire "${categorie}" : ${n.length} modules actifs (${n.map((m) => m.nom).join(', ')}), un seul est autorisé.`);
  }

  // 1.3.c — aucune paire de modules actifs mutuellement incompatible.
  const nomsActifs = new Set(connus.map((m) => m.nom));
  const paires = new Set();
  for (const m of connus) {
    for (const autre of m.incompatible) {
      if (!nomsActifs.has(autre)) continue;
      const cle = [m.nom, autre].sort().join(' + ');
      if (paires.has(cle)) continue;
      paires.add(cle);
      err(`modules incompatibles actifs simultanément : ${cle}.`);
    }
  }

  // Dépendances déclarées (colonne « Requiert » du MANIFEST).
  for (const m of connus) {
    for (const requis of m.requiert) {
      if (!nomsActifs.has(requis)) err(`module "${m.nom}" requiert "${requis}", qui n'est pas actif.`);
    }
  }

  // 1.3.d — paramètres requis par les modules actifs présents dans CONFIG.md.
  const attendus = new Set(PARAMETRES_TRANSVERSES);
  for (const m of connus) {
    const texte = moduleTexts.get(m.nom);
    if (texte === undefined) {
      avert(`module "${m.nom}" : fichier introuvable, ses paramètres n'ont pas été vérifiés.`);
      continue;
    }
    for (const p of parseModuleParams(texte)) {
      const cible = p.heriteDe || p.nom;
      attendus.add(cible);
      if ((p.requis || p.heriteDe) && !config.parametres.has(cible)) {
        err(`paramètre "${cible}" requis par le module "${m.nom}" et absent de la table "## Paramètres".`);
      }
    }
  }
  for (const nom of config.parametres.keys()) {
    if (!attendus.has(nom)) {
      avert(`paramètre "${nom}" présent dans CONFIG.md mais réclamé par aucun module actif ni paramètre transverse connu (module désactivé ? faute de frappe ?).`);
    }
  }

  // 1.3.e — paramètres transverses obligatoires et valeurs reconnues.
  const valeurEnum = (nom, valeurs) => {
    if (!config.parametres.has(nom)) {
      err(`paramètre transverse obligatoire "${nom}" absent de la table "## Paramètres".`);
      return;
    }
    const v = config.parametres.get(nom);
    if (!valeurs.includes(v)) err(`paramètre "${nom}" : valeur "${v}" non reconnue (attendu : ${valeurs.join(', ')}).`);
  };
  valeurEnum('permission_mode', PERMISSION_MODES);
  valeurEnum('format_rapport_final', FORMATS_RAPPORT);

  // 1.3.f — table `## Politique de modèle` si présente, et paramètres du harnais entiers positifs.
  if (config.aPolitique) {
    const profilsVus = new Set();
    for (const ligne of config.politique) {
      if (!PROFILS.includes(ligne.profil)) {
        err(`politique de modèle : profil "${ligne.profil || '(vide)'}" inconnu (attendu : ${PROFILS.join(', ')}).`);
      } else {
        profilsVus.add(ligne.profil);
      }
      if (estVide(ligne.modele)) err(`politique de modèle : profil "${ligne.profil}" sans modèle.`);
      if (!EFFORTS.includes(ligne.effort)) {
        err(`politique de modèle : profil "${ligne.profil}" — effort "${ligne.effort || '(vide)'}" non reconnu (attendu : ${EFFORTS.join(', ')}).`);
      }
      // `direct-spawn`, politique de modèle, règle (b) : jamais `haiku` pour une instance.
      if (/haiku/i.test(ligne.modele)) {
        const msg = `politique de modèle : profil "${ligne.profil}" sur "${ligne.modele}" — le module direct-spawn interdit haiku pour une instance (boucle agentique longue).`;
        if (nomsActifs.has('direct-spawn')) err(msg); else avert(msg);
      }
    }
    for (const p of PROFILS) {
      if (!profilsVus.has(p)) avert(`politique de modèle : profil "${p}" non couvert — les défauts du module d'orchestration s'appliqueront.`);
    }
  }
  // 1.3.g — chantier 9, §11.2 : fournisseurs et catalogue de modèles. Les deux tables sont
  // facultatives ; absentes, ce bloc ne produit rien (un CONFIG.md 1.11 reste valide tel quel).
  // Présentes, elles doivent être cohérentes entre elles, et la politique de modèle comme les
  // paramètres de modèle doivent s'exprimer sur des identifiants du catalogue : c'est la seule
  // garantie qu'un identifiant nommé quelque part est traduisible en modèle réel au lancement.
  const fournisseursParNom = new Map((config.fournisseurs || []).map((f) => [f.nom, f]));
  const catalogueParId = new Map((config.catalogue || []).map((m) => [m.id, m]));
  if (config.aFournisseurs && fournisseursParNom.size === 0) err('table "## Fournisseurs" présente mais vide.');
  if (config.aCatalogue && catalogueParId.size === 0) err('table "## Catalogue de modèles" présente mais vide.');
  if (config.aCatalogue && !config.aFournisseurs) {
    err('table "## Catalogue de modèles" présente sans "## Fournisseurs" : la colonne Fournisseur ne référence rien.');
  }
  if (config.aFournisseurs && !config.aCatalogue) {
    avert('table "## Fournisseurs" présente sans "## Catalogue de modèles" : aucun modèle n\'est rattaché à ces fournisseurs.');
  }
  // Les exécuteurs sont lus sur le disque plutôt que listés en dur : ajouter `framework/bin/executeurs/
  // <nom>.js` suffit à le rendre déclarable, sans toucher à ce lint. Répertoire absent (lint hors dépôt) ⇒
  // contrôle silencieusement sauté, jamais une erreur inventée.
  const dirExecuteurs = path.join(entree.racine || process.cwd(), 'framework', 'bin', 'executeurs');
  const executeursConnus = fs.existsSync(dirExecuteurs)
    ? fs.readdirSync(dirExecuteurs).filter((f) => f.endsWith('.js') && f !== 'index.js').map((f) => f.replace(/\.js$/, ''))
    : null;
  const VARIABLE_ENV = /^[A-Z][A-Z0-9_]*$/;
  for (const f of config.fournisseurs || []) {
    if (estVide(f.executeur)) err(`fournisseur "${f.nom}" : colonne Exécuteur vide.`);
    else if (executeursConnus && !executeursConnus.includes(f.executeur)) {
      err(`fournisseur "${f.nom}" : exécuteur "${f.executeur}" introuvable dans framework/bin/executeurs/ (connus : ${executeursConnus.join(', ')}).`);
    }
    if (!estVide(f.secours)) {
      if (f.secours === f.nom) err(`fournisseur "${f.nom}" : déclaré comme son propre secours.`);
      else if (!fournisseursParNom.has(f.secours)) err(`fournisseur "${f.nom}" : secours "${f.secours}" non déclaré dans "## Fournisseurs".`);
    }
    for (const [colonne, valeur] of [['URL (variable)', f.url], ['Jeton (variable)', f.jeton]]) {
      if (!estVide(valeur) && !VARIABLE_ENV.test(valeur)) {
        avert(`fournisseur "${f.nom}" : colonne ${colonne} — "${valeur}" n'est pas un nom de variable d'environnement (la valeur elle-même ne se met jamais dans CONFIG.md).`);
      }
    }
  }
  for (const m of config.catalogue || []) {
    if (estVide(m.reel)) err(`catalogue : modèle "${m.id}" sans modèle réel.`);
    if (estVide(m.fournisseur)) err(`catalogue : modèle "${m.id}" sans fournisseur.`);
    else if (config.aFournisseurs && !fournisseursParNom.has(m.fournisseur)) {
      err(`catalogue : modèle "${m.id}" — fournisseur "${m.fournisseur}" non déclaré dans "## Fournisseurs".`);
    }
    for (const mauvais of effortsDeCellule(m.efforts).invalides) {
      err(`catalogue : modèle "${m.id}" — efforts "${mauvais}" illisibles (attendu un intervalle "low…max" ou une liste parmi : ${EFFORTS.join(', ')}).`);
    }
    // Deux états bien distincts pour la colonne « Coût », et deux diagnostics de gravité différente :
    // vide = état légitime (tarif non public, ou fournisseur qui rapporte lui-même `cout_usd`), mais
    // qui mérite d'être signalé car la session sera journalisée **sans coût** dans `SESSIONS.md` —
    // jamais « 0,00 » — et un bilan de mission s'en trouvera incomplet : c'est un avertissement.
    // Tarif écrit mais illisible = faute de saisie, donc une erreur.
    if (estVide(m.cout)) {
      avert(`catalogue : modèle "${m.id}" sans tarif — le coût d'une session ne pourra pas être estimé quand l'exécuteur ne le rapporte pas (la ligne de SESSIONS.md restera sans coût).`);
    } else if (!/^[\d.,]+\s*\/\s*[\d.,]+(\s*\/\s*[\d.,]+\s*\/\s*[\d.,]+)?$/.test(m.cout)) {
      err(`catalogue : modèle "${m.id}" — coût "${m.cout}" illisible (attendu "<entrée> / <sortie>" ou "<entrée> / <sortie> / <cache écrit> / <cache lu>" en USD par Mtok).`);
    }
    for (const e of m.equivalent) {
      if (!catalogueParId.has(e)) err(`catalogue : modèle "${m.id}" — équivalent "${e}" absent du catalogue.`);
      else if (catalogueParId.get(e).fournisseur === m.fournisseur) {
        avert(`catalogue : modèle "${m.id}" — équivalent "${e}" chez le même fournisseur "${m.fournisseur}" : sans effet pour le repli sur limite (429).`);
      }
    }
    for (const a of m.aptitudes) {
      if (!PROFILS.includes(normaliser(a))) avert(`catalogue : modèle "${m.id}" — aptitude "${a}" hors des profils connus (${PROFILS.join(', ')}).`);
    }
  }
  // Références croisées : tout identifiant de modèle nommé ailleurs dans CONFIG.md doit être au catalogue.
  if (config.aCatalogue && catalogueParId.size > 0) {
    const verifieId = (valeur, quoi) => {
      if (estVide(valeur)) return null;
      const m = catalogueParId.get(valeur);
      if (!m) { err(`${quoi} : modèle "${valeur}" absent de "## Catalogue de modèles".`); return null; }
      return m;
    };
    for (const ligne of config.politique) {
      const m = verifieId(ligne.modele, `politique de modèle : profil "${ligne.profil}"`);
      const permis = m ? effortsDeCellule(m.efforts).permis : [];
      if (m && permis.length && !permis.includes(ligne.effort)) {
        err(`politique de modèle : profil "${ligne.profil}" — effort "${ligne.effort}" hors des efforts déclarés pour "${m.id}" (${permis.join(', ')}).`);
      }
    }
    for (const p of ['sous_agent_modele', 'modele_cli', 'modele_repli']) {
      if (config.parametres.has(p)) verifieId(config.parametres.get(p), `paramètre "${p}"`);
    }
  }

  for (const nom of ENTIERS_POSITIFS) {
    if (!config.parametres.has(nom)) continue; // « Leur absence n'est pas une erreur » (BOOTSTRAP 1.3)
    const v = config.parametres.get(nom);
    if (!/^\d+$/.test(v) || Number(v) <= 0) err(`paramètre "${nom}" : "${v}" n'est pas un entier positif.`);
  }
  // Chantier 7, §9.3 : autocompact_tokens (direct-spawn) doit rester strictement au-dessus du
  // seuil de hibernation volontaire (seuil_contexte_tokens, context-budget), sans quoi le dernier
  // recours (compaction automatique de Claude Code) déclencherait avant l'ordre d'hiberner du hook.
  if (config.parametres.has('autocompact_tokens') && config.parametres.has('seuil_contexte_tokens')) {
    const auto = Number(config.parametres.get('autocompact_tokens'));
    const seuil = Number(config.parametres.get('seuil_contexte_tokens'));
    if (Number.isFinite(auto) && Number.isFinite(seuil) && auto <= seuil) {
      err(`paramètre "autocompact_tokens" (${auto}) doit être strictement supérieur à "seuil_contexte_tokens" (${seuil}).`);
    }
  }

  // 1.1 / 1.2 — contrôles pré-bootstrap, uniquement sur demande explicite.
  if (entree.bootstrapCheck) {
    const racine = entree.racine || process.cwd();
    if (!fs.existsSync(path.join(racine, 'mission/OBJECTIVE.md'))) err('bootstrap : mission/OBJECTIVE.md est absent (BOOTSTRAP.md étape 1.1).');
    for (const marqueur of MARQUEURS_MISSION) {
      if (fs.existsSync(path.join(racine, marqueur))) {
        err(`bootstrap : "${marqueur}" existe déjà — une mission est en cours ou terminée dans ce dépôt (BOOTSTRAP.md étape 1.2).`);
      }
    }
  }

  return { erreurs, avertissements, config };
}

/** Charge les fichiers puis lance le lint. */
function lintDepuisDisque(options) {
  const configPath = options.config;
  const manifestPath = options.manifest;
  const modulesDir = options.modulesDir;
  const manifestText = fs.readFileSync(manifestPath, 'utf8');
  const configText = fs.readFileSync(configPath, 'utf8');
  const moduleTexts = new Map();
  if (modulesDir && fs.existsSync(modulesDir)) {
    for (const categorie of fs.readdirSync(modulesDir)) {
      const dir = path.join(modulesDir, categorie);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const fichier of fs.readdirSync(dir)) {
        if (!fichier.endsWith('.md')) continue;
        moduleTexts.set(fichier.replace(/\.md$/, ''), fs.readFileSync(path.join(dir, fichier), 'utf8'));
      }
    }
  }
  return lintConfig({
    configText, manifestText, moduleTexts,
    racine: options.racine, bootstrapCheck: options.bootstrapCheck,
  });
}

function parseArgs(argv) {
  const o = { config: 'framework/CONFIG.md', manifest: null, modulesDir: null, bootstrapCheck: false, json: false, racine: process.cwd() };
  const positionnels = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') o.manifest = argv[++i];
    else if (a === '--modules-dir') o.modulesDir = argv[++i];
    else if (a === '--racine') o.racine = argv[++i];
    else if (a === '--bootstrap-check') o.bootstrapCheck = true;
    else if (a === '--json') o.json = true;
    else if (a.startsWith('--')) throw new Error(`option inconnue : ${a}`);
    else positionnels.push(a);
  }
  if (positionnels.length > 0) o.config = positionnels[0];
  const base = path.dirname(o.config);
  if (!o.manifest) o.manifest = path.join(base, 'MANIFEST.md');
  if (!o.modulesDir) o.modulesDir = path.join(base, 'modules');
  return o;
}

function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    process.stderr.write(`config-lint : ${e.message}\n`);
    return 1;
  }
  let resultat;
  try {
    resultat = lintDepuisDisque(options);
  } catch (e) {
    process.stderr.write(`config-lint : ${e.message}\n`);
    return 1;
  }
  if (options.json) {
    process.stdout.write(JSON.stringify({ erreurs: resultat.erreurs, avertissements: resultat.avertissements }, null, 2) + '\n');
  } else {
    process.stdout.write(`config-lint · ${options.config} contre ${options.manifest}\n`);
    for (const m of resultat.erreurs) process.stdout.write(`  ERREUR        ${m}\n`);
    for (const m of resultat.avertissements) process.stdout.write(`  AVERTISSEMENT ${m}\n`);
    process.stdout.write(`  → ${resultat.erreurs.length} erreur(s), ${resultat.avertissements.length} avertissement(s)\n`);
  }
  return resultat.erreurs.length > 0 ? 1 : 0;
}

module.exports = { parseManifest, parseConfig, parseModuleParams, lintConfig, lintDepuisDisque, parseArgs, main,
  effortsDeCellule,
  CATEGORIES_OBLIGATOIRES, PERMISSION_MODES, FORMATS_RAPPORT, EFFORTS, PROFILS };

if (require.main === module) process.exit(main(process.argv.slice(2)));
