'use strict';
/**
 * Garde a posteriori fondé sur le dépôt (IMPLEMENTATION §11.4, chantier 9 volet 4).
 *
 * Les hooks de `framework/hooks/holarch-hooks.js` restent la couche préventive de l'exécuteur
 * `claude-code`. Ce module est la garantie **portable** : il vérifie une session après coup, à
 * partir des seuls commits, donc quel que soit le fournisseur (`capacites.hooks` faux compris).
 *
 * Trois règles (§11.4, points 1 à 3) :
 *   1. écritures hors de l'arbre autorisé de l'instance (KERNEL §4) ;
 *   2. transition de `STATUS.md` (KERNEL §3 + règles de `sleep-guard`) ;
 *   3. enfants créés hors budget (`instance-budget`, règles de `spawn-guard`).
 *
 * Le module est **pur** : aucune écriture, aucun lancement de session, aucune `ALERT`. La conduite
 * à tenir sur un écart est câblée par le lanceur. Il est **fail-open** (§0.2) : dépôt absent, shas
 * inconnus, commande Git indisponible ⇒ `{ ecarts: [] }`, jamais d'exception.
 */

const { spawnSync } = require('child_process');

/** États de la machine du KERNEL §3. */
const ETATS = new Set(['INIT', 'READY', 'WORKING', 'WAITING_CHILDREN', 'BLOCKED', 'DELIVERED', 'FAILED', 'ARCHIVED']);

/**
 * Transitions admises (KERNEL §3). Rester dans le même état est toujours admis.
 * Le garde n'observe que les **extrémités** d'une session (état à `avant`, état à `apres`) : les
 * états traversés entre les deux ne sont pas committés séparément. Un état final est donc jugé
 * par accessibilité dans ce graphe (`atteignable`), pas par arête directe — `INIT → DELIVERED`
 * (une instance incarnée, qui travaille et livre dans la même session) est conforme.
 */
const TRANSITIONS = {
  INIT: ['READY', 'WORKING', 'ARCHIVED'],
  READY: ['WORKING', 'BLOCKED', 'FAILED', 'ARCHIVED'],
  WORKING: ['WAITING_CHILDREN', 'BLOCKED', 'DELIVERED', 'FAILED', 'ARCHIVED'],
  WAITING_CHILDREN: ['WORKING', 'BLOCKED', 'DELIVERED', 'FAILED', 'ARCHIVED'],
  BLOCKED: ['WORKING', 'DELIVERED', 'FAILED', 'ARCHIVED'],
  DELIVERED: ['WORKING', 'FAILED', 'ARCHIVED'],
  FAILED: ['WORKING', 'ARCHIVED'],
  ARCHIVED: [],
};

/** Existe-t-il un chemin de `depuis` vers `vers` dans la machine à états ? (parcours en largeur) */
function atteignable(depuis, vers) {
  if (depuis === vers) return true;
  const vus = new Set([depuis]);
  const file = [depuis];
  while (file.length) {
    for (const suivant of TRANSITIONS[file.shift()] || []) {
      if (suivant === vers) return true;
      if (!vus.has(suivant)) { vus.add(suivant); file.push(suivant); }
    }
  }
  return false;
}

/** Racines du harnais, interdites à toute instance sans exception (`framework-guard`). */
const HARNAIS = ['framework/', 'docs/', 'tools/'];

/** Constat de blocage dans le journal (mêmes expressions que `sleep-guard`). */
const RE_CONSTAT = /\b(impossible|bloqu[ée]e?s?|refus[ée]e?s?|ne (?:peut|peux) pas)\b/i;
const RE_NON_BLOQUANT = /constat non bloquant/i;

// ---------------------------------------------------------------- utilitaires Git

function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!r || r.error || r.status !== 0) return null;
  return String(r.stdout || '');
}

function estDepot(root) {
  const out = git(root, ['rev-parse', '--git-dir']);
  return typeof out === 'string' && out.trim() !== '';
}

function resoudre(root, sha) {
  if (!sha) return null;
  const out = git(root, ['rev-parse', '--verify', `${sha}^{commit}`]);
  return out ? out.trim() : null;
}

/** Contenu d'un fichier à un commit donné, ou `null` s'il n'y est pas. */
function montrer(root, sha, rel) {
  return git(root, ['show', `${sha}:${rel}`]);
}

function jourDe(root, sha) {
  const out = git(root, ['show', '-s', '--format=%cI', sha]);
  return out ? out.trim().slice(0, 10) : '';
}

// ---------------------------------------------------------------- analyse de fichiers

/** Même extraction que `parseStatus` des hooks (l.47-57). */
function parseStatus(texte) {
  const t = String(texte || '');
  const etat = (t.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m) || [])[1] || '';
  const note = (t.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m) || [])[1] || '';
  const reveil = (t.match(/^\|\s*R[ée]veil\s*\|\s*(.*?)\s*\|\s*$/m) || [])[1] || '';
  return { etat, note, reveil };
}

/** Même extraction que `parseFiche` des hooks (l.58-64). */
function parseFiche(texte) {
  const m = String(texte || '').match(/^\|\s*Budget allou[ée] \/ consomm[ée]\s*\|\s*(\d+)\s*\/\s*(\d+)/mi);
  return m ? { alloue: Number(m[1]), consomme: Number(m[2]) } : { alloue: null, consomme: null };
}

/**
 * Validation syntaxique d'une condition de réveil (`terme | tous(...) | lun(...)`).
 * Utilise `bin/reveil.js` s'il est disponible — sinon une vérification locale équivalente, pour
 * que le module reste utilisable hors arborescence complète du framework.
 */
function reveilValide(condition) {
  const c = String(condition || '').trim().replace(/^`+|`+$/g, '').trim();
  if (!c || c === '—' || c === '-') return false;
  try {
    // eslint-disable-next-line global-require
    const reveil = require('../reveil.js');
    if (reveil && typeof reveil.parseReveil === 'function') {
      const r = reveil.parseReveil(c);
      return !!r && !r.erreur;
    }
  } catch (_) { /* repli local */ }
  const terme = /^(message:[A-Z_]+|enfant:[^:\s()]+:[A-Z_]+|enfants:[A-Z_]+|fichier:[^\s()]+|date:[^\s()]+)$/;
  const groupe = c.match(/^(tous|lun)\(([^()]*)\)$/);
  if (groupe) {
    const membres = groupe[2].split(',').map((s) => s.trim()).filter(Boolean);
    return membres.length > 0 && membres.every((m) => terme.test(m));
  }
  return terme.test(c);
}

// ---------------------------------------------------------------- arbre autorisé (règle 1)

function tirets(chemin) { return String(chemin).replace(/\//g, '-'); }

function cheminParent(chemin) {
  const segs = String(chemin).split('/').filter(Boolean);
  return segs.length > 1 ? segs.slice(0, -1).join('/') : null;
}

/**
 * Un chemin du dépôt est-il dans l'arbre autorisé de l'instance ? (KERNEL §4, `wake-guard`,
 * `framework-guard`, et la liste de `IMPLEMENTATION §11.4` point 1.)
 * Retourne `null` si le chemin est hors sujet (jamais committé), sinon `{ok, motif}`.
 */
function autorise(rel, chemin) {
  const p = String(rel).replace(/\\/g, '/');
  if (p.startsWith('mission/.holarch/')) return null; // jamais committé (annexe A)
  if (p === 'mission/OBJECTIVE.md') return { ok: false, motif: 'mission/OBJECTIVE.md appartient à la mission, personne ne l’écrit (KERNEL §4)' };
  for (const racine of HARNAIS) {
    if (p.startsWith(racine)) return { ok: false, motif: `${racine} est le harnais, interdit à toute instance (framework-guard)` };
  }
  if (p.startsWith(`mission/${chemin}/`)) return { ok: true };
  if (p.startsWith(`mission/shared/${chemin}/`)) return { ok: true };
  if (p.startsWith('mission/registry/instances/')) {
    const fiche = p.slice('mission/registry/instances/'.length);
    const soi = `${tirets(chemin)}.md`;
    if (fiche === soi) return { ok: true };
    if (fiche.startsWith(`${tirets(chemin)}-`)) return { ok: true }; // fiche d'un descendant, créée au spawn
    return { ok: false, motif: 'fiche registre d’une autre instance (écriture exclusive par fiche, sharded-files)' };
  }
  if (p.startsWith('mission/registry/')) return { ok: true }; // flux partagés : PROGRESS, ORG, DECISIONS, SESSIONS, REVEILS, contrats
  const parent = cheminParent(chemin);
  if (parent && p === `mission/${parent}/INBOX.md`) return { ok: true };
  if (p.startsWith('mission/')) return { ok: false, motif: 'hors de l’arbre de l’instance (KERNEL §4)' };
  return { ok: false, motif: 'hors de mission/ : rien du dépôt n’appartient à l’instance en dehors de son arbre' };
}

function regle1(root, chemin, avant, apres, ecarts) {
  const out = git(root, ['diff', '--name-status', '--no-renames', `${avant}..${apres}`]);
  if (out === null) return;
  for (const ligne of out.split('\n')) {
    if (!ligne.trim()) continue;
    const parts = ligne.split('\t');
    const etat = parts[0];
    const rel = parts[parts.length - 1];
    const verdict = autorise(rel, chemin);
    if (verdict && !verdict.ok) {
      ecarts.push({ regle: 1, chemin: rel, detail: `${etat === 'A' ? 'création' : etat === 'D' ? 'suppression' : 'modification'} hors arbre autorisé : ${verdict.motif}` });
    }
  }
}

// ---------------------------------------------------------------- transition de STATUS (règle 2)

function derniereEntreeJournal(texte) {
  const blocs = String(texte || '').split(/^## /m);
  return blocs.length > 1 ? blocs[blocs.length - 1] : '';
}

function messageSignale(texte, chemin, jour) {
  const re = new RegExp(`^from:\\s*${chemin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$[\\s\\S]*?^type:\\s*(BLOCKER|CLARIFICATION|PROPOSAL)\\s*$[\\s\\S]*?^date:\\s*${jour}`, 'm');
  return re.test(String(texte || ''));
}

function regle2(root, chemin, avant, apres, ecarts) {
  const rel = `mission/${chemin}/STATUS.md`;
  const apresTexte = montrer(root, apres, rel);
  if (apresTexte === null) {
    if (montrer(root, avant, rel) !== null) {
      ecarts.push({ regle: 2, chemin: rel, detail: 'STATUS.md présent avant la session et absent après : l’état de l’instance n’est plus observable' });
    }
    return; // instance sans STATUS.md (pas encore incarnée) : rien à juger
  }
  const av = parseStatus(montrer(root, avant, rel) || '');
  const ap = parseStatus(apresTexte);

  if (!ETATS.has(ap.etat)) {
    ecarts.push({ regle: 2, chemin: rel, detail: `état final « ${ap.etat || '(vide)'} » hors de la machine à états du KERNEL §3` });
    return;
  }
  if (av.etat && ETATS.has(av.etat) && !atteignable(av.etat, ap.etat)) {
    ecarts.push({ regle: 2, chemin: rel, detail: `transition interdite ${av.etat} → ${ap.etat} : aucun chemin de la machine à états du KERNEL §3 n’y mène` });
  }
  if (ap.etat === 'WORKING' && !/hibernation volontaire/i.test(ap.note)) {
    ecarts.push({ regle: 2, chemin: rel, detail: 'session terminée à WORKING sans note « hibernation volontaire » : ON_SLEEP non exécuté (sleep-guard)' });
  }
  if ((ap.etat === 'WAITING_CHILDREN' || ap.etat === 'BLOCKED') && !reveilValide(ap.reveil)) {
    ecarts.push({ regle: 2, chemin: rel, detail: `état ${ap.etat} sans condition de réveil valide (ligne Réveil : « ${ap.reveil || '—'} »)` });
  }

  const journal = derniereEntreeJournal(montrer(root, apres, `mission/${chemin}/JOURNAL.md`) || '');
  if (journal && RE_CONSTAT.test(journal) && !RE_NON_BLOQUANT.test(journal)) {
    const jour = jourDe(root, apres);
    const outbox = montrer(root, apres, `mission/${chemin}/OUTBOX.md`) || '';
    const parent = cheminParent(chemin);
    const inboxParent = parent ? (montrer(root, apres, `mission/${parent}/INBOX.md`) || '') : '';
    if (!messageSignale(outbox, chemin, jour) && !messageSignale(inboxParent, chemin, jour)) {
      ecarts.push({ regle: 2, chemin: `mission/${chemin}/JOURNAL.md`, detail: 'constat de blocage dans la dernière entrée de journal sans BLOCKER/CLARIFICATION/PROPOSAL émis le même jour (KERNEL §6.3 : jamais de refus silencieux)' });
    }
  }
}

// ---------------------------------------------------------------- budget d'enfants (règle 3)

/** Sous-répertoires directs de `mission/<chemin>/` qui portent un `ROLE.md`, à un commit donné. */
function enfantsDansArbre(root, chemin, ref) {
  const out = git(root, ['ls-tree', '--name-only', `${ref}:mission/${chemin}`]);
  if (out === null) return [];
  const noms = [];
  for (const nom of out.split('\n').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean)) {
    if (nom === 'workspace' || nom === 'memoire') continue;
    if (montrer(root, ref, `mission/${chemin}/${nom}/ROLE.md`) !== null) noms.push(nom);
  }
  return noms;
}

/**
 * Enfants imputables à l'instance : ceux visibles dans son propre arbre à `apres`, plus ceux
 * visibles sur les branches d'enfants (sous `git-branches`/`worktree`, le commit de spawn est posé
 * sur la branche de l'enfant, donc invisible dans l'arbre du parent — `spawn-guard` recompte de
 * la même façon, via `countChildren`).
 */
function enfantsConnus(root, chemin, apres) {
  const noms = new Set(enfantsDansArbre(root, chemin, apres));
  const refs = git(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  if (refs) {
    const marque = `${tirets(chemin)}-`;
    for (const b of refs.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!b.includes(marque)) continue;
      for (const nom of enfantsDansArbre(root, chemin, b)) noms.add(nom);
    }
  }
  return [...noms];
}

function regle3(root, chemin, avant, apres, ecarts) {
  const relFiche = `mission/registry/instances/${tirets(chemin)}.md`;
  const fiche = montrer(root, apres, relFiche) || montrer(root, avant, relFiche);
  if (fiche === null) return; // pas de fiche : budget inconnu, fail-open
  const { alloue } = parseFiche(fiche);
  if (alloue === null) return;

  const avantNoms = new Set(enfantsDansArbre(root, chemin, avant));
  const noms = enfantsConnus(root, chemin, apres);
  const crees = noms.filter((n) => !avantNoms.has(n));
  if (crees.length === 0) return; // aucune création pendant la session : rien à imputer

  if (noms.length > alloue) {
    ecarts.push({
      regle: 3,
      chemin: `mission/${chemin}`,
      detail: `${crees.length} enfant(s) créé(s) pendant la session (${crees.join(', ')}) portant le total à ${noms.length} pour un budget alloué de ${alloue} (instance-budget)`,
    });
  }
}

// ---------------------------------------------------------------- point d'entrée

/**
 * Vérification a posteriori d'une session, fondée sur le dépôt (IMPLEMENTATION §11.4).
 * @param {string} root    racine du dépôt
 * @param {string} chemin  chemin d'instance depuis mission/ (ex. "concepteur/implementeur-garde")
 * @param {string} avant   sha de base (état du worktree avant la session)
 * @param {string} apres   sha final (état après la session)
 * @returns {{ ecarts: Array<{regle: 1|2|3, chemin: string, detail: string}> }}
 */
function verifierSession(root, chemin, avant, apres) {
  const ecarts = [];
  try {
    if (!root || !chemin) return { ecarts };
    if (!estDepot(root)) return { ecarts };
    const a = resoudre(root, avant);
    const b = resoudre(root, apres);
    if (!a || !b) return { ecarts };
    for (const regle of [regle1, regle2, regle3]) {
      try { regle(root, chemin, a, b, ecarts); } catch (_) { /* fail-open, règle par règle */ }
    }
  } catch (_) {
    return { ecarts };
  }
  return { ecarts };
}

module.exports = { verifierSession };
