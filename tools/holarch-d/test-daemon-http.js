'use strict';
/**
 * Tests de la couche HTTP réelle de daemon.js (auth, routage, codes d'erreur) avec un faux
 * `launch` injecté — un vrai serveur `node:http` tourne sur 127.0.0.1, mais aucun sous-processus
 * `claude` n'est jamais lancé. `sortieProcessus: false` (défaut de `demarrer`) : jamais de
 * `process.exit` ici, seulement `instance.arreter()`.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { demarrer } = require('./daemon');
const { fauxLanceur } = require('./fixtures');

function racineTemporaire() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-d-http-'));
  process.env.HOLARCH_HOME = d;
  return d;
}

async function avecDaemon(options, fn) {
  racineTemporaire();
  const instance = demarrer({ launch: fauxLanceur(options) });
  await instance.pret;
  try {
    await fn(instance);
  } finally {
    await instance.arreter();
  }
}

function url(instance, chemin) {
  return new URL(chemin, `http://127.0.0.1:${instance.server.address().port}`).toString();
}

async function requete(instance, methode, chemin, { corps, sansToken } = {}) {
  const r = await fetch(url(instance, chemin), {
    method: methode,
    headers: Object.assign(
      sansToken ? {} : { Authorization: `Bearer ${instance.token}` },
      corps !== undefined ? { 'Content-Type': 'application/json' } : {},
    ),
    body: corps !== undefined ? JSON.stringify(corps) : undefined,
  });
  const texteBrut = await r.text();
  let data;
  try { data = texteBrut ? JSON.parse(texteBrut) : {}; } catch (_e) { data = { brut: texteBrut }; }
  return { status: r.status, data };
}

test('une requête sans jeton (ou avec un jeton faux) est refusée en 401', async () => {
  await avecDaemon({}, async (instance) => {
    const sans = await requete(instance, 'GET', '/ping', { sansToken: true });
    assert.strictEqual(sans.status, 401);
    const r = await fetch(url(instance, '/ping'), { headers: { Authorization: 'Bearer faux-jeton' } });
    assert.strictEqual(r.status, 401);
  });
});

test('GET /ping avec le bon jeton répond ok', async () => {
  await avecDaemon({}, async (instance) => {
    const r = await requete(instance, 'GET', '/ping');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.ok, true);
  });
});

test('une route inconnue renvoie 404', async () => {
  await avecDaemon({}, async (instance) => {
    const r = await requete(instance, 'GET', '/route-inexistante');
    assert.strictEqual(r.status, 404);
  });
});

test('un corps JSON invalide renvoie 400, pas un crash du serveur', async () => {
  await avecDaemon({}, async (instance) => {
    const r = await fetch(url(instance, '/submit_task'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${instance.token}`, 'Content-Type': 'application/json' },
      body: '{ceci n\'est pas du JSON',
    });
    assert.strictEqual(r.status, 400);
    // Le serveur doit rester utilisable ensuite.
    const suite = await requete(instance, 'GET', '/ping');
    assert.strictEqual(suite.status, 200);
  });
});

test('POST /refine_prompt sans prompt renvoie 400', async () => {
  await avecDaemon({}, async (instance) => {
    const r = await requete(instance, 'POST', '/refine_prompt', { corps: {} });
    assert.strictEqual(r.status, 400);
    assert.strictEqual(r.data.type, 'invalid_input');
  });
});

test('POST /refine_prompt avec prompt répond 200 avec un devis', async () => {
  await avecDaemon({
    triageSortie: {
      level: 1, specialists: ['generaliste'], profile: 'execution', complexity: 'basse',
      rationale: 'r', questions: [], mission_draft: '', optimized_prompt: 'reformulé',
    },
  }, async (instance) => {
    const r = await requete(instance, 'POST', '/refine_prompt', { corps: { prompt: 'une question' } });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.data.optimized_prompt, 'reformulé');
    assert.ok(r.data.estimate);
  });
});

test('POST /submit_task niveau 2 renvoie 400 explicite', async () => {
  await avecDaemon({}, async (instance) => {
    const r = await requete(instance, 'POST', '/submit_task', { corps: { prompt: 'q', level: 2, profile: 'execution' } });
    assert.strictEqual(r.status, 400);
    assert.match(r.data.error, /non implémenté/);
  });
});

test('cycle complet : submit_task (202-like 200) → get_task queued puis done → list_tasks → cancel_task no-op sur tâche terminée', async () => {
  await avecDaemon({ delaiMs: 20 }, async (instance) => {
    const soumission = await requete(instance, 'POST', '/submit_task', { corps: { prompt: 'q', level: 1, profile: 'execution' } });
    assert.strictEqual(soumission.status, 200);
    const id = soumission.data.task_id;
    assert.strictEqual(soumission.data.state, 'queued');

    let etat;
    for (let i = 0; i < 50; i++) {
      const r = await requete(instance, 'GET', `/get_task?task_id=${id}`);
      etat = r.data;
      if (etat.state === 'done') break;
      await new Promise((res) => { setTimeout(res, 20); });
    }
    assert.strictEqual(etat.state, 'done');
    assert.match(etat.result_md, /réponse de test/);

    const liste = await requete(instance, 'GET', '/list_tasks');
    assert.strictEqual(liste.status, 200);
    assert.ok(liste.data.some((t) => t.id === id));

    const annulation = await requete(instance, 'POST', '/cancel_task', { corps: { task_id: id } });
    assert.strictEqual(annulation.status, 200);
    assert.strictEqual(annulation.data.state, 'done'); // déjà terminée : no-op, pas d'erreur
  });
});

test('GET /get_task sur un id inconnu renvoie 404', async () => {
  await avecDaemon({}, async (instance) => {
    const r = await requete(instance, 'GET', '/get_task?task_id=inexistant');
    assert.strictEqual(r.status, 404);
  });
});

test('un second démon sur le même HOLARCH_HOME est refusé', async () => {
  await avecDaemon({}, async (instance) => {
    assert.throws(() => demarrer({ launch: fauxLanceur({}) }), /tourne déjà/);
    assert.ok(instance); // le premier démon reste sain
  });
});

test('POST /stop répond puis ferme réellement le serveur', async () => {
  racineTemporaire();
  const instance = demarrer({ launch: fauxLanceur({}) });
  await instance.pret;
  const cible = url(instance, '/ping'); // capturé avant fermeture : address() renvoie null après
  const r = await requete(instance, 'POST', '/stop', { corps: {} });
  assert.strictEqual(r.status, 200);
  await new Promise((res) => { setTimeout(res, 200); });
  await assert.rejects(() => fetch(cible, { headers: { Authorization: `Bearer ${instance.token}` } }));
});
