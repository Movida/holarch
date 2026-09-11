'use strict';
// Socle partagé des trois outils de maintenance (tools/holarch-maintenance/{promote,archive,open}.js).
// Node ≥ 18, aucune dépendance.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/** Wrapper spawnSync : jamais `exec` (pas d'injection shell). Ne lève que si options.doitReussir et
 *  code !== 0. */
function executer(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  const resultat = { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  if (options.doitReussir && resultat.code !== 0) {
    throw new Error(`${cmd} ${args.join(' ')} a échoué (code ${resultat.code}) : ${resultat.stderr}`);
  }
  return resultat;
}

/** `git status --porcelain`, filtre les chemins sous `exclusions` (ex. "mission/"). Retourne
 *  {propre, sales} — sales = chemins encore sales après filtrage, pour un message de refus explicite. */
function arbrePropre(cheminDepot, exclusions = []) {
  const r = executer('git', ['status', '--porcelain'], { cwd: cheminDepot });
  const lignes = r.stdout.split('\n').filter(Boolean);
  const sales = lignes
    .map((l) => l.slice(3))
    .filter((p) => !exclusions.some((ex) => p === ex || p.startsWith(ex.endsWith('/') ? ex : `${ex}/`)));
  return { propre: sales.length === 0, sales };
}

/** Tâches détachées connues du lanceur (mission/.holarch/tasks/*.json, même registre que
 *  `listTaches()` dans framework/bin/holarch-spawn.js) : vivante si state === 'running' et le pid
 *  répond (process.kill(pid, 0) ne lève pas ESRCH). Retourne {vivante, taches}. */
function tacheDetacheeVivante(cheminMission) {
  const dir = path.join(cheminMission, 'mission', '.holarch', 'tasks');
  let fichiers;
  try { fichiers = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_) { fichiers = []; }
  const vivantes = [];
  for (const f of fichiers) {
    let t;
    try { t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (_) { continue; }
    if (!t || t.state !== 'running' || !t.pid) continue;
    try { process.kill(t.pid, 0); vivantes.push(t); } catch (_) { /* pid mort */ }
  }
  return { vivante: vivantes.length > 0, taches: vivantes };
}

/** Processus `holarch-spawn.js`/`claude -p` de mission en cours. Même régime que
 *  `missionEnCours()` de tools/holarch-session/garde.js (déjà éprouvé dans ce dépôt) : `ps -eo
 *  pid,args`, injectable par `psText` pour les tests (jamais d'appel `ps` réel en test). */
function processusMissionVivant(psText, cheminDepot) {
  if (psText === undefined && cheminDepot) {
    // Maintenance 1.12.0 : restreint au dépôt courant — un balayage `ps` global refusait l'archivage dès qu'une mission
    // tournait dans un autre clone du conteneur (rejeu du 2026-09-11). Les verrous de vivacité du lanceur
    // (mission/.holarch/live/*.json, pid) sont propres à ce dépôt ; les tâches détachées sont vues par tacheDetacheeVivante.
    const dir = path.join(cheminDepot, 'mission', '.holarch', 'live');
    let fichiers;
    try { fichiers = fs.readdirSync(dir).filter((f) => f.endsWith('.json') && !f.endsWith('.contexte.json')); } catch (_) { return false; }
    return fichiers.some((f) => {
      try { const v = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); process.kill(v.pid, 0); return true; } catch (_) { return false; }
    });
  }
  const texte = psText !== undefined ? psText : (executer('ps', ['-eo', 'pid,args']).stdout || '');
  return String(texte).split('\n').some((l) => /holarch-spawn\.js|claude -p\b/.test(l) && !/--replay-user-messages|grep/.test(l));
}

/** Nom de mission : ligne de titre `# Configuration — mission : <nom>` (forme réelle de tout CONFIG.md, écrite par
 *  open.js et les presets), puis `nom_mission` ou `Nom` en table (maintenance 1.12.0 : archive.js ne lisait que la
 *  table, absente des CONFIG réels). */
function lireNomMission(cheminConfig) {
  let texte;
  try { texte = fs.readFileSync(cheminConfig, 'utf8'); } catch (_) { return null; }
  const m = texte.match(/^# Configuration — mission : (.+?)\s*$/m);
  if (m) return m[1].trim();
  return lireParamMission(cheminConfig, 'nom_mission') || lireParamMission(cheminConfig, 'Nom');
}

/** Extrait une valeur de la table `CONFIG.md` (ligne `| <cle> | <valeur> |`) par une regex
 *  ligne-à-ligne — pas de parseur markdown général. Retourne la valeur (chaîne) ou null si absente. */
function lireParamMission(cheminConfig, cle) {
  let texte;
  try { texte = fs.readFileSync(cheminConfig, 'utf8'); } catch (_) { return null; }
  const cleEchappee = cle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^\\|\\s*${cleEchappee}\\s*\\|\\s*(.*?)\\s*\\|\\s*$`, 'm');
  const m = texte.match(re);
  return m ? m[1] : null;
}

/** Insertion idempotente de `texte` juste après la première ligne contenant `ancre`. No-op (retourne
 *  false) si `texte` est déjà présent dans le fichier. Retourne true si une écriture a eu lieu. */
function insererSquelette(cheminFichier, ancre, texte, options = {}) {
  const contenu = fs.readFileSync(cheminFichier, 'utf8');
  const lignes = contenu.split('\n');
  const idx = trouverAncre(lignes, ancre, options);
  if (idx === -1) throw new Error(`ancre introuvable dans ${cheminFichier} : ${String(ancre)}`);
  // Idempotence locale : le texte est déjà à l'emplacement visé (et non « quelque part dans le fichier » — un document
  // qui cite le marqueur `<!-- à relire -->` dans sa prose empêchait l'insertion, archivage réel du 2026-09-11).
  const dejaLa = options.avant ? lignes[idx - 1] === texte : lignes[idx + 1] === texte;
  if (dejaLa) return false;
  lignes.splice(options.avant ? idx : idx + 1, 0, texte);
  fs.writeFileSync(cheminFichier, lignes.join('\n'));
  return true;
}

/** Ancre = chaîne (ligne qui la contient) ou RegExp (ligne qui la vérifie) ; `null` = fin du fichier (dernière ligne
 *  non vide). options.dernier : dernière ligne correspondante plutôt que la première. Retourne l'indice ou -1. */
function trouverAncre(lignes, ancre, options = {}) {
  if (ancre === null) { let i = lignes.length - 1; while (i > 0 && lignes[i].trim() === '') i--; return i; }
  const test = ancre instanceof RegExp ? (l) => ancre.test(l) : (l) => l.includes(ancre);
  if (options.dernier) { for (let i = lignes.length - 1; i >= 0; i--) if (test(lignes[i])) return i; return -1; }
  return lignes.findIndex(test);
}

/** Vérifie toutes les ancres AVANT la première écriture (maintenance 1.12.0 : archive.js avait déjà posé le tag et fait
 *  le `git mv` quand une ancre manquait). Retourne la liste des {fichier, ancre} introuvables (vide = tout est là). */
function verifierAncres(liste) {
  const manquantes = [];
  for (const { fichier, ancre, options } of liste) {
    let lignes;
    try { lignes = fs.readFileSync(fichier, 'utf8').split('\n'); } catch (_) { manquantes.push({ fichier, ancre }); continue; }
    if (trouverAncre(lignes, ancre, options || {}) === -1) manquantes.push({ fichier, ancre });
  }
  return manquantes;
}

/** `git add -A -- <cibles...>` ciblé (jamais un `add -A` global sans pathspec) puis `git commit -m
 *  message`. `cibles` doit contenir au moins un pathspec explicite. */
function commitStandard(cheminDepot, cibles, message) {
  if (!Array.isArray(cibles) || cibles.length === 0) {
    throw new Error('commitStandard : au moins un pathspec explicite est requis (jamais un add -A global)');
  }
  executer('git', ['add', '-A', '--', ...cibles], { cwd: cheminDepot, doitReussir: true });
  return executer('git', ['commit', '-m', message], { cwd: cheminDepot, doitReussir: true });
}

module.exports = {
  executer,
  arbrePropre,
  tacheDetacheeVivante,
  processusMissionVivant,
  lireParamMission,
  lireNomMission,
  insererSquelette,
  trouverAncre,
  verifierAncres,
  commitStandard,
};
