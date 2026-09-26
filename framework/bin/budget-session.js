'use strict';
/**
 * Budget USD par fiche (chantier 16, `docs/IMPLEMENTATION.md` §18.2). Une ligne optionnelle
 * `| Budget USD / session | 12 |` de la fiche registre (gabarit de `sharded-files`, à ne pas confondre
 * avec « Budget alloué / consommé », qui compte des instances), posée par le parent à `ON_SPAWN` comme
 * `Modèle` et `Effort` (règle d'une ligne dans `direct-spawn` : exécution lourde 12 à 15, racine au
 * défaut). Précédence : `--budget-usd` (CLI) > fiche > `budget_usd_par_session` (CONFIG).
 *
 * Plafond `budget_usd_session_max` (`CONFIG.md`, défaut 20 dans ce module comme dans les défauts du
 * lanceur) : une ligne de fiche illisible ou au-delà du plafond est un refus — même lecture de fiche
 * que `veille.js` pour la ligne `Veille` (`refusVeille`), donc indépendante de toute autre source :
 * une ligne de fiche cassée reste un refus qu'une session s'apprête ou non à l'utiliser réellement.
 * Une valeur `--budget-usd` (CLI) au-delà du plafond n'est PAS refusée : geste explicite du
 * mainteneur, jamais posé automatiquement par un parent — seule la fiche est surveillée.
 *
 * Module autonome, sans dépendance à holarch-spawn.js : testable depuis ce paquet promouvable
 * (`require('../bin/budget-session.js')`, chemin qui marche identiquement une fois promu sous
 * `framework/bin/`). Utilisé aussi par `spawn-guard` (`holarch-hooks.js`).
 */

const PLAFOND_DEFAUT = 20;
// Seconde revue n° 60 : défaut documenté de budget_usd_par_session (direct-spawn, DEFAULTS du lanceur), si absent ou vide.
const BUDGET_DEFAUT = 8;

/** Seule lecture numérique des montants du chantier 16 (fiche, CONFIG.md, `--budget-usd`, environnement de
 *  budget-watch — MSG-utilisateur-004, points A et 12) : absent, chaîne vide ou blanche → `undefined`, jamais 0 ;
 *  virgule décimale acceptée (« 16,5 ») ; tout autre texte → `undefined`, que l'appelant refuse explicitement. */
function lireNombre(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!/^[+-]?(\d+([.,]\d*)?|[.,]\d+)$/.test(s)) return undefined;
  return Number(s.replace(',', '.'));
}

/** Ligne `Budget USD / session` d'une fiche registre : `null` si absente, sinon `{ brut, usd }`
 *  (`usd` = nombre positif fini, ou `NaN` si illisible). */
function lireBudgetFiche(ficheTexte) {
  const m = String(ficheTexte || '').match(/^\|\s*Budget USD \/ session\s*\|\s*(.*?)\s*\|\s*$/mi);
  if (!m) return null;
  const brut = m[1].replace(/`/g, '').trim();
  // Revue n° 45 : ligne optionnelle laissée vide, à « — » ou au texte d'exemple du gabarit (`<…>`) = absente.
  if (/^(|[-—–]+|<.*>)$/.test(brut)) return null;
  const n = lireNombre(brut);
  const usd = n === undefined ? NaN : n;
  return { brut, usd };
}

/** Plafond effectif : `params.budget_usd_session_max` s'il est un nombre positif fini, sinon
 *  `PLAFOND_DEFAUT` — ce module ne dépend pas des défauts du lanceur (`DEFAULTS`), qui ne s'appliquent
 *  qu'à `resolveParams` ; `spawn-guard` lit `CONFIG.md` paramètre par paramètre, sans cette fusion. */
function plafondEffectif(params) {
  const p = lireNombre(params && params.budget_usd_session_max);
  const declare = p !== undefined && p > 0 ? p : PLAFOND_DEFAUT;
  // Point 11 : jamais sous le budget de session lui-même (un budget relevé à 25 ne rend pas toute fiche « au-delà »).
  const base = lireNombre(params && params.budget_usd_par_session);
  return base !== undefined && base > declare ? base : declare;
}

/** Troisième revue n° 76 : défaut de `budget_usd_par_session` quand CONFIG.md n'a pas la ligne —
 *  min(BUDGET_DEFAUT, budget_usd_session_max déclaré), pour tous les lecteurs (lanceur et dry-run par resolveParams,
 *  réveil par plafondEffectif(resolveParams), spawn-guard qui ne lit que les lignes présentes, lint). */
function budgetParDefaut(params) {
  const p = lireNombre(params && params.budget_usd_session_max);
  return Math.min(BUDGET_DEFAUT, p !== undefined && p > 0 ? p : PLAFOND_DEFAUT);
}

/** Seconde revue n° 61 : `budget_usd_session_max` présent mais illisible ou non positif → motif de refus (lanceur,
 *  spawn-guard), jamais le plafond 20 en silence ; absent ou vide → `null`. */
function refusPlafond(params) {
  const brut = params && params.budget_usd_session_max;
  if (brut === null || brut === undefined || String(brut).trim() === '') return null;
  const p = lireNombre(brut);
  return p !== undefined && p > 0 ? null : `budget_usd_session_max illisible (« ${brut} ») dans CONFIG.md : un nombre positif attendu (§18.2)`;
}

/** Motif de refus (chaîne) ou `null` : ligne `Budget USD / session` illisible/nulle, ou au-delà du
 *  plafond. Ne dépend jamais d'une valeur `--budget-usd` (CLI) — voir l'en-tête du fichier. */
function refusBudgetFiche(budgetFiche, plafond) {
  if (!budgetFiche) return null;
  if (!(budgetFiche.usd > 0)) return `ligne « Budget USD / session » illisible (« ${budgetFiche.brut} ») : un nombre positif attendu (direct-spawn, §18.2)`;
  if (budgetFiche.usd > plafond) return `ligne « Budget USD / session » à ${budgetFiche.usd} USD > plafond budget_usd_session_max (${plafond} USD, §18.2)`;
  return null;
}

/** Résolution complète pour le lanceur : `{ usd, source: 'CLI'|'fiche'|'CONFIG', refus }`.
 *  `budgetCli` : valeur `--budget-usd` déjà lue par le lanceur (`opts.budget`), brute (chaîne ou
 *  nombre) — `null`/`undefined`/`''` si absente. `refus` porte sur la ligne de fiche (voir
 *  `refusBudgetFiche`) ou sur un `budget_usd_par_session` illisible (revue n° 35) ; quand il est non nul, l'appelant refuse le lancement (dry-run : avertit sur
 *  stderr ; réel : throw), quelle que soit la source finalement choisie pour `usd`. */
function resoudreBudget(ficheTexte, budgetCli, params) {
  const p = params || {};
  const plafond = plafondEffectif(p);
  const budgetFiche = lireBudgetFiche(ficheTexte);
  const refus = refusPlafond(p) || refusBudgetFiche(budgetFiche, plafond);
  const cliNum = lireNombre(budgetCli);
  const cliPresent = budgetCli !== null && budgetCli !== undefined && String(budgetCli).trim() !== '';
  // `--budget-usd` illisible : refus explicite, plus jamais ignoré en silence (point 12).
  if (cliPresent && !(cliNum > 0)) return { usd: null, source: 'CLI', refus: `--budget-usd illisible (« ${budgetCli} ») : un nombre positif attendu (§18.2)` };
  if (cliPresent) return { usd: cliNum, source: 'CLI', refus };
  if (budgetFiche && !refus) return { usd: budgetFiche.usd, source: 'fiche', refus: null };
  // Revue n° 35 : `budget_usd_par_session` présent mais illisible (« 8 USD ») est un refus, jamais 20 en silence ;
  // absent, le défaut ne dépasse jamais le plafond déclaré.
  const brutConfig = p.budget_usd_par_session;
  const configPresent = brutConfig !== null && brutConfig !== undefined && String(brutConfig).trim() !== '';
  const defaut = lireNombre(brutConfig);
  if (configPresent && !(defaut > 0)) {
    return { usd: Math.min(BUDGET_DEFAUT, plafond), source: 'CONFIG', refus: refus || `budget_usd_par_session illisible (« ${brutConfig} ») dans CONFIG.md : un nombre positif attendu (§18.2)` };
  }
  return { usd: configPresent ? defaut : Math.min(BUDGET_DEFAUT, plafond), source: 'CONFIG', refus };
}

/** Entrée de catalogue (`cout_*`, USD/Mtok) → tarif lu par budget-watch.js, ou null sans entrée ni sortie. */
function tarifDe(entree) {
  if (!entree || typeof entree.cout_entree !== 'number' || typeof entree.cout_sortie !== 'number') return null;
  const e = entree.cout_entree;
  return {
    entree: e,
    sortie: entree.cout_sortie,
    cache_lu: typeof entree.cout_cache_lu === 'number' ? entree.cout_cache_lu : e * 0.1,
    cache_ecrit: typeof entree.cout_cache_ecrit === 'number' ? entree.cout_cache_ecrit : e * 1.25,
  };
}

/** Valeur de `HOLARCH_TARIF` (JSON) ou `undefined` : le modèle de la session (aussi `defaut`) et, revue n° 5,
 *  chaque modèle tarifé du catalogue sous son identifiant et son `modele_reel` — un sous-agent Sonnet se chiffre
 *  au tarif de Sonnet (`message.model` de sa transcription), jamais à celui du modèle de la session. */
function tarifsBudget(cat, meta) {
  const session = tarifDe(meta && meta.tarif);
  if (!session) return undefined;
  const table = {};
  for (const [id, entree] of Object.entries((cat && cat.modeles) || {})) {
    const t = tarifDe(entree);
    if (!t) continue;
    table[id] = t;
    if (entree.modele_reel) table[entree.modele_reel] = t;
  }
  table[meta.modele] = session;
  table[meta.modele_reel || meta.modele] = session;
  table.defaut = session;
  return JSON.stringify(table);
}

module.exports = {
  lireNombre, lireBudgetFiche, refusBudgetFiche, plafondEffectif, budgetParDefaut, refusPlafond, resoudreBudget, tarifsBudget, PLAFOND_DEFAUT, BUDGET_DEFAUT,
};
