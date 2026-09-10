#!/usr/bin/env node
'use strict';
/**
 * daemon.js — le démon `holarch-d` : processus utilisateur durable, seul détenteur de l'état (§3 de
 * la spec). HTTP JSON sur 127.0.0.1 uniquement, port choisi par l'OS, jeton dans
 * `~/.holarch/daemon.json` (mode 0600) — D2. Auto-démarré par la porte MCP ou la CLI s'il ne tourne
 * pas déjà (D3, voir `client.js`) ; peut aussi être lancé directement :
 *   node tools/holarch-d/daemon.js
 *
 * N'écrit jamais `framework/` ; `require('../../framework/bin/holarch-spawn.js')` reste indirect,
 * via `policy.js`/`launch.js`, jamais depuis ce fichier.
 *
 * `demarrer()` ne quitte jamais le processus elle-même (option `sortieProcessus`, désactivée par
 * défaut) : c'est `main()` (exécutée seulement si ce fichier est lancé directement) qui décide de
 * `process.exit`. Ce découpage rend le démon testable en process — `test-daemon-http.js` démarre
 * un vrai serveur HTTP avec un faux `launch`, sans jamais risquer de tuer `node --test`.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { creerCoeur } = require('./daemon-core');
const launch = require('./launch');

const VERSION = '0.2.0-etape2';
const REPO_ROOT = require('./repo').racineDepot() || path.join(__dirname, '..', '..');
const INACTIVITE_MAX_MS = 24 * 60 * 60 * 1000; // D3 : arrêt après 24h sans tâche active

function racineHolarch() {
  return process.env.HOLARCH_HOME || path.join(os.homedir(), '.holarch');
}

function processusVivant(pid) {
  try { process.kill(pid, 0); return true; } catch (_e) { return false; }
}

/** Verrou + pidfile (§12) : un second démon est refusé plutôt que de corrompre l'état partagé. */
function verrouiller(holarchHome, lockFile, daemonFile) {
  fs.mkdirSync(holarchHome, { recursive: true });
  if (fs.existsSync(lockFile)) {
    const pidExistant = Number(fs.readFileSync(lockFile, 'utf8').trim());
    if (pidExistant && processusVivant(pidExistant)) {
      throw new Error(`un démon holarch-d tourne déjà (pid ${pidExistant}) — voir ${daemonFile}`);
    }
  }
  fs.writeFileSync(lockFile, String(process.pid));
}

function deverrouiller(lockFile, daemonFile) {
  try { fs.unlinkSync(lockFile); } catch (_e) { /* déjà supprimé */ }
  try { fs.unlinkSync(daemonFile); } catch (_e) { /* déjà supprimé */ }
}

function envoyerJson(res, code, obj) {
  const corps = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corps) });
  res.end(corps);
}

function lireCorpsJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 2_000_000) req.destroy(new Error('corps de requête trop volumineux'));
    });
    req.on('end', () => {
      if (!data) { resolve({}); return; }
      try { resolve(JSON.parse(data)); } catch (_e) { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

/** Classement grossier (§11, taxonomie d'erreurs) : suffisant à cette étape, pas exhaustif — voir README. */
function typeErreur(message) {
  if (/pas de résultat exploitable/.test(message)) return 'claude_failed';
  return 'invalid_input';
}

function codeHttp(message) {
  return /introuvable/.test(message) ? 404 : 400;
}

/**
 * @param {{launch?: object, sortieProcessus?: boolean}} options `launch` substituable pour les
 *   tests (aucun sous-processus réel) ; `sortieProcessus` (faux par défaut) autorise
 *   `process.exit`/les gestionnaires `SIGTERM`/`SIGINT` — seul `main()` l'active.
 */
function demarrer({ launch: launchInjecte, sortieProcessus = false } = {}) {
  const holarchHome = racineHolarch();
  const daemonFile = path.join(holarchHome, 'daemon.json');
  const lockFile = path.join(holarchHome, 'daemon.lock');
  verrouiller(holarchHome, lockFile, daemonFile);

  const token = crypto.randomBytes(24).toString('hex');
  let derniereActivite = Date.now();
  const coeur = creerCoeur({ launch: launchInjecte || launch, depotRacine: REPO_ROOT });

  const routes = {
    'POST /refine_prompt': (corps) => coeur.refinePrompt(corps),
    'POST /submit_task': (corps) => coeur.submitTask(corps),
    'GET /get_task': (_corps, url) => coeur.getTask(url.searchParams.get('task_id')),
    'GET /list_tasks': (_corps, url) => coeur.listTasks({
      space: url.searchParams.get('space') || undefined,
      state: url.searchParams.get('state') || undefined,
      limit: url.searchParams.get('limit') ? Number(url.searchParams.get('limit')) : undefined,
    }),
    'POST /cancel_task': (corps) => coeur.cancelTask(corps.task_id),
    'POST /rate_result': (corps) => coeur.rateResult(corps),
    'GET /list_specialists': (_corps, url) => coeur.listSpecialists({
      space: url.searchParams.get('space') || undefined,
    }),
    // Espaces : routes HTTP servant **uniquement** la CLI (§9). La porte MCP ne les appelle pas —
    // ce n'est pas une omission, c'est la règle : déclarer ce qu'un LLM a le droit de lire est un
    // acte de l'utilisateur. Le démon ne peut pas distinguer ses deux clients ; c'est `mcp-door.js`
    // qui n'expose pas ces outils.
    'POST /space_add': (corps) => coeur.spaceAdd(corps),
    'GET /space_list': () => ({ spaces: coeur.spaceList() }),
    'POST /space_digest': (corps) => coeur.spaceDigest(corps),
    'GET /ping': () => ({ ok: true, version: VERSION, pid: process.pid }),
    'POST /stop': () => {
      setTimeout(() => {
        // eslint-disable-next-line no-use-before-define
        arreter().then(() => { if (sortieProcessus) process.exit(0); });
      }, 50);
      return { ok: true, arret: 'en cours' };
    },
  };

  const server = http.createServer(async (req, res) => {
    derniereActivite = Date.now();
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); } catch (_e) { envoyerJson(res, 400, { error: 'URL invalide', type: 'invalid_input' }); return; }
    const cle = `${req.method} ${url.pathname}`;

    const entete = req.headers.authorization || '';
    if (entete !== `Bearer ${token}`) { envoyerJson(res, 401, { error: 'jeton invalide ou manquant', type: 'invalid_input' }); return; }

    const gestionnaire = routes[cle];
    if (!gestionnaire) { envoyerJson(res, 404, { error: `route inconnue : ${cle}`, type: 'invalid_input' }); return; }

    try {
      const corps = req.method === 'POST' ? await lireCorpsJson(req) : {};
      const resultat = await gestionnaire(corps, url);
      envoyerJson(res, 200, resultat);
    } catch (e) {
      envoyerJson(res, codeHttp(e.message), { error: e.message, type: typeErreur(e.message) });
    }
  });

  const pretePromesse = new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      fs.writeFileSync(daemonFile, JSON.stringify({
        port, token, pid: process.pid, version: VERSION, startedAt: new Date().toISOString(),
      }, null, 2));
      fs.chmodSync(daemonFile, 0o600);
      process.stderr.write(`holarch-d ▸ écoute sur 127.0.0.1:${port} (pid ${process.pid}, ${holarchHome})\n`);
      resolve({ port, token });
    });
  });

  const verifInactivite = setInterval(() => {
    if (coeur._enCours.size === 0 && Date.now() - derniereActivite > INACTIVITE_MAX_MS) {
      process.stderr.write('holarch-d ▸ inactif depuis plus de 24h, arrêt\n');
      // eslint-disable-next-line no-use-before-define
      arreter().then(() => { if (sortieProcessus) process.exit(0); });
    }
  }, 60 * 60 * 1000);
  verifInactivite.unref();

  function arreter() {
    clearInterval(verifInactivite);
    deverrouiller(lockFile, daemonFile);
    return new Promise((resolve) => { server.close(() => resolve()); });
  }

  if (sortieProcessus) {
    process.on('SIGTERM', () => arreter().then(() => process.exit(0)));
    process.on('SIGINT', () => arreter().then(() => process.exit(0)));
  }

  return {
    server, coeur, arreter, pret: pretePromesse, holarchHome, daemonFile, lockFile, token,
  };
}

function main() {
  let instance;
  try {
    instance = demarrer({ sortieProcessus: true });
  } catch (e) {
    process.stderr.write(`holarch-d ▸ ${e.message}\n`);
    process.exit(1);
  }
  return instance;
}

if (require.main === module) main();

module.exports = { demarrer, main, VERSION, racineHolarch };
