'use strict';
// holarch-job.test.js — chantier 16, §18.4 (docs/IMPLEMENTATION.md), unité U9.
// `require(path.join(__dirname, '..', 'bin', 'jobs.js'))` : chemin identique une fois promu sous
// `framework/`. CLI testée en sous-processus (`node .../holarch-job.js ...`). Chaque test travaille
// dans un `fs.mkdtempSync` hors dépôt git (HOLARCH_ROOT = ce répertoire, cwd = ce répertoire :
// `racine()` échoue le `git rev-parse` et retombe sur HOLARCH_ROOT). `after()` tue tout ce qui a été
// noté et supprime les répertoires temporaires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const jobs = require(path.join(__dirname, '..', 'bin', 'jobs.js'));
const charge = require(path.join(__dirname, '..', 'bin', 'charge.js'));
const CLI = path.join(__dirname, '..', 'bin', 'holarch-job.js');

const DIRS = [];
const GROUPES_A_TUER = []; // pgid notés par les tests (superviseurs, groupes de commande)

function nouveauDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-job-'));
  DIRS.push(d);
  return d;
}

function envDeBase(dir, extra) {
  return Object.assign({}, process.env, { HOLARCH_ROOT: dir, HOLARCH_INSTANCE: undefined }, extra || {});
}

/** Sondage avec délai max, jamais de sleep fixe long. */
function attendreQue(predicat, { pasMs = 50, maxMs = 5000 } = {}) {
  const debut = Date.now();
  while (!predicat()) {
    if (Date.now() - debut > maxMs) throw new Error(`attendreQue : délai dépassé (${maxMs}ms)`);
    const r = spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${pasMs})`]);
    void r;
  }
}

function lireEtatDisque(dir, id) {
  return jobs.lireEtat(dir, id);
}

function noterGroupe(pid) { if (pid) GROUPES_A_TUER.push(pid); }

// -- charge machine (§18.5, unité U10) : petits utilitaires de test --------------------------------

function ecrireMeminfo(fichier, moDisponible) {
  fs.writeFileSync(fichier, `MemAvailable:    ${moDisponible * 1024} kB\n`);
}

/** Mute temporairement des variables d'environnement réelles (jobs.lancer() hérite de process.env au
 *  moment du spawn du superviseur) le temps de `fn`, puis restaure l'état antérieur. */
function envChargeTemp(vars, fn) {
  const cles = Object.keys(vars);
  const anciennes = {};
  for (const k of cles) anciennes[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    fn();
  } finally {
    for (const k of cles) {
      if (anciennes[k] === undefined) delete process.env[k]; else process.env[k] = anciennes[k];
    }
  }
}

/** Arrête sans exception un job lourd de test, quel que soit son état (idempotent). */
function arreterSansEchec(dir, id) {
  try { jobs.arreterJob(dir, id, 'utilisateur'); } catch (_err) { /* ignore */ }
}

test.after(() => {
  for (const pid of GROUPES_A_TUER) {
    try { process.kill(-pid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
    try { process.kill(pid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
  }
  for (const d of DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_err) { /* ignore */ } }
});

// -- 1. lancer : rapidité et forme de l'id ---------------------------------------------------------

test('lancer : rend la main en < 1 s, id conforme, nom normalisé', () => {
  const dir = nouveauDir();
  const debut = Date.now();
  const r = spawnSync(process.execPath, [CLI, 'lancer', 'Rendu Final!', '--', 'node', '-e', 'process.exit(0)'], {
    cwd: dir, env: envDeBase(dir), encoding: 'utf8',
  });
  const dureeMs = Date.now() - debut;
  assert.ok(dureeMs < 1000, `lancer a pris ${dureeMs}ms`);
  const id = r.stdout.trim();
  assert.match(id, /^[a-z0-9-]+-\d{8}t\d{6}-[0-9a-f]{4}$/);
  assert.match(id, /^rendu-final-/);
  const etat = lireEtatDisque(dir, id);
  noterGroupe(etat.pid_superviseur);
  attendreQue(() => ['fini', 'echoue'].includes(lireEtatDisque(dir, id).etat));
});

// -- 2. groupe du lanceur tué -----------------------------------------------------------------------

test('groupe du « lanceur » tué → le job atteint quand même fini', () => {
  const dir = nouveauDir();
  const marqueur = path.join(dir, 'lanceur-vivant');
  // Processus intermédiaire détaché (son propre groupe) qui lance `lancer` puis dort.
  const scriptLanceur = `
    const { spawnSync } = require('child_process');
    require('fs').writeFileSync(${JSON.stringify(marqueur)}, String(process.pid));
    spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(CLI)}, 'lancer', 'via-lanceur', '--', 'node', '-e', 'process.exit(0)'], {
      cwd: ${JSON.stringify(dir)}, env: Object.assign({}, process.env, { HOLARCH_ROOT: ${JSON.stringify(dir)} }),
      stdio: ['ignore', require('fs').openSync(${JSON.stringify(path.join(dir, 'lanceur.out'))}, 'w'), 'ignore'],
    });
    setTimeout(() => {}, 30000);
  `;
  const intermediaire = spawn(process.execPath, ['-e', scriptLanceur], { detached: true, stdio: 'ignore' });
  intermediaire.unref();
  attendreQue(() => fs.existsSync(marqueur));
  attendreQue(() => fs.existsSync(path.join(dir, 'lanceur.out')) && fs.readFileSync(path.join(dir, 'lanceur.out'), 'utf8').trim().length > 0);
  const id = fs.readFileSync(path.join(dir, 'lanceur.out'), 'utf8').trim();
  // Tue le groupe du processus intermédiaire (jamais celui du superviseur, détaché indépendamment).
  try { process.kill(-intermediaire.pid, 'SIGKILL'); } catch (_err) { /* ignore */ }

  const etat0 = lireEtatDisque(dir, id);
  noterGroupe(etat0.pid_superviseur);
  attendreQue(() => { const e = lireEtatDisque(dir, id); return e && ['fini', 'echoue'].includes(e.etat); });
  assert.equal(lireEtatDisque(dir, id).etat, 'fini');
});

// -- 3. publication -----------------------------------------------------------------------------

test('publication : sortie absente pendant l\'exécution ; valider OK → final sans .partiel', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const sortie = path.join(sortieDir, 'resultat.txt');
  const { id, pid } = jobs.lancer({
    nom: 'publication-ok', root: dir, cwd: dir,
    sorties: [sortie],
    commande: ['node', '-e', `setTimeout(() => require('fs').writeFileSync(process.env.HOLARCH_JOB_SORTIE_1, 'contenu'), 200)`],
    valider: null,
  });
  noterGroupe(pid);
  assert.equal(fs.existsSync(sortie), false);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'fini');
  assert.equal(fs.existsSync(sortie), true);
  assert.equal(fs.existsSync(`${sortie}.partiel`), false);
  assert.equal(fs.readFileSync(sortie, 'utf8'), 'contenu');
});

test('publication : valider en échec → echoue, .echec présent, final absent', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const sortie = path.join(sortieDir, 'resultat.txt');
  const { id, pid } = jobs.lancer({
    nom: 'publication-valider-echec', root: dir, cwd: dir,
    sorties: [sortie],
    commande: ['node', '-e', `require('fs').writeFileSync(process.env.HOLARCH_JOB_SORTIE_1, 'x')`],
    valider: ['node', '-e', 'process.exit(1)'],
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'echoue');
  assert.equal(fs.existsSync(`${sortie}.echec`), true);
  assert.equal(fs.existsSync(sortie), false);
});

test('publication : code de la commande ≠ 0 → echoue', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const sortie = path.join(sortieDir, 'resultat.txt');
  const { id, pid } = jobs.lancer({
    nom: 'publication-code-non-nul', root: dir, cwd: dir,
    sorties: [sortie],
    commande: ['node', '-e', `require('fs').writeFileSync(process.env.HOLARCH_JOB_SORTIE_1, 'x'); process.exit(3)`],
    valider: null,
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'echoue');
  assert.equal(lireEtatDisque(dir, id).code, 3);
});

test('publication : final préexistant + échec → echoue (jamais fini)', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const sortie = path.join(sortieDir, 'resultat.txt');
  fs.writeFileSync(sortie, 'ancien contenu, jamais une preuve');
  const { id, pid } = jobs.lancer({
    nom: 'publication-final-preexistant', root: dir, cwd: dir,
    sorties: [sortie],
    commande: ['node', '-e', `require('fs').writeFileSync(process.env.HOLARCH_JOB_SORTIE_1, 'x'); process.exit(1)`],
    valider: null,
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'echoue');
  assert.equal(lireEtatDisque(dir, id).etat, 'echoue');
});

test('revue n° 10 : final préexistant ou .partiel périmé, commande à code 0 qui n\'écrit rien → echoue, jamais fini', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const rendu = path.join(sortieDir, 'rendu.mp4');
  fs.writeFileSync(rendu, 'ANCIEN RENDU');
  const film = path.join(sortieDir, 'film.mp4');
  fs.writeFileSync(`${film}.partiel`, 'TRONQUE');
  const a = jobs.lancer({ nom: 'oublie-sortie', root: dir, cwd: dir, sorties: [rendu], commande: ['node', '-e', 'process.exit(0)'], valider: null });
  const b = jobs.lancer({
    nom: 'partiel-perime', root: dir, cwd: dir, sorties: [film], commande: ['node', '-e', 'process.exit(0)'], valider: ['test', '-s', '{fichier}'],
  });
  noterGroupe(a.pid);
  noterGroupe(b.pid);
  attendreQue(() => ['fini', 'echoue'].includes(lireEtatDisque(dir, a.id).etat) && ['fini', 'echoue'].includes(lireEtatDisque(dir, b.id).etat));
  assert.equal(lireEtatDisque(dir, a.id).etat, 'echoue', 'final préexistant : jamais publié par ce job');
  assert.equal(fs.readFileSync(rendu, 'utf8'), 'ANCIEN RENDU');
  assert.equal(lireEtatDisque(dir, b.id).etat, 'echoue', '.partiel périmé : jamais publié');
  assert.equal(fs.existsSync(film), false, 'aucun final publié depuis un partiel d\'un autre job');
});

// -- 4. arreter -----------------------------------------------------------------------------------

test('arreter : job long → arrete en < 8 s, groupe mort', () => {
  const dir = nouveauDir();
  const { id, pid } = jobs.lancer({
    nom: 'job-long', root: dir, cwd: dir,
    commande: ['node', '-e', 'setTimeout(() => {}, 60000)'],
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'en-cours');
  const pgid = lireEtatDisque(dir, id).pgid;
  const r = spawnSync(process.execPath, [CLI, 'arreter', id], { cwd: dir, env: envDeBase(dir), encoding: 'utf8' });
  assert.equal(r.status, 0);
  const debut = Date.now();
  attendreQue(() => lireEtatDisque(dir, id).etat === 'arrete', { maxMs: 8000 });
  assert.ok(Date.now() - debut < 8000);
  let groupeVivant = true;
  try { process.kill(-pgid, 0); groupeVivant = true; } catch (_err) { groupeVivant = false; }
  assert.equal(groupeVivant, false);
});

test('arreter : autre propriétaire → refus code 1 nommant le propriétaire', () => {
  const dir = nouveauDir();
  const { id, pid } = jobs.lancer({
    nom: 'job-proprietaire', root: dir, cwd: dir, proprietaire: 'concepteur/a',
    commande: ['node', '-e', 'setTimeout(() => {}, 20000)'],
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'en-cours');
  const r = spawnSync(process.execPath, [CLI, 'arreter', id], {
    cwd: dir, env: envDeBase(dir, { HOLARCH_INSTANCE: 'autre' }), encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /concepteur\/a/);
  // nettoyage : arrêt par l'utilisateur, dont le job appartient réellement
  jobs.arreterJob(dir, id, 'utilisateur');
});

/** État de job écrit à la main, superviseur mort (revue finale : constats 1, 13, 41, 49). */
function ecrireEtatManuel(dir, id, champs) {
  const etat = Object.assign({
    id, nom: 'manuel', proprietaire: 'utilisateur',
    pid_superviseur: 999999999, starttime_superviseur: '1', pgid: null, starttime_commande: null,
    commande: ['node', '-e', 'process.exit(0)'], cwd: dir, lourd: false, reprenable: false,
    valider: null, progression: null, sorties: [], debut: jobs.nowIso(), fin: null,
    etat: 'en-cours', code: null, vivacite: 'pid+starttime',
  }, champs);
  fs.mkdirSync(jobs.jobsDir(dir), { recursive: true });
  fs.writeFileSync(jobs.statePath(dir, id), JSON.stringify(etat, null, 2));
}

/** Chef de groupe « étranger » : processus détaché qui n'appartient à aucun job. */
function groupeEtranger() {
  const p = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)'], { detached: true, stdio: 'ignore' });
  p.unref();
  noterGroupe(p.pid);
  attendreQue(() => jobs.starttimeDe(p.pid) !== null);
  return p.pid;
}

/** Chef de groupe vivant (un zombie non encore récolté par ce processus de test compte pour mort). */
function groupeVit(pgid) {
  const s = etatProcessus(pgid);
  return s !== null && s !== 'Z';
}

test('revue n° 1 : arreter ne tue jamais un groupe dont le starttime ne correspond pas, ni un job terminé', () => {
  const dir = nouveauDir();
  const pgid = groupeEtranger();
  ecrireEtatManuel(dir, 'fini-a', { etat: 'fini', pgid, starttime_commande: '1' });
  const r1 = jobs.arreterJob(dir, 'fini-a', 'utilisateur');
  assert.equal(r1.code, 0);
  assert.equal(lireEtatDisque(dir, 'fini-a').etat, 'fini');
  ecrireEtatManuel(dir, 'orph-b', { etat: 'en-cours', pgid, starttime_commande: '1' });
  jobs.arreterJob(dir, 'orph-b', 'utilisateur');
  ecrireEtatManuel(dir, 'orph-c', { etat: 'en-cours', pgid, starttime_commande: null });
  jobs.arreterJob(dir, 'orph-c', 'utilisateur');
  assert.equal(groupeVit(pgid), true, 'groupe étranger tué');
  assert.equal(lireEtatDisque(dir, 'orph-b').etat, 'arrete');
  // Témoin : starttime exact (commande orpheline réellement à ce job) → groupe tué.
  ecrireEtatManuel(dir, 'orph-d', { etat: 'en-cours', pgid, starttime_commande: jobs.starttimeDe(pgid) });
  jobs.arreterJob(dir, 'orph-d', 'utilisateur');
  attendreQue(() => !groupeVit(pgid));
});

test('revue n° 13 et 41 : reprendre tue la commande orpheline (même arrêtée par SIGSTOP) avant de la déclarer interrompue', () => {
  const dir = nouveauDir();
  const pgid = groupeEtranger();
  process.kill(pgid, 'SIGSTOP');
  const st = jobs.starttimeDe(pgid);
  ecrireEtatManuel(dir, 'orph-cmd', { etat: 'suspendu', pgid, starttime_commande: st, cwd: dir });
  assert.equal(jobs.jobsVivantsDans(dir, dir).length, 1, 'commande orpheline vivante ignorée par jobsVivantsDans');
  jobs.reprendre(dir);
  assert.equal(lireEtatDisque(dir, 'orph-cmd').etat, 'interrompu');
  assert.equal(groupeVit(pgid), false, 'commande orpheline toujours vivante après reprendre');
});

test('revue n° 49 : liste --vivants n\'affiche pas un job actif au superviseur mort', () => {
  const dir = nouveauDir();
  ecrireEtatManuel(dir, 'orph-liste', { etat: 'en-cours' });
  assert.equal(jobs.listerJobs(dir, { vivants: true }).length, 0);
  assert.equal(jobs.listerJobs(dir, {}).length, 1);
});

test('revue n° 37 : reprendre d\'un orphelin reprenable au cwd disparu → code 0, « non repris », aucun fantôme', () => {
  const dir = nouveauDir();
  ecrireEtatManuel(dir, 'orph-cwd', { reprenable: true, cwd: path.join(dir, 'worktree-nettoye') });
  for (let i = 0; i < 2; i += 1) {
    const r = spawnSync(process.execPath, [CLI, 'reprendre'], { cwd: dir, env: envDeBase(dir), encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    if (i === 0) assert.match(r.stdout, /orph-cwd non repris : répertoire de travail absent/);
    const etats = fs.readdirSync(jobs.jobsDir(dir)).filter((f) => f.endsWith('.json'));
    assert.deepEqual(etats, ['orph-cwd.json'], 'aucun job fantôme en-file');
  }
  assert.equal(lireEtatDisque(dir, 'orph-cwd').etat, 'interrompu');
});

test('revue n° 39 : arreter tue aussi les membres du groupe qui ignorent SIGTERM quand le chef meurt', () => {
  const dir = nouveauDir();
  const pidFile = path.join(dir, 'membre.pid');
  const script = `const c = require('child_process').spawn('sh', ['-c', 'trap "" TERM; exec sleep 120'], { stdio: 'ignore' });`
    + `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); setTimeout(() => {}, 60000);`;
  const { id, pid } = jobs.lancer({ nom: 'job-groupe', root: dir, cwd: dir, commande: ['node', '-e', script] });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'en-cours' && fs.existsSync(pidFile));
  noterGroupe(lireEtatDisque(dir, id).pgid);
  attendreQue(() => fs.readFileSync(pidFile, 'utf8') !== '');
  const membre = Number(fs.readFileSync(pidFile, 'utf8'));
  attendreQue(() => etatProcessus(membre) !== null);
  const r = spawnSync(process.execPath, [CLI, 'arreter', id], { cwd: dir, env: envDeBase(dir), encoding: 'utf8' });
  assert.equal(r.status, 0);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'arrete', { maxMs: 8000 });
  attendreQue(() => { const s = etatProcessus(membre); return s === null || s === 'Z'; }, { maxMs: 7000 });
  const s = etatProcessus(membre);
  assert.ok(s === null || s === 'Z', `membre du groupe encore vivant 7 s après l'arrêt (état ${s})`);
});

test('revue n° 47 : depuis un vrai worktree git, racine() et lancer() retombent sur la racine principale (V1-1)', () => {
  const dir = fs.realpathSync(nouveauDir());
  const git = (args, cwd) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, `git ${args.join(' ')} : ${r.stderr}`);
  };
  git(['init', '-q'], dir);
  git(['-c', 'user.email=t@t.t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], dir);
  const wt = path.join(dir, 'mission', '.holarch', 'worktrees', 'a');
  git(['worktree', 'add', '-q', '-b', 'holarch/a', wt], dir);
  fs.mkdirSync(path.join(wt, 'sous'), { recursive: true });
  assert.equal(jobs.racine(wt), dir, 'racine d\'un worktree = racine principale, jamais .git/worktrees');
  assert.equal(jobs.racine(path.join(wt, 'sous')), dir);
  const { id, pid } = jobs.lancer({ nom: 'job-wt', cwd: wt, commande: ['node', '-e', 'process.exit(0)'] });
  noterGroupe(pid);
  assert.ok(fs.existsSync(jobs.statePath(dir, id)), 'état du job écrit sous la racine principale');
  attendreQue(() => ['fini', 'echoue'].includes((lireEtatDisque(dir, id) || {}).etat));
});

// -- 5. evalJob -----------------------------------------------------------------------------------

test('evalJob : terminal → vrai ; en-cours vivant → faux ; orphelin non terminal → vrai sans réécrire ; inconnu → faux', () => {
  const dir = nouveauDir();
  const { id, pid } = jobs.lancer({
    nom: 'job-evaljob', root: dir, cwd: dir,
    commande: ['node', '-e', 'setTimeout(() => {}, 20000)'],
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'en-cours');
  assert.equal(jobs.evalJob(dir, id).vrai, false);

  jobs.arreterJob(dir, id, 'utilisateur');
  attendreQue(() => lireEtatDisque(dir, id).etat === 'arrete');
  assert.equal(jobs.evalJob(dir, id).vrai, true);

  const idOrphelin = 'orphelin-manuel-20260101t000000-abcd';
  const etatOrphelin = {
    id: idOrphelin, nom: 'orphelin-manuel', proprietaire: 'utilisateur',
    pid_superviseur: 999999999, starttime_superviseur: '1', pgid: null, starttime_commande: null,
    commande: ['node', '-e', 'process.exit(0)'], cwd: dir, lourd: false, reprenable: false,
    valider: null, progression: null, sorties: [], debut: jobs.nowIso(), fin: null,
    etat: 'en-cours', code: null, vivacite: 'pid+starttime',
  };
  fs.mkdirSync(jobs.jobsDir(dir), { recursive: true });
  fs.writeFileSync(jobs.statePath(dir, idOrphelin), JSON.stringify(etatOrphelin, null, 2));
  const avant = fs.readFileSync(jobs.statePath(dir, idOrphelin), 'utf8');
  const res = jobs.evalJob(dir, idOrphelin);
  assert.equal(res.vrai, true);
  const apres = fs.readFileSync(jobs.statePath(dir, idOrphelin), 'utf8');
  assert.equal(avant, apres);

  assert.equal(jobs.evalJob(dir, 'id-totalement-inconnu').vrai, false);
});

// -- 6. réveil ------------------------------------------------------------------------------------

test('réveil : job fini d\'une instance → seam reçu avec --pour ; propriétaire utilisateur → aucun appel', () => {
  const dir = nouveauDir();
  const capture = path.join(dir, 'reveil-capture.json');
  const seam = path.join(dir, 'seam-reveil.js');
  fs.writeFileSync(seam, `require('fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\n`);

  const ancienneSeam = process.env.HOLARCH_JOB_REVEIL;
  try {
    process.env.HOLARCH_JOB_REVEIL = seam;

    const r2 = jobs.lancer({
      nom: 'job-reveil-2', root: dir, cwd: dir, proprietaire: 'concepteur/a',
      commande: ['node', '-e', 'process.exit(0)'],
    });
    noterGroupe(r2.pid);
    attendreQue(() => lireEtatDisque(dir, r2.id).etat === 'fini');
    attendreQue(() => fs.existsSync(capture));
    const argv = JSON.parse(fs.readFileSync(capture, 'utf8'));
    assert.deepEqual(argv, ['--reveil', '--pour', 'concepteur/a', '--declencheur', `job:${r2.id}`, '--root', dir]);

    fs.rmSync(capture, { force: true });
    const r3 = jobs.lancer({
      nom: 'job-reveil-utilisateur', root: dir, cwd: dir, proprietaire: 'utilisateur',
      commande: ['node', '-e', 'process.exit(0)'],
    });
    noterGroupe(r3.pid);
    attendreQue(() => lireEtatDisque(dir, r3.id).etat === 'fini');
    // Pas d'événement à attendre (aucun appel prévu) : une courte pause bornée suffit à laisser une
    // éventuelle écriture erronée du fichier de capture se produire avant de vérifier son absence.
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 300)']);
    assert.equal(fs.existsSync(capture), false);
  } finally {
    if (ancienneSeam === undefined) delete process.env.HOLARCH_JOB_REVEIL;
    else process.env.HOLARCH_JOB_REVEIL = ancienneSeam;
  }
});

/** Seam de réveil qui capture son argv dans `capture` ; restaure l'environnement après `fn`. */
function avecSeamReveil(dir, fn) {
  const capture = path.join(dir, 'reveil-capture.json');
  const seam = path.join(dir, 'seam-reveil.js');
  fs.writeFileSync(seam, `require('fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\n`);
  const ancienneSeam = process.env.HOLARCH_JOB_REVEIL;
  try {
    process.env.HOLARCH_JOB_REVEIL = seam;
    fn(capture);
  } finally {
    if (ancienneSeam === undefined) delete process.env.HOLARCH_JOB_REVEIL;
    else process.env.HOLARCH_JOB_REVEIL = ancienneSeam;
  }
}

test('revue n° 7 : job fini pendant la session de son propriétaire → réveil différé jusqu\'à la fin de la session', () => {
  const dir = nouveauDir();
  avecSeamReveil(dir, (capture) => {
    const verrouLive = path.join(dir, 'mission', '.holarch', 'live', 'concepteur-a.json');
    fs.mkdirSync(path.dirname(verrouLive), { recursive: true });
    fs.writeFileSync(verrouLive, JSON.stringify({ pid: process.pid }));
    const { id, pid } = jobs.lancer({
      nom: 'court', root: dir, cwd: dir, proprietaire: 'concepteur/a', commande: ['node', '-e', 'process.exit(0)'],
    });
    noterGroupe(pid);
    attendreQue(() => lireEtatDisque(dir, id).etat === 'fini');
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 800)']);
    assert.equal(fs.existsSync(capture), false, 'réveil lancé pendant que le propriétaire est vivant (il sera écarté)');
    fs.rmSync(verrouLive);
    attendreQue(() => fs.existsSync(capture), { maxMs: 5000 });
    assert.ok(JSON.parse(fs.readFileSync(capture, 'utf8')).includes(`job:${id}`));
  });
});

test('revue n° 12 : reprendre réveille le propriétaire d\'un job orphelin passé à interrompu', () => {
  const dir = nouveauDir();
  avecSeamReveil(dir, (capture) => {
    ecrireEtatManuel(dir, 'orph-reveil', { etat: 'en-cours', proprietaire: 'concepteur/a' });
    jobs.reprendre(dir);
    assert.equal(lireEtatDisque(dir, 'orph-reveil').etat, 'interrompu');
    attendreQue(() => fs.existsSync(capture), { maxMs: 5000 });
    assert.ok(JSON.parse(fs.readFileSync(capture, 'utf8')).includes('job:orph-reveil'));
  });
});

/** Seam qui ajoute une ligne à `capture` par appel et sort avec les codes de `codes` (dernier répété). */
function avecSeamCompteur(dir, codes, fn) {
  const capture = path.join(dir, 'reveil-appels.txt');
  const seam = path.join(dir, 'seam-compteur.js');
  fs.writeFileSync(seam, `const fs = require('fs'); fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const n = fs.readFileSync(${JSON.stringify(capture)}, 'utf8').trim().split('\\n').length; const codes = ${JSON.stringify(codes)};
process.exit(codes[Math.min(n, codes.length) - 1]);\n`);
  const ancienneSeam = process.env.HOLARCH_JOB_REVEIL;
  try {
    process.env.HOLARCH_JOB_REVEIL = seam;
    fn(() => { try { return fs.readFileSync(capture, 'utf8').trim().split('\n').filter(Boolean).length; } catch (_) { return 0; } });
  } finally {
    if (ancienneSeam === undefined) delete process.env.HOLARCH_JOB_REVEIL;
    else process.env.HOLARCH_JOB_REVEIL = ancienneSeam;
  }
}

test('seconde revue n° 51/54 : reprendre à 6 orphelins d\'un même propriétaire (guetteurs concurrents réels), 3 tours → un seul réveil par tour, pas 6', () => {
  const bilan = [];
  for (let tour = 0; tour < 3; tour += 1) {
    const dir = nouveauDir();
    avecSeamCompteur(dir, [0], (appels) => {
      const verrouLive = path.join(dir, 'mission', '.holarch', 'live', 'concepteur-a.json');
      fs.mkdirSync(path.dirname(verrouLive), { recursive: true });
      fs.writeFileSync(verrouLive, JSON.stringify({ pid: process.pid }));
      for (let i = 0; i < 6; i += 1) ecrireEtatManuel(dir, `orph-${i}`, { etat: 'en-cours', proprietaire: 'concepteur/a' });
      jobs.reprendre(dir);
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 1200)']);
      assert.equal(appels(), 0, 'aucun réveil tant que le propriétaire est en session');
      fs.rmSync(verrouLive);
      attendreQue(() => appels() >= 1, { maxMs: 5000 });
      spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 2500)']);
      bilan.push(appels());
    });
  }
  assert.ok(bilan.every((n) => n >= 1 && n <= 2), `réveils par tour : ${bilan.join(', ')} (attendu 1, au plus 2 — jamais un par job)`);
});

test('seconde revue n° 52 : `--reveil --pour` répond « occupée » (code 3) → le guetteur se ré-arme et relance, jamais éteint sans réveil', () => {
  const dir = nouveauDir();
  avecSeamCompteur(dir, [3, 0], (appels) => {
    ecrireEtatManuel(dir, 'orph-52', { etat: 'en-cours', proprietaire: 'concepteur/a' });
    jobs.reprendre(dir);
    attendreQue(() => appels() >= 2, { maxMs: 6000 });
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 1500)']);
    assert.equal(appels(), 2, 'un appel occupé (3), puis un seul réveil effectif (0)');
  });
});

test('seconde revue n° 53 : arreter un job orphelin (superviseur mort) → état arrete ET réveil du propriétaire', () => {
  const dir = nouveauDir();
  avecSeamCompteur(dir, [0], (appels) => {
    ecrireEtatManuel(dir, 'orph-53', { etat: 'en-cours', proprietaire: 'concepteur/a' });
    const r = jobs.arreterJob(dir, 'orph-53', 'utilisateur');
    assert.match(r.message, /superviseur déjà mort/);
    assert.equal(lireEtatDisque(dir, 'orph-53').etat, 'arrete');
    attendreQue(() => appels() >= 1, { maxMs: 5000 });
  });
});

test('revue n° 11 : commande introuvable → echoue (code 127) et réveil du propriétaire, jamais en-cours pour toujours', () => {
  const dir = nouveauDir();
  const capture = path.join(dir, 'reveil-capture.json');
  const seam = path.join(dir, 'seam-reveil.js');
  fs.writeFileSync(seam, `require('fs').writeFileSync(${JSON.stringify(capture)}, JSON.stringify(process.argv.slice(2)));\n`);
  const ancienneSeam = process.env.HOLARCH_JOB_REVEIL;
  try {
    process.env.HOLARCH_JOB_REVEIL = seam;
    const { id, pid } = jobs.lancer({
      nom: 'typo', root: dir, cwd: dir, proprietaire: 'concepteur/a', sorties: [path.join(dir, 'out.txt')],
      commande: ['commande-qui-nexiste-pas-holarch', 'arg'],
    });
    noterGroupe(pid);
    attendreQue(() => lireEtatDisque(dir, id).etat === 'echoue');
    assert.equal(lireEtatDisque(dir, id).code, 127);
    attendreQue(() => fs.existsSync(capture));
    assert.ok(JSON.parse(fs.readFileSync(capture, 'utf8')).includes(`job:${id}`));
  } finally {
    if (ancienneSeam === undefined) delete process.env.HOLARCH_JOB_REVEIL;
    else process.env.HOLARCH_JOB_REVEIL = ancienneSeam;
  }
});

// -- 7. reprendre ---------------------------------------------------------------------------------

test('reprendre : orphelin reprenable → interrompu + partiel supprimé + nouveau job qui finit', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const sortie = path.join(sortieDir, 'resultat.txt');
  const partiel = `${sortie}.partiel`;
  fs.writeFileSync(partiel, 'partiel abandonné');
  const id = 'orphelin-reprenable-20260101t000000-aaaa';
  const etatOrphelin = {
    id, nom: 'orphelin-reprenable', proprietaire: 'utilisateur',
    pid_superviseur: 999999998, starttime_superviseur: '1', pgid: null, starttime_commande: null,
    commande: ['node', '-e', `require('fs').writeFileSync(process.env.HOLARCH_JOB_SORTIE_1, 'nouveau')`],
    cwd: dir, lourd: false, reprenable: true,
    valider: null, progression: null, sorties: [sortie], debut: jobs.nowIso(), fin: null,
    etat: 'en-cours', code: null, vivacite: 'pid+starttime',
  };
  fs.mkdirSync(jobs.jobsDir(dir), { recursive: true });
  fs.writeFileSync(jobs.statePath(dir, id), JSON.stringify(etatOrphelin, null, 2));

  const res = jobs.reprendre(dir);
  assert.equal(lireEtatDisque(dir, id).etat, 'interrompu');
  assert.equal(fs.existsSync(partiel), false);
  const ligneNouveau = res.lignes.find((l) => l.includes('repris'));
  assert.ok(ligneNouveau);
  const nouveauId = ligneNouveau.match(/nouveau job (\S+)$/)[1];
  const nouveauEtat = lireEtatDisque(dir, nouveauId);
  assert.equal(nouveauEtat.reprise_de, id);
  noterGroupe(nouveauEtat.pid_superviseur);
  attendreQue(() => lireEtatDisque(dir, nouveauId).etat === 'fini');
});

test('reprendre : orphelin non reprenable → interrompu seul (pas de relance)', () => {
  const dir = nouveauDir();
  const id = 'orphelin-non-reprenable-20260101t000000-bbbb';
  const etatOrphelin = {
    id, nom: 'orphelin-non-reprenable', proprietaire: 'utilisateur',
    pid_superviseur: 999999997, starttime_superviseur: '1', pgid: null, starttime_commande: null,
    commande: ['node', '-e', 'process.exit(0)'], cwd: dir, lourd: false, reprenable: false,
    valider: null, progression: null, sorties: [], debut: jobs.nowIso(), fin: null,
    etat: 'en-cours', code: null, vivacite: 'pid+starttime',
  };
  fs.mkdirSync(jobs.jobsDir(dir), { recursive: true });
  fs.writeFileSync(jobs.statePath(dir, id), JSON.stringify(etatOrphelin, null, 2));

  const avantIds = new Set(fs.readdirSync(jobs.jobsDir(dir)).filter((f) => f.endsWith('.json')));
  const res = jobs.reprendre(dir);
  assert.equal(lireEtatDisque(dir, id).etat, 'interrompu');
  const apresIds = new Set(fs.readdirSync(jobs.jobsDir(dir)).filter((f) => f.endsWith('.json')));
  assert.equal(apresIds.size, avantIds.size);
  assert.equal(res.lignes.some((l) => l.includes('repris')), false);
});

// -- 8. --valider CLI avec guillemets --------------------------------------------------------------

test('--valider CLI avec guillemets : découpage correct sans shell', () => {
  const opts = jobs.parseLancerArgs([
    'job-valider-guillemets', '--valider', 'node -e "process.exit(0)" {fichier}', '--',
    'node', '-e', 'process.exit(0)',
  ]);
  assert.deepEqual(opts.valider, ['node', '-e', 'process.exit(0)', '{fichier}']);
});

test('--valider CLI de bout en bout : job publié via un valider entre guillemets', () => {
  const dir = nouveauDir();
  const sortieDir = nouveauDir();
  const sortie = path.join(sortieDir, 'resultat.txt');
  const r = spawnSync(process.execPath, [
    CLI, 'lancer', 'job-valider-cli', '--sortie', sortie,
    '--valider', 'node -e "process.exit(0)" {fichier}',
    '--', 'node', '-e', `require('fs').writeFileSync(process.env.HOLARCH_JOB_SORTIE_1, 'ok')`,
  ], { cwd: dir, env: envDeBase(dir), encoding: 'utf8' });
  assert.equal(r.status, 0);
  const id = r.stdout.trim();
  const etat0 = lireEtatDisque(dir, id);
  noterGroupe(etat0.pid_superviseur);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'fini');
  assert.equal(fs.readFileSync(sortie, 'utf8'), 'ok');
});

// -- 9. reveil.js (skip hors clone) -----------------------------------------------------------------

test('reveil.js : job:<id> reconnu par parseReveil/evalReveil (skip hors clone)', (t) => {
  let reveil;
  try {
    reveil = require(path.join(__dirname, '..', 'bin', 'reveil.js'));
  } catch (_err) {
    t.skip('reveil.js absent de ce clone (fragment pas encore appliqué)');
    return;
  }
  const ast = reveil.parseReveil('job:x-1');
  // Revue n° 40 : reveil.js présent (clone ou dépôt promu) => le terme job: doit être reconnu, jamais un saut
  // silencieux qui laisserait npm test vert si le fragment disparaissait.
  assert.ok(ast, 'reveil.js sans le terme job: (fragment reveil.fragment-parseterm-job.js non appliqué)');
  const dir = nouveauDir();
  const { id, pid } = jobs.lancer({
    nom: 'job-reveiljs', root: dir, cwd: dir,
    commande: ['node', '-e', 'process.exit(0)'],
  });
  noterGroupe(pid);
  attendreQue(() => lireEtatDisque(dir, id).etat === 'fini');
  const ast2 = reveil.parseReveil(`lun(job:${id}, message:RESPONSE)`);
  const ctx = { root: dir, chemin: 'x', readInbox: () => '' };
  const res = reveil.evalReveil(ast2, ctx);
  assert.equal(res.satisfied, true);
});

// -- 10. charge machine (§18.5) ---------------------------------------------------------------------

/** État d'ordonnancement d'un pid (`R`, `S`, `T`…), `null` s'il n'existe plus. */
function etatProcessus(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return s.slice(s.lastIndexOf(')') + 2).split(' ')[0];
  } catch (_err) { return null; }
}

/** Environnement de charge isolé : jetons et file dans un répertoire temporaire, mémoire simulée. */
function envCharge(meminfo, extra) {
  return Object.assign({
    HOLARCH_CHARGE_DIR: path.join(nouveauDir(), 'charge'),
    HOLARCH_MEMINFO: meminfo,
    HOLARCH_CHARGE_TICK_MS: '100',
    HOLARCH_CHARGE_SUSPENSION_MIN_MS: '100',
  }, extra || {});
}

function lancerLourd(dir, vars, nom) {
  let r;
  envChargeTemp(vars, () => {
    r = jobs.lancer({
      nom, root: dir, cwd: dir, lourd: true,
      commande: ['node', '-e', 'setInterval(() => {}, 1000)'],
    });
  });
  noterGroupe(r.pid);
  return r.id;
}

test('decisionSuspension : plus récent suspendu, seul en cours jamais, fenêtre de 15 s, plus ancien repris', () => {
  const j = (n, debut, suspendu) => ({ n, debut, suspendu: !!suspendu });
  const deux = [j(0, '2026-01-01T00:00:01Z'), j(1, '2026-01-01T00:00:02Z')];
  assert.deepEqual(charge.decisionSuspension(deux, 1000, 3000, null, 0, 15000), { action: 'suspendre', cible: 1 });
  assert.equal(charge.decisionSuspension([j(0, 'a')], 1000, 3000, null, 0, 15000), null);
  assert.equal(charge.decisionSuspension(deux, 1000, 3000, 10000, 20000, 15000), null);
  assert.equal(charge.decisionSuspension(deux, null, 3000, null, 0, 15000), null);
  const susp = [j(0, '2026-01-01T00:00:01Z'), j(1, '2026-01-01T00:00:02Z', true), j(2, '2026-01-01T00:00:03Z', true)];
  assert.deepEqual(charge.decisionSuspension(susp, 4500, 3000, null, 0, 15000), { action: 'reprendre', cible: 1 });
  assert.equal(charge.decisionSuspension(susp, 4499, 3000, null, 0, 15000), null);
});

test('revue n° 14 : tous les jobs vivants suspendus (le seul en cours a fini) → le plus ancien reprend, même sous le plancher', () => {
  const j = (n, debut, suspendu) => ({ n, debut, suspendu: !!suspendu });
  const tousSuspendus = [j(1, '2026-01-01T00:00:02Z', true), j(2, '2026-01-01T00:00:03Z', true)];
  assert.deepEqual(charge.decisionSuspension(tousSuspendus, 1000, 3000, null, 0, 15000), { action: 'reprendre', cible: 1 });
  assert.deepEqual(charge.decisionSuspension(tousSuspendus, 3500, 3000, null, 0, 15000), { action: 'reprendre', cible: 1 });
});

test('jetons : pris par un vivant → refusé ; jeton au pid mort → repris et signalé', () => {
  const dir = path.join(nouveauDir(), 'charge');
  const info = { pid: process.pid, starttime: charge.starttimeDe(process.pid), job: 'a', proprietaire: 'x' };
  assert.deepEqual(charge.prendreJeton(dir, 1, info), { n: 0, repris: false });
  assert.equal(charge.prendreJeton(dir, 1, Object.assign({}, info, { job: 'b' })), null);
  const mort = spawnSync(process.execPath, ['-e', 'process.exit(0)']).pid;
  fs.writeFileSync(charge.jetonPath(dir, 0), JSON.stringify({ pid: mort, job: 'ancien', proprietaire: 'y' }));
  const r = charge.prendreJeton(dir, 1, info);
  assert.equal(r.repris, true);
  assert.equal(r.ancienJob, 'ancien');
  charge.libererJeton(dir, 0, process.pid);
  assert.equal(fs.existsSync(charge.jetonPath(dir, 0)), false);
});

test('trois lourds pour deux jetons : le troisième en file, démarre à la libération ; arreter en file → arrete', () => {
  const dir = nouveauDir();
  const mem = path.join(dir, 'meminfo');
  ecrireMeminfo(mem, 16000);
  const vars = envCharge(mem);
  const a = lancerLourd(dir, vars, 'lourd-a');
  attendreQue(() => lireEtatDisque(dir, a).etat === 'en-cours');
  const b = lancerLourd(dir, vars, 'lourd-b');
  attendreQue(() => lireEtatDisque(dir, b).etat === 'en-cours');
  const c = lancerLourd(dir, vars, 'lourd-c');
  const d = lancerLourd(dir, vars, 'lourd-d');
  try {
    attendreQue(() => lireEtatDisque(dir, d).pid_superviseur !== null);
    attendreQue(() => charge.ticketsVivants(vars.HOLARCH_CHARGE_DIR).length === 2);
    assert.equal(lireEtatDisque(dir, c).etat, 'en-file');
    assert.equal(lireEtatDisque(dir, d).etat, 'en-file');
    jobs.arreterJob(dir, d, 'utilisateur');
    attendreQue(() => lireEtatDisque(dir, d).etat === 'arrete');
    jobs.arreterJob(dir, a, 'utilisateur');
    attendreQue(() => lireEtatDisque(dir, c).etat === 'en-cours', { maxMs: 8000 });
    assert.equal(charge.jetonsVivants(vars.HOLARCH_CHARGE_DIR, 2).length, 2);
  } finally {
    for (const id of [a, b, c, d]) arreterSansEchec(dir, id);
  }
  attendreQue(() => [a, b, c].every((id) => lireEtatDisque(dir, id).etat === 'arrete'), { maxMs: 8000 });
  assert.equal(charge.jetonsVivants(vars.HOLARCH_CHARGE_DIR, 2).length, 0);
});

test('mémoire sous plancher : le plus récent suspendu (SIGSTOP), le plus ancien jamais ; repris au-dessus de plancher + 1500', () => {
  const dir = nouveauDir();
  const mem = path.join(dir, 'meminfo');
  ecrireMeminfo(mem, 16000);
  const vars = envCharge(mem);
  const a = lancerLourd(dir, vars, 'ancien');
  attendreQue(() => lireEtatDisque(dir, a).etat === 'en-cours');
  const b = lancerLourd(dir, vars, 'recent');
  try {
    attendreQue(() => lireEtatDisque(dir, b).etat === 'en-cours');
    ecrireMeminfo(mem, 1000);
    attendreQue(() => lireEtatDisque(dir, b).etat === 'suspendu');
    attendreQue(() => etatProcessus(lireEtatDisque(dir, b).pgid) === 'T');
    assert.equal(lireEtatDisque(dir, a).etat, 'en-cours');
    ecrireMeminfo(mem, 4600);
    attendreQue(() => lireEtatDisque(dir, b).etat === 'en-cours');
    attendreQue(() => etatProcessus(lireEtatDisque(dir, b).pgid) !== 'T');
    ecrireMeminfo(mem, 1000);
    attendreQue(() => lireEtatDisque(dir, b).etat === 'suspendu');
    const pgid = lireEtatDisque(dir, b).pgid;
    jobs.arreterJob(dir, b, 'utilisateur');
    attendreQue(() => lireEtatDisque(dir, b).etat === 'arrete', { maxMs: 8000 });
    attendreQue(() => etatProcessus(pgid) === null || etatProcessus(pgid) === 'Z');
  } finally {
    arreterSansEchec(dir, a);
    arreterSansEchec(dir, b);
  }
  attendreQue(() => lireEtatDisque(dir, a).etat === 'arrete', { maxMs: 8000 });
});

test('jobsVivantsDans (amendement 5) : job vivant dont le cwd est sous le worktree nommé ; terminé ou ailleurs → absent', () => {
  const dir = nouveauDir();
  const wt = path.join(dir, 'wt');
  const ailleurs = path.join(dir, 'wt-bis');
  fs.mkdirSync(wt);
  fs.mkdirSync(ailleurs);
  const { id, pid } = jobs.lancer({
    nom: 'dans-wt', root: dir, cwd: wt, commande: ['node', '-e', 'setInterval(() => {}, 1000)'],
  });
  noterGroupe(pid);
  try {
    attendreQue(() => lireEtatDisque(dir, id).etat === 'en-cours');
    assert.deepEqual(jobs.jobsVivantsDans(dir, wt).map((e) => e.id), [id]);
    assert.deepEqual(jobs.jobsVivantsDans(dir, ailleurs), []);
    jobs.arreterJob(dir, id, 'utilisateur');
    attendreQue(() => lireEtatDisque(dir, id).etat === 'arrete', { maxMs: 8000 });
    assert.deepEqual(jobs.jobsVivantsDans(dir, wt), []);
  } finally {
    arreterSansEchec(dir, id);
  }
});

test('revue n° 17 : ticket de file au pid réutilisé (starttime différent) → écarté, la file avance', () => {
  const dir = nouveauDir();
  const etranger = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  try {
    const fdir = charge.fileDir(dir);
    fs.mkdirSync(fdir, { recursive: true });
    const perime = `${'1'.padStart(20, '0')}-${etranger.pid}`;
    fs.writeFileSync(path.join(fdir, perime), JSON.stringify({ pid: etranger.pid, starttime: 'avant-redemarrage' }));
    const mien = charge.creerTicket(dir, process.pid);
    assert.deepEqual(charge.ticketsVivants(dir).map((t) => t.fichier), [mien], 'ticket d\'avant le redémarrage retiré');
    assert.equal(charge.monTicketEstLePremier(dir, mien), true);
  } finally {
    etranger.kill('SIGKILL');
  }
});

test('revue n° 15 : deux missions de max différents → la cible de suspension se voit désignée (vue machine)', () => {
  const dir = nouveauDir();
  // B (max 3) tient jeton-1 depuis longtemps ; A (max 1) vient de prendre jeton-0 : A est le plus récent.
  const groupe = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true });
  const meminfo = path.join(dir, 'meminfo');
  fs.writeFileSync(meminfo, 'MemAvailable:    1024000 kB\n');
  const avant = process.env.HOLARCH_MEMINFO;
  process.env.HOLARCH_MEMINFO = meminfo;
  try {
    fs.writeFileSync(charge.jetonPath(dir, 1), JSON.stringify({ pid: process.pid, debut: '2026-01-01T01:00:00.000Z', suspendu: false }));
    fs.writeFileSync(charge.jetonPath(dir, 0), JSON.stringify({ pid: groupe.pid, debut: '2026-01-01T02:00:00.000Z', suspendu: false }));
    assert.deepEqual(charge.jetonsVivants(dir, 1).map((j) => j.n), [0, 1], 'vue machine, pas bornée au max de A');
    const r = charge.tickSuspension(dir, { max: 1, monJetonN: 0, monPgid: groupe.pid, memoireLibreMinMo: 3000 });
    assert.equal(r, 'suspendu', 'le superviseur de A (max 1) suspend son rendu sous le plancher');
  } finally {
    if (avant === undefined) delete process.env.HOLARCH_MEMINFO; else process.env.HOLARCH_MEMINFO = avant;
    try { process.kill(-groupe.pid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
  }
});

test('revue n° 16 : file commune — un ticket en tête au petit max ne bloque pas une mission qui a des jetons libres', () => {
  const dir = nouveauDir();
  fs.writeFileSync(charge.jetonPath(dir, 0), JSON.stringify({ pid: process.pid, debut: '2026-01-01T01:00:00.000Z', suspendu: false }));
  const ticketA = charge.creerTicket(dir, process.pid, 1);
  const ticketB = charge.creerTicket(dir, process.pid, 3);
  assert.equal(charge.monTicketEstLePremier(dir, ticketA), true);
  assert.equal(charge.monTicketEstLePremier(dir, ticketB), true, 'A est saturé (jeton-0 tenu) : B passe');
  fs.unlinkSync(charge.jetonPath(dir, 0));
  assert.equal(charge.monTicketEstLePremier(dir, ticketB), false, 'jeton-0 libre : A redevient prioritaire');
});

test('revue n° 18 : memoire_libre_min_mo = 0 (accepté par config-lint) est lu 0, pas le défaut 3000', () => {
  const root = nouveauDir();
  fs.mkdirSync(path.join(root, 'framework'));
  const config = (v) => `# Configuration\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| memoire_libre_min_mo | ${v} |\n`;
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), config('0'));
  assert.equal(charge.lireParametresCharge(root).memoireLibreMinMo, 0);
  fs.writeFileSync(path.join(root, 'framework', 'CONFIG.md'), config(''));
  assert.equal(charge.lireParametresCharge(root).memoireLibreMinMo, 3000, 'cellule vide : défaut');
  assert.equal(charge.decisionSuspension([{ n: 0, debut: 'a', suspendu: false }, { n: 1, debut: 'b', suspendu: false }], 2500, 0, null, 0, 1), null,
    'plancher 0 : jamais de suspension');
});

test('seconde revue n° 56 : deux missions aux planchers différents → décision au plus haut plancher vivant (suspension et admission)', async () => {
  const dir = nouveauDir();
  // B (plancher 3000) tient jeton-1 depuis longtemps ; C1 (mission au plancher 0) tient jeton-0, plus récent.
  const groupe = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore', detached: true });
  noterGroupe(groupe.pid);
  const meminfo = path.join(dir, 'meminfo');
  ecrireMeminfo(meminfo, 2000);
  const avant = process.env.HOLARCH_MEMINFO;
  process.env.HOLARCH_MEMINFO = meminfo;
  try {
    fs.writeFileSync(charge.jetonPath(dir, 1), JSON.stringify({ pid: process.pid, debut: '2026-01-01T01:00:00.000Z', suspendu: false, plancher_mo: 3000 }));
    fs.writeFileSync(charge.jetonPath(dir, 0), JSON.stringify({ pid: groupe.pid, debut: '2026-01-01T02:00:00.000Z', suspendu: false, plancher_mo: 0 }));
    assert.equal(charge.tickSuspension(dir, { max: 3, monJetonN: 1, monPgid: process.pid, memoireLibreMinMo: 3000 }), null, 'B, le plus ancien, jamais suspendu');
    assert.equal(charge.tickSuspension(dir, { max: 3, monJetonN: 0, monPgid: groupe.pid, memoireLibreMinMo: 0 }), 'suspendu',
      'le superviseur de C1 (plancher 0) suspend C1 sous le plancher de B');
    // Admission de C2 (plancher 0) : jamais sous le plancher d'un jeton vivant.
    let sondes = 0;
    const r = await charge.admettreLourd(dir, {
      max: 3, memoireLibreMinMo: 0, tickMs: 20, info: { pid: process.pid }, verifierArret: () => { sondes += 1; return sondes > 4; },
    });
    assert.deepEqual(r, { ok: false, arrete: true }, 'C2 admis à 2000 Mo sous le plancher 3000 de B');
  } finally {
    if (avant === undefined) delete process.env.HOLARCH_MEMINFO; else process.env.HOLARCH_MEMINFO = avant;
    try { process.kill(-groupe.pid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
  }
  // Le plancher de la mission est inscrit dans le jeton pris.
  const d2 = nouveauDir();
  const r2 = await charge.admettreLourd(d2, { max: 1, memoireLibreMinMo: 1234, tickMs: 20, info: { pid: process.pid } });
  assert.equal(JSON.parse(fs.readFileSync(charge.jetonPath(d2, r2.n), 'utf8')).plancher_mo, 1234);
});

test('seconde revue n° 55 : plancher ≥ mémoire totale → job lourd refusé au lancement (jamais en file pour toujours)', () => {
  const dir = nouveauDir();
  fs.mkdirSync(path.join(dir, 'framework'));
  fs.writeFileSync(path.join(dir, 'framework', 'CONFIG.md'), '# Configuration\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| memoire_libre_min_mo | 8000 |\n');
  const meminfo = path.join(dir, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:        4096000 kB\nMemAvailable:    3000000 kB\n');
  const vars = envCharge(meminfo);
  let err = null;
  let r = null;
  envChargeTemp(vars, () => {
    try { r = jobs.lancer({ nom: 'trop-gros', root: dir, cwd: dir, lourd: true, commande: ['node', '-e', '0'] }); } catch (e) { err = e; }
  });
  if (r) { noterGroupe(r.pid); arreterSansEchec(dir, r.id); }
  assert.ok(err, 'job lourd lancé alors que son plancher (8000 Mo) dépasse la mémoire totale (4000 Mo)');
  assert.match(err.message, /memoire_libre_min_mo/);
  assert.equal(fs.existsSync(path.join(dir, 'mission', '.holarch', 'jobs')) && fs.readdirSync(path.join(dir, 'mission', '.holarch', 'jobs')).length, false, 'aucun état écrit');
});

test('revue n° 42 : jeton vide ou illisible repris passé le délai, jamais frais', () => {
  const dir = nouveauDir();
  fs.writeFileSync(charge.jetonPath(dir, 0), '');
  assert.equal(charge.prendreJeton(dir, 1, { pid: process.pid }), null, 'jeton vide frais : peut-être en cours d\'écriture');
  const vieux = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(charge.jetonPath(dir, 0), vieux, vieux);
  const r = charge.prendreJeton(dir, 1, { pid: process.pid });
  assert.equal(r && r.n, 0);
  assert.equal(r.repris, true);
  assert.equal(JSON.parse(fs.readFileSync(charge.jetonPath(dir, 0), 'utf8')).pid, process.pid);
});

// -- Seconde revue, n° 41 -------------------------------------------------------------------------

test('seconde revue n° 41 (jobs) : superviseur tué (kill -9), groupe vivant → jamais jobs_lourds_max + 1, l\'orphelin est tué avant la reprise du jeton', () => {
  const dir = nouveauDir();
  const mem = path.join(dir, 'meminfo');
  ecrireMeminfo(mem, 16000);
  const vars = envCharge(mem);
  // A lancé depuis un processus qui sort aussitôt (comme la CLI) : son superviseur n'est pas un enfant de ce test,
  // donc réellement mort (pas zombie) après kill -9.
  const sortie = spawnSync(process.execPath, ['-e', 'const r = require(process.argv[1]).lancer({ nom: \'orphelin-a\', root: process.argv[2], cwd: process.argv[2], lourd: true, commande: [process.execPath, \'-e\', \'setInterval(() => {}, 1000)\'] }); process.stdout.write(JSON.stringify(r));',
    path.join(__dirname, '..', 'bin', 'jobs.js'), dir], { cwd: dir, env: { ...process.env, ...vars }, encoding: 'utf8' });
  const a = JSON.parse(sortie.stdout).id;
  noterGroupe(JSON.parse(sortie.stdout).pid);
  attendreQue(() => lireEtatDisque(dir, a).etat === 'en-cours' && lireEtatDisque(dir, a).pgid);
  const b = lancerLourd(dir, vars, 'vivant-b');
  attendreQue(() => lireEtatDisque(dir, b).etat === 'en-cours');
  const { pgid: pgidA, pid_superviseur: supA } = lireEtatDisque(dir, a);
  noterGroupe(pgidA);
  let c = null;
  try {
    // Le superviseur note le groupe au jeton juste après le spawn (sans cette note — code d'avant —, le jeton n'a que son pid).
    const jetonA = () => { try { return JSON.parse(fs.readFileSync(charge.jetonPath(vars.HOLARCH_CHARGE_DIR, 0), 'utf8')); } catch (_e) { return null; } };
    attendreQue(() => jetonA() && (typeof charge.noterGroupeJeton !== 'function' || jetonA().pgid === pgidA));
    process.kill(supA, 'SIGKILL');
    assert.equal(['S', 'R'].includes(etatProcessus(pgidA)), true, 'la commande de A survit à son superviseur');
    c = lancerLourd(dir, vars, 'nouveau-c');
    attendreQue(() => lireEtatDisque(dir, c).etat === 'en-cours', { maxMs: 8000 });
    const etatA = etatProcessus(pgidA);
    assert.equal(etatA === null || etatA === 'Z', true, `groupe orphelin de A mort quand C démarre (état ${etatA}) : au plus 2 lourds`);
  } finally {
    try { process.kill(-pgidA, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
    for (const id of [b, c].filter(Boolean)) arreterSansEchec(dir, id);
  }
  attendreQue(() => [b, c].filter(Boolean).every((id) => lireEtatDisque(dir, id).etat === 'arrete'), { maxMs: 8000 });
});

test('seconde revue n° 41 (charge) : écriture de la suspension en échec après SIGSTOP → superviseur vivant, groupe repris, jamais arrêté pour toujours', () => {
  const dir = nouveauDir();
  const mem = path.join(dir, 'meminfo');
  ecrireMeminfo(mem, 16000);
  const vars = envCharge(mem);
  const a = lancerLourd(dir, vars, 'ancien-a');
  attendreQue(() => lireEtatDisque(dir, a).etat === 'en-cours');
  const b = lancerLourd(dir, vars, 'recent-b');
  const bloquant = path.join(vars.HOLARCH_CHARGE_DIR, 'derniere-suspension');
  try {
    attendreQue(() => lireEtatDisque(dir, b).etat === 'en-cours' && lireEtatDisque(dir, b).pgid);
    fs.mkdirSync(bloquant); // writeFileSync(derniere-suspension) lève EISDIR : émule EACCES/ENOSPC
    ecrireMeminfo(mem, 1000);
    spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 1500)']); // ≈ 15 ticks sous le plancher
    const { pgid: pgidB, pid_superviseur: supB } = lireEtatDisque(dir, b);
    assert.equal(![null, 'Z'].includes(etatProcessus(supB)), true, 'superviseur de B vivant malgré l\'échec d\'écriture');
    fs.rmdirSync(bloquant);
    ecrireMeminfo(mem, 16000);
    attendreQue(() => etatProcessus(pgidB) !== 'T', { maxMs: 3000 });
    assert.notEqual(lireEtatDisque(dir, b).etat, 'suspendu');
  } finally {
    try { fs.rmdirSync(bloquant); } catch (_err) { /* déjà retiré */ }
    arreterSansEchec(dir, a);
    arreterSansEchec(dir, b);
    try { process.kill(-lireEtatDisque(dir, b).pgid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
  }
  attendreQue(() => [a, b].every((id) => ['arrete', 'interrompu', 'echoue'].includes(lireEtatDisque(dir, id).etat)), { maxMs: 8000 });
});

// Seconde revue n° 57 : processus réels, départ commun par attente active sur une date, gagnants vivants jusqu'à la fin.
const TRAVAILLEUR_REPRISE = `const charge = require(process.argv[1]); const path = require('path');
const base = process.argv[2]; const t0 = Number(process.argv[3]); const manches = Number(process.argv[4]); const res = [];
for (let m = 0; m < manches; m += 1) {
  while (Date.now() < t0 + m * 100) { /* départ commun */ }
  res.push(charge.prendreJeton(path.join(base, 'm' + m), 1, { pid: process.pid, debut: new Date().toISOString() }) ? 1 : 0);
}
while (Date.now() < t0 + manches * 100 + 300) { /* gagnants vivants tant que les autres jouent */ }
process.stdout.write(res.join(''));`;

test('seconde revue n° 57 : jeton au pid mort repris par 8 processus au même instant → un seul gagnant (100 manches ; troisième revue : 1 manche double sur 30 à 4 processus ne mordait pas)', async () => {
  const base = nouveauDir();
  const MANCHES = 100;
  for (let m = 0; m < MANCHES; m += 1) {
    const d = path.join(base, `m${m}`);
    fs.mkdirSync(d);
    // starttime différent du nôtre : détenteur mort (pid réutilisé), jamais un pid au hasard.
    fs.writeFileSync(charge.jetonPath(d, 0), JSON.stringify({ pid: process.pid, starttime: 'mort-avant', debut: 'x', suspendu: false }));
  }
  const t0 = Date.now() + 1500;
  const chargeJs = path.join(__dirname, '..', 'bin', 'charge.js');
  const sorties = await Promise.all([0, 1, 2, 3, 4, 5, 6, 7].map(() => new Promise((resolve) => {
    const enfant = spawn(process.execPath, ['-e', TRAVAILLEUR_REPRISE, chargeJs, base, String(t0), String(MANCHES)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    enfant.stdout.on('data', (b) => { out += b; });
    enfant.on('exit', () => resolve(out));
  })));
  const gagnants = [];
  for (let m = 0; m < MANCHES; m += 1) gagnants.push(sorties.reduce((s, o) => s + Number(o[m] || 0), 0));
  const doubles = gagnants.filter((g) => g > 1).length;
  assert.equal(doubles, 0, `${doubles}/${MANCHES} manches à plusieurs gagnants : ${gagnants.join(',')}`);
  assert.ok(gagnants.every((g) => g === 1), `manche sans gagnant : ${gagnants.join(',')}`);
  for (let m = 0; m < MANCHES; m += 1) {
    assert.deepEqual(fs.readdirSync(path.join(base, `m${m}`)).filter((f) => f !== 'jeton-0'), [], 'marque ou temporaire laissé');
  }
});

test('seconde revue n° 57 : marque de reprise au détenteur vivant respectée, au détenteur mort reprise', () => {
  const dir = nouveauDir();
  const mort = JSON.stringify({ pid: process.pid, starttime: 'mort-avant', debut: 'x', suspendu: false });
  fs.writeFileSync(charge.jetonPath(dir, 0), mort);
  const marque = `${charge.jetonPath(dir, 0)}.reprise-${crypto.createHash('sha256').update(mort).digest('hex').slice(0, 16)}`;
  fs.writeFileSync(marque, JSON.stringify({ pid: process.pid }));
  assert.equal(charge.prendreJeton(dir, 1, { pid: process.pid }), null, 'reprise en cours ailleurs : on passe');
  assert.equal(fs.readFileSync(charge.jetonPath(dir, 0), 'utf8'), mort, 'jeton mort intact sous la marque d\'un autre');
  fs.writeFileSync(marque, JSON.stringify({ pid: process.pid, starttime: 'mort-aussi' }));
  const r = charge.prendreJeton(dir, 1, { pid: process.pid });
  assert.equal(r && r.repris, true);
  assert.deepEqual(fs.readdirSync(dir), ['jeton-0'], 'marques retirées');
});

test('seconde revue n° 58 : ticket vide au pid réutilisé (> 10 s) retiré de la file ; ticket écrit par renommage', () => {
  const dir = nouveauDir();
  const fdir = charge.fileDir(dir);
  fs.mkdirSync(fdir, { recursive: true });
  const vide = path.join(fdir, `${'1'.padStart(20, '0')}-${process.pid}`);
  fs.writeFileSync(vide, '');
  const mien = charge.creerTicket(dir, process.pid, 2);
  assert.equal(charge.monTicketEstLePremier(dir, mien), false, 'ticket vide récent : peut-être en cours d\'écriture, respecté');
  const vieux = (Date.now() - 20000) / 1000;
  fs.utimesSync(vide, vieux, vieux);
  assert.equal(charge.monTicketEstLePremier(dir, mien), true, 'ticket vide ancien : mort, retiré');
  assert.equal(fs.existsSync(vide), false);
  assert.deepEqual(fs.readdirSync(fdir), [mien], 'aucun temporaire laissé');
  assert.equal(JSON.parse(fs.readFileSync(path.join(fdir, mien), 'utf8')).max, 2);
});

test('troisième revue n° 84 : jeton vivant réécrit en boucle par un autre processus → jetonsVivants ne le voit jamais absent', async () => {
  const dir = path.join(nouveauDir(), 'charge');
  const info = { pid: process.pid, starttime: charge.starttimeDe(process.pid), job: 'a', proprietaire: 'x' };
  assert.deepEqual(charge.prendreJeton(dir, 1, info), { n: 0, repris: false });
  const CHARGE_JS = path.join(__dirname, '..', 'bin', 'charge.js');
  // Réécrivain réel (suspendu ↔ repris, comme la suspension sous plancher mémoire) pendant ~1,2 s.
  const ecrivain = spawn(process.execPath, ['-e', `const c = require(process.argv[1]); const fin = Date.now() + 1200; let s = false;
    require('fs').writeFileSync(process.argv[2] + '/pret', '1'); while (Date.now() < fin) { s = !s; c.ecrireSuspenduJeton(process.argv[2], 0, s); }`, CHARGE_JS, dir], { stdio: 'ignore' });
  const fini = new Promise((r) => { ecrivain.once('exit', r); });
  const debut = Date.now();
  while (!fs.existsSync(path.join(dir, 'pret')) && Date.now() - debut < 5000) { /* attend le départ de l'écrivain */ }
  let lectures = 0;
  let absent = 0;
  const fin = Date.now() + 800;
  while (Date.now() < fin) { lectures += 1; if (charge.jetonsVivants(dir, 1).length !== 1) absent += 1; }
  await fini;
  assert.ok(lectures > 100, `assez de lectures (${lectures})`);
  assert.equal(absent, 0, `jeton vu absent ${absent} fois sur ${lectures} lectures`);
});

test('troisième revue n° 85 : `holarch-job lancer` refusé par jobs.lancer → message et code 2, pas une pile', () => {
  const dir = nouveauDir();
  fs.mkdirSync(path.join(dir, 'framework'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'mission'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'framework', 'CONFIG.md'), '# Configuration\n\n## Paramètres\n| Paramètre | Valeur |\n|---|---|\n| memoire_libre_min_mo | 8000 |\n');
  spawnSync('git', ['init', '-q'], { cwd: dir }); // racine du job = ce dépôt jetable, jamais celui qui lance les tests
  const meminfo = path.join(dir, 'meminfo');
  fs.writeFileSync(meminfo, 'MemTotal:        4096000 kB\nMemAvailable:    3000000 kB\n');
  const env = Object.assign({}, process.env, envCharge(meminfo));
  const r = spawnSync(process.execPath, [CLI, 'lancer', 'trop-gros', '--lourd', '--', 'node', '-e', '0'], { cwd: dir, env, encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /lancement refusé : .*memoire_libre_min_mo/);
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'aucune pile d\'exception');
});
