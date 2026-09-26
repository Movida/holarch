'use strict';
// Forme d'un kit de domaine (chantier 17, docs/IMPLEMENTATION.md §17.2) : `config-lint --kits [<dir>]`
// (défaut framework/kits ; `npm run lint:kits`). Un kit est framework/kits/<domaine>/ :
//   INDEX.md          ≤ 60 lignes : ce qu'est le domaine, « Quand attacher », une ligne par pièce ;
//   references/*.md   notes courtes ;  prompts/*.md  blocs de prompt composables ;
//   verificateurs/*   scripts exécutables (.py, .sh, .js), chacun avec `--help` et `--a-sec` (test à sec : code 0
//                     sans donnée réelle, sans réseau).
// Chaque pièce dit ce qu'elle garantit et comment le vérifier : lignes « Garantit : » et « Vérifier : » dans ses
// 20 premières lignes (citation `>` en markdown, commentaire dans un script). Rien de nominatif ne se vérifie
// mécaniquement ; le lint refuse au moins les adresses électroniques et les motifs de clé d'API.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const NOM_KIT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INDEX_MAX_LIGNES = 60;
const SOUS_REPERTOIRES = ['references', 'verificateurs', 'prompts'];
const INTERPRETES = { '.py': 'python3', '.sh': 'sh', '.js': process.execPath };
const MOTIFS_INTERDITS = [
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, quoi: 'adresse électronique' },
  { re: /sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}/, quoi: 'motif de clé d\'API' },
];

function fichiers(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort(); } catch (_) { return []; }
}

function declareGarantie(texte) {
  const tete = texte.split('\n').slice(0, 20).join('\n');
  const manque = [];
  if (!/Garantit\s*:/.test(tete)) manque.push('« Garantit : »');
  if (!/Vérifier\s*:/.test(tete)) manque.push('« Vérifier : »');
  return manque;
}

/** Lance un vérificateur avec un argument ; `{ code, sortie }`. */
function lancer(fichier, arg, timeoutMs) {
  const interp = INTERPRETES[path.extname(fichier)];
  const r = interp
    ? spawnSync(interp, [fichier, arg], { encoding: 'utf8', timeout: timeoutMs })
    : spawnSync(fichier, [arg], { encoding: 'utf8', timeout: timeoutMs });
  return { code: r.error ? `${r.error.code || r.error.message}` : r.status, sortie: `${r.stdout || ''}${r.stderr || ''}` };
}

/** Lint d'un kit : `{ erreurs, avertissements }` (messages préfixés du nom du kit). */
function lintKit(dirKit, options) {
  const o = Object.assign({ executer: true, timeoutMs: 60000 }, options);
  const nom = path.basename(dirKit);
  const erreurs = [];
  const avert = [];
  const E = (m) => erreurs.push(`${nom} : ${m}`);
  if (!NOM_KIT.test(nom)) E('nom de kit invalide (kebab-case attendu)');
  const index = (() => { try { return fs.readFileSync(path.join(dirKit, 'INDEX.md'), 'utf8'); } catch (_) { return null; } })();
  if (index === null) { E('INDEX.md absent'); return { erreurs, avertissements: avert }; }
  const nLignes = index.replace(/\n+$/, '').split('\n').length;
  if (nLignes > INDEX_MAX_LIGNES) E(`INDEX.md fait ${nLignes} lignes (borne ${INDEX_MAX_LIGNES})`);
  if (!/quand attacher/i.test(index)) E('INDEX.md ne dit pas « Quand attacher » le kit');
  for (const ent of fs.readdirSync(dirKit, { withFileTypes: true })) {
    if (ent.isDirectory() && !SOUS_REPERTOIRES.includes(ent.name)) avert.push(`${nom} : répertoire inattendu ${ent.name}/ (attendus : ${SOUS_REPERTOIRES.join(', ')})`);
    if (ent.isFile() && ent.name !== 'INDEX.md') avert.push(`${nom} : fichier inattendu à la racine du kit : ${ent.name}`);
  }
  const pieces = [];
  for (const sous of SOUS_REPERTOIRES) for (const f of fichiers(path.join(dirKit, sous))) pieces.push({ sous, f, rel: `${sous}/${f}` });
  if (!pieces.length) E('aucune pièce (references/, verificateurs/, prompts/ vides)');
  for (const p of [{ rel: 'INDEX.md', texte: index }, ...pieces.map((x) => ({ rel: x.rel, texte: fs.readFileSync(path.join(dirKit, x.rel), 'utf8') }))]) {
    for (const m of MOTIFS_INTERDITS) if (m.re.test(p.texte)) E(`${p.rel} contient un(e) ${m.quoi} (rien de nominatif, aucune valeur de clé)`);
  }
  for (const x of pieces) {
    const chemin = path.join(dirKit, x.rel);
    const texte = fs.readFileSync(chemin, 'utf8');
    if (!index.includes(x.rel)) E(`${x.rel} n'est pas listé dans INDEX.md (une ligne par pièce, chemin relatif au kit)`);
    const manque = declareGarantie(texte);
    if (manque.length) E(`${x.rel} : ${manque.join(' et ')} absent(s) des 20 premières lignes`);
    if ((x.sous === 'references' || x.sous === 'prompts') && path.extname(x.f) !== '.md') E(`${x.rel} : markdown attendu sous ${x.sous}/`);
    if (x.sous === 'verificateurs') {
      if (!INTERPRETES[path.extname(x.f)]) E(`${x.rel} : extension non reconnue (attendu ${Object.keys(INTERPRETES).join(', ')})`);
      else if (!/--a-sec/.test(texte)) E(`${x.rel} : pas d'option --a-sec (test à sec)`);
      if (o.executer && INTERPRETES[path.extname(x.f)]) {
        const h = lancer(chemin, '--help', o.timeoutMs);
        if (h.code !== 0 || !h.sortie.trim()) E(`${x.rel} --help : code ${h.code}${h.sortie.trim() ? '' : ', sortie vide'}`);
        const s = lancer(chemin, '--a-sec', o.timeoutMs);
        if (s.code !== 0) E(`${x.rel} --a-sec : code ${s.code} — ${s.sortie.trim().split('\n').slice(-1)[0] || 'sans sortie'}`);
      }
    }
  }
  for (const m of index.matchAll(/`((?:references|verificateurs|prompts)\/[^`\s]+)`/g)) {
    if (!fs.existsSync(path.join(dirKit, m[1]))) E(`INDEX.md cite ${m[1]}, absent du kit`);
  }
  return { erreurs, avertissements: avert };
}

/** Lint de tous les kits d'un répertoire (framework/kits). Répertoire absent ou vide : erreur — un contrôle qui ne
 *  vérifie rien ne doit pas rendre 0. */
function lintKits(dirKits, options) {
  const erreurs = [];
  const avertissements = [];
  let kits = [];
  try { kits = fs.readdirSync(dirKits, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch (_) {
    erreurs.push(`${dirKits} : répertoire absent`);
  }
  if (!kits.length && !erreurs.length) erreurs.push(`${dirKits} : aucun kit`);
  for (const k of kits) {
    const r = lintKit(path.join(dirKits, k), options);
    erreurs.push(...r.erreurs);
    avertissements.push(...r.avertissements);
  }
  return { kits, erreurs, avertissements };
}

module.exports = { lintKit, lintKits, declareGarantie, NOM_KIT, INDEX_MAX_LIGNES, SOUS_REPERTOIRES };
