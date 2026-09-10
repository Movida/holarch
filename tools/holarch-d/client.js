'use strict';
/**
 * client.js — client HTTP mince vers le démon `holarch-d`, partagé par la porte MCP (`mcp-door.js`)
 * et la CLI (`cli.js`) — « une seule implémentation pour la porte MCP et la CLI » (D2). Démarre le
 * démon s'il ne tourne pas déjà (D3) : détaché, pidfile, jeton lu dans `~/.holarch/daemon.json`.
 * Aucune dépendance externe — `fetch`/`AbortController` sont globaux depuis Node 18.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const HOLARCH_HOME = process.env.HOLARCH_HOME || path.join(os.homedir(), '.holarch');
const DAEMON_FILE = path.join(HOLARCH_HOME, 'daemon.json');
const DAEMON_SCRIPT = path.join(__dirname, 'daemon.js');

function lireInfosDemon() {
  try { return JSON.parse(fs.readFileSync(DAEMON_FILE, 'utf8')); } catch (_e) { return null; }
}

async function estVivant(infos, timeoutMs = 1000) {
  if (!infos || !infos.port || !infos.token) return false;
  try {
    const ctrl = new AbortController();
    const minuteur = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(`http://127.0.0.1:${infos.port}/ping`, {
      headers: { Authorization: `Bearer ${infos.token}` },
      signal: ctrl.signal,
    });
    clearTimeout(minuteur);
    return r.ok;
  } catch (_e) {
    return false;
  }
}

function demarrerDemonDetache() {
  const enfant = spawn(process.execPath, [DAEMON_SCRIPT], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: process.env,
  });
  enfant.unref();
}

async function attendreDemarrage(delaiTotalMs = 8000) {
  const debut = Date.now();
  for (;;) {
    const infos = lireInfosDemon();
    if (infos && await estVivant(infos, 500)) return infos;
    if (Date.now() - debut > delaiTotalMs) {
      throw new Error('le démon holarch-d ne répond pas après démarrage (délai dépassé)');
    }
    await new Promise((r) => { setTimeout(r, 150); });
  }
}

/** Garantit qu'un démon tourne et répond, en démarre un s'il le faut (D3). */
async function assurerDemon() {
  const infos = lireInfosDemon();
  if (await estVivant(infos)) return infos;
  demarrerDemonDetache();
  return attendreDemarrage();
}

async function appeler(methode, chemin, corps) {
  const infos = await assurerDemon();
  const url = new URL(chemin, `http://127.0.0.1:${infos.port}`);
  let reponse;
  try {
    reponse = await fetch(url, {
      method: methode,
      headers: Object.assign(
        { Authorization: `Bearer ${infos.token}` },
        corps !== undefined ? { 'Content-Type': 'application/json' } : {},
      ),
      body: corps !== undefined ? JSON.stringify(corps) : undefined,
    });
  } catch (e) {
    const err = new Error(`démon injoignable : ${e.message}`);
    err.type = 'daemon_unreachable';
    throw err;
  }
  const texteBrut = await reponse.text();
  let data;
  try { data = texteBrut ? JSON.parse(texteBrut) : {}; } catch (_e) { data = { error: texteBrut }; }
  if (!reponse.ok) {
    const err = new Error(data.error || `erreur HTTP ${reponse.status}`);
    err.type = data.type || 'daemon_unreachable';
    err.status = reponse.status;
    throw err;
  }
  return data;
}

function requeteListe(chemin, params = {}) {
  const qs = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur !== undefined && valeur !== null) qs.set(cle, String(valeur));
  }
  const suffixe = qs.toString();
  return appeler('GET', suffixe ? `${chemin}?${suffixe}` : chemin);
}

module.exports = {
  refinePrompt: (corps) => appeler('POST', '/refine_prompt', corps),
  submitTask: (corps) => appeler('POST', '/submit_task', corps),
  getTask: (taskId) => requeteListe('/get_task', { task_id: taskId }),
  listTasks: (params) => requeteListe('/list_tasks', params),
  cancelTask: (taskId) => appeler('POST', '/cancel_task', { task_id: taskId }),
  rateResult: (corps) => appeler('POST', '/rate_result', corps),
  listSpecialists: (params) => requeteListe('/list_specialists', params || {}),
  spaceAdd: (corps) => appeler('POST', '/space_add', corps),
  spaceList: () => appeler('GET', '/space_list'),
  spaceDigest: (corps) => appeler('POST', '/space_digest', corps),
  stop: () => appeler('POST', '/stop', {}),
  ping: () => appeler('GET', '/ping'),
  lireInfosDemon, assurerDemon, estVivant, HOLARCH_HOME, DAEMON_FILE,
};
