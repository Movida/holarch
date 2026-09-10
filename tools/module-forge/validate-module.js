#!/usr/bin/env node
/**
 * module-forge — validateur mécanique d'extensions HOLARCH
 * ------------------------------------------------------
 * Priorité 3.1 de `docs/archive/mission-holon-v2/shared/concepteur/SYNTHESE-HOLON-V2.md` : « le système conçoit ses
 * propres modules, et les valide par les mêmes règles que celles qui le gouvernent ».
 *
 * Deux modes, aucune dépendance externe (Node seul, comme le harnais v1.1) :
 *
 *   node validate-module.js module <fichier.md> [...]   contrat de module (spec §8.1)
 *   node validate-module.js config <CONFIG.md>          composition d'une configuration (= T1 rejouable)
 *
 * Options : --manifest <f> (défaut framework/MANIFEST.md) · --modules-dir <d> (défaut framework/modules)
 *           --extra <module.md> (répétable : module candidat pas encore catalogué) · --json · --strict
 * Codes de sortie : 0 conforme · 1 erreur(s) de conformité · 2 erreur d'usage.
 *
 * Ce que ce script NE fait pas (devoir d'honnêteté, KERNEL §5.4) : il ne vérifie pas qu'un module
 * ne contredit pas le KERNEL « sur le fond ». Cette règle (spec §8.1, règle a) n'est pas
 * mécanisable ; le script se contente de signaler, en `review`, les formulations qui prétendent
 * lever un invariant, et laisse le jugement à un humain ou à une instance de relecture.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// --- Constantes normatives (KERNEL §2, spec §8.1, §9.1) ---------------------

const HOOKS = [
  'ON_WAKE', 'ON_ORIENT', 'ON_PLAN', 'ON_SPAWN', 'ON_SUPERVISE',
  'ON_CHILD_DONE', 'ON_CONFLICT', 'ON_DELIVER', 'ON_SLEEP',
];

const CATEGORIES_OBLIGATOIRES = ['orchestration', 'synchronisation', 'memoire', 'registre'];
const CATEGORIES_CUMULABLES = ['recursion', 'conflits', 'extension', 'extensions', 'observabilite'];
const CATEGORIES = [...CATEGORIES_OBLIGATOIRES, ...CATEGORIES_CUMULABLES];

const ENTETE_REQUISE = ['Catégorie', 'Version', 'Requiert', 'Incompatible avec'];
const ENTETE_RECOMMANDEE = ['Complète bien'];

// Formulations qui prétendent lever un invariant du KERNEL : signalées pour relecture humaine,
// jamais bloquantes — un module peut légitimement citer le KERNEL sans le contredire.
const MOTIFS_A_RELIRE = [
  [/\b(ignore|contourne|outrepasse|passe outre)\b[^.]{0,60}\bKERNEL\b/i, 'prétend ignorer ou contourner le KERNEL'],
  [/\bsans passer par\b[^.]{0,40}\bON_SLEEP\b/i, 'prétend permettre une fin de session sans ON_SLEEP'],
  [/\bmodifie[rz]?\b[^.]{0,30}\bROLE\.md\b[^.]{0,30}\ben place\b/i, 'prétend modifier un ROLE.md en place (KERNEL §10)'],
  [/\b(écris|écrire|modifie[rz]?)\b[^.]{0,30}`?framework\//i, 'prétend écrire sous framework/ (KERNEL §4)'],
  [/\bsupprime[rz]?\b[^.]{0,40}\b(INBOX|OUTBOX|JOURNAL)\b/i, 'prétend supprimer dans un flux append-only (KERNEL §7)'],
  [/\bn'?(écris|écrire) (pas|plus)\b[^.]{0,20}\bMEMORY\.md\b/i, 'prétend dispenser d\'écrire MEMORY.md (KERNEL §5.3)'],
];

// --- Utilitaires ------------------------------------------------------------

const listeVide = (v) => !v || /^(—|-|aucun|none|n\/a)$/i.test(v.trim());

function listeDeModules(valeur) {
  if (listeVide(valeur)) return [];
  return valeur
    .split(/[,;]/)
    .map((s) => s.replace(/[`*\[\]]/g, '').replace(/\(.*?\)/g, '').trim())
    .filter(Boolean);
}

function lignesDeTable(lignes, debut) {
  const out = [];
  for (let i = debut; i < lignes.length; i++) {
    const l = lignes[i].trim();
    if (!l.startsWith('|')) { if (out.length) break; else continue; }
    const cells = l.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === '')) continue; // séparateur
    out.push(cells);
  }
  return out;
}

// --- Lecture du MANIFEST ----------------------------------------------------

function lireManifest(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8');
  const lignes = texte.split('\n');
  const debut = lignes.findIndex((l) => /^\|\s*Module\s*\|/i.test(l.trim()));
  if (debut === -1) throw new Error(`MANIFEST illisible (table « | Module | ... » absente) : ${fichier}`);
  const modules = new Map();
  for (const cells of lignesDeTable(lignes, debut + 1)) {
    if (cells.length < 3) continue;
    const nom = cells[0].replace(/\[([^\]]+)\]\([^)]*\)/, '$1').replace(/`/g, '').trim();
    if (!nom || /^module$/i.test(nom)) continue;
    modules.set(nom, {
      nom,
      categorie: cells[1].trim(),
      version: cells[2].trim(),
      requiert: listeDeModules(cells[3] || ''),
      incompatible: listeDeModules(cells[4] || ''),
    });
  }
  return modules;
}

// --- Lecture d'un fichier de module ----------------------------------------

function lireModule(fichier) {
  const texte = fs.readFileSync(fichier, 'utf8');
  const lignes = texte.split('\n');
  const m = { fichier, nom: null, entete: {}, sections: [], hooks: [], texte };

  const titre = lignes.find((l) => /^#\s+/.test(l));
  const mt = titre && titre.match(/^#\s+Module\s*:\s*(.+?)\s*$/);
  if (mt) m.nom = mt[1].replace(/`/g, '').trim();

  for (const l of lignes) {
    if (/^##\s/.test(l)) break;
    const me = l.match(/^>\s*([^:]+?)\s*:\s*(.*)$/);
    if (me) m.entete[me[1].trim()] = me[2].trim();
  }

  let hookCourant = null;
  lignes.forEach((l, i) => {
    if (/^##\s/.test(l)) { m.sections.push(l.replace(/^##\s+/, '').trim()); hookCourant = null; }
    const mh = l.match(/^###\s*⚓\s*(.+?)\s*$/);
    if (mh) { hookCourant = { nom: mh[1].replace(/`/g, '').trim(), ligne: i + 1, corps: [] }; m.hooks.push(hookCourant); return; }
    if (hookCourant && !/^#{2,3}\s/.test(l)) hookCourant.corps.push(l);
    if (/^#{2}\s/.test(l)) hookCourant = null;
  });

  return m;
}

// --- Validation d'un module -------------------------------------------------

function validerModule(fichier, ctx) {
  const r = { cible: fichier, erreurs: [], avertissements: [], relectures: [] };
  const err = (s) => r.erreurs.push(s);
  const warn = (s) => r.avertissements.push(s);

  let m;
  try { m = lireModule(fichier); } catch (e) { err(`illisible : ${e.message}`); return r; }

  // 1. Titre et nom
  if (!m.nom) err('titre absent ou mal formé — attendu « # Module : <nom> » (spec §8.1)');
  else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(m.nom)) err(`nom « ${m.nom} » non kebab-case`);
    const stem = path.basename(fichier).replace(/\.md$/, '');
    if (m.nom !== stem) err(`le nom du module (« ${m.nom} ») diffère du nom de fichier (« ${stem}.md »)`);
  }

  // 2. En-tête
  for (const champ of ENTETE_REQUISE) if (!(champ in m.entete)) err(`en-tête « > ${champ} : … » manquante (spec §8.1)`);
  for (const champ of ENTETE_RECOMMANDEE) if (!(champ in m.entete)) warn(`en-tête « > ${champ} : … » absente (indicative, non contraignante)`);

  const cat = (m.entete['Catégorie'] || '').replace(/`/g, '').trim();
  if (cat && !CATEGORIES.includes(cat)) err(`catégorie « ${cat} » inconnue — attendu : ${CATEGORIES.join(', ')}`);
  const ver = (m.entete['Version'] || '').trim();
  if (ver && !/^\d+\.\d+\.\d+$/.test(ver)) err(`version « ${ver} » non semver (attendu MAJEUR.MINEUR.CORRECTIF)`);

  // 3. Sections obligatoires
  if (!m.sections.includes('Paramètres')) err('section « ## Paramètres » manquante (spec §8.1)');
  else {
    const lignes = m.texte.split('\n');
    const i = lignes.findIndex((l) => /^##\s+Paramètres\s*$/.test(l));
    const table = lignesDeTable(lignes, i + 1);
    const entete = table[0] || [];
    const attendu = ['Paramètre', 'Défaut', 'Description'];
    if (entete.length < 3 || !attendu.every((c, k) => (entete[k] || '').toLowerCase() === c.toLowerCase())) {
      err('la table « ## Paramètres » doit avoir exactement les colonnes | Paramètre | Défaut | Description |');
    }
  }
  if (!m.sections.includes('Règles injectées')) err('section « ## Règles injectées » manquante (spec §8.1)');

  // 4. Hooks
  if (m.hooks.length === 0) err('aucune règle injectée : au moins un « ### ⚓ <HOOK> » est requis');
  const vus = new Set();
  for (const h of m.hooks) {
    if (!HOOKS.includes(h.nom)) err(`hook « ${h.nom} » inexistant (ligne ${h.ligne}) — hooks du KERNEL §2 : ${HOOKS.join(', ')}`);
    if (vus.has(h.nom)) err(`hook « ${h.nom} » déclaré deux fois`);
    vus.add(h.nom);
    // Note de conception : un contrôle lexical du style « 2e personne impérative » (spec §8.1) a été
    // écrit puis retiré — il signalait 8 hooks de modules légitimes du catalogue (heartbeat-log,
    // dependency-graph, journal-synthesis), qui décrivent leur règle sous forme nominale. Un contrôle
    // qui crie plus souvent à tort qu'à raison décrédibilise tous les autres : le style reste du
    // ressort de la relecture humaine. Seul le vide, lui, est mécaniquement décidable.
    const corps = h.corps.join('\n').trim();
    if (!corps) err(`hook « ${h.nom} » sans instruction (règle : instructions impératives autonomes)`);
  }

  // 5. Références et symétrie des incompatibilités
  const connus = ctx.manifest ? new Set([...ctx.manifest.keys()]) : new Set();
  for (const n of ctx.extras) connus.add(n);
  const requiert = listeDeModules(m.entete['Requiert'] || '');
  const incompatibles = listeDeModules(m.entete['Incompatible avec'] || '');
  for (const dep of requiert) if (connus.size && !connus.has(dep)) err(`« Requiert : ${dep} » — module inconnu du MANIFEST`);
  for (const inc of incompatibles) {
    if (connus.size && !connus.has(inc)) { err(`« Incompatible avec : ${inc} » — module inconnu du MANIFEST`); continue; }
    const autre = ctx.fichierDe(inc);
    if (!autre) continue;
    const decl = listeDeModules(lireModule(autre).entete['Incompatible avec'] || '');
    if (m.nom && !decl.includes(m.nom)) err(`incompatibilité asymétrique : « ${inc} » ne déclare pas « ${m.nom} » en retour (spec §8.1, règle d)`);
  }

  // 6. Cohérence avec le MANIFEST
  if (ctx.manifest && m.nom) {
    const fiche = ctx.manifest.get(m.nom);
    if (!fiche) warn(`absent de ${path.relative(ctx.racine, ctx.fichierManifest)} — inutilisable tant qu'il n'y est pas catalogué (spec §8.4)`);
    else {
      if (cat && fiche.categorie !== cat) err(`catégorie incohérente : « ${cat} » dans le module, « ${fiche.categorie} » au MANIFEST`);
      if (ver && fiche.version !== ver) err(`version incohérente : « ${ver} » dans le module, « ${fiche.version} » au MANIFEST`);
    }
  }

  // 7. Non-contradiction avec le KERNEL — heuristique, jamais bloquante
  for (const [motif, libelle] of MOTIFS_A_RELIRE) {
    const trouve = m.texte.match(motif);
    if (trouve) r.relectures.push(`${libelle} — « ${trouve[0].trim().slice(0, 90)} »`);
  }

  return r;
}

// --- Validation d'une configuration (T1 rejouable) --------------------------

function validerConfig(fichier, ctx) {
  const r = { cible: fichier, erreurs: [], avertissements: [], relectures: [] };
  const err = (s) => r.erreurs.push(s);

  const lignes = fs.readFileSync(fichier, 'utf8').split('\n');
  const i = lignes.findIndex((l) => /^##\s+Modules actifs/i.test(l));
  if (i === -1) { err('section « ## Modules actifs » absente (spec §9.1)'); return r; }

  const actifs = [];
  for (const cells of lignesDeTable(lignes, i + 1)) {
    if (cells.length < 3) continue;
    if (/^#$/.test(cells[0]) || /^catégorie$/i.test(cells[1])) continue;
    actifs.push({ categorie: cells[1].replace(/`/g, '').trim(), nom: cells[2].replace(/`/g, '').trim() });
  }
  if (!actifs.length) { err('aucun module actif déclaré'); return r; }

  const parCategorie = new Map();
  for (const a of actifs) {
    if (!CATEGORIES.includes(a.categorie)) err(`catégorie « ${a.categorie} » inconnue (module « ${a.nom} »)`);
    const fiche = ctx.manifest.get(a.nom) || ctx.fichesExtras.get(a.nom);
    if (!fiche) { err(`module « ${a.nom} » absent du MANIFEST — configuration invalide (spec §8.4)`); continue; }
    if (fiche.categorie !== a.categorie) err(`« ${a.nom} » déclaré en catégorie « ${a.categorie} », catalogué « ${fiche.categorie} »`);
    parCategorie.set(fiche.categorie, [...(parCategorie.get(fiche.categorie) || []), a.nom]);
  }

  for (const c of CATEGORIES_OBLIGATOIRES) {
    const n = (parCategorie.get(c) || []).length;
    if (n === 0) err(`catégorie obligatoire « ${c} » : aucun module actif (spec §9.1)`);
    if (n > 1) err(`catégorie obligatoire « ${c} » : ${n} modules actifs (${parCategorie.get(c).join(', ')}), un seul autorisé`);
  }

  const noms = new Set(actifs.map((a) => a.nom));
  for (const a of actifs) {
    const fiche = ctx.manifest.get(a.nom) || ctx.fichesExtras.get(a.nom);
    if (!fiche) continue;
    for (const dep of fiche.requiert) if (!noms.has(dep)) err(`« ${a.nom} » requiert « ${dep} », absent des modules actifs`);
    for (const inc of fiche.incompatible) {
      if (noms.has(inc) && a.nom < inc) err(`« ${a.nom} » et « ${inc} » sont incompatibles et tous deux actifs (spec §8.1)`);
    }
  }
  return r;
}

// --- Contexte, rendu, CLI ---------------------------------------------------

function trouverRacine(depart) {
  let d = path.resolve(depart);
  for (;;) {
    if (fs.existsSync(path.join(d, 'framework', 'KERNEL.md'))) return d;
    const p = path.dirname(d);
    if (p === d) return null;
    d = p;
  }
}

function construireContexte(o) {
  const racine = trouverRacine(process.cwd()) || process.cwd();
  const fichierManifest = o.manifest || path.join(racine, 'framework', 'MANIFEST.md');
  const modulesDir = o.modulesDir || path.join(racine, 'framework', 'modules');
  const manifest = fs.existsSync(fichierManifest) ? lireManifest(fichierManifest) : null;

  const index = new Map();
  const parcourir = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) parcourir(p);
      else if (e.name.endsWith('.md')) index.set(e.name.replace(/\.md$/, ''), p);
    }
  };
  parcourir(modulesDir);

  const fichesExtras = new Map();
  const extras = [];
  for (const f of o.extras) {
    const m = lireModule(f);
    if (!m.nom) continue;
    extras.push(m.nom);
    index.set(m.nom, f);
    fichesExtras.set(m.nom, {
      nom: m.nom,
      categorie: (m.entete['Catégorie'] || '').trim(),
      version: (m.entete['Version'] || '').trim(),
      requiert: listeDeModules(m.entete['Requiert'] || ''),
      incompatible: listeDeModules(m.entete['Incompatible avec'] || ''),
    });
  }

  return { racine, fichierManifest, manifest, extras, fichesExtras, fichierDe: (n) => index.get(n) || null };
}

function rendre(resultats, o) {
  if (o.json) { process.stdout.write(JSON.stringify(resultats, null, 2) + '\n'); return; }
  for (const r of resultats) {
    const nb = r.erreurs.length;
    const etat = nb ? `✗ ${nb} erreur(s)` : '✓ conforme';
    process.stdout.write(`\n${etat} — ${r.cible}\n`);
    for (const e of r.erreurs) process.stdout.write(`  [erreur]      ${e}\n`);
    for (const a of r.avertissements) process.stdout.write(`  [avert.]      ${a}\n`);
    for (const x of r.relectures) process.stdout.write(`  [à relire]    ${x}\n`);
  }
  process.stdout.write('\n');
}

function main(argv) {
  const o = { mode: null, cibles: [], manifest: '', modulesDir: '', extras: [], json: false, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') o.manifest = argv[++i];
    else if (a === '--modules-dir') o.modulesDir = argv[++i];
    else if (a === '--extra') o.extras.push(argv[++i]);
    else if (a === '--json') o.json = true;
    else if (a === '--strict') o.strict = true;
    else if (a === '-h' || a === '--help') { usage(); return 0; }
    else if (!o.mode) o.mode = a;
    else o.cibles.push(a);
  }
  if (!o.mode || !['module', 'config'].includes(o.mode) || !o.cibles.length) { usage(); return 2; }

  const ctx = construireContexte(o);
  const resultats = o.cibles.map((c) => (o.mode === 'module' ? validerModule(c, ctx) : validerConfig(c, ctx)));
  rendre(resultats, o);
  const dur = resultats.some((r) => r.erreurs.length || (o.strict && r.avertissements.length));
  return dur ? 1 : 0;
}

function usage() {
  process.stdout.write([
    'module-forge — validateur mécanique d\'extensions HOLARCH',
    '',
    '  node validate-module.js module <fichier.md> [...]  contrat de module (spec §8.1)',
    '  node validate-module.js config <CONFIG.md>         composition (T1 rejouable)',
    '',
    'Options : --manifest <f> --modules-dir <d> --extra <module.md> --json --strict',
    '',
  ].join('\n'));
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { lireModule, lireManifest, validerModule, validerConfig, construireContexte, HOOKS, CATEGORIES };
