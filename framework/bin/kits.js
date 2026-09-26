'use strict';
// Kits de domaine (chantier 17, docs/IMPLEMENTATION.md §17.2) : un kit est un répertoire framework/kits/<domaine>/
// (INDEX.md, references/, verificateurs/, prompts/). On l'attache par une ligne « Kits » — section « Contexte hérité »
// du ROLE.md (posée par le parent à ON_SPAWN, direct-spawn), ou section « Ressources » d'OBJECTIVE.md pour la racine.
// Le lanceur injecte l'INDEX.md de chaque kit attaché (bloc <kits>, après <reveil>) et refuse de lancer une instance
// dont un kit nommé est absent ; le dry-run les liste avec leur taille (ligne « blocs »). L'instance lit les pièces
// elle-même à ON_ORIENT (regles-du-metier), jamais tout le kit d'un coup.
const fs = require('fs');
const path = require('path');

const NOM_KIT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INDEX_MAX_CHARS = 8000; // config-lint --kits borne l'INDEX.md à 60 lignes ; ceci n'est qu'un filet
const LIGNE_KITS = /^\s*(?:[-*]\s*)?\**Kits\**\s*:\s*(.*)$/;

function lire(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return null; }
}

/** Lignes des sections `## <titre>` dont le titre commence par l'un de `titres`. */
function sections(texte, titres) {
  const out = [];
  let dedans = false;
  for (const l of String(texte || '').split('\n')) {
    if (/^## /.test(l)) { dedans = titres.some((t) => l.slice(3).trim().startsWith(t)); continue; }
    if (dedans) out.push(l);
  }
  return out;
}

/** Noms de la ligne « Kits » (`- Kits : media, video` ; gras, backticks et commentaire après le nom tolérés ;
 *  `—` ou `aucun` = aucun kit). Un nom qui n'est pas en kebab-case est rendu tel quel : c'est au refus de le dire. */
function nomsDesLignes(lignes) {
  const noms = [];
  for (const l of lignes) {
    const m = l.match(LIGNE_KITS);
    if (!m) continue;
    for (const brut of m[1].split(',')) {
      const n = brut.replace(/[`*]/g, '').trim().split(/\s+/)[0] || '';
      if (!n || /^(—|-|aucun)$/i.test(n)) continue;
      if (!noms.includes(n)) noms.push(n);
    }
  }
  return noms;
}

/** Kits attachés à une instance. `cwd` : sa racine de travail (worktree) ; `bootstrap` : racine pas encore créée. */
function kitsAttaches(root, chemin, opts) {
  const o = opts || {};
  const noms = [];
  const ajouter = (liste) => { for (const n of liste) if (!noms.includes(n)) noms.push(n); };
  if (!o.bootstrap) {
    const role = lire(path.join(o.cwd || root, 'mission', chemin, 'ROLE.md'));
    ajouter(nomsDesLignes(sections(role, ['Contexte hérité'])));
  }
  if (o.bootstrap || !String(chemin).includes('/')) {
    const obj = lire(path.join(root, 'mission', 'OBJECTIVE.md'));
    ajouter(nomsDesLignes(sections(obj, ['Ressources', 'Contexte hérité'])));
  }
  return noms;
}

/** `{ presents: [{ nom, rel, index }], absents: [{ nom, motif }] }` pour les kits attachés à l'instance. */
function resoudreKits(root, chemin, opts) {
  const presents = [];
  const absents = [];
  for (const nom of kitsAttaches(root, chemin, opts)) {
    if (!NOM_KIT.test(nom)) { absents.push({ nom, motif: 'nom invalide (kebab-case attendu)' }); continue; }
    const rel = `framework/kits/${nom}/INDEX.md`;
    const index = lire(path.join(root, rel));
    if (index === null) absents.push({ nom, motif: `${rel} introuvable` });
    else presents.push({ nom, rel, index });
  }
  return { presents, absents };
}

/** Bloc `<kits>` du prompt de réveil et sa pesée pour `--dry-run`, ou null si aucun kit présent. */
function blocKits(res) {
  if (!res.presents.length && !res.absents.length) return null;
  const parties = res.presents.map((k) => {
    const tronque = k.index.length > INDEX_MAX_CHARS;
    const note = tronque ? ` note="TRONQUÉ à ${INDEX_MAX_CHARS} caractères — relis ${k.rel}"` : '';
    const corps = (tronque ? k.index.slice(0, INDEX_MAX_CHARS) : k.index).replace(/\s+$/, '');
    return `<fichier chemin="${k.rel}"${note}>\n${corps}\n</fichier>`;
  });
  const entete = 'Kits de domaine attachés (ligne « Kits ») : lis les pièces utiles à ON_ORIENT, jamais tout le kit d\'un coup.';
  const texte = `<kits>\n${entete}\n${parties.join('\n')}\n</kits>`;
  const note = [
    ...res.presents.map((k) => `${k.nom} ${k.index.length}`),
    ...res.absents.map((k) => `${k.nom} ABSENT`),
  ].join(', ');
  return { texte: res.presents.length ? texte : null, chars: res.presents.reduce((s, k) => s + k.index.length, 0), note };
}

/** Message de refus au lancement, ou null. */
function refusKits(chemin, res) {
  if (!res.absents.length) return null;
  return `instance ${chemin} : kit(s) nommé(s) à la ligne « Kits » mais absent(s) — ${res.absents.map((a) => `« ${a.nom} » (${a.motif})`).join(' ; ')}. Corrige la ligne (ROLE.md, Contexte hérité ; OBJECTIVE.md, Ressources) ou crée le kit (framework/kits/<domaine>/, docs/IMPLEMENTATION.md §17.2).`;
}

module.exports = {
  NOM_KIT, INDEX_MAX_CHARS, sections, nomsDesLignes, kitsAttaches, resoudreKits, blocKits, refusKits,
};
