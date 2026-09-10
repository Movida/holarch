'use strict';
/**
 * spaces.js — les **espaces** de travail (§5, §11, §13 de la spec, Étape 2). Un espace est
 * l'unité de contexte de holarch-d : il déclare ce qu'un LLM a le droit de lire (`roots`), le dépôt
 * Git de référence, et porte tout l'état accumulé qui s'y rapporte — carte du dépôt (`DIGEST.md`),
 * journal de décisions (`DECISIONS.md`), et une mémoire par spécialiste (D8/D9).
 *
 * Sur disque, sous `<HOLARCH_HOME>/spaces/<nom>/` (jamais dans le dépôt, D7) :
 *   SPACE.md                          déclaration de l'espace (front-matter + description)
 *   DIGEST.md                         carte du dépôt, régénérable (§13.1)
 *   DECISIONS.md                      append-only, daté (§13.2)
 *   specialists/<nom>/MEMORY.md       mémoire par spécialiste, réécrite intégralement (§7)
 *
 * **Les espaces se déclarent en CLI uniquement, jamais en MCP** (§9) : accorder un droit de
 * lecture est un acte de l'utilisateur, pas d'une conversation. Ce module ne fait qu'exposer les
 * primitives ; c'est `cli.js` qui les appelle, et `mcp-door.js` qui ne les appelle pas.
 *
 * Le format de `SPACE.md` est délibérément celui des fiches de spécialistes (front-matter plat +
 * sections `##`), pour être parsé par `parseFiche()` de `validate-specialists.js` plutôt que par un
 * second parseur maison.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { racineHolarch, commitFramework } = require('./ledger');
const { parseFiche } = require('./validate-specialists');

const ESPACE_DEFAUT = 'default';
const NOM_VALIDE = /^[a-z0-9][a-z0-9._-]*$/i;

function racineEspaces() {
  return path.join(racineHolarch(), 'spaces');
}

/** Valide un nom d'espace. Refus explicite plutôt que normalisation silencieuse : le nom sert de
 *  composant de chemin, une traversée (`../`) doit être une erreur, pas un chemin nettoyé. */
function validerNom(nom) {
  const n = String(nom || '').trim();
  if (!n) throw new Error("nom d'espace requis");
  if (!NOM_VALIDE.test(n) || n === '.' || n === '..') {
    throw new Error(`nom d'espace invalide : « ${nom} » (attendu : lettres, chiffres, . _ -, commençant par un alphanumérique)`);
  }
  return n;
}

function cheminEspace(nom) {
  return path.join(racineEspaces(), validerNom(nom));
}

function cheminSpaceMd(nom) {
  return path.join(cheminEspace(nom), 'SPACE.md');
}

function existe(nom) {
  try { return fs.existsSync(cheminSpaceMd(nom)); } catch (_e) { return false; }
}

function serialiserSpaceMd({ nom, racines, repo, description, created }) {
  return [
    '---',
    `name: ${nom}`,
    `repo: ${repo || ''}`,
    `roots: [${(racines || []).join(', ')}]`,
    `created: ${created}`,
    '---',
    '',
    `# Espace ${nom}`,
    '',
    '## Description',
    '',
    (description || '(aucune description)').trim(),
    '',
  ].join('\n');
}

/**
 * Crée un espace. Les racines sont résolues en absolu **à la création** (une racine relative
 * dépendrait du cwd de l'appelant, qui n'est pas celui du démon) et doivent exister : déclarer une
 * racine inexistante est presque toujours une faute de frappe, et la découvrir au moment d'un
 * appel LLM coûterait un appel pour rien.
 */
function creerEspace({
  nom, racines = [], repo = null, description = null, ecraser = false,
}) {
  const n = validerNom(nom);
  if (existe(n) && !ecraser) throw new Error(`l'espace « ${n} » existe déjà (utiliser --force pour le redéclarer)`);

  const racinesAbsolues = racines.map((r) => {
    const abs = path.resolve(String(r));
    if (!fs.existsSync(abs)) throw new Error(`racine inexistante : ${abs}`);
    if (!fs.statSync(abs).isDirectory()) throw new Error(`racine qui n'est pas un répertoire : ${abs}`);
    return fs.realpathSync(abs);
  });

  const dossier = cheminEspace(n);
  fs.mkdirSync(path.join(dossier, 'specialists'), { recursive: true });
  const created = existe(n) ? (lireEspace(n).created || new Date().toISOString()) : new Date().toISOString();
  fs.writeFileSync(cheminSpaceMd(n), serialiserSpaceMd({
    nom: n, racines: racinesAbsolues, repo: repo || racinesAbsolues[0] || null, description, created,
  }));
  return lireEspace(n);
}

/** Lit un espace, ou `null` s'il n'est pas déclaré. */
function lireEspace(nom) {
  const p = cheminSpaceMd(nom);
  if (!fs.existsSync(p)) return null;
  const { meta, sections } = parseFiche(fs.readFileSync(p, 'utf8'), 'SPACE.md');
  const roots = Array.isArray(meta.roots) ? meta.roots : (meta.roots ? [meta.roots] : []);
  return {
    name: meta.name || validerNom(nom),
    repo: meta.repo || null,
    roots,
    created: meta.created || null,
    description: sections.Description || null,
  };
}

/** L'espace `default` existe toujours, sans racine : à l'Étape 1 aucun espace n'était déclaré, et
 *  rien ne doit casser pour un utilisateur qui n'en déclare jamais. Sans racine = aucun outil de
 *  lecture accordé (D17) : le défaut reste le plus fermé. */
function assurerEspaceDefaut() {
  if (!existe(ESPACE_DEFAUT)) {
    creerEspace({
      nom: ESPACE_DEFAUT,
      racines: [],
      description: "Espace par défaut, sans racine déclarée : aucun accès en lecture accordé aux spécialistes.",
    });
  }
  return lireEspace(ESPACE_DEFAUT);
}

function listerEspaces() {
  const racine = racineEspaces();
  if (!fs.existsSync(racine)) return [];
  return fs.readdirSync(racine, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => { try { return lireEspace(d.name); } catch (_e) { return null; } })
    .filter(Boolean)
    .sort((a, b) => (a.name < b.name ? -1 : 1));
}

// --- Chemins : primitive de frontière de lecture (§11) -----------------
//
// ⚠️ Lire ceci avant de raisonner sur la sécurité de §11 : à l'Étape 2, `normaliserChemin`
// ci-dessous n'est appelée par **aucun chemin d'exécution** (seuls ses tests l'appellent). Ce qui
// tient réellement le refus de lecture hors racines, c'est le bac à sable du sous-processus
// (`launch.js` : `--tools` sous double condition D17, `cwd` sur la première racine, `--add-dir`
// pour les suivantes, ni écriture ni Bash) — aucune entrée du démon ne porte de chemin à cette
// étape. C'est une primitive prête et testée d'avance, pour l'Étape 3 (lecture ciblée de fichier),
// pas une porte en service. Voir README, divergence n° 7.

function sousRacine(cible, racine) {
  const r = racine.endsWith(path.sep) ? racine : racine + path.sep;
  return cible === racine || cible.startsWith(r);
}

/**
 * Normalise un chemin et **refuse tout ce qui sort des racines déclarées** (§11). Elle est conçue
 * pour être la porte unique de son appelant — `..`, chemins absolus arbitraires et liens
 * symboliques pointant hors racine sont tous traités ici, pas dans l'appelant — mais elle n'a pas
 * encore d'appelant en production (voir l'avertissement de section ci-dessus) : quiconque ajoute
 * une entrée portant un chemin doit la faire passer par ici, et le prouver par un test.
 *
 * Deux vérifications, pas une : la comparaison lexicale sur `path.resolve` (qui gère `..`) **et**,
 * quand la cible existe, la même comparaison sur `fs.realpathSync` — un lien symbolique passe la
 * première et échoue la seconde. Un espace sans racine refuse tout : c'est le défaut fermé.
 */
function normaliserChemin(nomEspace, chemin) {
  const espace = lireEspace(nomEspace);
  if (!espace) throw new Error(`espace inconnu : « ${nomEspace} »`);
  if (!espace.roots.length) {
    throw new Error(`l'espace « ${espace.name} » n'a aucune racine déclarée : aucun accès fichier autorisé`);
  }
  if (chemin === undefined || chemin === null || String(chemin).trim() === '') {
    throw new Error('chemin requis');
  }

  const brut = String(chemin);
  const base = path.isAbsolute(brut) ? brut : path.join(espace.roots[0], brut);
  const resolu = path.resolve(base);

  const dansRacine = (cible) => espace.roots.some((r) => sousRacine(cible, path.resolve(r)));
  if (!dansRacine(resolu)) {
    throw new Error(`chemin hors des racines déclarées de « ${espace.name} » : ${resolu}`);
  }
  if (fs.existsSync(resolu)) {
    const reel = fs.realpathSync(resolu);
    if (!dansRacine(reel)) {
      throw new Error(`chemin hors des racines déclarées de « ${espace.name} » (via un lien symbolique) : ${reel}`);
    }
    return reel;
  }
  return resolu;
}

// --- Mémoire par spécialiste (D8/D9, gabarit §7) -----------------------

const SECTIONS_MEMOIRE = [
  'Ce que je sais du projet',
  'Ce que j\'ai déjà recommandé',
  'Ce qui a été retenu ou écarté',
  'Points ouverts',
];

const MAX_CARACTERES_MEMOIRE = 6000; // ~1500 tokens (§7), borné en caractères : mesurable sans tokenizer

function cheminMemoire(nomEspace, specialiste) {
  return path.join(cheminEspace(nomEspace), 'specialists', validerNom(specialiste), 'MEMORY.md');
}

function lireMemoire(nomEspace, specialiste) {
  const p = cheminMemoire(nomEspace, specialiste);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/** Réécriture **intégrale** (D8 : jamais d'append — une mémoire qui ne fait que croître finit par
 *  coûter plus cher que ce qu'elle fait gagner). Tronquée au-delà du plafond, avec une marque
 *  visible plutôt qu'en silence. */
function ecrireMemoire(nomEspace, specialiste, contenu) {
  const p = cheminMemoire(nomEspace, specialiste);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let texte = String(contenu || '').trim();
  if (texte.length > MAX_CARACTERES_MEMOIRE) {
    texte = `${texte.slice(0, MAX_CARACTERES_MEMOIRE)}\n\n_(mémoire tronquée à ${MAX_CARACTERES_MEMOIRE} caractères)_`;
  }
  fs.writeFileSync(p, `${texte}\n`);
  return texte;
}

function gabaritMemoire() {
  return SECTIONS_MEMOIRE.map((s) => `## ${s}\n`).join('\n');
}

// --- DECISIONS.md (§13.2) ----------------------------------------------

function cheminDecisions(nomEspace) {
  return path.join(cheminEspace(nomEspace), 'DECISIONS.md');
}

function lireDecisions(nomEspace) {
  const p = cheminDecisions(nomEspace);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/**
 * Ajoute une entrée datée. **Append-only, jamais de suppression ni de réécriture** : c'est la
 * réponse retenue au point laissé ouvert en §16 — on corrige une décision en en ajoutant une qui
 * la remplace (`supersedes`), pas en effaçant la précédente. Le fichier reste lisible à la main.
 */
function ajouterDecision(nomEspace, {
  taskId = null, verdict = null, note = null, decisions = [], supersedes = null, specialist = null,
}) {
  const p = cheminDecisions(nomEspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (!fs.existsSync(p)) {
    fs.writeFileSync(p, `# Décisions — espace ${validerNom(nomEspace)}\n\n<!-- Append-only : une décision se corrige en en ajoutant une qui la remplace (supersedes), jamais en effaçant. -->\n`);
  }
  const date = new Date().toISOString();
  const lignes = [
    '',
    `## ${date} · tâche ${taskId || '—'} · verdict ${verdict || '—'}`,
  ];
  if (specialist) lignes.push(`- spécialiste : ${specialist}`);
  if (supersedes) lignes.push(`- supersedes : ${supersedes}`);
  if (note) lignes.push(`- note : ${String(note).trim().replace(/\n/g, ' ')}`);
  for (const d of (decisions || [])) {
    if (String(d).trim()) lignes.push(`- ${String(d).trim().replace(/\n/g, ' ')}`);
  }
  lignes.push('');
  fs.appendFileSync(p, lignes.join('\n'));
  return { date, taskId, verdict, note, decisions, supersedes };
}

// --- DIGEST.md (§13.1) --------------------------------------------------

function cheminDigest(nomEspace) {
  return path.join(cheminEspace(nomEspace), 'DIGEST.md');
}

function lireDigest(nomEspace) {
  const p = cheminDigest(nomEspace);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

/** Écrit la carte du dépôt avec, en front-matter, le commit sur lequel elle a été établie : c'est
 *  ce qui permet ensuite de savoir qu'elle a vieilli (`digestPerime`, digest.js). */
function ecrireDigest(nomEspace, { corps, commit = null, cout = null }) {
  const p = cheminDigest(nomEspace);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const entete = [
    '---',
    `space: ${validerNom(nomEspace)}`,
    `commit: ${commit || ''}`,
    `date: ${new Date().toISOString()}`,
    `cost_usd: ${cout === null || cout === undefined ? '' : cout}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(p, entete + String(corps || '').trim() + '\n');
  return p;
}

/** Métadonnées du digest existant (`{commit, date}`), ou `null` s'il n'y en a pas. */
function metaDigest(nomEspace) {
  const texte = lireDigest(nomEspace);
  if (!texte) return null;
  const { meta } = parseFiche(texte, 'DIGEST.md');
  return { commit: meta.commit || null, date: meta.date || null, cost_usd: meta.cost_usd || null };
}

/** HEAD court du dépôt de référence de l'espace, ou `null` (pas de dépôt, ou pas un dépôt Git). */
function headDepot(nomEspace) {
  const espace = lireEspace(nomEspace);
  const depot = espace && (espace.repo || espace.roots[0]);
  if (!depot || !fs.existsSync(depot)) return null;
  return commitFramework(depot);
}

const SEUIL_COMMITS_DIGEST = 50; // §13.1 : « quand HEAD a trop avancé », rendu mesurable

/**
 * Le digest a-t-il vieilli ? Réponse motivée plutôt que booléenne — l'appelant (CLI, README)
 * doit pouvoir dire *pourquoi* il propose une régénération.
 *
 * « Trop avancé » (§13.1) est traduit en nombre de commits écoulés depuis celui sur lequel le
 * digest a été établi : un commit d'écart ne périme pas une carte, cinquante oui. Si la distance
 * n'est pas calculable (commit inconnu du dépôt, dépôt absent), on retombe sur l'égalité stricte —
 * prudent, mais jamais bloquant : un digest périmé reste servi, il est seulement signalé.
 */
function digestPerime(nomEspace, { seuil = SEUIL_COMMITS_DIGEST } = {}) {
  const meta = metaDigest(nomEspace);
  if (!meta) return { perime: true, motif: 'aucun digest', distance: null, head: headDepot(nomEspace) };
  const head = headDepot(nomEspace);
  if (!head) return { perime: false, motif: 'pas de dépôt Git de référence', distance: null, head: null };
  if (!meta.commit) return { perime: true, motif: 'digest sans commit de référence', distance: null, head };
  if (meta.commit === head) return { perime: false, motif: 'à jour', distance: 0, head };

  const espace = lireEspace(nomEspace);
  const depot = espace.repo || espace.roots[0];
  let distance = null;
  try {
    distance = Number(execFileSync('git', ['-C', depot, 'rev-list', '--count', `${meta.commit}..HEAD`], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim());
  } catch (_e) {
    return { perime: true, motif: `HEAD a changé (${meta.commit} → ${head}), distance incalculable`, distance: null, head };
  }
  return {
    perime: distance >= seuil,
    motif: distance >= seuil
      ? `${distance} commits depuis le digest (seuil ${seuil})`
      : `${distance} commit(s) depuis le digest, sous le seuil de ${seuil}`,
    distance,
    head,
  };
}

module.exports = {
  ESPACE_DEFAUT, SECTIONS_MEMOIRE, MAX_CARACTERES_MEMOIRE, SEUIL_COMMITS_DIGEST,
  headDepot, digestPerime,
  racineEspaces, cheminEspace, cheminSpaceMd, validerNom, existe,
  creerEspace, lireEspace, listerEspaces, assurerEspaceDefaut,
  normaliserChemin,
  cheminMemoire, lireMemoire, ecrireMemoire, gabaritMemoire,
  cheminDecisions, lireDecisions, ajouterDecision,
  cheminDigest, lireDigest, ecrireDigest, metaDigest,
};
