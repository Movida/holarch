'use strict';
/**
 * budget-watch.js — fusible de budget de session (docs/IMPLEMENTATION.md §18.1, chantier 16).
 *
 * Module autonome, sans dépendance à holarch-hooks.js : testable depuis ce paquet promouvable
 * (`require('../hooks/budget-watch.js')`, chemin qui marche identiquement une fois promu sous
 * `framework/hooks/`). Un fragment de holarch-hooks.js l'appelle dans la même invocation PostToolUse
 * que contextWatch (une seule lecture de la fin de transcription par appel d'outil, fonction et tests
 * distincts).
 *
 * Fonctions pures exportées : `lireRappel`, `estimerCout`, `decider`. Orchestration : `budgetWatch`.
 */
const fs = require('fs');
const path = require('path');

const PALIER_PCT = 5; // un ordre au plus par tranche de 5 % du plafond
const SEUIL_BUDGET_PCT_DEFAUT = 80;
const RESERVE_USD_DEFAUT = 1.2;

const NOTE_SOUS_AGENT = '[HOLARCH · budget de session] La session principale a franchi sa réserve de budget : '
  + 'rends ton rapport maintenant, en l’état, sans nouvelle écriture.';

// Reprend la check-list ON_SLEEP de contextWatch (framework/hooks/holarch-hooks.js), adaptée au motif
// budget plutôt que contexte.
const CHECKLIST_ON_SLEEP_BUDGET = 'Liste de contrôle ON_SLEEP : '
  + '☐ MEMORY.md réécrit en entier (État courant / Décisions prises / Prochaines actions / Points de vigilance) '
  + '☐ fiche memoire/U<n>-….md de l\'unité en cours si elle s\'achève ici '
  + '☐ STATUS.md à l\'état réel, Note « hibernation volontaire (budget) » '
  + '☐ entrée JOURNAL.md '
  + '☐ fiche registre à jour (Statut, budget consommé, Profil/Effort, livrables) '
  + '☐ commit Git [<ton chemin>] ….';

// Lecture numérique unique du chantier 16 (vide = absent, jamais 0 ; virgule décimale acceptée) : MSG-utilisateur-004,
// points A et 12. Même chemin relatif dans ce paquet et une fois promu sous framework/.
const { lireNombre } = require(path.join(__dirname, '..', 'bin', 'budget-session.js'));

/** Dernier rappel `USD budget: $<dépensé>/$<plafond>; $<reste> remaining` de `texte`, ou `null`. Le
 *  plafond peut être remis à l'échelle par une passerelle (`budgetCli`) : seul le ratio reste juste. */
function lireRappel(texte) {
  const tous = lireRappels(texte);
  return tous.length ? tous[tous.length - 1] : null;
}

/** Rappels structurés de la transcription : lignes `{"type":"attachment","attachment":{"type":"budget_usd",
 *  "used","total","remaining"}}` écrites par le CLI lui-même (forme mesurée le 2026-09-26, revue n° 3). Un texte
 *  « USD budget: … » cité dans un message (TASK, sortie de `cat`) n'est jamais un attachement de premier niveau. */
function rappelsStructures(texte) {
  const out = [];
  for (const ligne of texte.split('\n')) {
    if (!ligne.includes('"budget_usd"')) continue;
    let o;
    try { o = JSON.parse(ligne); } catch (_) { continue; } // première ligne tronquée par lireDernierMo
    const a = o && o.type === 'attachment' ? o.attachment : null;
    if (!a || a.type !== 'budget_usd') continue;
    const depense = Number(a.used);
    const plafond = Number(a.total);
    if (!Number.isFinite(depense) || !Number.isFinite(plafond) || plafond <= 0) continue;
    out.push({ depense, plafond, ratio: depense / plafond, structure: true });
  }
  return out;
}

/** Tous les rappels cohérents de `texte`, dans l'ordre : les attachements `budget_usd` s'il y en a (seuls sûrs),
 *  sinon les textes « USD budget » (dépensé + reste = plafond, à 2 centimes près — CLI sans attachement, fixtures). */
function lireRappels(texte) {
  if (!texte) return [];
  const structures = rappelsStructures(texte);
  if (structures.length) return structures;
  // Troisième revue n° 3, 80 : un rappel du CLI est seul sur sa ligne (début de texte, saut de ligne réel ou échappé
  // `\n` d'une chaîne JSONL, ou balise `>`) ; une citation est prise dans une phrase (« TASK : … », `fichier: « … »`
  // d'un grep, guillemets) — elle ne donne plus d'ordre ni ne masque les vrais. Borne : §18.10 n° 15.
  const re = /(?:^|\n|\\n|>)[ \t]*USD budget:\s*\$([0-9.]+)\/\$([0-9.]+);\s*\$([0-9.]+)[ \t]*remaining[ \t]*(?=$|\n|\\n|<|")/g;
  const out = [];
  let m;
  while ((m = re.exec(texte)) !== null) {
    const depense = Number(m[1]);
    const plafond = Number(m[2]);
    const reste = Number(m[3]);
    if (!Number.isFinite(depense) || !Number.isFinite(plafond) || plafond <= 0 || !Number.isFinite(reste)) continue;
    if (Math.abs(plafond - depense - reste) > 0.02) continue;
    out.push({ depense, plafond, ratio: depense / plafond });
  }
  return out;
}

/** Rappel retenu (MSG-utilisateur-004, point 9) : un texte « USD budget: … » affiché par l'instance (fixture, `cat`)
 *  ne doit ni masquer les vrais ni sauter des paliers. Seuls comptent les rappels au plafond de la session — celui
 *  déjà retenu pour cette session, sinon `budgetUsd` s'il apparaît, sinon celui du dernier rappel (passerelle qui
 *  remet le plafond à l'échelle) — et à dépense non décroissante depuis le dernier rappel retenu. */
function choisirRappel(texte, { plafondCli, depenseCli, budgetUsd, rappelStructure }) {
  const tous = lireRappels(texte);
  if (!tous.length) return null;
  const egal = (a, b) => Math.abs(a - b) < 1e-6;
  // Revue n° 3 : un plafond retenu sur un texte cité ne tient plus dès qu'un attachement structuré paraît.
  // Seconde revue n° 3 : sans attachement (repli texte seul), rien n'est épinglé — le plafond se relit à chaque appel :
  // `budgetUsd` s'il apparaît, sinon le plus fréquent (à égalité, la série dont le dernier rappel a dépensé le plus : la vraie
  // dépense croît, une citation reste figée). Une citation cède
  // dès que les vrais rappels (un par appel d'outil) sont plus nombreux ou portent `budgetUsd`.
  const epingle = Number.isFinite(plafondCli) && tous[0].structure === true && rappelStructure === true;
  let plafond;
  if (epingle) plafond = plafondCli;
  else if (budgetUsd != null && tous.some((r) => egal(r.plafond, budgetUsd))) plafond = budgetUsd;
  else if (tous[0].structure) plafond = tous[tous.length - 1].plafond;
  else {
    const vus = new Map();
    for (const r of tous) vus.set(r.plafond, { n: ((vus.get(r.plafond) || {}).n || 0) + 1, depense: r.depense });
    let meilleur = null;
    for (const [p, v] of vus) if (!meilleur || v.n > meilleur.n || (v.n === meilleur.n && v.depense >= meilleur.depense)) meilleur = Object.assign({ p }, v);
    plafond = meilleur.p;
  }
  const memeSerie = Number.isFinite(plafondCli) && egal(plafond, plafondCli) && (tous[0].structure === true) === (rappelStructure === true);
  const plancher = memeSerie && Number.isFinite(depenseCli) ? depenseCli : -Infinity;
  const retenus = tous.filter((r) => egal(r.plafond, plafond) && r.depense >= plancher - 1e-9);
  return retenus.length ? retenus[retenus.length - 1] : null;
}

/** Coût estimé, en USD, à partir de lignes JSONL brutes (transcription) et d'une table de tarifs
 *  `{"<id modèle>": {entree, sortie, cache_lu, cache_ecrit}, "defaut": {...}}` (USD par million de
 *  tokens). Somme les `usage` des messages assistant, dédoublonnés par `message.id` (une transcription
 *  peut répéter le même message assistant sur plusieurs lignes). Retourne un nombre, ou `null` si aucun
 *  tarif n'a pu s'appliquer (pas de message assistant tarifable) — jamais un 0 inventé. */
function estimerCout(lignesJsonl, tarifs) {
  if (!tarifs || typeof tarifs !== 'object') return null;
  const r = sommerLignes(lignesJsonl, tarifs, new Set());
  return r.tarife ? r.usd : null;
}

/** Somme des lignes (dédoublonnées par `message.id` via `vus`, partagé entre appels) : `{usd, tarife}`. */
function sommerLignes(lignesJsonl, tarifs, vus) {
  let usd = 0;
  let tarife = false;
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const ligne of lignesJsonl || []) {
    if (!ligne) continue;
    let obj;
    try { obj = typeof ligne === 'string' ? JSON.parse(ligne) : ligne; } catch (_) { continue; }
    if (!obj || obj.type !== 'assistant' || !obj.message || !obj.message.usage) continue;
    const id = obj.message.id;
    if (id) {
      if (vus.has(id)) continue;
      vus.add(id);
    }
    const modele = obj.message.model;
    const tarif = (modele && tarifs[modele]) || tarifs.defaut;
    if (!tarif) continue;
    tarife = true;
    const u = obj.message.usage;
    usd += (n(u.input_tokens) * n(tarif.entree)
      + n(u.output_tokens) * n(tarif.sortie)
      + n(u.cache_read_input_tokens) * n(tarif.cache_lu)
      + n(u.cache_creation_input_tokens) * n(tarif.cache_ecrit)) / 1e6;
  }
  return { usd, tarife };
}

/** Coût estimé de TOUTE la transcription (MSG-utilisateur-004, point 2), relu incrémentalement : `suivi`
 *  (`{offset, usd, tarife, dernier_id}`, persisté dans l'état de session) dit jusqu'où la transcription a déjà
 *  été sommée ; seules les lignes complètes ajoutées depuis sont lues. Transcription raccourcie → reprise à 0.
 *  Retourne le nouveau suivi, ou `null` si le fichier est illisible. */
function coutIncremental(cheminFichier, suivi, tarifs) {
  const vide = { offset: 0, usd: 0, tarife: false, dernier_id: null };
  let s = suivi && typeof suivi.offset === 'number' && typeof suivi.usd === 'number' ? suivi : vide;
  let fd = null;
  try {
    const taille = fs.statSync(cheminFichier).size;
    if (taille < s.offset) s = vide;
    if (taille === s.offset) return s;
    const buf = Buffer.alloc(taille - s.offset);
    fd = fs.openSync(cheminFichier, 'r');
    fs.readSync(fd, buf, 0, buf.length, s.offset);
    const fin = buf.lastIndexOf(0x0a);
    if (fin < 0) return s; // aucune ligne complète nouvelle
    const lignes = buf.subarray(0, fin + 1).toString('utf8').split('\n');
    const vus = new Set(s.dernier_id ? [s.dernier_id] : []);
    const r = sommerLignes(lignes, tarifs, vus);
    let dernierId = s.dernier_id;
    for (let i = lignes.length - 1; i >= 0; i -= 1) {
      let obj = null;
      try { obj = lignes[i] ? JSON.parse(lignes[i]) : null; } catch (_) { obj = null; }
      if (obj && obj.type === 'assistant' && obj.message && obj.message.id) { dernierId = obj.message.id; break; }
    }
    return { offset: s.offset + fin + 1, usd: s.usd + r.usd, tarife: s.tarife || r.tarife, dernier_id: dernierId };
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

/** Décide de l'ordre d'hiberner pour le budget. `ordreA` est le palier (tranche de `PALIER_PCT` %)
 *  du dernier ordre déjà donné pour cette session — `undefined`/`null` si aucun encore. Retourne
 *  `{action: 'rien'|'ordre', palier, renforce}` ; `renforce` (ton renforcé) est vrai sous la moitié
 *  de la réserve, que l'action soit 'ordre' ou une répétition dans le même palier. */
function decider({ ratio, budgetUsd, reserveUsd, seuilPct, ordreA }) {
  const seuil = Number.isFinite(seuilPct) ? seuilPct : SEUIL_BUDGET_PCT_DEFAUT;
  const budget = Number.isFinite(budgetUsd) ? budgetUsd : 0;
  const reserve = Math.max(
    Number.isFinite(reserveUsd) ? reserveUsd : RESERVE_USD_DEFAUT,
    ((100 - seuil) / 100) * budget,
  );
  const reste = (1 - ratio) * budget;
  const palier = Math.floor((ratio * 100) / PALIER_PCT);
  if (reste > reserve) return { action: 'rien', palier, renforce: false };
  const renforce = reste <= reserve / 2;
  if (Number.isFinite(ordreA) && ordreA >= palier) return { action: 'rien', palier, renforce };
  return { action: 'ordre', palier, renforce };
}

function budgetLivePath(root, instance) {
  return path.join(root, 'mission', '.holarch', 'live', `${instance.replace(/\//g, '-')}.budget.json`);
}

function lireDernierMo(cheminFichier) {
  let fd = null;
  try {
    const taille = fs.statSync(cheminFichier).size;
    const span = Math.min(taille, 1024 * 1024);
    const buf = Buffer.alloc(span);
    fd = fs.openSync(cheminFichier, 'r');
    fs.readSync(fd, buf, 0, span, taille - span);
    return buf.toString('utf8');
  } catch (_) {
    return null;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}

function lireTarifs(env) {
  const brut = env && env.HOLARCH_TARIF;
  if (!brut) return null;
  try {
    const t = JSON.parse(brut);
    return t && typeof t === 'object' ? t : null;
  } catch (_) {
    return null;
  }
}

function chargerEtat(fichier, sessionId) {
  let data = null;
  try { data = JSON.parse(fs.readFileSync(fichier, 'utf8')); } catch (_) { data = null; }
  if (!data || data.session_id !== sessionId) return { ordre_a: null, consigne_sous_agents: [], cumul: {} };
  // État complet conservé (plafond, dépense, ratio, source lus par observe) : on fusionne, jamais on n'écrase.
  return Object.assign({}, data, {
    ordre_a: typeof data.ordre_a === 'number' ? data.ordre_a : null,
    consigne_sous_agents: Array.isArray(data.consigne_sous_agents) ? data.consigne_sous_agents : [],
    cumul: data.cumul && typeof data.cumul === 'object' ? data.cumul : {},
  });
}

function ecrireEtat(fichier, data) {
  try {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(data));
  } catch (_) { /* fail-open : le fusible ne doit jamais faire échouer l'appel d'outil */ }
}

function noteOrdre({ renforce, ratio, budgetUsd, source }) {
  const pct = Math.round(ratio * 100);
  const enTete = renforce
    ? '[HOLARCH · budget de session — sous la moitié de la réserve]'
    : '[HOLARCH · budget de session]';
  const estime = source === 'estime' ? ' (estimé, aucun rappel CLI dans la transcription)' : '';
  const plafondTxt = Number.isFinite(budgetUsd) ? ` sur un plafond de ${budgetUsd.toFixed(2)} $` : '';
  return `${enTete} ~${pct} % du budget dépensé${estime}${plafondTxt} : sous la réserve. `
    + `${renforce ? 'Ne commence aucune nouvelle unité de travail. ' : "Termine l'unité de travail en cours sans en commencer une autre. "}`
    + 'Hiberne volontairement (phase ON_SLEEP du KERNEL, §2 et §5.8) : MEMORY.md complet pour ton futur toi, '
    + 'entrée JOURNAL.md, STATUS.md laissé à ton état réel avec la Note « hibernation volontaire (budget) », '
    + 'fiche registre à jour, commit, puis termine la session. Le lanceur holarch-spawn te ré-incarnera '
    + `automatiquement avec un budget neuf. ${CHECKLIST_ON_SLEEP_BUDGET}`;
}

/**
 * Étape budgetWatch (PostToolUse). `input` = charge utile du hook (`transcript_path`, `session_id`) ;
 * `env` = environnement du process (paramètres posés par le lanceur, cf. docs/IMPLEMENTATION.md §18.1).
 * Retourne `{note, etat}` : `note` est le texte additionalContext à injecter (ou `null`, étape inerte
 * ou rien à dire) ; `etat` est le contenu écrit dans `mission/.holarch/live/<instance>.budget.json`
 * (ou `null` si rien n'a été écrit).
 */
function budgetWatch({ input, root, instance, env }) {
  const environnement = env || process.env;
  const transcriptPath = input && input.transcript_path;
  const sessionId = input && input.session_id;
  if (!transcriptPath || !sessionId) return { note: null, etat: null };

  // Hors bornes = absent : un budget nul ou négatif, un seuil hors ]0, 100[ ou une réserve négative retombent sur
  // les défauts plutôt que de faire hiberner à chaque appel d'outil.
  const budgetUsdEnv = lireNombre(environnement.HOLARCH_BUDGET_USD);
  const budgetUsdPose = budgetUsdEnv !== undefined && budgetUsdEnv > 0 ? budgetUsdEnv : null;
  const tarifs = lireTarifs(environnement);
  const seuilPctEnv = lireNombre(environnement.HOLARCH_SEUIL_BUDGET_PCT);
  const seuilPct = seuilPctEnv !== undefined && seuilPctEnv > 0 && seuilPctEnv < 100 ? seuilPctEnv : undefined;
  const reserveUsdEnv = lireNombre(environnement.HOLARCH_RESERVE_USD);
  const reserveUsd = reserveUsdEnv !== undefined && reserveUsdEnv >= 0 ? reserveUsdEnv : undefined;

  const fichierEtat = budgetLivePath(root, instance);
  const estSousAgent = transcriptPath.includes('/subagents/');
  const etatAvant = chargerEtat(fichierEtat, sessionId);
  const cumul = Object.assign({}, etatAvant.cumul);
  const critereRappel = {
    plafondCli: etatAvant.plafond_cli, depenseCli: etatAvant.depense_cli, budgetUsd: budgetUsdPose, rappelStructure: etatAvant.rappel_structure,
  };

  if (!estSousAgent) {
    const texte = lireDernierMo(transcriptPath);
    if (texte === null) return { note: null, etat: null };
    const rappel = choisirRappel(texte, critereRappel);
    let ratio;
    let plafond;
    let source;
    let traceCli = {};
    if (rappel) {
      ratio = rappel.ratio;
      plafond = rappel.plafond;
      source = 'cli';
      traceCli = { plafond_cli: rappel.plafond, depense_cli: rappel.depense, rappel_structure: rappel.structure === true };
    } else if (etatAvant.source === 'cli') {
      return { note: null, etat: etatAvant }; // aucun rappel retenable depuis le dernier : rien de neuf
    } else if (tarifs && budgetUsdPose !== null) {
      const suivi = coutIncremental(transcriptPath, cumul[transcriptPath], tarifs);
      if (!suivi || !suivi.tarife) return { note: null, etat: null };
      cumul[transcriptPath] = suivi;
      // Session principale + sous-agents déjà suivis pour cette session (sans rappel, rien d'autre ne les compte).
      const usd = Object.values(cumul).reduce((a, c) => a + (typeof c.usd === 'number' ? c.usd : 0), 0);
      ratio = usd / budgetUsdPose;
      plafond = budgetUsdPose;
      source = 'estime';
    } else {
      return { note: null, etat: null }; // ni rappel ni tarif exploitable : inerte
    }
    const budgetUsd = budgetUsdPose !== null ? budgetUsdPose : plafond;
    const decision = decider({ ratio, budgetUsd, reserveUsd, seuilPct, ordreA: etatAvant.ordre_a });
    const etat = Object.assign({}, etatAvant, traceCli, {
      session_id: sessionId,
      plafond: budgetUsd,
      depense: ratio * budgetUsd,
      ratio,
      source,
      ordre_a: decision.action === 'ordre' ? decision.palier : etatAvant.ordre_a,
      cumul,
    });
    // Revue n° 36 : la dépense ne décroît pas dans une session — le total déjà vu avec les sous-agents reste acquis.
    etat.ratio_total = Math.max(ratio, typeof etatAvant.ratio_total === 'number' ? etatAvant.ratio_total : 0);
    etat.depense_totale = etat.ratio_total * budgetUsd;
    ecrireEtat(fichierEtat, etat);
    if (decision.action !== 'ordre') return { note: null, etat };
    return { note: noteOrdre({ renforce: decision.renforce, ratio, budgetUsd, source }), etat };
  }

  // Sous-agent : le rappel de la session principale ne bouge pas tant qu'il travaille — on lit le
  // dernier rappel de SA transcription (<dir>/<sid>.jsonl), à défaut la dernière dépense principale persistée,
  // et on y ajoute le coût estimé de toute la transcription du sous-agent (<dir>/<sid>/subagents/…).
  const idx = transcriptPath.indexOf('/subagents/');
  const transcriptPrincipal = `${transcriptPath.slice(0, idx)}.jsonl`;
  const textePrincipal = lireDernierMo(transcriptPrincipal);
  const rappelPrincipal = textePrincipal ? choisirRappel(textePrincipal, critereRappel) : null;
  const ratioPersiste = typeof etatAvant.ratio === 'number' && Number.isFinite(etatAvant.ratio);
  let ratioBase = 0;
  let budgetUsd = budgetUsdPose;
  if (rappelPrincipal) {
    ratioBase = rappelPrincipal.ratio;
    if (budgetUsd === null) budgetUsd = rappelPrincipal.plafond;
  } else if (ratioPersiste) {
    ratioBase = etatAvant.ratio;
    if (budgetUsd === null && typeof etatAvant.plafond === 'number') budgetUsd = etatAvant.plafond;
  }
  if (budgetUsd === null || !tarifs) return { note: null, etat: null };
  const suivi = coutIncremental(transcriptPath, cumul[transcriptPath], tarifs);
  if (!suivi || !suivi.tarife) return { note: null, etat: null };
  // Revue n° 4 : des sous-agents en parallèle se comparent à la réserve ensemble, jamais chacun seul. On somme ce que
  // chaque sous-agent a dépensé depuis la dernière dépense principale connue (`base_sous_agents`, instantané des
  // cumuls pris quand cette dépense change — ce qui précède est déjà dans le rappel ou l'estimation principale).
  const cle = String(rappelPrincipal ? `cli:${rappelPrincipal.depense}` : `etat:${etatAvant.depense}`);
  const ref = etatAvant.base_sous_agents && etatAvant.base_sous_agents.cle === cle ? etatAvant.base_sous_agents : {
    cle,
    usd: Object.fromEntries(Object.entries(cumul).filter(([p]) => p.includes('/subagents/')).map(([p, c]) => [p, c.usd || 0])),
  };
  cumul[transcriptPath] = suivi;
  const sousAgents = Object.entries(cumul).filter(([p]) => p.includes('/subagents/'))
    .reduce((a, [p, c]) => a + Math.max(0, (typeof c.usd === 'number' ? c.usd : 0) - (ref.usd[p] || 0)), 0);
  const ratio = ratioBase + sousAgents / budgetUsd;
  // Champs lus par observe (plafond, dépense, ratio, source) : ceux de la session principale, posés ici
  // seulement s'ils manquent encore — jamais écrasés par la branche sous-agent (point 8).
  const principal = ratioPersiste ? {} : {
    plafond: budgetUsd, depense: ratioBase * budgetUsd, ratio: ratioBase, source: rappelPrincipal ? 'cli' : 'estime',
  };
  // Le sous-agent n'a pas de palier propre à lui (KERNEL, module delegation-intra-session) : seule la
  // réserve compte ici, une fois par transcription de sous-agent (`consigne_sous_agents`).
  const decision = decider({ ratio, budgetUsd, reserveUsd, seuilPct, ordreA: null });
  const consigner = decision.action === 'ordre' && !etatAvant.consigne_sous_agents.includes(transcriptPath);
  const etat = Object.assign({}, etatAvant, principal, {
    session_id: sessionId,
    cumul,
    base_sous_agents: ref,
    consigne_sous_agents: consigner
      ? etatAvant.consigne_sous_agents.concat([transcriptPath]) : etatAvant.consigne_sous_agents,
  });
  // Revue n° 36 : principal + sous-agents, lu par observe (budget-au-seuil) et recopié en estimation_budget.
  etat.ratio_total = Math.max(ratio, typeof etatAvant.ratio_total === 'number' ? etatAvant.ratio_total : 0);
  etat.depense_totale = etat.ratio_total * budgetUsd;
  ecrireEtat(fichierEtat, etat);
  return { note: consigner ? NOTE_SOUS_AGENT : null, etat };
}

module.exports = {
  lireNombre, lireRappel, lireRappels, choisirRappel, estimerCout, coutIncremental, decider, budgetWatch, budgetLivePath,
};
