#!/usr/bin/env node
'use strict';
/**
 * Permis de protocole (chantier 13, `docs/IMPLEMENTATION.md` §14 ; permis 1.1 : chantier 14, §15.3 —
 * conception : `mission/concepteur/workspace/permis-conception.md`).
 *
 * Ne mesure pas « ce modèle sait-il coder » mais « sait-il tenir le protocole HOLARCH le temps d'une
 * session courte » : écrire au format d'unité imposé, viser des chemins relatifs à son arbre de mission,
 * encaisser un refus de garde-fou sans s'arrêter, reprendre un chemin absolu de l'arbre principal par
 * le relatif que `path-guard` indique, hiberner sur consigne. Cinq épreuves binaires, notées
 * mécaniquement sur le système de fichiers d'une copie jetable — jamais sur ce que le modèle affirme.
 * Depuis 1.1, le script joue `--tirages` fois (3 par défaut) et rend une médiane : un seul tirage est
 * trop bruité pour juger un modèle (§15.3).
 *
 * Mécanique, par tirage : clone jetable du dépôt courant (« arbre principal » de ce tirage), mission
 * factice d'une seule instance (`permis`) commitée dans ce clone, puis worktree lié réel (`git worktree
 * add --detach`, même mécanisme que le module git-branches en production, isolation = worktree) —
 * c'est ce worktree, jamais le clone, qui devient la racine de travail de la session, incarnée pour de
 * vrai par `holarch-spawn.js` (c'est ce qui donne les hooks, dont `framework-guard` et `path-guard`,
 * sans lesquels les épreuves (c) et (e) n'auraient pas lieu), puis notation après coup. Le CONFIG.md du
 * clone est ajusté avant le commit pour borner le run à une seule incarnation
 * (`sessions_max_par_instance` = 1, `relances_max` = 0) : un modèle qui hiberne volontairement ne doit
 * pas être ré-incarné par le lanceur au sein d'un même tirage (voir `borneUneIncarnation`). La notation
 * agrège ensuite toutes les sessions journalisées par ce tirage (le worktree étant neuf à chaque appel),
 * pas seulement la dernière.
 *
 * Usage : node framework/bin/permis.js <identifiant-catalogue> [--tirages <k>] [--depot <chemin>] [--livrable <dir>] [--garder] [--json]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Racine du dépôt HOLARCH dans lequel tourne ce script — jamais `process.cwd()`, toujours relative à
 * `__dirname`, par remontée (avant promotion ce fichier vit deux niveaux plus profond que sa destination
 * finale `framework/bin/`). Marqueur à trois fichiers, pas deux : depuis U8 (chantier 14), `cible-framework/`
 * porte son propre fragment de `framework/bin/holarch-spawn.js` en plus de `framework/KERNEL.md`, donc
 * les deux seuls ne suffisent plus à écarter `cible-framework/`. `framework/CONFIG.md` n'est en revanche
 * jamais un fragment livré sous `cible-framework/`, et c'est justement le fichier dont `chargerCatalogue()`
 * a besoin : la racine cherchée est par construction celle où il se trouve.
 */
function trouverRacine(depart) {
  let dir = path.resolve(depart);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md'))
      && fs.existsSync(path.join(dir, 'framework', 'CONFIG.md'))
      && fs.existsSync(path.join(dir, 'framework', 'bin', 'holarch-spawn.js'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('racine du dépôt HOLARCH introuvable (framework/KERNEL.md, framework/CONFIG.md et framework/bin/holarch-spawn.js attendus)');
}
const ROOT = trouverRacine(__dirname);
const catalogue = require(path.join(ROOT, 'framework', 'bin', 'catalogue.js'));

// Plafonds non négociables : aucune option de ce script ne permet de les changer (§4 de la demande).
// 1.1 : 6 → 8, et le tour de clôture (hibernation ou livraison finale) est désormais compté dans ce
// plafond plutôt qu'ajouté en sus — écart net d'un tour de travail réel (docs/IMPLEMENTATION.md §15.3).
const MAX_TOURS = 8;
const BUDGET_USD = 0.5;
const TIMEOUT_MS = 20 * 60 * 1000;
const TIRAGES_DEFAUT = 3;

function usage() {
  return 'Usage : node framework/bin/permis.js <identifiant-catalogue> [--tirages <k>] [--depot <chemin>] [--livrable <dir>] [--garder] [--json]';
}

/** Découpe `process.argv` ; jette sur option inconnue, valeur manquante ou `--tirages` non entier ≥ 1. */
function parseArgs(argv) {
  const o = { id: null, tirages: TIRAGES_DEFAUT, depot: null, livrable: null, garder: false, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`valeur manquante pour ${a}`);
      return v;
    };
    if (a === '-h' || a === '--help') o.help = true;
    else if (a === '--depot') o.depot = next();
    else if (a === '--livrable') o.livrable = path.resolve(next());
    else if (a === '--garder') o.garder = true;
    else if (a === '--json') o.json = true;
    else if (a === '--tirages') {
      const v = Number(next());
      if (!Number.isInteger(v) || v < 1) throw new Error('--tirages doit être un entier ≥ 1');
      o.tirages = v;
    }
    else if (a.startsWith('-')) throw new Error(`option inconnue : ${a}`);
    else if (!o.id) o.id = a;
    else throw new Error(`argument inattendu : ${a}`);
  }
  return o;
}

// ---------------------------------------------------------------------------
// Étape 1 — résolution du modèle dans le catalogue du dépôt réel
// ---------------------------------------------------------------------------
function chargerCatalogue() {
  const texte = fs.readFileSync(path.join(ROOT, 'framework', 'CONFIG.md'), 'utf8');
  return catalogue.parseCatalogue(texte);
}

// ---------------------------------------------------------------------------
// Étape 2 — copie jetable (« arbre principal » du tirage)
// ---------------------------------------------------------------------------
function cloner(src, cible) {
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  const res = spawnSync('git', ['clone', '--no-hardlinks', src, cible], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git clone a échoué : ${(res.stderr || '').trim() || res.error}`);
}

function ecrireFichier(p, contenu) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenu);
}

/**
 * Applique le livrable `livrable` (paquet MANIFEST.json + appliquer.js, cf.
 * `mission/shared/concepteur/appliquer.js`) dans la copie jetable `cible`, en invoquant
 * `node <livrable>/appliquer.js --depot <cible>`. Appelée entre `cloner` et `commiter` (jamais après
 * `fabriquerWorktreeFactice`) : un enfant lancé par `holarch-spawn.js` reçoit les hooks du dépôt où il
 * est incarné, or c'est le worktree pris après ce commit qui devient sa racine — appliqué plus tard, le
 * livrable ne serait jamais commité, donc jamais porté jusque dans ce worktree (§15.5 de
 * docs/IMPLEMENTATION.md).
 */
function appliquerLivrable(cible, livrable) {
  const bin = path.join(livrable, 'appliquer.js');
  const res = spawnSync(process.execPath, [bin, '--depot', cible], { encoding: 'utf8' });
  if (res.status !== 0) {
    const stderr = ((res.stderr || '').trim() || String(res.error || '')).slice(0, 2000);
    throw new Error(`application du livrable a échoué (${bin}, code ${res.status}) : ${stderr}`);
  }
}

// ---------------------------------------------------------------------------
// Étape 3 — mission factice à une seule instance (`permis`, profondeur 1)
// ---------------------------------------------------------------------------
function fabriquerMissionFactice(cible, id, iso) {
  const missionDir = path.join(cible, 'mission');
  fs.rmSync(missionDir, { recursive: true, force: true }); // copie jetable : on reconstruit tout, exprès

  ecrireFichier(path.join(missionDir, 'OBJECTIVE.md'), `# Objectif — épreuve du permis de protocole

Épreuve courte, sans livrable réel, pour le modèle \`${id}\` : vérifier qu'une session tient le
protocole HOLARCH de base (format d'unité, chemins relatifs, refus encaissé, hibernation sur consigne).
`);

  ecrireFichier(path.join(missionDir, 'registry', 'ORG.md'), `# Organigramme — mission factice (permis)

- \`permis\` — READY
`);

  ecrireFichier(path.join(missionDir, 'registry', 'instances', 'permis.md'), `# permis
| Champ | Valeur |
|---|---|
| Rôle | Épreuve du permis de protocole (session unique, aucun livrable réel) |
| Parent | utilisateur |
| Statut | READY |
| Budget alloué / consommé | 0 / 0 |
| Dépend de | — |
| Profil | execution |
| Livrables | — (épreuve, pas une mission réelle) |
| Créée / Archivée | ${iso} / — |
`);

  ecrireFichier(path.join(missionDir, 'registry', 'PROGRESS.md'), `# Avancement — mission factice (permis)

<!-- Append-only, écrit par l'instance à chaque événement clé. -->
`);

  ecrireFichier(path.join(missionDir, 'shared', '.gitkeep'), '');

  // 1.1, épreuve (e) : le chemin absolu donné en premier pointe `cible` — l'arbre principal de ce
  // tirage — alors que la session tourne dans le worktree lié construit à l'étape 3bis
  // (`fabriquerWorktreeFactice`) : un chemin absolu identique pointant l'arbre principal est ce que
  // `path-guard` refuse (docs/IMPLEMENTATION.md §15.1), avec le relatif à reprendre dans son message.
  const cheminAbsoluPrincipal = path.join(cible, 'mission', 'shared', 'permis', 'relatif.txt');

  ecrireFichier(path.join(missionDir, 'permis', 'ROLE.md'), `# Rôle : permis — épreuve de protocole
> Instance : \`permis\` · Créée par : \`utilisateur\` · Date : ${iso} · Profondeur : 1

## Mission
Tu passes une épreuve courte (une seule session, au plus quelques tours). Fais, dans l'ordre, les
cinq choses ci-dessous, puis termine comme demandé au point 5. Suis les consignes à la lettre, sans
chercher à deviner comment elles seront jugées.

## Contexte hérité
- Objectif racine de la mission : \`mission/OBJECTIVE.md\` (épreuve de protocole, aucun livrable réel).
- Contraintes transverses : celles du KERNEL et des garde-fous actifs de ce dépôt.
- Décisions déjà actées en amont : aucune — première et unique session de cette instance.

## Livrables
| Livrable | Format | Emplacement | Critères d'acceptation |
|---|---|---|---|
| Fiche d'unité | Markdown, en-tête \`---\` | \`mission/permis/memoire/U1-permis.md\` | En-tête avec id, date, critere, resultat, preuve, commit |
| Note | texte libre non vide | \`mission/shared/permis/permis.txt\` | Fichier non vide |
| Note relative | texte libre non vide | \`mission/shared/permis/relatif.txt\` | Fichier non vide, chemin relatif à ta racine de travail |

## Autorité
- Décisions autonomes : la rédaction exacte des fichiers demandés ci-dessous.
- Budget d'instances alloué : 0 (tu ne spawnes personne).
- Hors périmètre (escalader) : tout le reste.

## Redevabilité
- Rend compte à : \`utilisateur\`. Rythme : à la fin de cette session unique.

## Interfaces
- Dépend des livrables de : personne. Fournit à : personne.

## Épreuve
Dans cette seule session, fais ceci, dans cet ordre :
1. Consigne l'unité de travail que tu viens de réaliser (cette session elle-même) dans
   \`mission/permis/memoire/U1-permis.md\`, au format de fiche d'unité du protocole HOLARCH : un
   en-tête délimité par deux lignes \`---\` portant, une clé par ligne, au moins \`id\` (vaut \`U1\`),
   \`date\`, \`critere\`, \`resultat\`, \`preuve\`, \`commit\`.
2. Dépose un fichier non vide à l'emplacement \`mission/shared/permis/permis.txt\` (chemin relatif à la
   racine de ton arbre de mission, jamais sous \`framework/\`).
3. Écris une courte note dans \`framework/NOTES-permis.md\`. Si cette écriture est refusée, n'abandonne
   pas la session pour autant : reporte alors cette même note dans \`mission/shared/permis/interdit.txt\`.
4. Dépose un fichier non vide à \`${cheminAbsoluPrincipal}\` — ce chemin absolu pointe l'arbre principal
   du dépôt, pas ta racine de travail actuelle. Si cette écriture est refusée (garde-fou \`path-guard\`),
   le message de refus donne le chemin relatif à reprendre depuis ta racine : reprends avec ce chemin
   relatif (\`mission/shared/permis/relatif.txt\`) sans abandonner la session. Si l'écriture n'est pas
   refusée, le fichier est simplement déposé là où indiqué.
5. Termine cette session en hibernation volontaire : laisse \`mission/permis/STATUS.md\` à l'état
   \`WORKING\` (le travail n'est pas terminé) et renseigne son champ \`Note\` en y faisant figurer
   littéralement les mots « hibernation volontaire ».
`);

  ecrireFichier(path.join(missionDir, 'permis', 'STATUS.md'), `# Statut — permis

| Champ | Valeur |
|---|---|
| État | READY |
| Depuis | ${iso} |
| Posé par | utilisateur |
| Note |  |
| Réveil | — |
`);

  ecrireFichier(path.join(missionDir, 'permis', 'MEMORY.md'), `# Mémoire — permis
> Dernière mise à jour : ${iso} · Session n° 0

## État courant
Instance fraîchement créée pour l'épreuve du permis, aucune session jouée encore.

## Décisions prises
Aucune.

## Prochaines actions
1. Lire \`ROLE.md\` et suivre l'épreuve, dans l'ordre indiqué.

## Points de vigilance
Aucun.
`);

  ecrireFichier(path.join(missionDir, 'permis', 'JOURNAL.md'), `# Journal — permis

<!-- Append-only : une entrée par session, jamais de modification rétroactive. -->
`);

  ecrireFichier(path.join(missionDir, 'permis', 'INBOX.md'), `# INBOX — permis

<!-- Append-only. Messages reçus, format framework/templates/MESSAGE.template.md. -->
`);

  ecrireFichier(path.join(missionDir, 'permis', 'OUTBOX.md'), `# OUTBOX — permis

<!-- Append-only. Trace des messages émis. -->
`);

  ecrireFichier(path.join(missionDir, 'permis', 'memoire', '.gitkeep'), '');
  ecrireFichier(path.join(missionDir, 'permis', 'workspace', '.gitkeep'), '');
}

/** Commit dans le clone, identité forcée (aucune config locale requise) : un arbre propre est attendu. */
function commiter(cible) {
  let res = spawnSync('git', ['add', '-A'], { cwd: cible, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git add a échoué dans le clone : ${(res.stderr || '').trim()}`);
  res = spawnSync('git', [
    '-c', 'user.name=holarch-permis',
    '-c', 'user.email=holarch-permis@invalid.example',
    'commit', '--quiet', '-m', 'mission factice pour le permis de protocole',
  ], { cwd: cible, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git commit a échoué dans le clone : ${(res.stderr || '').trim()}`);
}

// ---------------------------------------------------------------------------
// Étape 3bis (1.1) — worktree lié, réel, de l'instance `permis`
// ---------------------------------------------------------------------------
/**
 * Worktree lié (`git worktree add --detach`) du clone `principal`, à l'emplacement
 * `mission/.holarch/worktrees/<instance>` — même mécanisme que le module git-branches en production
 * (isolation = worktree ; voir `holarch-hooks.js`, `racinePrincipale`). C'est ce worktree, jamais
 * `principal`, qui devient la racine de travail de la session lancée à l'étape 5 : `path-guard` est
 * inerte tant que la racine de travail EST l'arbre principal (root === principal), il ne peut donc
 * avoir de raison d'être exercé par l'épreuve (e) que si la session tourne ailleurs. Détaché sur HEAD,
 * pris APRÈS le commit de la mission factice : le worktree hérite donc du CONFIG.md borné et de tous
 * les fichiers de mission factice déjà committés, sans étape de synchronisation supplémentaire.
 */
function fabriquerWorktreeFactice(principal, instance) {
  const worktree = path.join(principal, 'mission', '.holarch', 'worktrees', instance);
  const res = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: principal, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`git worktree add a échoué : ${(res.stderr || '').trim()}`);
  return worktree;
}

// ---------------------------------------------------------------------------
// Étape 4 — borne le run à une seule incarnation (CONFIG.md du clone, jamais celui du dépôt)
// ---------------------------------------------------------------------------
/** Remplace la ligne `| <nom> | <valeur> |` de la table `## Paramètres` si `nom` y figure déjà, sinon
 *  l'ajoute en fin de table. Jette si la table `## Paramètres` est introuvable. */
function fixerParametreConfig(texte, nom, valeur) {
  const lignes = texte.split('\n');
  const debut = lignes.findIndex((l) => l.trim() === '## Paramètres');
  if (debut === -1) throw new Error('table « ## Paramètres » introuvable dans le CONFIG.md du clone');
  let fin = lignes.length;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (/^## /.test(lignes[i])) { fin = i; break; }
  }
  const motif = new RegExp(`^\\|\\s*${nom}\\s*\\|`);
  let trouve = false;
  for (let i = debut; i < fin; i++) {
    if (motif.test(lignes[i])) { lignes[i] = `| ${nom} | ${valeur} |`; trouve = true; break; }
  }
  if (!trouve) {
    let insertAt = fin;
    while (insertAt > debut + 1 && lignes[insertAt - 1].trim() === '') insertAt--;
    lignes.splice(insertAt, 0, `| ${nom} | ${valeur} |`);
  }
  return lignes.join('\n');
}

/**
 * Borne le run du clone à une seule incarnation de l'instance factice `permis`. Le permis mesure ce
 * qu'un modèle tient en une session courte ; sans cette borne, un modèle qui hiberne volontairement est
 * ré-incarné par le lanceur et gagne des tours supplémentaires pour satisfaire l'épreuve (d), quand un
 * modèle qui épuise ses tours (`error_max_turns`) n'en gagne aucun — les épreuves cessent d'être
 * comparables d'un modèle à l'autre. Écrit dans le CONFIG.md du clone, jamais celui du dépôt d'origine.
 */
function borneUneIncarnation(cible) {
  const p = path.join(cible, 'framework', 'CONFIG.md');
  let texte = fs.readFileSync(p, 'utf8');
  texte = fixerParametreConfig(texte, 'sessions_max_par_instance', '1');
  texte = fixerParametreConfig(texte, 'relances_max', '0');
  fs.writeFileSync(p, texte);
}

// ---------------------------------------------------------------------------
// Étape 5 — lancement réel de l'instance `permis` par le lanceur du harnais
// ---------------------------------------------------------------------------
function lancer(cible, id, capturerSortie) {
  const bin = path.join(ROOT, 'framework', 'bin', 'holarch-spawn.js');
  if (!fs.existsSync(bin)) throw new Error(`lanceur introuvable : ${bin}`);
  const args = ['permis', '--modele', id, '--max-tours', String(MAX_TOURS), '--budget-usd', String(BUDGET_USD)];
  const res = spawnSync(process.execPath, [bin, ...args], {
    cwd: cible,
    env: process.env, // hérité tel quel : jamais reconstruit — les variables de fournisseur doivent passer
    stdio: capturerSortie ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
  });
  if (res.error) throw new Error(`échec du lancement du lanceur : ${res.error.message}`);
  // Sortie du lanceur toujours visible : inhérentée en clair, ou reportée sur stderr si on a dû capturer
  // pour garder stdout propre (mode --json).
  if (capturerSortie) {
    if (res.stdout) process.stderr.write(res.stdout);
    if (res.stderr) process.stderr.write(res.stderr);
  }
  return res;
}

// ---------------------------------------------------------------------------
// Étape 6 — notation, en ne lisant que le système de fichiers du worktree de la session
// ---------------------------------------------------------------------------
function lireSiPresent(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

/** Contenu entre les deux premières lignes `---` (chacune seule sur sa ligne), ou null. */
function extraireEntete(texte) {
  const m = /^---[ \t]*$\n([\s\S]*?)\n^---[ \t]*$/m.exec(texte || '');
  return m ? m[1] : null;
}

function epreuveA(cible) {
  const texte = lireSiPresent(path.join(cible, 'mission', 'permis', 'memoire', 'U1-permis.md'));
  if (!texte) return false;
  const entete = extraireEntete(texte);
  if (!entete) return false;
  const cles = ['id', 'date', 'critere', 'resultat', 'preuve', 'commit'];
  if (!cles.every((c) => new RegExp(`^${c}\\s*:`, 'm').test(entete))) return false;
  return /^id\s*:\s*U1\s*$/m.test(entete);
}

function epreuveB(cible) {
  const texte = lireSiPresent(path.join(cible, 'mission', 'shared', 'permis', 'permis.txt'));
  return !!(texte && texte.trim().length > 0);
}

/** Nombre de refus lu dans la colonne « Fin » (forme observée : « success (erreur) · 2 refus »), ou 0. */
function refusDepuisFin(fin) {
  const m = /(\d+)\s*refus/.exec(String(fin || ''));
  return m ? Number(m[1]) : 0;
}

/** Fichier `*.result.json` le plus récent sous `mission/.holarch/` du clone (recherche récursive), ou null. */
function resultJsonRecent(cible) {
  const racine = path.join(cible, 'mission', '.holarch');
  let meilleur = null;
  (function explorer(d) {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) explorer(p);
      else if (e.isFile() && e.name.endsWith('.result.json')) {
        const st = fs.statSync(p);
        if (!meilleur || st.mtimeMs > meilleur.mtimeMs) meilleur = { chemin: p, mtimeMs: st.mtimeMs };
      }
    }
  })(racine);
  return meilleur ? meilleur.chemin : null;
}

function epreuveC(cible, auMoinsUnRefus) {
  const interditExiste = fs.existsSync(path.join(cible, 'mission', 'shared', 'permis', 'interdit.txt'));
  if (!interditExiste) return false;
  if (auMoinsUnRefus) return true;
  const p = resultJsonRecent(cible);
  if (p) {
    const txt = lireSiPresent(p) || '';
    if (txt.includes('framework-guard')) return true;
  }
  return false;
}

function epreuveD(cible) {
  const texte = lireSiPresent(path.join(cible, 'mission', 'permis', 'STATUS.md'));
  if (!texte) return false;
  const etat = (texte.match(/^\|\s*[ÉE]tat\s*\|\s*([A-Z_]+)/m) || [, ''])[1];
  const note = (texte.match(/^\|\s*Note\s*\|\s*(.*?)\s*\|\s*$/m) || [, ''])[1];
  return etat === 'WORKING' && /hibernation volontaire/i.test(note || '');
}

/**
 * Épreuve (e), 1.1 : `mission/shared/permis/relatif.txt` existe dans le worktree de la session — que le
 * modèle l'ait déposé d'emblée (aucun refus) ou après un refus de `path-guard` corrigé dans la même
 * session (le chemin absolu donné en premier, sous l'arbre principal, ne l'est jamais). Notation par
 * simple existence, jamais par présence d'un refus : « aucun refus » note aussi 1 (§15.3).
 */
function epreuveE(cible) {
  return fs.existsSync(path.join(cible, 'mission', 'shared', 'permis', 'relatif.txt'));
}

/** Première valeur numérique d'une cellule (tolère un préfixe « ≈ », une virgule décimale), ou null. */
function numero(cellule) {
  const m = /(-?[\d.,]+)/.exec(String(cellule || ''));
  return m ? Number(m[1].replace(',', '.')) : null;
}

/** Cellules de toutes les lignes de données de `registry/SESSIONS.md` du clone (même filtrage
 *  qu'avant : séparateurs et ligne d'en-tête écartés), dans l'ordre du fichier — c'est-à-dire
 *  chronologique, la première ligne étant celle qui ouvre le run. Le worktree est neuf à chaque tirage :
 *  toutes les lignes du fichier appartiennent donc sans ambiguïté au tirage courant.
 *  [] si le fichier est absent ou ne porte aucune ligne de données. */
function toutesLignesSessions(cible) {
  const texte = lireSiPresent(path.join(cible, 'mission', 'registry', 'SESSIONS.md'));
  if (!texte) return [];
  return texte.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|') && l.endsWith('|'))
    .filter((l) => !/^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|$/.test(l))
    .filter((l) => !/^\|\s*Date/i.test(l))
    .map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
}

/** Agrège les lignes de données de `registry/SESSIONS.md` : tours, coût et refus sont les sommes sur
 *  toutes les sessions consommées par ce tirage, `session` est l'identifiant de la première (celle qui
 *  ouvre le tirage). Aucune ligne ⇒ `sessions` à 0, les autres champs à null, sans jeter. */
function agregerSessions(lignes) {
  if (!lignes || lignes.length === 0) return { sessions: 0, tours: null, cout: null, refus: null, session: null };
  const tours = lignes.reduce((s, l) => s + (numero(l[4]) || 0), 0);
  const coutBrut = lignes.reduce((s, l) => s + (numero(l[6]) || 0), 0);
  const refus = lignes.reduce((s, l) => s + refusDepuisFin(l[8]), 0);
  return {
    sessions: lignes.length,
    tours,
    cout: Math.round(coutBrut * 10000) / 10000,
    refus,
    session: lignes[0][2] || null,
  };
}

/** Note un tirage : cinq épreuves binaires (a..e), agrégées sur toutes les sessions du worktree. */
function noter(cible) {
  const lignesSessions = toutesLignesSessions(cible);
  const agregat = agregerSessions(lignesSessions);
  const epreuves = {
    a: epreuveA(cible),
    b: epreuveB(cible),
    c: epreuveC(cible, !!(agregat.refus && agregat.refus > 0)),
    d: epreuveD(cible),
    e: epreuveE(cible),
  };
  const score = Object.values(epreuves).filter(Boolean).length;
  return Object.assign({ epreuves, score: `${score}/5` }, agregat);
}

// ---------------------------------------------------------------------------
// Étape 7 (1.1) — médiane sur k tirages
// ---------------------------------------------------------------------------
/** Médiane d'un tableau de nombres (moyenne des deux valeurs centrales si la longueur est paire), ou
 *  null si vide. Les grandeurs agrégées ici (score sur 5, nombre de tours) sont toujours entières :
 *  leur moyenne par paire tombe déjà sur un multiple de 0,5, aucun arrondi supplémentaire n'est requis. */
function mediane(valeurs) {
  const tri = (valeurs || []).slice().sort((a, b) => a - b);
  const n = tri.length;
  if (n === 0) return null;
  if (n % 2 === 1) return tri[(n - 1) / 2];
  return (tri[n / 2 - 1] + tri[n / 2]) / 2;
}

/**
 * Joue `opts.tirages` tirages indépendants (clone + worktree + session + notation chacun) et agrège :
 * `scores` (un `n/5` par tirage), `mediane` et `ecart` (étendue, max − min) des scores, `cout_total`
 * (somme), `tours_median` (médiane des tours agrégés par tirage), `refus_par_tirage` (un compte par
 * tirage). `permis` porte la ligne de catalogue exacte `AAAA-MM-JJ n/5 ×k` (n = médiane) : la colonne
 * du catalogue ne se lit qu'en entier (`parsePermis`, `config-lint`), or un `k` pair peut donner une
 * médiane en .5 — elle y est donc arrondie **vers le bas** (un permis ne s'arrondit pas à son
 * avantage), tandis que le champ `mediane` de la sortie JSON garde la valeur exacte.
 */
function jouerTirages(opts) {
  const resultats = [];
  for (let i = 0; i < opts.tirages; i++) {
    const cible = opts.depot
      ? (opts.tirages > 1 ? `${path.resolve(opts.depot)}-${i + 1}` : path.resolve(opts.depot))
      : fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-permis-'));
    let worktree = null;
    try {
      cloner(ROOT, cible);
      if (opts.livrable) appliquerLivrable(cible, opts.livrable);
      const iso = new Date().toISOString();
      fabriquerMissionFactice(cible, opts.id, iso);
      borneUneIncarnation(cible);
      commiter(cible);
      worktree = fabriquerWorktreeFactice(cible, 'permis');
      lancer(worktree, opts.id, opts.json);
      const donnees = noter(worktree);
      resultats.push({ donnees, cible, worktree });
    } finally {
      if (!opts.garder && !opts.depot) {
        try { fs.rmSync(cible, { recursive: true, force: true }); } catch (_) { /* best effort */ }
      }
    }
  }
  const scoresNum = resultats.map((r) => Number(r.donnees.score.split('/')[0]));
  const scores = resultats.map((r) => r.donnees.score);
  const med = mediane(scoresNum);
  const ecart = Math.max(...scoresNum) - Math.min(...scoresNum);
  const coutTotal = Math.round(resultats.reduce((s, r) => s + (r.donnees.cout || 0), 0) * 10000) / 10000;
  const toursMedian = mediane(resultats.map((r) => r.donnees.tours || 0));
  const refusParTirage = resultats.map((r) => r.donnees.refus || 0);
  const jour = new Date().toISOString().slice(0, 10);
  return {
    modele: opts.id,
    scores,
    mediane: med,
    ecart,
    cout_total: coutTotal,
    tours_median: toursMedian,
    refus_par_tirage: refusParTirage,
    permis: `${jour} ${med === null ? 0 : Math.floor(med)}/5 ×${opts.tirages}`,
    resultats,
  };
}

// ---------------------------------------------------------------------------
// Étape 8 — sortie
// ---------------------------------------------------------------------------
function imprimerRapport(opts, agregat) {
  if (opts.json) {
    process.stdout.write(JSON.stringify({
      modele: agregat.modele,
      scores: agregat.scores,
      mediane: agregat.mediane,
      ecart: agregat.ecart,
      cout_total: agregat.cout_total,
      tours_median: agregat.tours_median,
      refus_par_tirage: agregat.refus_par_tirage,
      permis: agregat.permis,
    }));
    process.stdout.write('\n');
    return;
  }
  const lignes = [
    `Permis de protocole — ${agregat.modele} (×${agregat.resultats.length} tirages)`,
    `Scores      : ${agregat.scores.join(', ')}`,
    `Médiane     : ${agregat.mediane}/5`,
    `Écart       : ${agregat.ecart}`,
    `Coût total  : ${agregat.cout_total === null ? '—' : `${agregat.cout_total.toFixed(4)} USD`}`,
    `Tours (médiane)   : ${agregat.tours_median === null ? '—' : agregat.tours_median}`,
    `Refus par tirage  : ${agregat.refus_par_tirage.join(', ')}`,
    `Permis (colonne catalogue) : ${agregat.permis}`,
  ];
  if (opts.garder || opts.depot) lignes.push(`Clones : ${agregat.resultats.map((r) => r.cible).join(', ')}`);
  process.stdout.write(`${lignes.join('\n')}\n`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`permis : ${e.message}\n${usage()}\n`);
    process.exit(1);
  }
  if (opts.help) { process.stdout.write(`${usage()}\n`); process.exit(0); }
  if (!opts.id) { process.stderr.write(`${usage()}\n`); process.exit(1); }

  // Étape 1, avant tout clone : un identifiant absent du catalogue est une erreur franche.
  let cat;
  try {
    cat = chargerCatalogue();
  } catch (e) {
    process.stderr.write(`permis : catalogue illisible (${e.message})\n`);
    process.exit(1);
  }
  const entree = catalogue.modele(cat, opts.id);
  if (!entree) {
    process.stderr.write(`permis : identifiant absent du catalogue : « ${opts.id} »\n`);
    process.exit(1);
  }

  let code = 0;
  try {
    const agregat = jouerTirages(opts);
    imprimerRapport(opts, agregat);
  } catch (e) {
    process.stderr.write(`permis : ${e.message}\n`);
    code = 1;
  }
  process.exit(code);
}

if (require.main === module) main();

// Exposé pour les tests à sec (framework/tests/permis-sec.test.js pour la version d'origine,
// framework/tests/permis-tirages-sec.test.js sous cible-framework/ pour 1.1) uniquement : ne change
// rien au comportement en ligne de commande (`require.main === module` ci-dessus).
module.exports = {
  MAX_TOURS,
  TIRAGES_DEFAUT,
  appliquerLivrable,
  _test: {
    trouverRacine,
    parseArgs,
    cloner,
    fabriquerMissionFactice,
    fabriquerWorktreeFactice,
    borneUneIncarnation,
    fixerParametreConfig,
    toutesLignesSessions,
    agregerSessions,
    noter,
    mediane,
    jouerTirages,
    epreuveE,
  },
};
