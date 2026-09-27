'use strict';
// Mode « solo d'abord » (diagnostic du 2026-09-27, docs/diagnostics/2026-09-27-refonte-apres-releves.md).
// Une seule instance fait le travail ; le lanceur la crée lui-même (pas de session de bootstrap), lui injecte un
// contrat court (framework/SOLO.md), et fait éprouver sa livraison par une instance neuve (contre-épreuve).
// Ce module ne dépend que de fs/path : il est requis par le lanceur, les hooks et config-lint.

const fs = require('fs');
const path = require('path');

const RACINE = 'concepteur';
const VERIFICATEUR = 'contre-epreuve';

/** `mode = solo` dans la table Paramètres (défaut : equipe, comportement 1.27). */
function estSolo(cfg) { return !!(cfg && cfg.params && String(cfg.params.mode || '').trim() === 'solo'); }

/** Contre-épreuve active : solo et `contre_epreuve` ≠ non (défaut oui en solo). */
function contreEpreuveActive(cfg) {
  return estSolo(cfg) && String((cfg.params && cfg.params.contre_epreuve) || 'oui').trim() !== 'non';
}
function contreEpreuveMax(cfg) {
  const n = Number(cfg && cfg.params && cfg.params.contre_epreuve_max);
  return Number.isInteger(n) && n >= 1 ? n : 2;
}

/** `livraison_hors_mission` : entrées séparées par `;` ou `,`, chacune `chemin` ou `chemin@instance[+instance…]`.
 *  Sans `@`, l'entrée vaut pour la racine seulement. Retourne `[{ chemin, instances }]`. */
function livraisonHorsMission(valeur) {
  return String(valeur || '').split(/[;,]/).map((e) => e.trim().replace(/^`+|`+$/g, '')).filter((e) => e && e !== '—' && e !== '-')
    .map((e) => {
      const i = e.lastIndexOf('@');
      const chemin = (i === -1 ? e : e.slice(0, i)).trim().replace(/^\.\//, '').replace(/\/+$/, '');
      const instances = i === -1 ? [RACINE] : e.slice(i + 1).split('+').map((x) => x.trim()).filter(Boolean);
      return { chemin, instances };
    });
}

/** true si `rel` (relatif à la racine du dépôt) est ouvert à `instance` par le paramètre. Correspondance par
 *  préfixe de répertoire : `src` couvre `src` et `src/…`, jamais `srcx`. */
function cheminLivrable(entrees, rel, instance) {
  const r = String(rel || '').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!r || r.split('/').includes('..')) return false;
  return entrees.some((e) => e.chemin && e.instances.includes(instance) && (r === e.chemin || r.startsWith(`${e.chemin}/`)));
}

// ---------------------------------------------------------------------------------------------------------------
// Création de la racine sans session LLM : les fichiers que BOOTSTRAP.md faisait écrire au modèle (2,38 USD et 42
// appels dans l'expérience « relevés ») sont déterministes en solo.
// ---------------------------------------------------------------------------------------------------------------
function ecrireSiAbsent(f, contenu) {
  if (fs.existsSync(f)) return false;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, contenu);
  return true;
}

function fichiersInstance(chemin, role, quand, poseur) {
  return {
    'ROLE.md': role,
    'STATUS.md': `# Statut — ${chemin}\n\n| Champ | Valeur |\n|---|---|\n| État | INIT |\n| Depuis | ${quand} |\n| Posé par | ${poseur} |\n| Note | — |\n| Réveil | — |\n`,
    'MEMORY.md': `# Mémoire — ${chemin}\n> Dernière mise à jour : ${quand} · Session n° 0\n\n## État courant\nInstance créée par le lanceur, jamais incarnée.\n\n## Prochaines actions\n1. Cadrage (SOLO.md §2).\n`,
    'JOURNAL.md': `# Journal — ${chemin}\n\n<!-- Une ligne par session, ajoutée en fin de fichier (SOLO.md §4). -->\n`,
    'INBOX.md': `# INBOX — ${chemin}\n\n<!-- Append-only. Messages de l'utilisateur et du lanceur (contre-épreuve). -->\n`,
    'OUTBOX.md': `# OUTBOX — ${chemin}\n\n<!-- Append-only. Messages à l'utilisateur (livraison, blocage). -->\n`,
  };
}

function fiche(chemin, role, profil, parent, quand) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Rôle | ${role} |\n| Parent | ${parent} |\n| Statut | INIT |\n| Budget alloué / consommé | 0 / 0 |\n| Dépend de | — |\n| Profil | ${profil} |\n| Livrables | |\n| Créée / Archivée | ${quand} / — |\n`;
}

/** Crée la racine solo (idempotent). Retourne la liste des fichiers écrits, relatifs à `root`. */
function creerRacineSolo(root, nomMission, quand) {
  const ecrits = [];
  const w = (rel, c) => { if (ecrireSiAbsent(path.join(root, rel), c)) ecrits.push(rel); };
  const role = `# Rôle : ${RACINE} — instance unique de la mission ${nomMission}\n> Créée par : lanceur (mode solo) · ${quand}\n\n` +
    `Tu fais **tout** le travail décrit par \`mission/OBJECTIVE.md\` (injecté à chaque réveil), jusqu'au livrable\n` +
    `final. Ton contrat est \`framework/SOLO.md\`. Tu rends compte à l'utilisateur par \`OUTBOX.md\`.\n`;
  for (const [f, c] of Object.entries(fichiersInstance(RACINE, role, quand, 'lanceur (mode solo)'))) w(`mission/${RACINE}/${f}`, c);
  w(`mission/registry/instances/${RACINE}.md`, fiche(RACINE, `instance unique de la mission ${nomMission}`, 'conception', 'utilisateur', quand));
  w('mission/registry/ORG.md', `# Organigramme — mission ${nomMission}\n\n- ${RACINE} — INIT (mode solo)\n`);
  w('mission/registry/DECISIONS.md', `# Décisions — mission ${nomMission}\n\n<!-- Append-only. -->\n`);
  w('mission/shared/.gitkeep', '');
  return ecrits;
}

// ---------------------------------------------------------------------------------------------------------------
// Contre-épreuve. Revue du 2026-09-27 : un filtre de chemins ne ferme ni un glob Bash, ni `grep -r`, ni `git log -p`.
// Les cas cachés ne vivent donc jamais dans un fichier suivi : le vérificateur travaille dans TRAVAIL (sous
// mission/.holarch/, jamais committé), et le lanceur déplace ce répertoire hors du dépôt après chaque manche. Le compteur
// de manches qui fait foi est lui aussi hors du dépôt (la racine peut écrire partout sous mission/) ; le journal
// mission/registry/CONTRE-EPREUVES.md n'est qu'une trace lisible.
// ---------------------------------------------------------------------------------------------------------------
const os = require('os');
const { spawnSync } = require('child_process');
const TRAVAIL = 'mission/.holarch/contre-epreuve';

/** Clé stable de la mission : nom + commit qui a créé la racine (une mission neuve repart de zéro). */
function cleMission(root, nomMission) {
  const r = spawnSync('git', ['-C', root, 'log', '--diff-filter=A', '--format=%h', '--', `mission/${RACINE}/ROLE.md`], { encoding: 'utf8' });
  const sha = r.status === 0 ? (r.stdout.trim().split('\n').pop() || 'sans-commit') : 'sans-git';
  let reel = root;
  try { reel = fs.realpathSync(root); } catch (_) { /* tel quel */ }
  const h = require('crypto').createHash('sha1').update(reel).digest('hex').slice(0, 8);
  return `${String(nomMission || 'mission').replace(/[^A-Za-z0-9._-]+/g, '-')}-${sha}-${h}`;
}
/** Répertoire hors du dépôt : état de la contre-épreuve et cas archivés. `HOLARCH_CONTRE_EPREUVES` le déplace (tests). */
function etatDir(root, nomMission) {
  const base = process.env.HOLARCH_CONTRE_EPREUVES || path.join(os.homedir(), '.holarch', 'contre-epreuves');
  return path.join(base, cleMission(root, nomMission));
}
function lireEtat(root, nomMission) {
  try { return JSON.parse(fs.readFileSync(path.join(etatDir(root, nomMission), 'etat.json'), 'utf8')); } catch (_) { return { manches: [] }; }
}
function ecrireEtat(root, nomMission, etat) {
  const d = etatDir(root, nomMission);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'etat.json'), `${JSON.stringify(etat, null, 2)}\n`);
}
/** Manches jouées (verdict ok, ko ou absent après une vraie session) : les manches « non jouées » ne comptent pas. */
function manchesJouees(root, nomMission) { return lireEtat(root, nomMission).manches.filter((m) => m.verdict !== 'non-joue').length; }

/** (Re)crée l'instance de contre-épreuve pour la manche `n` : fichiers d'instance réécrits, TRAVAIL vidé — elle ne
 *  sait rien des manches précédentes. Retourne les chemins à committer (jamais TRAVAIL). */
function preparerVerificateur(root, nomMission, n, quand, livrables) {
  const base = path.join(root, 'mission', VERIFICATEUR);
  const role = `# Rôle : ${VERIFICATEUR} — manche ${n}, mission ${nomMission}\n> Créée par : lanceur (mode solo) · ${quand}\n\n` +
    `Tu éprouves le produit de \`${RACINE}\` avec un regard neuf, **sans** son historique (\`mission/${RACINE}/\` t'est\n` +
    `interdit). Tu as l'énoncé (\`mission/OBJECTIVE.md\`, injecté) et le produit : \`mission/shared/\`${livrables ? ` et ${livrables}` : ''}.\n` +
    `Tu travailles dans \`${TRAVAIL}/\` (jamais committé). Procédure : \`framework/SOLO.md\` §6.\n`;
  fs.rmSync(base, { recursive: true, force: true });
  fs.mkdirSync(base, { recursive: true });
  for (const [f, c] of Object.entries(fichiersInstance(VERIFICATEUR, role, quand, `lanceur (contre-épreuve, manche ${n})`))) fs.writeFileSync(path.join(base, f), c);
  fs.rmSync(path.join(root, TRAVAIL), { recursive: true, force: true });
  fs.mkdirSync(path.join(root, TRAVAIL), { recursive: true });
  const f = path.join(root, 'mission', 'registry', 'instances', `${VERIFICATEUR}.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, fiche(VERIFICATEUR, `contre-épreuve du livrable de ${RACINE} (manche ${n})`, 'relecture', RACINE, quand));
  return [`mission/${VERIFICATEUR}`, `mission/registry/instances/${VERIFICATEUR}.md`];
}

/** Lit `TRAVAIL/VERDICT.md` : la **première ligne non vide** doit être `Verdict : ok|ko`. */
function lireVerdict(root) {
  let t;
  try { t = fs.readFileSync(path.join(root, TRAVAIL, 'VERDICT.md'), 'utf8'); } catch (_) { return null; }
  const premiere = (t.split('\n').find((l) => l.trim()) || '').trim();
  const m = premiere.match(/^(?:\*\*)?Verdict(?:\*\*)?\s*:\s*\**\s*(ok|ko)\b/i);
  return { verdict: m ? m[1].toLowerCase() : null, texte: t };
}

/** Déplace TRAVAIL hors du dépôt (`<etatDir>/manche-<n>`) : la racine ne pourra lire les cas par aucun moyen. */
function archiverTravail(root, nomMission, n) {
  const src = path.join(root, TRAVAIL);
  if (!fs.existsSync(src)) return null;
  const dst = path.join(etatDir(root, nomMission), `manche-${n}`);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try { fs.renameSync(src, dst); } catch (_) { fs.cpSync(src, dst, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); }
  return dst;
}

function journaliserManche(root, nomMission, entree) {
  const etat = lireEtat(root, nomMission);
  etat.manches.push(entree);
  ecrireEtat(root, nomMission, etat);
  const f = path.join(root, 'mission', 'registry', 'CONTRE-EPREUVES.md');
  if (!fs.existsSync(f)) fs.writeFileSync(f, '# Contre-épreuves — trace tenue par le lanceur (le compteur qui fait foi est hors du dépôt)\n\n| Manche | Date (UTC) | Verdict | Commit éprouvé | Synthèse |\n|---|---|---|---|---|\n');
  const syn = String(entree.synthese || '').replace(/\s+/g, ' ').replace(/\|/g, '/').slice(0, 300);
  fs.appendFileSync(f, `| ${entree.manche} | ${entree.date} | ${entree.verdict} | ${entree.sha || '—'} | ${syn || '—'} |\n`);
}

function ecrireStatusRacine(root, etat, quand, pose, note) {
  fs.writeFileSync(path.join(root, 'mission', RACINE, 'STATUS.md'), `# Statut — ${RACINE}\n\n| Champ | Valeur |\n|---|---|\n| État | ${etat} |\n| Depuis | ${quand} |\n| Posé par | ${pose} |\n| Note | ${note} |\n| Réveil | — |\n`);
}

/** Verdict ko avant la dernière manche : rapport agrégé dans l'INBOX, STATUS WORKING + note d'hibernation (la boucle
 *  du lanceur ré-incarne). Écriture du lanceur, pas de l'instance. */
function renvoyerALaRacine(root, n, quand, rapport) {
  fs.appendFileSync(path.join(root, 'mission', RACINE, 'INBOX.md'), `\n---\nid: MSG-contre-epreuve-${n}\nfrom: contre-epreuve\nto: ${RACINE}\ntype: ALERT\nref: —\ndate: ${quand}\norigine: harnais\n---\n**Contre-épreuve, manche ${n}.** ` +
    `Verdict **ko** : ta livraison ne tient pas sur des cas que tu n'as pas vus. Rapport agrégé de l'instance neuve\n(les cas eux-mêmes ne te sont pas montrés) :\n\n${String(rapport || '').trim().slice(0, 6000)}\n\n` +
    `Corrige la cause (généralise, ne vise pas ces cas), vérifie, puis livre de nouveau (SOLO.md §5).\n`);
  ecrireStatusRacine(root, 'WORKING', quand, `lanceur (contre-épreuve, manche ${n})`, `hibernation volontaire (contre-épreuve ko, manche ${n})`);
}

/** Fin sans acceptation (ko final, verdict absent, manche non jouée, manches épuisées) : la racine passe BLOCKED — une
 *  livraison non éprouvée ne ressemble jamais à un succès (code de sortie, observe, etat). */
function bloquerRacine(root, quand, note) {
  ecrireStatusRacine(root, 'BLOCKED', quand, 'lanceur (contre-épreuve)', note);
  try { fs.appendFileSync(path.join(root, 'mission', RACINE, 'OUTBOX.md'), `\n> [lanceur · ${quand}] ${note}\n`); } catch (_) { /* OUTBOX absent */ }
}

/** Ne garde du rapport du vérificateur que ce qui précède `## Cas`. */
function rapportAgrege(texte) {
  const t = String(texte || '');
  const i = t.search(/^##\s+Cas\b/im);
  return (i === -1 ? t : t.slice(0, i)).replace(/^.*\n/, '').trim();
}

module.exports = {
  RACINE, VERIFICATEUR, estSolo, contreEpreuveActive, contreEpreuveMax, livraisonHorsMission, cheminLivrable,
  creerRacineSolo, preparerVerificateur, lireVerdict, manchesJouees, journaliserManche, renvoyerALaRacine, rapportAgrege,
  TRAVAIL, etatDir, lireEtat, archiverTravail, bloquerRacine,
};
