'use strict';
/**
 * jobs.js — logique des jobs asynchrones du harnais HOLARCH (chantier 16, docs/IMPLEMENTATION.md
 * §18.4, conception mission/shared/concepteur/CONCEPTION-JOBS.md §1-§2). Module Node autonome, sans
 * dépendance (seulement les modules natifs), require-able par `holarch-job.js` (CLI mince) et par les
 * tests. Aucun appel réseau.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
// Charge machine des jobs lourds (§18.5, unité U10) : module de bas niveau, sans dépendance en
// retour vers `jobs.js` (voir l'en-tête de charge.js).
const charge = require('./charge');

const ETATS_TERMINAUX = ['fini', 'echoue', 'arrete', 'interrompu'];
const ETATS_ACTIFS = ['en-file', 'en-cours', 'suspendu'];

function nowIso() { return new Date().toISOString(); }

/** Racine principale (jamais celle d'un worktree) : dirname(git rev-parse --git-common-dir) exécuté
 *  dans `cwd`, sans shell ; repli HOLARCH_ROOT, puis cwd. */
function racine(cwd) {
  try {
    const r = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd, encoding: 'utf8' });
    if (r.status === 0 && r.stdout && r.stdout.trim()) {
      return path.dirname(r.stdout.trim());
    }
  } catch (_err) { /* pas un dépôt git, ou git absent */ }
  if (process.env.HOLARCH_ROOT) return process.env.HOLARCH_ROOT;
  return cwd;
}

function jobsDir(root) { return path.join(root, 'mission', '.holarch', 'jobs'); }
function statePath(root, id) { return path.join(jobsDir(root), `${id}.json`); }
function logFilePath(root, id) { return path.join(jobsDir(root), `${id}.log`); }
function arretFilePath(root, id) { return path.join(jobsDir(root), `${id}.arret`); }

function proprietaireActuel() { return process.env.HOLARCH_INSTANCE || 'utilisateur'; }

/** minuscules, hors [a-z0-9-] → '-', tirets multiples réduits, tirets de bord retirés, vide → 'job'. */
function normaliserNom(nom) {
  let n = String(nom == null ? '' : nom).toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (!n) n = 'job';
  return n;
}

function horodateUTC(d) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}t${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`;
}

/** `<nom>-<aaaammjjthhmmss>-<4 hex>`, tout en minuscules ; matche ^[a-z0-9-]+$. */
function genererId(nom) {
  const n = normaliserNom(nom);
  const ts = horodateUTC(new Date());
  const hex = crypto.randomBytes(2).toString('hex');
  return `${n}-${ts}-${hex}`;
}

function ecrireStateAtomique(root, id, etat) {
  const dir = jobsDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const p = statePath(root, id);
  const tmp = `${p}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(etat, null, 2));
  fs.renameSync(tmp, p);
}

function lireEtat(root, id) {
  try { return JSON.parse(fs.readFileSync(statePath(root, id), 'utf8')); } catch (_err) { return null; }
}

/** Champ 22 (starttime) de /proc/<pid>/stat, compté après la dernière ')' (le nom de commande peut
 *  contenir espaces et parenthèses). null si /proc indisponible ou pid absent. */
function starttimeDe(pid) {
  try {
    const contenu = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const idx = contenu.lastIndexOf(')');
    if (idx === -1) return null;
    const champs = contenu.slice(idx + 2).trim().split(/\s+/);
    // après ')', le premier champ lu est le champ 3 (état) ; le champ 22 est donc à l'indice 22-3=19.
    return champs[19] || null;
  } catch (_err) {
    return null;
  }
}

/** Capture au moment du spawn : { starttime, vivacite }. `vivacite` = 'pid+starttime' si /proc a
 *  répondu, sinon 'pid' (repli : kill(pid,0) seul). */
function capturerVivacite(pid) {
  const st = starttimeDe(pid);
  if (st !== null) return { starttime: st, vivacite: 'pid+starttime' };
  return { starttime: null, vivacite: 'pid' };
}

/** Vivacité d'un pid noté : kill(pid,0) et, si vivacite === 'pid+starttime', même starttime que celui
 *  noté à la création (un conteneur redémarré réutilise les petits pids). */
function estVivantSelon(pid, starttime, vivacite) {
  if (!pid) return false;
  try { process.kill(pid, 0); } catch (_err) { return false; }
  if (vivacite !== 'pid+starttime') return true;
  const actuel = starttimeDe(pid);
  if (actuel === null) return true; // /proc devenu indisponible : on ne peut plus comparer, pas de faux mort
  return actuel === starttime;
}

/** Découpage sans shell d'une commande `--valider` : espaces séparateurs, guillemets simples ou
 *  doubles groupent un argument, aucun échappement ni expansion reconnus (règle dite dans --help). */
function decouperArgv(str) {
  const s = String(str == null ? '' : str);
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"' || s[i] === "'") {
      const quote = s[i];
      i++;
      let buf = '';
      while (i < s.length && s[i] !== quote) { buf += s[i]; i++; }
      if (i < s.length) i++; // saute le guillemet fermant
      out.push(buf);
    } else {
      let buf = '';
      while (i < s.length && !/\s/.test(s[i])) { buf += s[i]; i++; }
      out.push(buf);
    }
  }
  return out;
}

/** Parse les arguments de `holarch-job lancer <nom> ...` (après le mot 'lancer'). */
function parseLancerArgs(argv) {
  if (!argv.length || argv[0].startsWith('--')) throw new Error('nom du job requis en premier argument');
  const nom = argv[0];
  const opts = {
    nom, lourd: false, sorties: [], valider: null, progression: null, reprenable: false, commande: null,
  };
  let i = 1;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '--') { opts.commande = argv.slice(i + 1); i = argv.length; break; }
    if (a === '--lourd') { opts.lourd = true; i += 1; continue; }
    if (a === '--sortie') { opts.sorties.push(argv[i + 1]); i += 2; continue; }
    if (a === '--valider') { opts.valider = decouperArgv(argv[i + 1]); i += 2; continue; }
    if (a === '--progression') { opts.progression = argv[i + 1]; i += 2; continue; }
    if (a === '--reprenable') { opts.reprenable = true; i += 1; continue; }
    throw new Error(`option inconnue : ${a}`);
  }
  if (!opts.commande || !opts.commande.length) throw new Error('commande requise après --');
  return opts;
}

/** `lancer(opts)` programmatique — opts : { nom, lourd, sorties: [chemins], valider: argv|null,
 *  progression, reprenable, commande: argv, cwd, root?, proprietaire?, reprise_de? }. Crée l'état
 *  `en-file`, démarre le superviseur détaché, rend la main (< 1 s). */
function lancer(opts) {
  const cwd = opts.cwd ? path.resolve(opts.cwd) : process.cwd();
  // Revue n° 37 : un cwd disparu (worktree nettoyé) ferait émettre 'error' au spawn du superviseur, sans
  // écouteur — plantage, et un état `en-file` fantôme déjà écrit. Refus avant toute écriture.
  let cwdOk = false;
  try { cwdOk = fs.statSync(cwd).isDirectory(); } catch (_err) { cwdOk = false; }
  if (!cwdOk) throw new Error(`répertoire de travail absent : ${cwd}`);
  const root = opts.root || racine(cwd);
  // Seconde revue n° 55 : un plancher ≥ mémoire totale ne serait jamais atteint — le job resterait `en-file` pour
  // toujours et, en tête de la file commune, bloquerait les autres missions. Refus avant toute écriture.
  if (opts.lourd) {
    const plancher = charge.lireParametresCharge(root).memoireLibreMinMo;
    const totale = charge.memoireTotaleMo();
    if (totale !== null && plancher >= totale) {
      throw new Error(`memoire_libre_min_mo = ${plancher} Mo ≥ mémoire totale ${totale} Mo : ce job lourd ne serait jamais admis`);
    }
  }
  const proprietaire = opts.proprietaire || proprietaireActuel();
  const id = genererId(opts.nom);
  const sorties = (opts.sorties || []).map((s) => path.resolve(cwd, s));

  const etat = {
    id,
    nom: opts.nom,
    proprietaire,
    pid_superviseur: null,
    starttime_superviseur: null,
    pgid: null,
    starttime_commande: null,
    commande: opts.commande,
    cwd,
    lourd: !!opts.lourd,
    reprenable: !!opts.reprenable,
    valider: opts.valider || null,
    progression: opts.progression || null,
    sorties,
    debut: null,
    fin: null,
    etat: 'en-file',
    code: null,
    vivacite: null,
  };
  if (opts.reprise_de) etat.reprise_de = opts.reprise_de;

  ecrireStateAtomique(root, id, etat);

  const holarchJobJs = path.join(__dirname, 'holarch-job.js');
  const logPath = logFilePath(root, id);
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const fdLog = fs.openSync(logPath, 'a');
  // HOLARCH_ROOT forcé (jamais seulement hérité) : le superviseur recalcule sa propre racine
  // (racine(cwd)) et doit impérativement retomber sur la même que celle décidée ici — un
  // HOLARCH_ROOT ambiant différent (ou un `git rev-parse` qui réussirait pour de tout autres
  // raisons depuis `cwd`) romprait sinon le lien entre l'état écrit ici et celui relu par le
  // superviseur, qui resterait alors muet (id introuvable) sans jamais l'écrire dans le journal.
  const env = Object.assign({}, process.env, { HOLARCH_ROOT: root });
  const enfant = spawn(process.execPath, [holarchJobJs, 'superviser', id], {
    detached: true, cwd, stdio: ['ignore', fdLog, fdLog], env,
  });
  fs.closeSync(fdLog);
  enfant.unref();

  const viv = capturerVivacite(enfant.pid);
  etat.pid_superviseur = enfant.pid;
  etat.starttime_superviseur = viv.starttime;
  etat.vivacite = viv.vivacite;
  ecrireStateAtomique(root, id, etat);

  return { id, pid: enfant.pid };
}

/** Admission (§18.5, unité U10) : un job non lourd est admis aussitôt (comportement U9 inchangé). Un
 *  job lourd dépose un ticket et attend un jeton machine (charge.js, `jobs_lourds_max`,
 *  `memoire_libre_min_mo` de `<root>/framework/CONFIG.md`) ; l'état reste `en-file` pendant l'attente.
 *  `verifierArret()` : vrai si `arreter` a été demandé pendant l'attente — l'admission est alors
 *  abandonnée (ticket supprimé) plutôt que de démarrer la commande. Retourne
 *  `{ ok: true, jeton?: n, chargeDir? }` ou `{ ok: false, arrete: true }`. */
async function admettre(root, etat) {
  if (!etat.lourd) return { ok: true };
  const dir = charge.chargeDir();
  const params = charge.lireParametresCharge(root);
  const info = {
    pid: process.pid,
    starttime: starttimeDe(process.pid),
    racine: root,
    mission: path.basename(root),
    job: etat.id,
    proprietaire: etat.proprietaire,
  };
  const journal = (msg) => { try { process.stdout.write(`[job] ${nowIso()} ${msg}\n`); } catch (_err) { /* ignore */ } };
  const res = await charge.admettreLourd(dir, {
    max: params.jobsLourdsMax,
    memoireLibreMinMo: params.memoireLibreMinMo,
    tickMs: charge.tickMs(),
    info,
    verifierArret: () => fs.existsSync(arretFilePath(root, etat.id)),
    journal,
  });
  if (!res.ok) return { ok: false, arrete: true };
  return { ok: true, jeton: res.n, chargeDir: res.dir };
}

// Revue finale n° 7 : un job qui finit pendant une session de son propriétaire verrait son unique
// réveil écarté (`isLive`), et le propriétaire hibernerait ensuite sur une condition déjà vraie sans que
// personne ne le réveille. Le réveil passe donc par un guetteur détaché qui attend que le verrou de
// vivacité du propriétaire (`mission/.holarch/live/<chemin>.json`, holarch-spawn.js) tombe, puis lance
// `--reveil --pour` (au plus `HOLARCH_JOB_REVEIL_ATTENTE_MAX_MS`, 12 h par défaut).
// Seconde revue n° 52, 54 : un seul guetteur par propriétaire (verrou `live/<p>.guetteur`, primitive exclusive de
// lots.js), qui attend que le lanceur de p soit sorti (ni verrou live/ ni `.attente.json` vivants), lance
// `--reveil --pour` et attend sa fin ; code 3 (p encore occupé : tâche détachée vivante…) → il se ré-arme. Les
// demandes (`live/<p>.reveils-demandes`, append) notées pendant son cycle en déclenchent un autre après lui.
const GUETTEUR_REVEIL = `const fs = require('fs'); const path = require('path'); const { spawn } = require('child_process');
const [script, proprio, root, maxMs, pasMs, lotsJs, ...args] = process.argv.slice(1);
const lots = require(lotsJs); const st = require(path.join(path.dirname(lotsJs), 'jobs.js')).starttimeDe(process.pid);
const base = path.join(root, 'mission', '.holarch', 'live', proprio.replace(/\\//g, '-'));
const garde = base + '.guetteur'; const demandes = base + '.reveils-demandes';
const vivant = (f) => { try { process.kill(JSON.parse(fs.readFileSync(f, 'utf8')).pid, 0); return true; } catch (e) { return false; } };
const taille = () => { try { return fs.statSync(demandes).size; } catch (e) { return 0; } };
const prendre = () => lots.acquerirVerrou(garde, { pid: process.pid, starttime: st }).acquis;
const rendre = () => { try { if (JSON.parse(fs.readFileSync(garde, 'utf8')).pid === process.pid) fs.unlinkSync(garde); } catch (e) { /* absent */ } };
const fin = Date.now() + Number(maxMs);
const cycle = () => {
  const vu = taille();
  const tick = () => {
    if (Date.now() >= fin) { rendre(); return; }
    if (vivant(base + '.json') || vivant(base + '.attente.json')) { setTimeout(tick, Number(pasMs)); return; }
    const c = spawn(process.execPath, [script, ...args], { stdio: 'ignore', cwd: root });
    c.on('error', () => rendre());
    c.on('exit', (code) => {
      if (code === 3) { setTimeout(tick, Number(pasMs)); return; }
      rendre();
      if (taille() !== vu && prendre()) cycle();
    });
  };
  tick();
};
if (prendre()) cycle();`;

function declencherReveil(root, id, etat) {
  if (etat.proprietaire === 'utilisateur') return;
  const script = process.env.HOLARCH_JOB_REVEIL || path.join(root, 'framework', 'bin', 'holarch-spawn.js');
  const args = ['--reveil', '--pour', etat.proprietaire, '--declencheur', `job:${id}`, '--root', root];
  const maxMs = Number(process.env.HOLARCH_JOB_REVEIL_ATTENTE_MAX_MS) > 0 ? Number(process.env.HOLARCH_JOB_REVEIL_ATTENTE_MAX_MS) : 12 * 3600 * 1000;
  const base = path.join(root, 'mission', '.holarch', 'live', etat.proprietaire.replace(/\//g, '-'));
  // La demande est notée AVANT de regarder le guetteur : s'il est en fin de cycle, il la voit en relisant la taille.
  try { fs.mkdirSync(path.dirname(base), { recursive: true }); fs.appendFileSync(`${base}.reveils-demandes`, `${nowIso()} job:${id}\n`); } catch (_err) { /* meilleur effort */ }
  try {
    const g = JSON.parse(fs.readFileSync(`${base}.guetteur`, 'utf8'));
    if (estVivantSelon(g.pid, g.starttime, g.starttime ? 'pid+starttime' : 'pid')) return; // un guetteur veille déjà
  } catch (_err) { /* aucun guetteur */ }
  // Troisième revue n° 77 : le guetteur et le `--reveil` qu'il lance sont le harnais, pas l'instance dont la session a
  // lancé ce job — sans HOLARCH_INSTANCE, le lanceur n'y applique pas les refus faits aux instances (refusInstance).
  const env = Object.assign({}, process.env);
  delete env.HOLARCH_INSTANCE;
  try {
    const enfant = spawn(process.execPath, ['-e', GUETTEUR_REVEIL, script, etat.proprietaire, root, String(maxMs), '1000', path.join(__dirname, 'lots.js'), ...args], {
      detached: true, stdio: 'ignore', cwd: root, env,
    });
    enfant.unref();
  } catch (_err) { /* meilleur effort : la fin du job reste vraie même si le réveil échoue */ }
}

/** Libère le jeton et le ticket éventuels d'un job lourd (idempotent : `jetonInfo` peut être `null`
 *  si le job n'a jamais été admis, par exemple `arreter` reçu pendant `en-file`, ou non lourd). */
function libererCharge(jetonInfo) {
  if (!jetonInfo) return;
  try { charge.libererJeton(jetonInfo.dir, jetonInfo.n, process.pid); } catch (_err) { /* meilleur effort */ }
}

function terminerJob(root, id, etat, {
  code, arretRequis, sorties, partiels, jetonInfo, tickTimer,
}) {
  if (tickTimer) clearInterval(tickTimer);
  libererCharge(jetonInfo);
  const log = (msg) => { try { process.stdout.write(`[job] ${nowIso()} ${msg}\n`); } catch (_err) { /* ignore */ } };
  if (arretRequis) {
    etat.etat = 'arrete';
  } else if (code === 0) {
    // Revue n° 10 : « fini » exige que CE job ait produit chaque sortie (`.partiel` purgé au lancement) — un final
    // préexistant ou une commande qui oublie `{sortie}` ne passent jamais pour publiés.
    let ok = partiels.every((p) => fs.existsSync(p));
    if (!ok) etat.motif = 'sortie non produite par le job';
    for (let i = 0; i < partiels.length && ok; i += 1) {
      if (etat.valider) {
        const argvValider = etat.valider.map((a) => (a === '{fichier}' ? partiels[i] : a));
        const r = spawnSync(argvValider[0], argvValider.slice(1), { cwd: etat.cwd });
        if (!r || r.status !== 0) ok = false;
      }
    }
    if (ok) {
      for (let i = 0; i < partiels.length; i += 1) {
        try { fs.renameSync(partiels[i], sorties[i]); } catch (_err) { /* partiel déjà absent */ }
      }
      etat.etat = 'fini';
    } else {
      for (let i = 0; i < partiels.length; i += 1) {
        try { fs.renameSync(partiels[i], `${sorties[i]}.echec`); } catch (_err) { /* partiel déjà absent */ }
      }
      etat.etat = 'echoue';
    }
  } else {
    for (let i = 0; i < partiels.length; i += 1) {
      try { fs.renameSync(partiels[i], `${sorties[i]}.echec`); } catch (_err) { /* partiel déjà absent */ }
    }
    etat.etat = 'echoue';
  }
  etat.code = code;
  etat.fin = nowIso();
  ecrireStateAtomique(root, id, etat);
  log(`job ${etat.etat} (code ${code})`);
  try { fs.unlinkSync(arretFilePath(root, id)); } catch (_err) { /* pas de demande d'arrêt en cours */ }
  declencherReveil(root, id, etat);
  process.exit(0);
}

/** `superviser <id>` : à lancer uniquement comme processus détaché créé par `lancer`. Ne rend jamais
 *  la main tant que la commande supervisée n'est pas terminée (ou arrêtée). Asynchrone : un job lourd
 *  attend son admission (§18.5) avant de démarrer la commande ; l'état reste `en-file` pendant
 *  l'attente, sans changement de comportement pour un job non lourd (admission immédiate). */
async function superviser(root, id) {
  const etat = lireEtat(root, id);
  if (!etat) return; // id inconnu : rien à superviser (ne devrait jamais arriver, lancer écrit avant de démarrer)

  // Installé avant l'admission : un `arreter` reçu pendant `en-file` ne doit pas tuer ce processus par
  // le comportement par défaut de SIGTERM (rien à signaler tant que `etat.pgid` n'existe pas — c'est
  // `verifierArret()`, ci-dessous, qui fait sortir l'attente d'admission).
  let arretRequis = false;
  let minuteurKill = null;
  process.on('SIGTERM', () => {
    if (arretRequis) return;
    arretRequis = true;
    if (etat.pgid) {
      try { process.kill(-etat.pgid, 'SIGTERM'); } catch (_err) { /* groupe déjà mort */ }
      // Un groupe suspendu (job lourd sous plancher mémoire) ignore SIGTERM tant qu'il n'a pas repris :
      // SIGCONT après SIGTERM (jamais avant : l'ordre importe) pour que le signal soit traité.
      try { process.kill(-etat.pgid, 'SIGCONT'); } catch (_err) { /* groupe déjà mort */ }
      minuteurKill = setTimeout(() => {
        try { process.kill(-etat.pgid, 'SIGKILL'); } catch (_err) { /* groupe déjà mort */ }
      }, 5000);
    }
  });

  let jetonInfo = null;
  if (etat.lourd) {
    const admission = await admettre(root, etat);
    if (admission.ok) jetonInfo = { n: admission.jeton, dir: admission.chargeDir };
    if (!admission.ok || arretRequis) {
      // Un jeton a pu être accordé juste avant qu'un `arreter` concurrent ne soit vu ici : le libérer
      // avant d'abandonner (jamais de jeton qui fuit).
      libererCharge(jetonInfo);
      etat.etat = 'arrete';
      etat.fin = etat.fin || nowIso();
      ecrireStateAtomique(root, id, etat);
      try { fs.unlinkSync(arretFilePath(root, id)); } catch (_err) { /* pas de demande d'arrêt en cours */ }
      declencherReveil(root, id, etat);
      return;
    }
  }

  etat.etat = 'en-cours';
  etat.debut = etat.debut || nowIso();
  ecrireStateAtomique(root, id, etat);

  const sorties = etat.sorties || [];
  const partiels = sorties.map((s) => `${s}.partiel`);
  // Revue n° 10 : un `.partiel` laissé par un job antérieur (arrêté, planté) n'est jamais la sortie de celui-ci.
  for (const p of partiels) { try { fs.unlinkSync(p); } catch (_err) { /* pas de partiel */ } }
  let placeholderUtilise = false;
  const argvCommande = (etat.commande || []).map((a) => {
    if (a === '{sortie}' && !placeholderUtilise && partiels.length) { placeholderUtilise = true; return partiels[0]; }
    return a;
  });
  const env = Object.assign({}, process.env);
  partiels.forEach((p, idx) => { env[`HOLARCH_JOB_SORTIE_${idx + 1}`] = p; });

  let enfant;
  try {
    enfant = spawn(argvCommande[0], argvCommande.slice(1), {
      detached: true, cwd: etat.cwd, stdio: ['ignore', 'inherit', 'inherit'], env,
    });
  } catch (_err) {
    terminerJob(root, id, etat, {
      code: 1, arretRequis: false, sorties, partiels, jetonInfo, tickTimer: null,
    });
    return;
  }

  etat.pgid = enfant.pid;
  etat.starttime_commande = starttimeDe(enfant.pid);
  ecrireStateAtomique(root, id, etat);
  // Seconde revue n° 41 : le jeton reste tenu par ce groupe s'il survit à son superviseur.
  if (jetonInfo) charge.noterGroupeJeton(jetonInfo.dir, jetonInfo.n, process.pid, etat.pgid, etat.starttime_commande);

  if (etat.lourd) { try { os.setPriority(enfant.pid, 10); } catch (_err) { /* ignore */ } }

  // Si SIGTERM a déjà été reçu pendant la fenêtre entre l'admission et le spawn (rare mais possible),
  // le groupe fraîchement créé n'a pas encore été signalé : rattrapage immédiat.
  if (arretRequis && etat.pgid) {
    try { process.kill(-etat.pgid, 'SIGTERM'); } catch (_err) { /* groupe déjà mort */ }
    try { process.kill(-etat.pgid, 'SIGCONT'); } catch (_err) { /* groupe déjà mort */ }
    minuteurKill = setTimeout(() => {
      try { process.kill(-etat.pgid, 'SIGKILL'); } catch (_err) { /* groupe déjà mort */ }
    }, 5000);
  }

  let tickTimer = null;
  if (etat.lourd && jetonInfo) {
    const params = charge.lireParametresCharge(root);
    const journal = (msg) => { try { process.stdout.write(`[job] ${nowIso()} ${msg}\n`); } catch (_err) { /* ignore */ } };
    tickTimer = setInterval(() => {
      // Seconde revue n° 41 : une exception du tick ne tue jamais le superviseur (groupe arrêté orphelin).
      try {
      charge.tickSuspension(jetonInfo.dir, {
        max: params.jobsLourdsMax,
        memoireLibreMinMo: params.memoireLibreMinMo,
        monJetonN: jetonInfo.n,
        monPgid: etat.pgid,
        majEtat: (nouvelEtat) => {
          if (etat.etat === 'en-cours' || etat.etat === 'suspendu') {
            etat.etat = nouvelEtat;
            ecrireStateAtomique(root, id, etat);
          }
        },
        journal,
      });
      } catch (err) { journal(`tick de charge en échec : ${err.message}`); }
    }, charge.tickMs());
  }

  // Revue finale n° 11 : une commande introuvable émet 'error' (pas d'exception au spawn) ; sans écouteur,
  // le superviseur plantait et le job restait `en-cours` sans réveil. Une seule terminaison, quel que
  // soit l'ordre des événements 'error' et 'exit'.
  let termine = false;
  const terminer = (code) => {
    if (termine) return;
    termine = true;
    if (minuteurKill) clearTimeout(minuteurKill);
    // Revue n° 39 : le chef de groupe mort ne dit rien des autres membres, qui ont pu ignorer SIGTERM. Arrêt
    // demandé : SIGKILL au groupe tout de suite (le pgid reste réservé tant qu'un membre vit), jamais de survivant.
    if (arretRequis && etat.pgid) { try { process.kill(-etat.pgid, 'SIGKILL'); } catch (_err) { /* groupe vide */ } }
    // Troisième revue n° 75 et 83 : chef sorti (tué seul, ou sorti 0 en laissant un membre), le groupe qui reste paie
    // ou tient la machine hors de toute couverture — tué, et attendu (2 s au plus) avant de libérer jeton et réveil.
    if (etat.pgid && charge.groupeVivant(etat.pgid, etat.starttime_commande)) {
      charge.tuerGroupeOrphelin({ pgid: etat.pgid });
      const limite = Date.now() + 2000;
      while (Date.now() < limite && charge.groupeVivant(etat.pgid, etat.starttime_commande)) dormirSync(20);
      try { process.stdout.write(`[job] ${nowIso()} membres du groupe survivant au chef tués\n`); } catch (_err) { /* ignore */ }
    }
    terminerJob(root, id, etat, {
      code, arretRequis, sorties, partiels, jetonInfo, tickTimer,
    });
  };
  enfant.on('error', (err) => {
    try { process.stdout.write(`[job] ${nowIso()} commande non lancée : ${err.message}\n`); } catch (_err) { /* ignore */ }
    terminer(127);
  });
  enfant.on('exit', (code) => { terminer(code === null ? 1 : code); });
}

/** Le groupe de commande noté est-il encore celui de ce job ? Exige le starttime du chef de groupe :
 *  sans lui, un pgid noté peut désigner un groupe étranger qui a repris le numéro (revue n° 1). */
function groupeCommandeVivant(etat) {
  if (!etat.pgid || etat.starttime_commande === null || etat.starttime_commande === undefined) return false;
  if (!estVivantSelon(etat.pgid, etat.starttime_commande, 'pid+starttime')) return false;
  try {
    const s = fs.readFileSync(`/proc/${etat.pgid}/stat`, 'utf8');
    if (s.slice(s.lastIndexOf(')') + 2).split(' ')[0] === 'Z') return false; // tué, pas encore récolté
  } catch (_err) { return false; }
  return true;
}

function dormirSync(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch (_err) { /* meilleur effort */ }
}

/** `arreter <id>` : refus (code 1) si l'appelant n'est ni le propriétaire ni 'utilisateur'. */
function arreterJob(root, id, appelant) {
  const etat = lireEtat(root, id);
  if (!etat) return { ok: false, code: 1, message: `job inconnu : ${id}` };
  if (appelant !== 'utilisateur' && appelant !== etat.proprietaire) {
    return { ok: false, code: 1, message: `refus : le job ${id} appartient à ${etat.proprietaire}` };
  }
  // Troisième revue n° 75 : job terminal (ou superviseur mort) dont le groupe survit au chef → le groupe est tué.
  const orphelinVivant = () => !!etat.pgid && !!etat.starttime_commande && charge.groupeVivant(etat.pgid, etat.starttime_commande);
  if (ETATS_TERMINAUX.includes(etat.etat)) {
    if (orphelinVivant()) {
      charge.tuerGroupeOrphelin({ pgid: etat.pgid });
      return { ok: true, code: 0, message: `${id} déjà terminé (${etat.etat}) : groupe orphelin tué` };
    }
    return { ok: true, code: 0, message: `${id} déjà terminé (${etat.etat}) : rien à arrêter` };
  }
  try { fs.writeFileSync(arretFilePath(root, id), nowIso()); } catch (_err) { /* meilleur effort */ }
  const superviseurVivant = estVivantSelon(etat.pid_superviseur, etat.starttime_superviseur, etat.vivacite);
  if (superviseurVivant) {
    try { process.kill(etat.pid_superviseur, 'SIGTERM'); } catch (_err) { /* mort entre-temps */ }
    return { ok: true, code: 0, message: `arrêt demandé pour ${id}` };
  }
  if (groupeCommandeVivant(etat) || orphelinVivant()) {
    try { process.kill(-etat.pgid, 'SIGCONT'); } catch (_err) { /* groupe déjà mort */ }
    try { process.kill(-etat.pgid, 'SIGKILL'); } catch (_err) { /* groupe déjà mort */ }
  }
  try { fs.unlinkSync(arretFilePath(root, id)); } catch (_err) { /* déjà retiré */ }
  etat.etat = 'arrete';
  etat.fin = etat.fin || nowIso();
  ecrireStateAtomique(root, id, etat);
  // Seconde revue n° 53 : état terminal écrit ici, pas par le superviseur (mort) — c'est donc ici qu'on réveille.
  declencherReveil(root, id, etat);
  return { ok: true, code: 0, message: `${id} arrêté (superviseur déjà mort)` };
}

/** `job:<id>` de reveil.js : vrai si l'état est terminal, ou si non terminal mais le superviseur est
 *  mort (orphelin, lu comme interrompu sans réécrire l'état) ; id inconnu → faux. */
function evalJob(root, id) {
  const etat = lireEtat(root, id);
  if (!etat) return { vrai: false, pourquoi: `job ${id} inconnu` };
  if (ETATS_TERMINAUX.includes(etat.etat)) {
    return { vrai: true, pourquoi: `job ${id} à l'état terminal ${etat.etat}` };
  }
  const vivant = estVivantSelon(etat.pid_superviseur, etat.starttime_superviseur, etat.vivacite);
  if (!vivant) return { vrai: true, pourquoi: `job ${id} orphelin (superviseur mort), lu comme interrompu` };
  return { vrai: false, pourquoi: `job ${id} à l'état ${etat.etat} (superviseur vivant)` };
}

/** `reprendre(root)` : tout job actif au superviseur mort → interrompu (partiels supprimés) ; ceux
 *  reprenable relancés (nouvel id, même commande/sorties/valider, champ reprise_de). */
function reprendre(root) {
  const lignes = [];
  const dir = jobsDir(root);
  let fichiers = [];
  try { fichiers = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_err) { return { lignes }; }
  for (const f of fichiers) {
    const id = f.slice(0, -('.json'.length));
    const etat = lireEtat(root, id);
    if (!etat || !ETATS_ACTIFS.includes(etat.etat)) continue;
    const vivant = estVivantSelon(etat.pid_superviseur, etat.starttime_superviseur, etat.vivacite);
    if (vivant) continue;

    // Revue finale n° 13 et 41 : le superviseur est mort mais la commande peut vivre encore (ou être
    // arrêtée par SIGSTOP avec sa mémoire) — la tuer avant toute relance, sinon deux rendus écrivent la
    // même sortie et le jeton repris fait jobs_lourds_max + 1 processus lourds.
    if (groupeCommandeVivant(etat)) {
      try { process.kill(-etat.pgid, 'SIGKILL'); } catch (_err) { /* groupe déjà mort */ }
      const limite = Date.now() + 3000;
      while (groupeCommandeVivant(etat) && Date.now() < limite) dormirSync(20);
      lignes.push(`HOLARCH ▸ job ${id} : commande orpheline (groupe ${etat.pgid}) tuée avant reprise`);
    }

    for (const s of etat.sorties || []) {
      try { fs.unlinkSync(`${s}.partiel`); } catch (_err) { /* pas de partiel */ }
    }
    etat.etat = 'interrompu';
    etat.fin = nowIso();
    ecrireStateAtomique(root, id, etat);
    lignes.push(`HOLARCH ▸ job ${id} (${etat.nom}) interrompu (superviseur mort)`);
    // Revue finale n° 12 : l'état terminal `interrompu` satisfait `job:<id>` — le propriétaire est réveillé.
    declencherReveil(root, id, etat);

    if (etat.reprenable) {
      let nouveauId;
      try {
        ({ id: nouveauId } = lancer({
          nom: etat.nom,
          lourd: etat.lourd,
          sorties: etat.sorties,
          valider: etat.valider,
          progression: etat.progression,
          reprenable: etat.reprenable,
          commande: etat.commande,
          cwd: etat.cwd,
          proprietaire: etat.proprietaire,
          reprise_de: id,
          root,
        }));
      } catch (err) {
        lignes.push(`HOLARCH ▸ job ${id} non repris : ${err.message}`);
        continue;
      }
      lignes.push(`HOLARCH ▸ job ${id} repris : nouveau job ${nouveauId}`);
    }
  }
  return { lignes };
}

/** `cible` est `dir` lui-même ou un de ses descendants. */
function estSousRepertoire(dir, cible) {
  const rel = path.relative(dir, cible);
  return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel));
}

/** Amendement 5 (porte V1) : jobs non terminaux au superviseur vivant dont `cwd` ou une sortie est
 *  sous `dir` — utilisé par `--nettoyer-worktree` pour refuser tant qu'un job y travaille encore. */
function jobsVivantsDans(root, dir) {
  const dirAbs = path.resolve(dir);
  const resultats = [];
  for (const etat of listerJobs(root, {})) {
    if (ETATS_TERMINAUX.includes(etat.etat)) continue;
    // Revue finale n° 13 : une commande orpheline encore vivante travaille toujours dans le worktree.
    if (!estVivantSelon(etat.pid_superviseur, etat.starttime_superviseur, etat.vivacite)
      && !groupeCommandeVivant(etat)) continue;
    const chemins = [etat.cwd, ...(etat.sorties || [])].filter(Boolean);
    if (chemins.some((c) => estSousRepertoire(dirAbs, path.resolve(c)))) resultats.push(etat);
  }
  return resultats;
}

function listerJobs(root, { proprietaire, vivants } = {}) {
  const dir = jobsDir(root);
  let fichiers = [];
  try { fichiers = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch (_err) { return []; }
  const resultats = [];
  for (const f of fichiers) {
    const id = f.slice(0, -('.json'.length));
    const etat = lireEtat(root, id);
    if (!etat) continue;
    if (proprietaire && etat.proprietaire !== proprietaire) continue;
    // Revue finale n° 49 : un job actif au superviseur mort est orphelin, pas vivant (il relève de reprendre).
    if (vivants && (!ETATS_ACTIFS.includes(etat.etat)
      || !estVivantSelon(etat.pid_superviseur, etat.starttime_superviseur, etat.vivacite))) continue;
    resultats.push(etat);
  }
  return resultats;
}

function lireJournal(root, id, n) {
  let texte = '';
  try { texte = fs.readFileSync(logFilePath(root, id), 'utf8'); } catch (_err) { return ''; }
  if (!n) return texte;
  const lignes = texte.split('\n');
  return lignes.slice(-(n + 1)).join('\n');
}

module.exports = {
  racine,
  jobsDir,
  statePath,
  logFilePath,
  arretFilePath,
  proprietaireActuel,
  normaliserNom,
  genererId,
  decouperArgv,
  parseLancerArgs,
  lancer,
  superviser,
  admettre,
  arreterJob,
  evalJob,
  reprendre,
  listerJobs,
  jobsVivantsDans,
  lireJournal,
  lireEtat,
  starttimeDe,
  estVivantSelon,
  groupeCommandeVivant,
  capturerVivacite,
  nowIso,
};
