'use strict';
// Test de la veille bornée (chantier 17, docs/IMPLEMENTATION.md §17.3, mission holarch-specialisation).
// Même construction que kits.test.js : un gabarit (racine temporaire où les cibles framework/bin/* et
// framework/hooks/* du paquet sont appliquées, sauf si le dépôt est déjà promu), puis des racines légères
// de fixture. Couvre : veille.js (fonctions pures), le lanceur (--dry-run avec et sans ligne Veille, refus
// sur un profil execution) et spawn-guard (refus d'incarner un enfant execution portant une ligne Veille).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CIBLE = path.resolve(__dirname, '..');

function trouverDepot(depart) {
  let d = depart;
  for (;;) {
    if (fs.existsSync(path.join(d, 'framework', 'bin', 'holarch-spawn.js'))
      && fs.existsSync(path.join(d, 'tools', 'config-lint', 'config-lint.js'))) return d;
    const parent = path.dirname(d);
    if (parent === d) throw new Error(`dépôt introuvable en remontant depuis ${depart}`);
    d = parent;
  }
}
const DEPOT = trouverDepot(path.resolve(__dirname, '..', '..'));
const PAQUET = path.resolve(__dirname, '..', '..', '..');
const PROMU = fs.existsSync(path.join(DEPOT, 'framework', 'bin', 'veille.js'))
  && fs.readFileSync(path.join(DEPOT, 'framework', 'bin', 'holarch-spawn.js'), 'utf8').includes("require('./veille')");

function construireGabarit() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-veille-gabarit-'));
  fs.cpSync(path.join(DEPOT, 'framework'), path.join(root, 'framework'), { recursive: true });
  fs.cpSync(path.join(DEPOT, 'tools', 'message-lint'), path.join(root, 'tools', 'message-lint'), { recursive: true });
  if (!PROMU) {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const APPLIQUER = require(path.join(PAQUET, 'appliquer.js'));
    const manifest = JSON.parse(fs.readFileSync(path.join(PAQUET, 'MANIFEST.json'), 'utf8'));
    const cibles = manifest.cibles.filter((c) => c.vers.startsWith('framework/bin/') || c.vers.startsWith('framework/hooks/'));
    const { verifications } = APPLIQUER.verifierTout(PAQUET, root, { cibles });
    for (const v of verifications) assert.ok(v.resultat.ok, `cible ${v.cible.vers} refusée : ${v.resultat.motif}`);
    const r = APPLIQUER.appliquerTransactionnel(verifications);
    assert.ok(r.ok, `application du gabarit échouée : ${r.motif}`);
  }
  return root;
}
const GABARIT = construireGabarit();
test.after(() => fs.rmSync(GABARIT, { recursive: true, force: true }));
const V = require(path.join(GABARIT, 'framework', 'bin', 'veille.js'));

function ecrire(root, relatif, texte) {
  const p = path.join(root, relatif);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, texte, 'utf8');
}
function fiche(chemin, lignes) {
  return `# ${chemin}\n| Champ | Valeur |\n|---|---|\n| Statut | INIT |\n| Budget alloué / consommé | 0 / 0 |\n${lignes.join('\n')}\n`;
}
function dryRun(chemin, lignesFiche) {
  ecrire(GABARIT, path.join('mission', chemin, 'ROLE.md'), '# Rôle\nInstance de test (fixture veille.test.js).\n');
  ecrire(GABARIT, path.join('mission', chemin, 'STATUS.md'), '| Champ | Valeur |\n|---|---|\n| État | READY |\n');
  ecrire(GABARIT, path.join('mission', 'registry', 'instances', `${chemin.replace(/\//g, '-')}.md`), fiche(chemin, lignesFiche));
  const r = spawnSync(process.execPath, [path.join(GABARIT, 'framework', 'bin', 'holarch-spawn.js'), chemin, '--dry-run', '--root', GABARIT],
    { encoding: 'utf8', cwd: GABARIT });
  assert.equal(r.status, 0, `dry-run : code ${r.status}\nstderr=${r.stderr}`);
  return `${r.stdout}\n${r.stderr}`;
}

test('lireVeille / lireProfil : ligne absente, entier, valeur illisible', () => {
  assert.equal(V.lireVeille('| Profil | conception |'), null);
  assert.deepEqual(V.lireVeille('| Veille | `8` |'), { brut: '8', lectures: 8 });
  assert.ok(Number.isNaN(V.lireVeille('| Veille | beaucoup |').lectures));
  assert.equal(V.lireProfil('| Profil | Exploration |'), 'exploration');
  assert.equal(V.lireProfil(null), '');
});

test('refusVeille : execution et profil absent refusés, conception/exploration acceptés, zéro refusé', () => {
  const v8 = V.lireVeille('| Veille | 8 |');
  assert.equal(V.refusVeille(null, 'execution'), null, 'sans ligne Veille, jamais de refus');
  assert.equal(V.refusVeille(v8, 'conception'), null);
  assert.equal(V.refusVeille(v8, 'exploration'), null);
  assert.match(V.refusVeille(v8, 'execution'), /réservée aux profils conception et exploration/);
  assert.match(V.refusVeille(v8, ''), /profil « \? »/);
  assert.match(V.refusVeille(V.lireVeille('| Veille | 0 |'), 'conception'), /entier > 0/);
});

test('resoudreVeille : outils fusionnés sans doublon, outils_veille configurable, inchangés sans ligne', () => {
  const p = { outils_cli: 'Read,Bash,WebFetch' };
  assert.deepEqual(V.resoudreVeille('| Veille | 3 |', 'conception', p), { lectures: 3, outils: 'Read,Bash,WebFetch,WebSearch', refus: null });
  assert.equal(V.resoudreVeille('| Veille | 3 |', 'exploration', { outils_cli: 'Read', outils_veille: 'WebFetch' }).outils, 'Read,WebFetch');
  assert.deepEqual(V.resoudreVeille('', 'conception', p), { lectures: 0, outils: 'Read,Bash,WebFetch', refus: null });
});

test('CLI --dry-run : ligne Veille sur conception → outils étendus montrés ; sans ligne → outils inchangés', () => {
  const avec = dryRun('veilleur', ['| Profil | conception |', '| Veille | 8 |']);
  assert.match(avec, /veille : au plus 8 lecture\(s\)/);
  assert.match(avec, /WebSearch/);
  const sans = dryRun('sobre', ['| Profil | conception |']);
  assert.doesNotMatch(sans, /WebSearch|veille : au plus/);
});

test('CLI --dry-run : ligne Veille sur execution → avertissement « un lancement réel serait refusé », outils inchangés', () => {
  const out = dryRun('executant', ['| Profil | execution |', '| Veille | 8 |']);
  assert.match(out, /réservée aux profils conception et exploration.*un lancement réel serait refusé/);
  assert.doesNotMatch(out, /WebSearch/);
});

test('spawn-guard : refuse un enfant execution (ou sans profil) portant une ligne Veille ; laisse passer les autres', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-veille-hook-'));
  try {
    const hooks = path.join(GABARIT, 'framework', 'hooks', 'holarch-hooks.js');
    const appel = (enfant, lignes) => {
      for (const f of ['ROLE.md', 'STATUS.md', 'MEMORY.md']) ecrire(root, path.join('mission', 'concepteur', enfant, f), 'x');
      ecrire(root, path.join('mission', 'registry', 'instances', `concepteur-${enfant}.md`), fiche(`concepteur/${enfant}`, lignes));
      const input = { session_id: 's', cwd: root, tool_name: 'Bash', tool_input: { command: `node framework/bin/holarch-spawn.js concepteur/${enfant}` } };
      const r = spawnSync(process.execPath, [hooks, 'spawn-guard'], { input: JSON.stringify(input), encoding: 'utf8',
        env: Object.assign({}, process.env, { HOLARCH_ROOT: root, HOLARCH_INSTANCE: 'concepteur' }) });
      assert.equal(r.status, 0, `hook : code ${r.status} ${r.stderr}`);
      const o = JSON.parse(r.stdout || '{}').hookSpecificOutput || {};
      return { decision: o.permissionDecision, motif: o.permissionDecisionReason || '' };
    };
    const refus = appel('execute', ['| Profil | execution |', '| Veille | 8 |']);
    assert.equal(refus.decision, 'deny');
    assert.match(refus.motif, /Veille/);
    assert.equal(appel('sans-profil', ['| Veille | 8 |']).decision, 'deny');
    assert.equal(appel('explore', ['| Profil | exploration |', '| Veille | 8 |']).decision, undefined);
    assert.equal(appel('sobre', ['| Profil | execution |']).decision, undefined);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
