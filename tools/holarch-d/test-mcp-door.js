'use strict';
/**
 * Tests de bout en bout de la porte MCP (`mcp-door.js`, SDK officiel) : une vraie session
 * JSON-RPC sur stdin/stdout d'un sous-processus, comme le ferait Claude Desktop. `tools/list` ne
 * nécessite aucun démon ; pour `tools/call`, un démon local est démarré dans CE process de test
 * avec un faux `launch` (aucun sous-processus `claude`, aucun coût), et la porte y est dirigée via
 * `HOLARCH_HOME` — validant tout le circuit porte → client HTTP → démon → cœur, sans rien dépenser.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { demarrer } = require('./daemon');
const { fauxLanceur } = require('./fixtures');

const PORTE = path.join(__dirname, 'mcp-door.js');

function avecPorte(envExtra, fn) {
  return new Promise((resolvePromise, rejectPromise) => {
    const proc = spawn(process.execPath, [PORTE], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, envExtra),
    });
    const lignes = [];
    let reste = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      reste += chunk.toString('utf8');
      let idx = reste.indexOf('\n');
      while (idx !== -1) {
        const ligne = reste.slice(0, idx);
        reste = reste.slice(idx + 1);
        idx = reste.indexOf('\n');
        if (ligne.trim()) { try { lignes.push(JSON.parse(ligne)); } catch (_e) { /* logs éventuels, pas du JSON-RPC */ } }
      }
    });
    proc.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    proc.on('error', rejectPromise);

    const send = (obj) => proc.stdin.write(`${JSON.stringify(obj)}\n`);
    const attendre = (predicat, timeoutMs = 5000) => new Promise((resolve, reject) => {
      const debut = Date.now();
      const tick = () => {
        const trouve = lignes.find(predicat);
        if (trouve) { resolve(trouve); return; }
        if (Date.now() - debut > timeoutMs) { reject(new Error(`timeout ; stderr: ${stderr} ; lignes reçues: ${JSON.stringify(lignes)}`)); return; }
        setTimeout(tick, 20);
      };
      tick();
    });

    const finir = (erreur, valeur) => { proc.kill('SIGTERM'); if (erreur) rejectPromise(erreur); else resolvePromise(valeur); };
    fn({ send, attendre, stderr: () => stderr }).then((v) => finir(null, v), finir);
  });
}

async function initialiser(send, attendre) {
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  const rep = await attendre((m) => m.id === 1);
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  return rep;
}

test('poignée de main : le serveur MCP s\'annonce comme holarch-mcp', async () => {
  await avecPorte({ HOLARCH_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-mcp-vide-')) }, async ({ send, attendre }) => {
    const rep = await initialiser(send, attendre);
    assert.strictEqual(rep.result.serverInfo.name, 'holarch-mcp');
  });
});

test('tools/list annonce exactement les sept outils de l\'Étape 2, et aucun outil d\'espace', async () => {
  await avecPorte({ HOLARCH_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-mcp-vide-')) }, async ({ send, attendre }) => {
    await initialiser(send, attendre);
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const rep = await attendre((m) => m.id === 2);
    const noms = rep.result.tools.map((t) => t.name).sort();
    assert.deepStrictEqual(noms, [
      'cancel_task', 'get_task', 'list_specialists', 'list_tasks',
      'rate_result', 'refine_prompt', 'submit_task',
    ]);
    const soumettre = rep.result.tools.find((t) => t.name === 'submit_task');
    assert.strictEqual(soumettre.inputSchema.type, 'object');
    assert.ok(soumettre.inputSchema.required.includes('prompt'));
    // Garantie de conception (SPEC.md §9) : déclarer ce qu'un LLM a le droit de lire est un acte
    // de l'utilisateur, pas d'une conversation. Le démon a des routes /space_*, la porte MCP non.
    assert.ok(!noms.some((n) => n.startsWith('space')), 'aucun outil d\'espace ne doit être exposé en MCP');
    const notation = rep.result.tools.find((t) => t.name === 'rate_result');
    assert.ok(notation.inputSchema.required.includes('task_id'));
    assert.ok(notation.inputSchema.required.includes('verdict'));
  });
});

test('tools/call refine_prompt traverse porte → client HTTP → démon → cœur (démon local, faux launch)', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-mcp-actif-'));
  process.env.HOLARCH_HOME = home;
  const instance = demarrer({
    launch: fauxLanceur({
      triageSortie: {
        level: 1, specialists: ['generaliste'], profile: 'execution', complexity: 'basse',
        rationale: 'simple', questions: [], mission_draft: '', optimized_prompt: 'reformulé par le faux routeur',
      },
    }),
  });
  await instance.pret;
  try {
    await avecPorte({ HOLARCH_HOME: home }, async ({ send, attendre }) => {
      await initialiser(send, attendre);
      send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'refine_prompt', arguments: { prompt: 'une question' } } });
      const rep = await attendre((m) => m.id === 2, 8000);
      assert.ok(!rep.result.isError, JSON.stringify(rep.result));
      const donnees = JSON.parse(rep.result.content[0].text);
      assert.strictEqual(donnees.optimized_prompt, 'reformulé par le faux routeur');
      assert.strictEqual(donnees.chosen_by, 'router');
    });
  } finally {
    await instance.arreter();
  }
});

test('tools/call avec un nom d\'outil inexistant renvoie une erreur MCP propre, pas un crash', async () => {
  await avecPorte({ HOLARCH_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-mcp-vide-')) }, async ({ send, attendre }) => {
    await initialiser(send, attendre);
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'outil-inexistant', arguments: {} } });
    const rep = await attendre((m) => m.id === 2);
    assert.ok(rep.error || (rep.result && rep.result.isError));
  });
});
