'use strict';
/**
 * Veille bornée (chantier 17, `docs/IMPLEMENTATION.md` §17.3) : une ligne `| Veille | <n> |` de la fiche registre,
 * posée par le parent à `ON_SPAWN` (`direct-spawn`), ouvre à l'instance les outils de `outils_veille` (défaut
 * `WebSearch,WebFetch`) pour au plus <n> lectures — jamais sur un profil `execution`, jamais sans ligne `Veille`.
 * Le lanceur (`holarch-spawn.js`) étend `--tools` ; `spawn-guard` (`holarch-hooks.js`) refuse d'incarner un enfant
 * dont la fiche porte une ligne `Veille` sur un profil qui n'y a pas droit. La borne de lectures est tenue par
 * l'instance (U0 « état de l'art », `regles-du-metier`), pas comptée ici.
 */

const OUTILS_VEILLE_DEFAUT = 'WebSearch,WebFetch';
const PROFILS_VEILLE = ['conception', 'exploration'];

/** Ligne `Veille` d'une fiche registre : `null` si absente, sinon `{ brut, lectures }` (lectures = entier > 0 ou NaN). */
function lireVeille(ficheTexte) {
  const m = String(ficheTexte || '').match(/^\|\s*Veille\s*\|\s*(.*?)\s*\|\s*$/mi);
  if (!m) return null;
  const brut = m[1].replace(/`/g, '').trim();
  const lectures = /^\d+$/.test(brut) ? Number(brut) : NaN;
  return { brut, lectures };
}

/** Ligne `Profil` d'une fiche registre, en minuscules ('' si absente) — les hooks n'ont pas le parseFiche du lanceur. */
function lireProfil(ficheTexte) {
  const m = String(ficheTexte || '').match(/^\|\s*Profil\s*\|\s*(.*?)\s*\|\s*$/mi);
  return m ? m[1].replace(/`/g, '').trim().toLowerCase() : '';
}

/** Motif de refus (chaîne) ou `null` : ligne `Veille` illisible, nulle, ou posée sur un profil sans droit. */
function refusVeille(veille, profil) {
  if (!veille) return null;
  const p = String(profil || '').toLowerCase().split(' ')[0];
  if (!(veille.lectures > 0)) return `ligne « Veille » illisible (« ${veille.brut} ») : un entier > 0 attendu, nombre maximal de lectures (direct-spawn, §17.3)`;
  if (!PROFILS_VEILLE.includes(p)) return `ligne « Veille » sur un profil « ${p || '?'} » : la veille est réservée aux profils ${PROFILS_VEILLE.join(' et ')} (direct-spawn, §17.3) — retire la ligne ou change le profil`;
  return null;
}

/** Outils de la session : `outils_cli` + `outils_veille` sans doublon. */
function fusionnerOutils(outilsCli, outilsVeille) {
  const liste = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  const out = liste(outilsCli);
  for (const o of liste(outilsVeille || OUTILS_VEILLE_DEFAUT)) if (!out.includes(o)) out.push(o);
  return out.join(',');
}

/** Résolution complète pour le lanceur : `{ lectures, outils, refus }` — `lectures` 0 et `outils` inchangés sans
 *  ligne `Veille` ; `refus` non nul si la ligne est posée à tort (le lanceur refuse alors le lancement). */
function resoudreVeille(ficheTexte, profil, params) {
  const p = params || {};
  const v = lireVeille(ficheTexte);
  const refus = refusVeille(v, profil);
  if (!v || refus) return { lectures: 0, outils: p.outils_cli, refus };
  return { lectures: v.lectures, outils: fusionnerOutils(p.outils_cli, p.outils_veille), refus: null };
}

module.exports = { lireVeille, lireProfil, refusVeille, fusionnerOutils, resoudreVeille, OUTILS_VEILLE_DEFAUT, PROFILS_VEILLE };
