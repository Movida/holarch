#!/usr/bin/env node
'use strict';
/**
 * holarch-upgrade — récupère la dernière version publiée du framework HOLARCH dans un projet.
 *
 * Mode par défaut : RAPPORT. Compare `framework/VERSION` local à celui de la source, liste les
 * fichiers ajoutés / modifiés / retirés dans le périmètre (`framework/`, `tools/`, `.claude/`,
 * `docs/holarch.md`), revalide le `CONFIG.md` local contre le `MANIFEST.md` et les modules de la
 * nouvelle version (config-lint + module-forge de la source), et dit si l'application est possible.
 * Ne touche à rien.
 *
 * `--apply` : applique les changements — seulement si aucune session de mission ne tourne (processus
 * `holarch-spawn.js` / `claude -p`, même détection que `tools/holarch-session`), et si `CONFIG.md`
 * reste valide. Jamais touchés : `framework/CONFIG.md` (la composition de la mission) et
 * `framework/claude/instance-settings.json` (allowlist possiblement élargie par le projet — le diff
 * est rapporté, la fusion reste manuelle). Ne committe pas : le mainteneur relit puis committe.
 *
 * Source : `--source <url git | répertoire>` ; défaut `package.json` → `holarch.modele`. Pour une
 * URL, `--ref <tag>` (défaut : le plus grand tag `v<semver>` de la source, sinon sa branche par défaut).
 *
 * Codes : 0 à jour ou appliqué · 1 mise à jour disponible (rapport) · 2 erreur ou refus ·
 *         3 CONFIG.md invalide contre la nouvelle version (à corriger à la main avant --apply).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const PERIMETRE = ['framework', 'tools', '.claude', 'docs/holarch.md'];
const PRESERVES = new Set(['framework/CONFIG.md']);
const A_RECONCILIER = new Set(['framework/claude/instance-settings.json']);
const IGNORES = new Set(['node_modules', '__pycache__', '.venv', '.DS_Store', 'settings.local.json']);

function findRoot(start) {
  let dir = path.resolve(start);
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'framework', 'KERNEL.md')) && fs.existsSync(path.join(dir, 'mission'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300000 });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

function lireVersion(dir) {
  const p = path.join(dir, 'framework', 'VERSION');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : null;
}
function parseSemver(v) { const m = String(v || '').match(/^v?(\d+)\.(\d+)\.(\d+)$/); return m ? m.slice(1).map(Number) : null; }
function comparerSemver(a, b) {
  const x = parseSemver(a), y = parseSemver(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
function niveau(local, source) {
  const x = parseSemver(local), y = parseSemver(source);
  if (!x || !y) return 'inconnu';
  if (x[0] !== y[0]) return 'majeure';
  if (x[1] !== y[1]) return 'mineure';
  return x[2] !== y[2] ? 'patch' : 'aucune';
}

/** Processus de mission (même critère que tools/holarch-session/etat.js ; `HOLARCH_GARDE_PS` injectable). */
function processusMission(psText) {
  return String(psText || '').split('\n').map((l) => l.trim())
    .filter((l) => /holarch-spawn\.js|claude -p\b/.test(l) && !/--replay-user-messages/.test(l) && !/grep/.test(l));
}

/** Plus grand tag v<semver> d'une source distante (git ls-remote), ou null. */
function dernierTag(url) {
  const r = run('git', ['ls-remote', '--tags', '--refs', url]);
  if (r.code !== 0) throw new Error(`git ls-remote ${url} : ${r.err}`);
  const tags = r.out.split('\n').map((l) => (l.split(/\s+/)[1] || '').replace('refs/tags/', '')).filter((t) => parseSemver(t));
  tags.sort((a, b) => comparerSemver(a, b));
  return tags.length ? tags[tags.length - 1] : null;
}

/** Résout la source : un arbre local (contient framework/VERSION) est pris tel quel ; tout le reste (URL, dépôt nu) est cloné. */
function obtenirSource(source, ref) {
  if (fs.existsSync(path.join(source, 'framework', 'VERSION'))) return { dir: path.resolve(source), ref: null, temporaire: false };
  const tag = ref || dernierTag(source);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-upgrade-'));
  const args = ['clone', '--quiet', '--depth', '1'];
  if (tag) args.push('--branch', tag);
  args.push(source, dir);
  const r = run('git', args);
  if (r.code !== 0) throw new Error(`git clone ${source}${tag ? ` (${tag})` : ''} : ${r.err}`);
  return { dir, ref: tag, temporaire: true };
}

function listerFichiers(base, rel, acc) {
  const abs = path.join(base, rel);
  if (!fs.existsSync(abs)) return acc;
  if (fs.statSync(abs).isDirectory()) {
    for (const e of fs.readdirSync(abs)) if (!IGNORES.has(e)) listerFichiers(base, rel ? `${rel}/${e}` : e, acc);
  } else acc.add(rel);
  return acc;
}

/** Diff du périmètre entre le projet et la source : { ajoutes, modifies, retires, reconcilier }. */
function comparer(root, srcDir) {
  const locaux = new Set(), distants = new Set();
  for (const p of PERIMETRE) { listerFichiers(root, p, locaux); listerFichiers(srcDir, p, distants); }
  const d = { ajoutes: [], modifies: [], retires: [], reconcilier: [] };
  for (const f of [...distants].sort()) {
    if (PRESERVES.has(f)) continue;
    if (!locaux.has(f)) { (A_RECONCILIER.has(f) ? d.reconcilier : d.ajoutes).push(f); continue; }
    if (!fs.readFileSync(path.join(root, f)).equals(fs.readFileSync(path.join(srcDir, f)))) (A_RECONCILIER.has(f) ? d.reconcilier : d.modifies).push(f);
  }
  for (const f of [...locaux].sort()) if (!distants.has(f) && !PRESERVES.has(f) && !A_RECONCILIER.has(f)) d.retires.push(f);
  return d;
}

/** Revalide le CONFIG.md local avec les validateurs et le MANIFEST de la source. */
function validerConfig(root, srcDir) {
  const cfg = path.join(root, 'framework', 'CONFIG.md');
  if (!fs.existsSync(cfg)) return { ok: true, detail: 'aucun framework/CONFIG.md local (mission non configurée)' };
  const manifest = path.join(srcDir, 'framework', 'MANIFEST.md');
  const modules = path.join(srcDir, 'framework', 'modules');
  const etapes = [
    ['config-lint', [path.join(srcDir, 'tools', 'config-lint', 'config-lint.js'), cfg, '--manifest', manifest, '--modules-dir', modules]],
    ['module-forge', [path.join(srcDir, 'tools', 'module-forge', 'validate-module.js'), 'config', cfg, '--manifest', manifest, '--modules-dir', modules]],
  ];
  for (const [nom, args] of etapes) {
    if (!fs.existsSync(args[0])) continue;
    const r = run(process.execPath, args, root);
    if (r.code !== 0) return { ok: false, detail: `${nom} : ${(r.out + '\n' + r.err).trim().split('\n').slice(-12).join('\n')}` };
  }
  return { ok: true, detail: 'framework/CONFIG.md valide contre le MANIFEST et les modules de la nouvelle version' };
}

function appliquer(root, srcDir, diff) {
  for (const f of [...diff.ajoutes, ...diff.modifies]) {
    const dst = path.join(root, f);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(srcDir, f), dst);
  }
  for (const f of diff.retires) fs.rmSync(path.join(root, f), { force: true });
  // Répertoires vidés par les retraits
  for (const f of diff.retires) {
    let d = path.dirname(path.join(root, f));
    while (d !== root && fs.existsSync(d) && !fs.readdirSync(d).length) { fs.rmdirSync(d); d = path.dirname(d); }
  }
  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.holarch) { pkg.holarch.version = lireVersion(srcDir); fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n'); }
    } catch (e) { /* package.json illisible : on ne le touche pas */ }
  }
}

/** Cœur, sans I/O console : retourne le rapport (et applique si demandé et possible). */
function analyser(root, opts) {
  opts = opts || {};
  const pkg = fs.existsSync(path.join(root, 'package.json')) ? JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) : {};
  const source = opts.source || (pkg.holarch && pkg.holarch.modele) || '';
  if (!source) return { statut: 'sans-source', code: 0, message: 'aucune source de modèle : ce dépôt est la lignée canonique, ou package.json → holarch.modele est vide (--source <url|dir>)' };
  const src = obtenirSource(source, opts.ref);
  try {
    const rap = { statut: '', code: 0, source, ref: src.ref, versionLocale: lireVersion(root), versionSource: lireVersion(src.dir) };
    if (!rap.versionSource) throw new Error(`${source} n'a pas de framework/VERSION : ce n'est pas un modèle HOLARCH publié`);
    rap.niveau = niveau(rap.versionLocale, rap.versionSource);
    rap.sens = comparerSemver(rap.versionLocale, rap.versionSource); // -1 local plus ancien, 0 égal, 1 local plus récent, null inconnu
    rap.diff = comparer(root, src.dir);
    const n = rap.diff.ajoutes.length + rap.diff.modifies.length + rap.diff.retires.length;
    rap.changements = n;
    rap.processus = processusMission(opts.ps !== undefined ? opts.ps : (process.env.HOLARCH_GARDE_PS !== undefined ? process.env.HOLARCH_GARDE_PS : (run('ps', ['-eo', 'pid,args']).out || '')));
    rap.missionModifiee = (run('git', ['status', '--porcelain', '--', 'mission/'], root).out || '').split('\n').filter(Boolean);
    rap.config = validerConfig(root, src.dir);
    if (n === 0 && !rap.diff.reconcilier.length) { rap.statut = 'a-jour'; rap.code = 0; return rap; }
    if (rap.sens === 1) { rap.statut = 'local-plus-recent'; rap.code = 0; return rap; }
    if (!rap.config.ok) { rap.statut = 'config-invalide'; rap.code = 3; return rap; }
    if (!opts.apply) { rap.statut = n ? 'disponible' : 'reconcilier'; rap.code = n ? 1 : 0; return rap; }
    if (rap.processus.length) { rap.statut = 'refus-mission-en-cours'; rap.code = 2; return rap; }
    appliquer(root, src.dir, rap.diff);
    rap.statut = 'applique'; rap.code = 0;
    return rap;
  } finally {
    if (src.temporaire) fs.rmSync(src.dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

function formater(rap, bref) {
  if (rap.statut === 'sans-source') return `holarch-upgrade : ${rap.message}`;
  const tete = `framework local v${rap.versionLocale || '?'} · modèle v${rap.versionSource}${rap.ref ? ` (${rap.ref})` : ''} · ${rap.niveau === 'aucune' ? 'même version' : `changement ${rap.niveau}`}`;
  const l = [];
  switch (rap.statut) {
    case 'a-jour': l.push(`${tete} · à jour, rien à faire`); break;
    case 'local-plus-recent': l.push(`${tete} · le projet est plus récent que le modèle, rien à faire`); break;
    case 'config-invalide': l.push(`${tete} · ✗ framework/CONFIG.md ne serait plus valide — corriger avant --apply`); break;
    case 'disponible': l.push(`${tete} · mise à jour disponible : ${rap.changements} fichier(s) — \`npm run upgrade -- --apply\` hors session de mission`); break;
    case 'reconcilier': l.push(`${tete} · seul un fichier à réconcilier à la main diffère`); break;
    case 'refus-mission-en-cours': l.push(`${tete} · ✗ refus : ${rap.processus.length} processus de mission en cours (holarch-spawn / claude -p) — arrêter d'abord (skill holarch-pause)`); break;
    case 'applique': l.push(`${tete} · ✓ appliqué : ${rap.changements} fichier(s) — relire \`git diff\`, puis committer`); break;
  }
  if (bref) return l[0];
  if (rap.niveau === 'majeure') l.push(`⚠ version majeure : lire framework/CHANGELOG.md — un fichier d'instance ou CONFIG.md écrit sous v${rap.versionLocale} peut ne plus être valide`);
  const liste = (titre, arr) => { if (arr.length) { l.push(`${titre} (${arr.length}) :`); for (const f of arr.slice(0, 40)) l.push(`  ${f}`); if (arr.length > 40) l.push(`  … ${arr.length - 40} de plus`); } };
  liste('ajoutés', rap.diff.ajoutes); liste('modifiés', rap.diff.modifies); liste('retirés', rap.diff.retires);
  if (rap.diff.reconcilier.length) liste('à réconcilier à la main (jamais écrasés)', rap.diff.reconcilier);
  l.push(`préservé : framework/CONFIG.md · ${rap.config.ok ? '✓' : '✗'} ${rap.config.detail}`);
  if (rap.missionModifiee.length) l.push(`ℹ ${rap.missionModifiee.length} fichier(s) de mission/ non committé(s) : une instance a peut-être écrit récemment`);
  return l.join('\n');
}

function parseArgs(argv) {
  const o = { source: '', ref: '', apply: false, bref: false, json: false, racine: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') o.source = argv[++i];
    else if (a === '--ref') o.ref = argv[++i];
    else if (a === '--apply') o.apply = true;
    else if (a === '--bref') o.bref = true;
    else if (a === '--json') o.json = true;
    else if (a === '--racine') o.racine = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`option inconnue : ${a}`);
  }
  return o;
}

function main(argv) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(`holarch-upgrade : ${e.message}`); return 2; }
  if (o.help) { console.log('Usage : node tools/holarch-upgrade/holarch-upgrade.js [--source <url|dir>] [--ref <tag>] [--apply] [--bref] [--json] [--racine <dir>]'); return 0; }
  try {
    const root = o.racine ? path.resolve(o.racine) : findRoot(process.cwd());
    if (!root) throw new Error('racine introuvable (framework/KERNEL.md + mission/)');
    const rap = analyser(root, o);
    if (o.json) console.log(JSON.stringify(rap, null, 2)); else console.log(formater(rap, o.bref));
    return rap.code;
  } catch (e) {
    console.error(`holarch-upgrade : ${e.message}`);
    return 2;
  }
}

module.exports = { analyser, formater, comparer, validerConfig, niveau, comparerSemver, dernierTag, processusMission, findRoot, PERIMETRE, PRESERVES, A_RECONCILIER };
if (require.main === module) process.exit(main(process.argv.slice(2)));
