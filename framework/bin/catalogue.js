'use strict';
/**
 * Catalogue de modèles et fournisseurs (chantier 9, volet 2 — `docs/IMPLEMENTATION.md` §11.2).
 *
 * Deux tables facultatives de `CONFIG.md` :
 *
 *   ## Fournisseurs
 *   | Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
 *
 *   ## Catalogue de modèles
 *   | Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie [/ cache écrit / cache lu] (USD par Mtok) | Aptitudes | Équivalent | Fenêtre (tokens) |
 *
 * **Compatibilité ascendante, règle cardinale** : les deux tables sont facultatives et un
 * identifiant absent du catalogue est passé tel quel à l'exécuteur (`modeleReel`). Un `CONFIG.md`
 * 1.11, sans aucune des deux tables, donne donc un catalogue vide et le lanceur se comporte
 * exactement comme avant — c'est un critère d'acceptation du chantier, pas une commodité.
 *
 * Ce module est **pur** : il ne lit aucun fichier, n'écrit rien, ne connaît ni le lanceur ni les
 * exécuteurs. Il traduit du texte en données et répond à quatre questions : quel modèle réel et quel
 * fournisseur pour cet identifiant, cet effort est-il permis, combien a coûté cette session si
 * l'exécuteur ne l'a pas dit, et vers quoi se replier sur une limite (429).
 */

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

const VIDE = new Set(['', '—', '-', '–', 'n/a']);
const estVide = (v) => VIDE.has(String(v == null ? '' : v).trim().toLowerCase());
const nettoyer = (s) => String(s == null ? '' : s).trim().replace(/^`+|`+$/g, '').trim();
const normaliser = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Cellule « a, b » → ['a','b'] ; cellule vide (`—`) → []. */
function liste(cellule) {
  if (estVide(cellule)) return [];
  return String(cellule).split(/[,;]/).map((x) => nettoyer(x)).filter((x) => !estVide(x));
}

/**
 * Cellule « Efforts » → tableau d'efforts permis, ou `null` quand la cellule est vide (`—`), qui
 * signifie « pas de contrainte connue » et non « aucun effort permis » : un fournisseur dont on
 * ignore les paliers ne doit pas bloquer un lancement.
 * Formes acceptées : `low…max` / `low...max` (intervalle sur l'ordre canonique) ou `low, high` (liste).
 */
function parseEfforts(cellule) {
  if (estVide(cellule)) return null;
  const brut = nettoyer(cellule);
  const intervalle = /^([a-z]+)\s*(?:…|\.\.\.|\.\.|-|–|—)\s*([a-z]+)$/i.exec(brut);
  if (intervalle) {
    const a = EFFORTS.indexOf(normaliser(intervalle[1]));
    const b = EFFORTS.indexOf(normaliser(intervalle[2]));
    if (a >= 0 && b >= a) return EFFORTS.slice(a, b + 1);
    return []; // intervalle illisible ou inversé : aucune valeur permise, config-lint le signalera
  }
  return liste(brut).map(normaliser);
}

/**
 * Cellule de tarif → [entrée, sortie, cache écrit, cache lu] en USD par Mtok ; vide ou illisible →
 * quatre `null` (coût non calculable). Deux formes acceptées :
 *   - « 15 / 75 » — entrée et sortie seules : les deux tarifs de cache sont alors *dérivés* du tarif
 *     d'entrée (voir `TARIF_CACHE_LU` / `TARIF_CACHE_ECRIT`) ;
 *   - « 10 / 50 / 12,50 / 0,25 » — entrée, sortie, écriture de cache, lecture de cache, tous quatre
 *     explicites : aucune dérivation, c'est le tarif publié qui prime.
 * La forme longue existe parce que la dérivation est fausse pour certains modèles : `claude-fable-5-1`
 * facture la lecture de cache à 0,25 (2,5 % de l'entrée), pas au dixième comme le reste du catalogue.
 */
function parseTarif(cellule) {
  const RIEN = [null, null, null, null];
  if (estVide(cellule)) return RIEN;
  const m = /^([\d.,]+)\s*\/\s*([\d.,]+)(?:\s*\/\s*([\d.,]+)\s*\/\s*([\d.,]+))?$/.exec(nettoyer(cellule));
  if (!m) return RIEN;
  const n = (s) => { if (s === undefined) return null; const v = Number(String(s).replace(',', '.')); return Number.isFinite(v) ? v : null; };
  return [n(m[1]), n(m[2]), n(m[3]), n(m[4])];
}

/**
 * Texte de `CONFIG.md` (ou d'un preset) → { fournisseurs, modeles, aFournisseurs, aCatalogue }.
 * `fournisseurs` et `modeles` sont des objets indexés, dans l'ordre de déclaration. Les drapeaux
 * `a…` distinguent « table absente » (compatibilité 1.11) de « table présente mais vide » (erreur
 * que `config-lint` signale).
 */
function parseCatalogue(texte) {
  const cat = { fournisseurs: {}, modeles: {}, aFournisseurs: false, aCatalogue: false };
  if (!texte) return cat;
  let section = '';
  for (const raw of String(texte).split('\n')) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      section = normaliser(line.replace(/^#+\s*/, ''));
      if (section.startsWith('fournisseurs')) cat.aFournisseurs = true;
      else if (section.startsWith('catalogue de modeles')) cat.aCatalogue = true;
      continue;
    }
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length === 0 || cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (section.startsWith('fournisseurs') && cells.length >= 2) {
      const nom = nettoyer(cells[0]);
      if (!nom || normaliser(nom) === 'nom') continue; // ligne d'en-tête
      cat.fournisseurs[nom] = {
        nom,
        executeur: nettoyer(cells[1]),
        url_var: estVide(cells[2]) ? null : nettoyer(cells[2]),
        jeton_var: estVide(cells[3]) ? null : nettoyer(cells[3]),
        secours: estVide(cells[4]) ? null : nettoyer(cells[4]),
      };
    } else if (section.startsWith('catalogue de modeles') && cells.length >= 3) {
      const id = nettoyer(cells[0]);
      if (!id || normaliser(id) === 'identifiant') continue;
      const [coutEntree, coutSortie, coutCacheEcrit, coutCacheLu] = parseTarif(cells[4]);
      cat.modeles[id] = {
        id,
        fournisseur: nettoyer(cells[1]),
        modele_reel: nettoyer(cells[2]),
        efforts: parseEfforts(cells[3]),
        cout_entree: coutEntree,
        cout_sortie: coutSortie,
        cout_cache_ecrit: coutCacheEcrit,
        cout_cache_lu: coutCacheLu,
        aptitudes: liste(cells[5]).map(normaliser),
        equivalent: liste(cells[6]),
        // 1.18.0, facultative : fenêtre de contexte que le CLI prête à ce modèle (il compacte de lui-même vers
        // 83 % de celle-ci, quels que soient --autocompact et le seuil HOLARCH) ; null = inconnue, aucun plafond.
        fenetre: parseFenetre(cells[7]),
      };
    }
  }
  return cat;
}

/** Entrée de catalogue d'un identifiant, ou null s'il n'y figure pas. */
function modele(cat, id) {
  if (!cat || !id) return null;
  return cat.modeles[nettoyer(id)] || null;
}

/** Fiche d'un fournisseur par son nom, ou null. */
function fournisseur(cat, nom) {
  if (!cat || !nom) return null;
  return cat.fournisseurs[nettoyer(nom)] || null;
}

/** Colonne « Fenêtre (tokens) » : entier positif (espaces, espaces fines et « _ » tolérés), sinon null. */
function parseFenetre(cellule) {
  if (cellule === undefined || estVide(cellule)) return null;
  const n = Number(String(cellule).replace(/[\s\u202f\u00a0_]/g, ''));
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Fournisseur d'un identifiant de modèle, ou null (identifiant hors catalogue, ou fournisseur non déclaré). */
function fournisseurDe(cat, id) {
  const m = modele(cat, id);
  return m ? fournisseur(cat, m.fournisseur) : null;
}

/**
 * Nom de modèle à passer à l'exécuteur. Un identifiant hors catalogue est rendu **tel quel** :
 * c'est ce qui fait qu'un `CONFIG.md` sans catalogue (ou nommant directement `claude-opus-5`)
 * continue de fonctionner sans modification.
 */
function modeleReel(cat, id) {
  const m = modele(cat, id);
  return m && m.modele_reel ? m.modele_reel : nettoyer(id);
}

/** true si l'effort est permis pour cette entrée (ou si le catalogue ne se prononce pas). */
function effortPermis(entree, effort) {
  if (!entree || entree.efforts === null || entree.efforts === undefined) return true;
  return entree.efforts.includes(normaliser(effort));
}

// Tarification du cache **par défaut**, relative au tarif d'entrée (hypothèses assumées,
// `holarch.md` §16) : une lecture de cache est facturée au dixième du tarif d'entrée (§11.2), une
// écriture de cache à 125 % (tarification Anthropic au 2026-09). Ces deux nombres ne servent que
// lorsque la cellule de coût ne donne que « entrée / sortie » : un catalogue qui écrit les quatre
// tarifs (forme longue de `parseTarif`) n'en dépend pas. Le coût calculé reste une estimation.
const TARIF_CACHE_LU = 0.1;
const TARIF_CACHE_ECRIT = 1.25;

/**
 * Coût estimé d'une session, en USD, à partir des tokens du `Resultat` normalisé et des tarifs du
 * catalogue (USD par million de tokens). Retourne `null` — jamais 0 — si l'entrée n'a pas de tarif
 * ou si aucun décompte de tokens n'est disponible : un « 0,0000 » inventé serait pire qu'un « ? ».
 */
function coutEstime(entree, tokens) {
  if (!entree || entree.cout_entree === null || entree.cout_sortie === null) return null;
  const t = tokens || {};
  const champs = ['entree', 'cache_lu', 'cache_ecrit', 'sortie'];
  if (!champs.some((c) => typeof t[c] === 'number' && Number.isFinite(t[c]))) return null;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const tarif = (explicite, facteur) =>
    (typeof explicite === 'number' && Number.isFinite(explicite) ? explicite : entree.cout_entree * facteur);
  const usd = n(t.entree) * entree.cout_entree
    + n(t.cache_lu) * tarif(entree.cout_cache_lu, TARIF_CACHE_LU)
    + n(t.cache_ecrit) * tarif(entree.cout_cache_ecrit, TARIF_CACHE_ECRIT)
    + n(t.sortie) * entree.cout_sortie;
  return usd / 1e6;
}

/** Nom du fournisseur de secours déclaré pour `nom`, ou null. */
function secoursDe(cat, nom) {
  const f = fournisseur(cat, nom);
  return f && f.secours ? f.secours : null;
}

/**
 * Identifiant équivalent de `id` chez le fournisseur `nomFournisseur`, ou null. L'équivalence est
 * déclarée par la colonne `Équivalent` (une ou plusieurs valeurs) et **vérifiée** : un équivalent
 * absent du catalogue, ou rattaché à un autre fournisseur, n'est pas retenu — le repli (volet 3)
 * doit échouer franchement plutôt que lancer une session sur un modèle inexistant.
 * L'équivalence est aussi lue à l'envers (`opus` équivalent déclaré sur `opus@openrouter`), ce qui
 * évite d'avoir à déclarer deux fois la même relation pour revenir au fournisseur principal.
 */
function equivalentChez(cat, id, nomFournisseur) {
  if (!cat || !id || !nomFournisseur) return null;
  const m = modele(cat, id);
  if (!m) return null;
  for (const candidat of m.equivalent) {
    const e = modele(cat, candidat);
    if (e && e.fournisseur === nettoyer(nomFournisseur)) return e.id;
  }
  for (const e of Object.values(cat.modeles)) {
    if (e.fournisseur === nettoyer(nomFournisseur) && e.equivalent.includes(m.id)) return e.id;
  }
  return null;
}

/**
 * Écarts de cohérence interne du catalogue (références croisées), tableau vide ⇒ cohérent.
 * `config-lint` fait le même contrôle sur le texte, avec ses propres messages ; celui-ci sert au
 * lanceur (avertissement au lancement) et aux tests. Volontairement silencieux sur ce qu'il ne peut
 * pas savoir : l'existence réelle d'un exécuteur est vérifiée par `executeurs.resoudre`.
 */
function verifierCatalogue(cat) {
  const ecarts = [];
  if (!cat) return ['catalogue absent'];
  for (const f of Object.values(cat.fournisseurs)) {
    if (!f.executeur) ecarts.push(`fournisseur « ${f.nom} » sans exécuteur`);
    if (f.secours && !cat.fournisseurs[f.secours]) ecarts.push(`fournisseur « ${f.nom} » : secours « ${f.secours} » non déclaré`);
    if (f.secours === f.nom) ecarts.push(`fournisseur « ${f.nom} » : secours de lui-même`);
  }
  for (const m of Object.values(cat.modeles)) {
    if (!m.modele_reel) ecarts.push(`modèle « ${m.id} » sans modèle réel`);
    if (!m.fournisseur) ecarts.push(`modèle « ${m.id} » sans fournisseur`);
    else if (!cat.fournisseurs[m.fournisseur]) ecarts.push(`modèle « ${m.id} » : fournisseur « ${m.fournisseur} » non déclaré`);
    if (Array.isArray(m.efforts) && m.efforts.length === 0) ecarts.push(`modèle « ${m.id} » : colonne Efforts illisible`);
    else if (Array.isArray(m.efforts)) {
      for (const e of m.efforts) if (!EFFORTS.includes(e)) ecarts.push(`modèle « ${m.id} » : effort « ${e} » inconnu (valeurs : ${EFFORTS.join(', ')})`);
    }
    for (const eq of m.equivalent) if (!cat.modeles[eq]) ecarts.push(`modèle « ${m.id} » : équivalent « ${eq} » absent du catalogue`);
  }
  return ecarts;
}

module.exports = {
  parseCatalogue, modele, fournisseur, fournisseurDe, modeleReel, effortPermis,
  coutEstime, secoursDe, equivalentChez, verifierCatalogue,
  EFFORTS, TARIF_CACHE_LU, TARIF_CACHE_ECRIT,
  // exportés pour les tests et `config-lint`
  parseEfforts, parseTarif, parseFenetre,
};
