'use strict';
// lots.test.js — chantier 16, §18.6 (docs/IMPLEMENTATION.md), unité U11 (lots payants).
// `require(path.join(__dirname, '..', 'bin', 'lots.js'))` : chemin identique une fois promu sous
// `framework/`. Chaque test travaille dans un `fs.mkdtempSync` hors dépôt git (racine/arbre passés
// explicitement en options injectables — jamais par dépendance à l'environnement ambiant de la
// session, sauf pour le test (a) qui a besoin qu'un job réel hérite HOLARCH_ROOT/HOLARCH_ARBRE).
// `after()` tue tout superviseur noté et supprime les répertoires temporaires.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const lots = require(path.join(__dirname, '..', 'bin', 'lots.js'));
const jobsMod = require(path.join(__dirname, '..', 'bin', 'jobs.js'));

const DIRS = [];
const PIDS_A_TUER = [];

function nouveauDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'holarch-lots-'));
  DIRS.push(d);
  return d;
}

test.after(() => {
  for (const pid of PIDS_A_TUER) {
    try { process.kill(-pid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
    try { process.kill(pid, 'SIGKILL'); } catch (_err) { /* déjà mort */ }
  }
  for (const d of DIRS) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_err) { /* ignore */ } }
});

/** Sondage avec délai max, jamais de sleep fixe long. */
function attendreQue(predicat, { pasMs = 50, maxMs = 8000 } = {}) {
  const debut = Date.now();
  while (!predicat()) {
    if (Date.now() - debut > maxMs) throw new Error(`attendreQue : délai dépassé (${maxMs}ms)`);
    spawnSync(process.execPath, ['-e', `setTimeout(()=>{}, ${pasMs})`]);
  }
}

/** Mute temporairement des variables d'environnement réelles (jobs.lancer() hérite de process.env au
 *  moment du spawn du superviseur, qui hérite lui-même au superviseur du `jouer-lot` spawné). */
function envTemp(vars, fn) {
  const cles = Object.keys(vars);
  const anciennes = {};
  for (const k of cles) anciennes[k] = process.env[k];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const k of cles) {
      if (anciennes[k] === undefined) delete process.env[k]; else process.env[k] = anciennes[k];
    }
  }
}

function ecrireConfig(racine, budgetServicesUsd) {
  const p = path.join(racine, 'framework', 'CONFIG.md');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `# Paramètres\n\n| Clé | Valeur |\n|---|---|\n| budget_services_usd | ${budgetServicesUsd} |\n`);
}

const SCRIPT_SERVICE = 'faux-service.js';
// argv : [entree, sortie, cout('none' pour aucune ligne), echec('1' pour un code de sortie non nul),
// delaiMs]. Incrémente process.env.LOTS_TEST_COMPTEUR (chemin d'un fichier compteur) à chaque appel
// réellement exécuté — jamais lors d'un élément sauté (fait / repris / en-cours-ailleurs), puisque
// ceux-ci ne relancent jamais ce script.
const CONTENU_SCRIPT_SERVICE = `
'use strict';
const fs = require('fs');
const path = require('path');
const [, , entree, sortie, cout, echec, delaiMs] = process.argv;
if (delaiMs) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(delaiMs)); }
const compteurFile = process.env.LOTS_TEST_COMPTEUR;
if (compteurFile) {
  let n = 0;
  try { n = Number(fs.readFileSync(compteurFile, 'utf8')) || 0; } catch (_e) { n = 0; }
  fs.writeFileSync(compteurFile, String(n + 1));
}
fs.mkdirSync(path.dirname(sortie), { recursive: true });
fs.writeFileSync(sortie, \`contenu de \${entree}\\n\`);
if (cout && cout !== 'none') process.stdout.write(\`\${JSON.stringify({ cout_usd: Number(cout) })}\\n\`);
process.exit(echec === '1' ? 1 : 0);
`;

function preparerService(racine) {
  const scriptPath = path.join(racine, SCRIPT_SERVICE);
  fs.writeFileSync(scriptPath, CONTENU_SCRIPT_SERVICE);
  return scriptPath;
}

function creerEntree(racine, nom, contenu) {
  const p = path.join(racine, 'sources', nom);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, contenu);
  return path.join('sources', nom);
}

/** Construit un objet lot (commande = [node, script, {entree:0}, {sortie}, {param:cout},
 *  {param:echec}, {param:delai}]) et l'écrit à `nomFichier` sous `racine`. */
function ecrireLot(racine, nomFichier, {
  nom, service = 'faux-service', scriptPath, elements,
}) {
  const lotObj = {
    nom,
    service,
    paralleles: 2,
    commande: [process.execPath, scriptPath, '{entree:0}', '{sortie}', '{param:cout}', '{param:echec}', '{param:delai}'],
    elements,
  };
  const p = path.join(racine, nomFichier);
  fs.writeFileSync(p, JSON.stringify(lotObj, null, 2));
  return p;
}

function elementDefaut(id, entreeRel, sortieRel, {
  cout = '0.01', echec = '0', delai = '0', cout_estime_usd = 0.02,
} = {}) {
  return {
    id,
    entrees: [entreeRel],
    parametres: { cout, echec, delai },
    sortie: sortieRel,
    cout_estime_usd,
  };
}

function compteurPath(racine) { return path.join(racine, 'compteur.txt'); }
function lireCompteur(racine) {
  try { return Number(fs.readFileSync(compteurPath(racine), 'utf8')) || 0; } catch (_err) { return 0; }
}

// ---------------------------------------------------------------------------------------------
// (a) même lot lancé deux fois → second refusé code 1 avec le nom du détenteur.
// ---------------------------------------------------------------------------------------------

test('lot : même lot lancé deux fois -> second refusé, détenteur nommé', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'a.txt', 'contenu-a');
  const fichierLot = ecrireLot(racine, 'lot-a.json', {
    nom: 'lot-a',
    scriptPath: script,
    elements: [elementDefaut('e1', entree, 'sortie/e1.out', { delai: '1500' })],
  });

  const r1 = envTemp({
    HOLARCH_INSTANCE: 'inst-a', HOLARCH_ROOT: racine, HOLARCH_ARBRE: racine, HOLARCH_JOB_REVEIL: path.join(racine, 'introuvable.js'),
  }, () => lots.lot(fichierLot, {
    racine, arbre: racine, proprietaire: 'inst-a', cwd: racine,
  }));
  assert.equal(r1.ok, true, `premier lot refusé de façon inattendue : ${r1.message}`);
  if (r1.pid) PIDS_A_TUER.push(r1.pid);

  // Le verrou de lot doit être vivant tout de suite (l'élément dort 1500 ms).
  assert.equal(fs.existsSync(lots.verrouLotPath(racine, r1.cle)), true);

  const r2 = lots.lot(fichierLot, { racine, arbre: racine, proprietaire: 'inst-b', cwd: racine });
  assert.equal(r2.ok, false);
  assert.equal(r2.code, 1);
  assert.match(r2.message, /détenu par inst-a, job .*, depuis \d\d:\d\d/);

  attendreQue(() => {
    const etat = jobsMod.lireEtat(racine, r1.id);
    return etat && ['fini', 'echoue', 'arrete', 'interrompu'].includes(etat.etat);
  });
  assert.equal(fs.existsSync(lots.verrouLotPath(racine, r1.cle)), false, 'le verrou de lot doit être libéré à la fin du job');
  assert.equal(fs.readFileSync(path.join(racine, 'sortie', 'e1.out'), 'utf8').includes('contenu de'), true);
});

// ---------------------------------------------------------------------------------------------
// (b) élément déjà fait (empreinte + sortie valide) -> sauté, compteur inchangé.
// ---------------------------------------------------------------------------------------------

test('jouerLot : élément déjà fait -> sauté, compteur inchangé', async () => {
  const racine = nouveauDir();
  const arbre = racine;
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'b.txt', 'contenu-b');
  const lotObj = { service: 'faux-service', commande: [process.execPath, script, '{entree:0}', '{sortie}', '{param:cout}', '{param:echec}', '{param:delai}'] };
  const dir = racine;
  const el = elementDefaut('e1', entree, 'sortie/b.out', {});
  const empreinte = lots.empreinteElement(lotObj, el, dir);

  // Sortie déjà publiée, sha256 noté, ligne 'fait' déjà journalisée.
  const sortieAbs = path.join(dir, el.sortie);
  fs.mkdirSync(path.dirname(sortieAbs), { recursive: true });
  fs.writeFileSync(sortieAbs, 'déjà-publié');
  const sha = lots.sha256Fichier(sortieAbs);
  fs.mkdirSync(lots.lotsDir(racine), { recursive: true });
  fs.appendFileSync(lots.coutsJsonlPath(racine), `${JSON.stringify({
    date: jobsMod.nowIso(), lot: 'lot-b', element: 'e1', service: 'faux-service', empreinte, cout_usd: 0.01, source: 'reel', proprietaire: 'inst-a', etat: 'fait', sha_sortie: sha, sortie: sortieAbs,
  })}\n`);

  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  const fichierLot = ecrireLot(racine, 'lot-b.json', { nom: 'lot-b', scriptPath: script, elements: [el] });
  const cle = lots.cleLot([empreinte]);

  process.env.LOTS_TEST_COMPTEUR = compteur;
  try {
    const code = await lots.jouerLot(fichierLot, cle, {
      racine, arbre, proprietaire: 'inst-a', cwd: racine,
    });
    assert.equal(code, 0);
  } finally {
    delete process.env.LOTS_TEST_COMPTEUR;
  }

  assert.equal(lireCompteur(racine), 0, 'un élément déjà fait ne doit jamais relancer la commande');
  assert.equal(fs.readFileSync(sortieAbs, 'utf8'), 'déjà-publié', 'la sortie déjà publiée reste inchangée');
});

// ---------------------------------------------------------------------------------------------
// (c) entrée modifiée -> rejoué (empreinte différente, compteur incrémenté).
// ---------------------------------------------------------------------------------------------

test('jouerLot : entrée modifiée -> rejoué (empreinte différente)', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  process.env.LOTS_TEST_COMPTEUR = compteur;
  try {
    const entree1 = creerEntree(racine, 'c.txt', 'version-1');
    const el1 = elementDefaut('e1', entree1, 'sortie/c.out', {});
    const fichierLot1 = ecrireLot(racine, 'lot-c1.json', { nom: 'lot-c', scriptPath: script, elements: [el1] });
    const lotObj1 = JSON.parse(fs.readFileSync(fichierLot1, 'utf8'));
    const empreinte1 = lots.empreinteElement(lotObj1, el1, racine);
    await lots.jouerLot(fichierLot1, lots.cleLot([empreinte1]), { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
    assert.equal(lireCompteur(racine), 1);

    // Entrée modifiée : même id, même sortie visée, contenu différent -> empreinte différente.
    creerEntree(racine, 'c.txt', 'version-2-modifiee');
    const el2 = elementDefaut('e1', entree1, 'sortie/c.out', {});
    const fichierLot2 = ecrireLot(racine, 'lot-c2.json', { nom: 'lot-c', scriptPath: script, elements: [el2] });
    const lotObj2 = JSON.parse(fs.readFileSync(fichierLot2, 'utf8'));
    const empreinte2 = lots.empreinteElement(lotObj2, el2, racine);
    assert.notEqual(empreinte1, empreinte2, 'une entrée modifiée doit changer l\'empreinte');
    await lots.jouerLot(fichierLot2, lots.cleLot([empreinte2]), { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
    assert.equal(lireCompteur(racine), 2, 'une entrée modifiée doit être rejouée');
    assert.equal(fs.readFileSync(path.join(racine, 'sortie', 'c.out'), 'utf8'), `contenu de ${path.join(racine, entree1)}\n`);
  } finally {
    delete process.env.LOTS_TEST_COMPTEUR;
  }
});

// ---------------------------------------------------------------------------------------------
// (d) devis au-delà du budget/plafond -> refus ; dans le budget -> accepté, rien écrit.
// ---------------------------------------------------------------------------------------------

test('lot --devis : refus au-delà du plafond, accepté dans le budget, rien écrit dans les deux cas', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10'); // budget large : seul --plafond doit refuser ici.
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'd.txt', 'contenu-d');
  const fichierLot = ecrireLot(racine, 'lot-d.json', {
    nom: 'lot-d',
    scriptPath: script,
    elements: [elementDefaut('e1', entree, 'sortie/d.out', { cout_estime_usd: 0.05 })],
  });

  const refus = lots.lot(fichierLot, {
    devis: true, plafond: 0.001, racine, arbre: racine, proprietaire: 'inst-a', cwd: racine,
  });
  assert.equal(refus.ok, false);
  assert.equal(refus.code, 1);

  const accepte = lots.lot(fichierLot, {
    devis: true, racine, arbre: racine, proprietaire: 'inst-a', cwd: racine,
  });
  assert.equal(accepte.ok, true);
  assert.equal(accepte.code, 0);

  // --devis n'écrit jamais rien (ni verrou, ni réservation, ni journal).
  assert.equal(fs.existsSync(lots.lotsDir(racine)), false, '--devis ne doit rien écrire sous mission/.holarch/lots/');
});

// ---------------------------------------------------------------------------------------------
// (e) élément en échec -> sortie non publiée, .echec, ligne echec avec le coût déclaré.
// ---------------------------------------------------------------------------------------------

test('jouerLot : élément en échec -> .echec, ligne echec avec coût déclaré', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'e.txt', 'contenu-e');
  const el = elementDefaut('e1', entree, 'sortie/e.out', { cout: '0.03', echec: '1' });
  const fichierLot = ecrireLot(racine, 'lot-e.json', { nom: 'lot-e', scriptPath: script, elements: [el] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  const empreinte = lots.empreinteElement(lotObj, el, racine);

  await lots.jouerLot(fichierLot, lots.cleLot([empreinte]), {
    racine, arbre: racine, proprietaire: 'inst-a', cwd: racine,
  });

  assert.equal(fs.existsSync(path.join(racine, 'sortie', 'e.out')), false, 'la sortie ne doit jamais être publiée en cas d\'échec');
  assert.equal(fs.existsSync(path.join(racine, 'sortie', 'e.out.echec')), true);
  const lignes = fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ligne = lignes.find((l) => l.element === 'e1' && l.etat === 'echec');
  assert.ok(ligne, 'une ligne echec doit être journalisée');
  assert.equal(ligne.cout_usd, 0.03, 'le coût déclaré doit être repris même en échec');
});

test('revue n° 26 : exception dans un élément → jouer-lot attend les autres, leur coût est écrit, l\'élément cassé a sa ligne echec', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'e.txt', 'contenu-e');
  fs.writeFileSync(path.join(racine, 'bloque'), 'fichier ordinaire');
  const lent = elementDefaut('lent', entree, 'sortie/lent.png', { cout: '3', delai: '800' });
  const casse = elementDefaut('casse', entree, 'bloque/casse.png', { cout: '1' });
  const fichierLot = ecrireLot(racine, 'lot-c.json', { nom: 'lot-c', scriptPath: script, elements: [lent, casse] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  const cle = lots.cleLot(lots.calculerEmpreintesLot(lotObj, racine).map((e) => e.empreinte));
  const code = await lots.jouerLot(fichierLot, cle, { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine })
    .catch(() => 'rejet');
  const lignes = fs.existsSync(lots.coutsJsonlPath(racine))
    ? fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  assert.ok(lignes.find((l) => l.element === 'lent' && l.etat === 'fait' && l.cout_usd === 3), 'coût de « lent » perdu');
  assert.ok(lignes.find((l) => l.element === 'casse' && l.etat === 'echec'), 'aucune ligne pour « casse »');
  assert.equal(code, 1);
});

test('revue n° 27 : valider reçoit {param:k} et {entree:n} de l\'élément (plus de « undefined »)', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'e.txt', 'contenu-e');
  const el = elementDefaut('v1', entree, 'sortie/v1.out', { cout: '0.5' });
  el.parametres.taille = '1024';
  const fichierLot = ecrireLot(racine, 'lot-v.json', { nom: 'lot-v', scriptPath: script, elements: [el] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  lotObj.valider = [process.execPath, '-e', 'process.exit(process.argv[1] === "1024" && require("fs").existsSync(process.argv[2]) ? 0 : 1)',
    '{param:taille}', '{entree:0}'];
  fs.writeFileSync(fichierLot, JSON.stringify(lotObj));
  await lots.jouerLot(fichierLot, lots.cleLot([lots.empreinteElement(lotObj, el, racine)]), {
    racine, arbre: racine, proprietaire: 'inst-a', cwd: racine,
  });
  assert.equal(fs.existsSync(path.join(racine, 'sortie', 'v1.out')), true, 'sortie validée non publiée');
});

// ---------------------------------------------------------------------------------------------
// (f) deux lots partageant un élément -> payé une fois (compteur = 1, ligne repris pour le second).
// ---------------------------------------------------------------------------------------------

test('jouerLot : deux lots partageant un élément -> payé une seule fois', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'f.txt', 'contenu-f');
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  process.env.LOTS_TEST_COMPTEUR = compteur;
  try {
    const elA = elementDefaut('e1', entree, 'sortie/f-a.out', {});
    const fichierLotA = ecrireLot(racine, 'lot-f-a.json', { nom: 'lot-f-a', scriptPath: script, elements: [elA] });
    const lotObjA = JSON.parse(fs.readFileSync(fichierLotA, 'utf8'));
    const empreinteA = lots.empreinteElement(lotObjA, elA, racine);
    await lots.jouerLot(fichierLotA, lots.cleLot([empreinteA]), { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
    assert.equal(lireCompteur(racine), 1);

    // Second lot : même service/commande/entrées/paramètres (même empreinte), sortie différente.
    const elB = elementDefaut('e1', entree, 'sortie/f-b.out', {});
    const fichierLotB = ecrireLot(racine, 'lot-f-b.json', { nom: 'lot-f-b', scriptPath: script, elements: [elB] });
    const lotObjB = JSON.parse(fs.readFileSync(fichierLotB, 'utf8'));
    const empreinteB = lots.empreinteElement(lotObjB, elB, racine);
    assert.equal(empreinteA, empreinteB, 'deux éléments identiques (entrées, paramètres, commande, service) doivent partager leur empreinte');
    await lots.jouerLot(fichierLotB, lots.cleLot([empreinteB]), { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });

    assert.equal(lireCompteur(racine), 1, 'le second lot ne doit jamais relancer la commande (élément déjà fait ailleurs)');
    assert.equal(fs.existsSync(path.join(racine, 'sortie', 'f-b.out')), true, 'la sortie du second lot doit être copiée depuis la première');
    const lignes = fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const repris = lignes.find((l) => l.etat === 'repris');
    assert.ok(repris, 'une ligne repris doit être journalisée pour le second lot');
    assert.equal(repris.cout_usd, 0, 'un repris ne doit jamais être repayé');
  } finally {
    delete process.env.LOTS_TEST_COMPTEUR;
  }
});

// ---------------------------------------------------------------------------------------------
// (g) amendement 1 : deux arbres courants, même racine, un lot chacun -> le cumul compte les deux,
// sans double compte (couts.jsonl, racine principale, fait foi ; COUTS-SERVICES.md par arbre).
// ---------------------------------------------------------------------------------------------

test('cumulActuel : deux arbres, même racine -> cumul complet sans double compte (amendement 1)', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const arbre1 = path.join(racine, 'arbre1');
  const arbre2 = path.join(racine, 'arbre2');
  fs.mkdirSync(arbre1, { recursive: true });
  fs.mkdirSync(arbre2, { recursive: true });
  const script = preparerService(racine);

  const entreeG = creerEntree(racine, 'g.txt', 'contenu-g');
  const elG = elementDefaut('eg', entreeG, 'sortie/g.out', { cout: '0.10' });
  const fichierLotG = ecrireLot(racine, 'lot-g.json', { nom: 'lot-g', scriptPath: script, elements: [elG] });
  const lotObjG = JSON.parse(fs.readFileSync(fichierLotG, 'utf8'));
  const empreinteG = lots.empreinteElement(lotObjG, elG, racine);
  await lots.jouerLot(fichierLotG, lots.cleLot([empreinteG]), {
    racine, arbre: arbre1, proprietaire: 'inst-arbre1', cwd: racine,
  });

  const entreeH = creerEntree(racine, 'h.txt', 'contenu-h');
  const elH = elementDefaut('eh', entreeH, 'sortie/h.out', { cout: '0.20' });
  const fichierLotH = ecrireLot(racine, 'lot-h.json', { nom: 'lot-h', scriptPath: script, elements: [elH] });
  const lotObjH = JSON.parse(fs.readFileSync(fichierLotH, 'utf8'));
  const empreinteH = lots.empreinteElement(lotObjH, elH, racine);
  await lots.jouerLot(fichierLotH, lots.cleLot([empreinteH]), {
    racine, arbre: arbre2, proprietaire: 'inst-arbre2', cwd: racine,
  });

  const cumulDepuisArbre1 = lots.cumulActuel(racine, arbre1);
  const cumulDepuisArbre2 = lots.cumulActuel(racine, arbre2);
  assert.ok(Math.abs(cumulDepuisArbre1 - 0.30) < 1e-9, `cumul (vu d'arbre1) doit sommer les deux : ${cumulDepuisArbre1}`);
  assert.ok(Math.abs(cumulDepuisArbre2 - 0.30) < 1e-9, `cumul (vu d'arbre2) doit sommer les deux, sans double compte : ${cumulDepuisArbre2}`);
});

// ---------------------------------------------------------------------------------------------
// (h) sleep-guard : holarch-hooks.js n'est pas atteignable depuis ce paquet (non promu) -> on teste
// verrousLotVivants seul.
// ---------------------------------------------------------------------------------------------

test('verrousLotVivants : un verrou vivant, un verrou au pid mort -> seul le vivant est listé', () => {
  // Le sleep-guard lui-même (fragment de holarch-hooks.js) ne se joue qu'après application : ici,
  // seule la source de vérité qu'il interroge est testée (valable depuis le paquet comme après promotion).
  const racine = nouveauDir();

  const vivDeMoi = jobsMod.capturerVivacite(process.pid);
  fs.mkdirSync(lots.lotsDir(racine), { recursive: true });
  fs.writeFileSync(lots.verrouLotPath(racine, 'cle-vivante'), JSON.stringify({
    proprietaire: 'inst-autrui', pid: process.pid, starttime: vivDeMoi.starttime, job: 'job-1', debut: jobsMod.nowIso(),
  }));
  // pid quasi certainement mort : un très grand pid, jamais attribué sur une machine réelle.
  fs.writeFileSync(lots.verrouLotPath(racine, 'cle-morte'), JSON.stringify({
    proprietaire: 'inst-autrui', pid: 999999999, starttime: null, job: 'job-2', debut: jobsMod.nowIso(),
  }));
  // budget.lock ne doit jamais apparaître dans la liste (ce n'est pas un verrou de lot).
  fs.writeFileSync(lots.budgetLockPath(racine), JSON.stringify({ pid: process.pid }));

  const vivants = lots.verrousLotVivants(racine);
  assert.equal(vivants.length, 1);
  assert.equal(vivants[0].cle, 'cle-vivante');
  assert.equal(vivants[0].proprietaire, 'inst-autrui');
  assert.equal(vivants[0].job, 'job-1');
});

// ---------------------------------------------------------------------------------------------
// Validation de format : {param:k} absent -> refus avant tout devis.
// ---------------------------------------------------------------------------------------------

test('validerFormatLot : {param:k} référencé sans parametres.k -> refus', () => {
  const lotObj = {
    nom: 'lot-invalide',
    service: 'faux-service',
    commande: ['prog', '{param:langue}'],
    elements: [{
      id: 'e1', entrees: [], parametres: {}, sortie: 'out.txt', cout_estime_usd: 0.01,
    }],
  };
  const r = lots.validerFormatLot(lotObj);
  assert.equal(r.ok, false);
  assert.match(r.motif, /langue/);
});

test('empreinteElement : ni date, ni sortie, ni id -> deux éléments équivalents partagent l\'empreinte', () => {
  const dir = nouveauDir();
  const script = preparerService(dir);
  const entree = creerEntree(dir, 'x.txt', 'même-contenu');
  const lotObj = { service: 'svc', commande: [process.execPath, script, '{entree:0}', '{sortie}'] };
  const e1 = crypto.randomUUID ? { id: crypto.randomUUID() } : { id: 'e1' };
  const empA = lots.empreinteElement(lotObj, { ...e1, entrees: [entree], parametres: { k: 'v' } }, dir);
  const empB = lots.empreinteElement(lotObj, { id: 'autre-id', entrees: [entree], parametres: { k: 'v' } }, dir);
  assert.equal(empA, empB);
});

test('revue n° 22 : cumul — une dépense du registre absente du journal compte, même si le journal porte la même empreinte', () => {
  const racine = nouveauDir();
  const base = {
    lot: 'l', element: 'e', service: 's', empreinte: 'a'.repeat(64), source: 'reel', proprietaire: 'p',
  };
  lots.ecrireLigneCouts(racine, racine, { ...base, date: '2026-01-01T00:00:00.000Z', cout_usd: 4, etat: 'echec' });
  fs.rmSync(lots.coutsJsonlPath(racine)); // `.holarch/` effacé : le registre committé reste seul témoin
  assert.equal(lots.cumulActuel(racine, racine), 4);
  lots.ecrireLigneCouts(racine, racine, { ...base, date: '2026-01-01T01:00:00.000Z', cout_usd: 4, etat: 'fait' });
  assert.equal(lots.cumulActuel(racine, racine), 8);
});

// -- revue finale n° 2 et 34 : COUTS-SERVICES.md en merge=union (amendement V1-7) --------------------

const GITATTRIBUTES = path.join(__dirname, '..', '..', '.gitattributes');
const SKIP_GITATTR = fs.existsSync(GITATTRIBUTES) ? false : '.gitattributes absent à la racine (paquet non appliqué)';

test('revue n° 2 et 34 : deux branches qui ajoutent chacune une ligne à COUTS-SERVICES.md fusionnent sans conflit', { skip: SKIP_GITATTR }, () => {
  const depot = nouveauDir();
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...a], { cwd: depot, encoding: 'utf8' });
  const registre = path.join(depot, 'mission', 'registry', 'COUTS-SERVICES.md');
  git('init', '-q');
  fs.copyFileSync(GITATTRIBUTES, path.join(depot, '.gitattributes'));
  fs.mkdirSync(path.dirname(registre), { recursive: true });
  fs.writeFileSync(registre, '# Coûts\n\n| Date | Lot |\n|---|---|\n');
  git('add', '-A'); git('commit', '-q', '-m', 'base');
  git('switch', '-q', '-c', 'a'); fs.appendFileSync(registre, '| 1 | lot-a |\n'); git('commit', '-q', '-am', 'a');
  git('switch', '-q', 'main');
  git('switch', '-q', '-c', 'b'); fs.appendFileSync(registre, '| 2 | lot-b |\n'); git('commit', '-q', '-am', 'b');
  git('switch', '-q', 'main');
  assert.equal(git('merge', '-q', '--no-ff', '-m', 'm1', 'a').status, 0);
  const r = git('merge', '-q', '--no-ff', '-m', 'm2', 'b');
  assert.equal(r.status, 0, `conflit : ${r.stdout}${r.stderr}`);
  const texte = fs.readFileSync(registre, 'utf8');
  assert.match(texte, /lot-a/);
  assert.match(texte, /lot-b/);
});

// -- revue finale n° 25 et 43 : verrous exclusifs sous concurrence réelle ----------------------------

/** N processus prennent le même verrou au même instant ; chacun garde le sien 1,5 s (vivant). */
async function courseAuVerrou(fichier, n) {
  const { spawn } = require('child_process');
  const lotsJs = path.join(__dirname, '..', 'bin', 'lots.js');
  const jobsJs = path.join(__dirname, '..', 'bin', 'jobs.js');
  const t0 = Date.now() + 400;
  const script = `const l = require(${JSON.stringify(lotsJs)});
    const st = require(${JSON.stringify(jobsJs)}).starttimeDe(process.pid);
    while (Date.now() < ${t0}) {}
    const r = l.acquerirVerrou(${JSON.stringify(fichier)}, { pid: process.pid, starttime: st });
    process.stdout.write(r.acquis ? 'OUI' : 'NON'); setTimeout(() => {}, 1500);`;
  const sorties = await Promise.all(Array.from({ length: n }, () => new Promise((resolve) => {
    const p = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.on('exit', () => resolve(out));
  })));
  return sorties.filter((s) => s === 'OUI').length;
}

test('revue n° 25 : un verrou n\'existe jamais vide (aucune fenêtre où un concurrent le lirait sans détenteur)', () => {
  const dir = nouveauDir();
  const f = path.join(dir, 'fenetre.lock');
  const orig = fs.writeFileSync;
  let videVu = false;
  fs.writeFileSync = function espion(...args) {
    try { if (fs.statSync(f).size === 0) videVu = true; } catch (_err) { /* absent : correct */ }
    return orig.apply(this, args);
  };
  try {
    assert.equal(lots.acquerirVerrou(f, { pid: process.pid }).acquis, true);
  } finally { fs.writeFileSync = orig; }
  assert.equal(videVu, false, 'verrou visible vide avant son contenu');
  assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).pid === process.pid);
});

test('revue n° 25 : verrou libre pris par 12 processus au même instant → un seul détenteur (3 manches)', async () => {
  const dir = nouveauDir();
  for (let manche = 0; manche < 3; manche += 1) {
    assert.equal(await courseAuVerrou(path.join(dir, `libre-${manche}.lock`), 12), 1, `manche ${manche}`);
  }
});

test('revue n° 43 : verrou au pid mort repris par 12 processus au même instant → un seul détenteur', async () => {
  const dir = nouveauDir();
  for (let manche = 0; manche < 3; manche += 1) {
    const f = path.join(dir, `mort-${manche}.lock`);
    fs.writeFileSync(f, JSON.stringify({ pid: 999999999, starttime: '1', proprietaire: 'mort' }));
    assert.equal(await courseAuVerrou(f, 12), 1, `manche ${manche}`);
  }
});

test('revue n° 48 : reprise d\'un verrou au pid mort rendue à l\'appelant et journalisée (reprises.jsonl)', () => {
  // Trace durable d'une reprise, à la racine des lots (§18.6).
  const racine = nouveauDir();
  const verrou = path.join(lots.lotsDir(racine), 'x.lock');
  fs.mkdirSync(path.dirname(verrou), { recursive: true });
  fs.writeFileSync(verrou, JSON.stringify({ pid: 999999999, starttime: '1', proprietaire: 'mort' }));
  const r = lots.acquerirVerrou(verrou, { pid: process.pid });
  assert.equal(r.acquis, true);
  assert.equal(r.repris.proprietaire, 'mort');
  lots.journaliserReprise(racine, 'lot x', r.repris);
  assert.match(fs.readFileSync(path.join(lots.lotsDir(racine), 'reprises.jsonl'), 'utf8'), /"proprietaire":"mort"/);
});

async function jouerUnLot(racine, fichierLot) {
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  const empreintes = lotObj.elements.map((el) => lots.empreinteElement(lotObj, el, racine));
  return lots.jouerLot(fichierLot, lots.cleLot(empreintes), { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
}

test('revue n° 19 : lot fini relancé, sortie intacte mais publication plus récente disparue → pas repayé', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'f.txt', 'contenu-f');
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  process.env.LOTS_TEST_COMPTEUR = compteur;
  try {
    const lotA = ecrireLot(racine, 'lot-a.json', { nom: 'lot-a', scriptPath: script, elements: [elementDefaut('e1', entree, 'outA/e1.txt')] });
    const lotB = ecrireLot(racine, 'lot-b.json', { nom: 'lot-b', scriptPath: script, elements: [elementDefaut('e1', entree, 'outB/e1.txt')] });
    await jouerUnLot(racine, lotA);
    await jouerUnLot(racine, lotB);
    assert.equal(lireCompteur(racine), 1);
    fs.rmSync(path.join(racine, 'outB'), { recursive: true });
    await jouerUnLot(racine, lotA);
    assert.equal(lireCompteur(racine), 1, 'outA existe avec le bon sha : fait, service non rappelé');
  } finally {
    delete process.env.LOTS_TEST_COMPTEUR;
  }
});

test('revue n° 20 : deux éléments de même empreinte dans un lot (paralleles 2) → les deux sorties produites, un seul appel', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'merci.txt', 'Merci');
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  process.env.LOTS_TEST_COMPTEUR = compteur;
  try {
    const lot = ecrireLot(racine, 'lot-tts.json', {
      nom: 'tts',
      scriptPath: script,
      elements: [elementDefaut('s1', entree, 'scene-01.wav', { delai: '300' }), elementDefaut('s3', entree, 'scene-03.wav', { delai: '300' })],
    });
    await jouerUnLot(racine, lot);
    assert.equal(fs.existsSync(path.join(racine, 'scene-01.wav')), true);
    assert.equal(fs.existsSync(path.join(racine, 'scene-03.wav')), true, 'le doublon est copié, pas perdu');
    assert.equal(lireCompteur(racine), 1, 'payé une fois');
  } finally {
    delete process.env.LOTS_TEST_COMPTEUR;
  }
});

test('revue n° 21 : « | » ou « / » dans le nom du lot ou l\'id d\'un élément ne décale pas le registre', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'g.txt', 'contenu-g');
  const lot = ecrireLot(racine, 'lot-g.json', {
    nom: 'scenes 1|2 et 1/2', scriptPath: script, elements: [elementDefaut('e|1/a', entree, 'out/g.txt', { cout: '0.5' })],
  });
  await jouerUnLot(racine, lot);
  assert.equal(lots.cumulActuel(racine, racine), 0.5);
  const lignes = lots.parserTableCouts(fs.readFileSync(path.join(racine, 'mission', 'registry', 'COUTS-SERVICES.md'), 'utf8'));
  assert.equal(lignes.length, 1);
  assert.equal(lignes[0].etat, 'fait');
});

function lotDevis005(racine) {
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'b.txt', 'contenu-b');
  return ecrireLot(racine, 'lot-b.json', { nom: 'lot-b', scriptPath: script, elements: [elementDefaut('e1', entree, 'out/b.txt', { cout_estime_usd: 0.05 })] });
}

test('revue n° 29 : budget_services_usd à virgule décimale (accepté par config-lint) lu tel quel', () => {
  const racine = nouveauDir();
  const fichierLot = lotDevis005(racine);
  const opts = { devis: true, racine, arbre: racine, proprietaire: 'inst-a', cwd: racine };
  ecrireConfig(racine, '12,5');
  assert.equal(lots.lot(fichierLot, opts).budget, 12.5);
  assert.equal(lots.lot(fichierLot, opts).ok, true);
  ecrireConfig(racine, '0,03');
  assert.equal(lots.lot(fichierLot, opts).ok, false, 'devis 0.05 > budget 0,03');
});

test('revue n° 23 : holarch-job lot --plafond à virgule appliqué, plafond illisible refusé (jamais ignoré)', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const fichierLot = lotDevis005(racine);
  const cli = path.join(__dirname, '..', 'bin', 'holarch-job.js');
  const jouer = (plafond) => spawnSync(process.execPath, [cli, 'lot', fichierLot, '--devis', '--plafond', plafond], {
    cwd: racine, encoding: 'utf8', env: { ...process.env, HOLARCH_ROOT: racine },
  });
  const virgule = jouer('0,01');
  assert.equal(virgule.status, 1, virgule.stdout + virgule.stderr);
  assert.match(virgule.stderr, /plafond 0\.01 USD/);
  assert.equal(jouer('abc').status, 2);
  assert.equal(jouer('1').status, 0);
});

test('seconde revue n° 66 : option inconnue, forme --plafond=x ou --plafond répété → refus (code 2), jamais ignorés', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const fichierLot = lotDevis005(racine);
  const cli = path.join(__dirname, '..', 'bin', 'holarch-job.js');
  // Toujours avec --devis : sans la correction, ces appels sont acceptés (code 0) sans lancer de job.
  const jouer = (...args) => spawnSync(process.execPath, [cli, 'lot', fichierLot, '--devis', ...args], {
    cwd: racine, encoding: 'utf8', env: { ...process.env, HOLARCH_ROOT: racine },
  });
  for (const args of [['--plafond=0,01'], ['--devi'], ['--plafond', '0,01', '--plafond', '1'], ['en-trop']]) {
    const r = jouer(...args);
    assert.equal(r.status, 2, `${args.join(' ')} → ${r.status} ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /option|plafond/);
  }
  assert.equal(jouer('--plafond', '1').status, 0);
});

test('seconde revue n° 67 : deux éléments à la même sortie (ou sortie = .partiel d\'une autre) → refus avant devis', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const a = creerEntree(racine, 'a.txt', 'contenu-a');
  const b = creerEntree(racine, 'b2.txt', 'contenu-b2');
  for (const [sa, sb] of [['out/x.txt', 'out/x.txt'], ['out/x.txt', './out/../out/x.txt'], ['out/x.txt', 'out/x.txt.partiel']]) {
    const fichierLot = ecrireLot(racine, 'lot-67.json', {
      nom: 'lot-67', scriptPath: script,
      elements: [elementDefaut('e1', a, sa, { cout_estime_usd: 2 }), elementDefaut('e2', b, sb, { cout_estime_usd: 3 })],
    });
    const r = lots.lot(fichierLot, { devis: true, racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
    assert.equal(r.ok, false, `${sa} / ${sb} accepté`);
    assert.match(r.message, /sortie/);
  }
});

test('troisième revue n° 79 : même sortie par un lien symbolique (répertoire ou fichier) → refus avant devis', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const a = creerEntree(racine, 'a.txt', 'contenu-a');
  const b = creerEntree(racine, 'b2.txt', 'contenu-b2');
  fs.mkdirSync(path.join(racine, 'out'), { recursive: true });
  fs.symlinkSync(path.join(racine, 'out'), path.join(racine, 'lien'));
  fs.writeFileSync(path.join(racine, 'out', 'y.txt'), 'ancien');
  fs.symlinkSync(path.join(racine, 'out', 'y.txt'), path.join(racine, 'alias-y.txt'));
  for (const [sa, sb] of [['out/x.txt', 'lien/x.txt'], ['lien/x.txt', 'out/x.txt.partiel'], ['out/y.txt', 'alias-y.txt']]) {
    const fichierLot = ecrireLot(racine, 'lot-79.json', {
      nom: 'lot-79', scriptPath: script,
      elements: [elementDefaut('e1', a, sa, { cout_estime_usd: 2 }), elementDefaut('e2', b, sb, { cout_estime_usd: 3 })],
    });
    const r = lots.lot(fichierLot, { devis: true, racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
    assert.equal(r.ok, false, `${sa} / ${sb} accepté`);
    assert.match(r.message, /sortie/);
  }
});

test('revue n° 31 : sans budget_services_usd (défaut 0) ou devis + cumul au-delà → refus, en devis comme au lancement', () => {
  const racine = nouveauDir();
  fs.mkdirSync(path.join(racine, 'framework'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'framework', 'CONFIG.md'), '# Paramètres\n\n| Clé | Valeur |\n|---|---|\n| langue_de_travail | fr |\n');
  const fichierLot = lotDevis005(racine);
  const opts = { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine };
  const devis = lots.lot(fichierLot, { ...opts, devis: true });
  assert.equal(devis.ok, false);
  assert.match(devis.message, /budget_services_usd 0 USD/);
  const lancement = lots.lot(fichierLot, opts);
  assert.equal(lancement.ok, false, 'aucun lot payant sans déclaration');
  assert.equal(fs.existsSync(path.join(racine, 'mission', '.holarch', 'jobs')), false, 'aucun job lancé');
  ecrireConfig(racine, '0.04');
  assert.equal(lots.lot(fichierLot, opts).ok, false, 'devis 0.05 + cumul 0 > 0.04');
});

test('revue n° 24 : coût déclaré négatif ou infini → estimation ; stdout énorme gardé borné, coût final lu', async () => {
  assert.equal(lots.dernierCoutDeclare('{"cout_usd": -9}\n'), null);
  assert.equal(lots.dernierCoutDeclare('{"cout_usd": 1e400}\n'), null);
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'n.txt', 'contenu-n');
  const lot = ecrireLot(racine, 'lot-n.json', { nom: 'lot-n', scriptPath: script, elements: [elementDefaut('e1', entree, 'out/n.txt', { cout: '-9' })] });
  await jouerUnLot(racine, lot);
  assert.equal(lots.cumulActuel(racine, racine), 0.02, 'cout_estime_usd appliqué, jamais un cumul négatif');
  const bavard = 'const l = "x".repeat(1023) + "\\n"; for (let i = 0; i < 4096; i += 1) process.stdout.write(l); process.stdout.write(JSON.stringify({ cout_usd: 4.2 }) + "\\n");';
  const res = await lots.executerCommande([process.execPath, '-e', bavard], { cwd: racine, env: process.env });
  assert.equal(res.code, 0);
  assert.ok(res.stdout.length <= 64 * 1024, `stdout gardé : ${res.stdout.length} caractères`);
  assert.equal(lots.dernierCoutDeclare(res.stdout), 4.2);
});

test('revue n° 28 : sleep-guard — mes lignes de coût non committées sont exigées même si un lot d\'autrui tourne', () => {
  const arbre = nouveauDir();
  const git = (...a) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { cwd: arbre, encoding: 'utf8' });
  git('init', '-q');
  const rel = path.join('mission', 'registry', 'COUTS-SERVICES.md');
  const p = path.join(arbre, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const ligne = (qui) => `| 2026-09-26T10:00:00Z | lot | e1 | s | aaaaaaaaaaaa | 1 | reel | ${qui} | fait |\n`;
  fs.writeFileSync(p, lots.ENTETE_REGISTRE || '| Date | Lot | Élément | Service | Empreinte (12) | Coût | Source | Propriétaire | État |\n|---|---|---|---|---|---|---|---|---|\n');
  fs.appendFileSync(p, ligne('concepteur'));
  assert.equal(lots.coutsNonCommitesDe(arbre, 'concepteur'), true, 'fichier non suivi portant ma ligne');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  assert.equal(lots.coutsNonCommitesDe(arbre, 'concepteur'), false, 'tout committé');
  fs.appendFileSync(p, ligne('concepteur-autre'));
  assert.equal(lots.coutsNonCommitesDe(arbre, 'concepteur'), false, 'seules les lignes d\'autrui sont en attente');
  fs.appendFileSync(p, ligne('concepteur'));
  assert.equal(lots.coutsNonCommitesDe(arbre, 'concepteur'), true, 'ma ligne en attente : commit exigé');
});

test('revue n° 32 : deux lots lancés au même moment partagent un élément non fait → un seul appel, l\'autre en-cours-ailleurs', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'p.txt', 'contenu-p');
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  process.env.LOTS_TEST_COMPTEUR = compteur;
  try {
    const lotA = ecrireLot(racine, 'lot-pa.json', { nom: 'lot-pa', scriptPath: script, elements: [elementDefaut('e1', entree, 'outA/p.txt', { delai: '400' })] });
    const lotB = ecrireLot(racine, 'lot-pb.json', { nom: 'lot-pb', scriptPath: script, elements: [elementDefaut('e1', entree, 'outB/p.txt', { delai: '400' })] });
    await Promise.all([jouerUnLot(racine, lotA), jouerUnLot(racine, lotB)]);
    assert.equal(lireCompteur(racine), 1, 'payé une seule fois');
    const etats = fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').map((l) => JSON.parse(l).etat).sort();
    assert.deepEqual(etats, ['en-cours-ailleurs', 'fait']);
  } finally {
    delete process.env.LOTS_TEST_COMPTEUR;
  }
});

// -- Seconde revue n° 64 et 68 ------------------------------------------------------------------------------------
function envLot(racine, instance, compteur) {
  return {
    HOLARCH_INSTANCE: instance, HOLARCH_ROOT: racine, HOLARCH_ARBRE: racine, HOLARCH_JOB_REVEIL: path.join(racine, 'introuvable.js'),
    LOTS_TEST_COMPTEUR: compteur,
  };
}
function jobTermine(racine, id) {
  const etat = jobsMod.lireEtat(racine, id);
  return etat && ['fini', 'echoue', 'arrete', 'interrompu'].includes(etat.etat);
}

test('seconde revue n° 64 : élément hors devis (en cours ailleurs au devis, libéré ensuite) → recontrôlé, jamais payé au-delà du plafond', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  const Y = elementDefaut('Y', creerEntree(racine, 'y.txt', 'y'), 'sortie/y.out', { cout: '4', delai: '1500', cout_estime_usd: 4 });
  const X = elementDefaut('X', creerEntree(racine, 'x.txt', 'x'), 'sortie/x.out', { cout: '6', cout_estime_usd: 6 });
  const fichierLot = ecrireLot(racine, 'lot-64.json', { nom: 'lot-64', scriptPath: script, elements: [Y, X] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  lotObj.paralleles = 1; // Y d'abord (1,5 s), X ensuite : X est libéré bien avant que jouer-lot l'atteigne
  fs.writeFileSync(fichierLot, JSON.stringify(lotObj, null, 2));
  const verrouX = lots.verrouElementPath(racine, lots.empreinteElement(lotObj, X, racine));
  const autre = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
  PIDS_A_TUER.push(autre.pid);
  fs.mkdirSync(path.dirname(verrouX), { recursive: true });
  fs.writeFileSync(verrouX, JSON.stringify({ proprietaire: 'inst-a', pid: autre.pid, job: 'a' }));
  const r = envTemp(envLot(racine, 'inst-b', compteur), () => lots.lot(fichierLot, { racine, arbre: racine, proprietaire: 'inst-b', cwd: racine, plafond: 5 }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.devis, 4, 'X, en cours ailleurs, est hors devis');
  PIDS_A_TUER.push(r.pid);
  fs.rmSync(verrouX); // le lot de A échoue sur X et libère son verrou
  autre.kill('SIGKILL');
  attendreQue(() => jobTermine(racine, r.id), { maxMs: 15000 });
  assert.equal(lireCompteur(racine), 1, 'X (6 USD) payé hors devis : plafond 5 dépassé');
  const lignes = fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lignes.find((l) => l.element === 'X').etat, 'hors-budget');
  assert.ok(lignes.reduce((s, l) => s + l.cout_usd, 0) <= 5, 'total payé ≤ plafond');
});

test('seconde revue n° 68 : superviseur du lot tué (kill -9) → la réservation suit jouer-lot, un second lot hors budget est refusé', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  const A = elementDefaut('a1', creerEntree(racine, 'a.txt', 'a'), 'sortie/a.out', { cout: '8', delai: '2500', cout_estime_usd: 8 });
  const fichierA = ecrireLot(racine, 'lot-68-a.json', { nom: 'lot-68-a', scriptPath: script, elements: [A] });
  // Lancé depuis un processus qui sort aussitôt (comme la CLI) : le superviseur n'est pas un enfant de ce test, donc
  // réellement mort (pas zombie) après kill -9.
  const lanceur = spawnSync(process.execPath, ['-e', 'const r = require(process.argv[1]).lot(process.argv[2], { racine: process.argv[3], arbre: process.argv[3], proprietaire: \'inst-a\', cwd: process.argv[3] }); process.stdout.write(JSON.stringify(r));',
    path.join(__dirname, '..', 'bin', 'lots.js'), fichierA, racine], { cwd: racine, env: { ...process.env, ...envLot(racine, 'inst-a', compteur) }, encoding: 'utf8' });
  const r1 = JSON.parse(lanceur.stdout);
  assert.equal(r1.ok, true, r1.message);
  PIDS_A_TUER.push(r1.pid);
  const resA = lots.reservationPath(racine, r1.cle);
  try { attendreQue(() => { const d = JSON.parse(fs.readFileSync(resA, 'utf8')); return d.pid !== r1.pid; }, { maxMs: 4000 }); } catch (_err) { /* sans la correction : jamais repris */ }
  const etatA = jobsMod.lireEtat(racine, r1.id);
  if (etatA && etatA.pgid) PIDS_A_TUER.push(etatA.pgid);
  process.kill(r1.pid, 'SIGKILL'); // le seul superviseur ; jouer-lot (son propre groupe) continue et paie
  spawnSync(process.execPath, ['-e', 'setTimeout(()=>{}, 200)']);
  const B = elementDefaut('b1', creerEntree(racine, 'b.txt', 'b'), 'sortie/b.out', { cout_estime_usd: 4 });
  const fichierB = ecrireLot(racine, 'lot-68-b.json', { nom: 'lot-68-b', scriptPath: script, elements: [B] });
  const r2 = lots.lot(fichierB, { racine, arbre: racine, proprietaire: 'inst-b', cwd: racine, devis: true });
  assert.equal(r2.ok, false, `second lot accepté alors que A paie encore 8 USD (cumul vu : ${r2.cumul})`);
  attendreQue(() => !fs.existsSync(resA), { maxMs: 10000 });
  assert.equal(lireCompteur(racine), 1);
});

// -- Seconde revue, n° 27 -------------------------------------------------------------------------

test('seconde revue n° 27 : {entree:1} sur un élément à une entrée, parametre null, {sortie} dans valider → refusés avant tout devis, rien de payé', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const entree = creerEntree(racine, 'a.txt', 'contenu-a');
  const variantes = [
    ['entree', (l) => { l.commande.push('{entree:1}'); }, /entree:1/],
    ['param-null', (l) => { l.elements[0].parametres.delai = null; }, /parametres\.delai/],
    ['valider-sortie', (l) => { l.valider = [process.execPath, '-e', '0', '{sortie}']; }, /\{sortie\}/],
    ['commande-fichier', (l) => { l.commande.push('{fichier}'); }, /\{fichier\}/],
  ];
  for (const [nom, muter, motif] of variantes) {
    const fichierLot = ecrireLot(racine, `lot-${nom}.json`, {
      nom: `lot-${nom}`, scriptPath: script, elements: [elementDefaut('e1', entree, `sortie/${nom}.out`)],
    });
    const obj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
    muter(obj);
    fs.writeFileSync(fichierLot, JSON.stringify(obj, null, 2));
    const r = envTemp({ HOLARCH_INSTANCE: 'inst-a', HOLARCH_ROOT: racine, HOLARCH_ARBRE: racine }, () => lots.lot(fichierLot, {
      racine, arbre: racine, proprietaire: 'inst-a', cwd: racine,
    }));
    if (r.pid) PIDS_A_TUER.push(r.pid);
    assert.equal(r.ok, false, `${nom} : lot accepté (${JSON.stringify(r)})`);
    assert.match(String(r.message || r.motif || ''), motif, nom);
  }
  assert.equal(lireCompteur(racine), 0, 'aucun appel payant');
});

test('seconde revue n° 27 : resoudreArgv lève sur un gabarit sans valeur, jamais « undefined »', () => {
  assert.throws(() => lots.resoudreArgv(['x', '{entree:1}'], { entrees: ['/a'] }), /entree:1/);
  assert.throws(() => lots.resoudreArgv(['{param:k}'], { parametres: {} }), /param:k/);
  assert.throws(() => lots.resoudreArgv(['{fichier}'], { sortie: '/s' }), /fichier/);
  assert.deepEqual(lots.resoudreArgv(['{entree:0}', '{param:k}', '{sortie}'], { entrees: ['/a'], parametres: { k: 3 }, sortie: '/s' }), ['/a', '3', '/s']);
});

// -- Seconde revue, n° 48 et 70 -------------------------------------------------------------------------
test('seconde revue n° 48 et 70 : verrous de lot, d\'élément et budget.lock au pid mort → tracés dans reprises.jsonl ; stdout de holarch-job lot = l\'id seul', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  const fichierLot = ecrireLot(racine, 'lot-48.json', { nom: 'lot-48', scriptPath: script, elements: [elementDefaut('e1', creerEntree(racine, 'e.txt', 'e'), 'sortie/e.out')] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  const empreintes = lotObj.elements.map((el) => lots.empreinteElement(lotObj, el, racine));
  const cle = lots.cleLot(empreintes);
  const poserMort = (fichier, proprietaire) => {
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify({ pid: 999999999, starttime: '1', proprietaire }));
  };
  poserMort(lots.verrouLotPath(racine, cle), 'mort-lot');
  poserMort(lots.verrouElementPath(racine, empreintes[0]), 'mort-element');
  poserMort(path.join(lots.lotsDir(racine), 'budget.lock'), 'mort-budget');
  // Vraie CLI (processus réel) : c'est son stdout que capture `id=$(holarch-job lot …)`.
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'holarch-job.js'), 'lot', fichierLot], {
    cwd: racine, encoding: 'utf8', env: { ...process.env, ...envLot(racine, 'inst-a', compteur) },
  });
  assert.equal(r.status, 0, r.stderr);
  const lignes = r.stdout.trim().split('\n');
  assert.equal(lignes.length, 1, `stdout = l'id seul, pas la trace de reprise : ${JSON.stringify(r.stdout)}`);
  const etat = jobsMod.lireEtat(racine, lignes[0]);
  if (etat && etat.pgid) PIDS_A_TUER.push(etat.pgid);
  attendreQue(() => jobTermine(racine, lignes[0]), { maxMs: 10000 });
  const reprises = fs.readFileSync(path.join(lots.lotsDir(racine), 'reprises.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const quoi = (p) => reprises.filter((x) => x.detenteur_mort && x.detenteur_mort.proprietaire === p).map((x) => x.quoi);
  assert.deepEqual(quoi('mort-lot'), [`lot ${cle}`], 'reprise du verrou de lot par lot()');
  assert.deepEqual(quoi('mort-element'), [`élément ${empreintes[0].slice(0, 12)}`], 'reprise du verrou d\'élément par jouer-lot');
  assert.deepEqual(quoi('mort-budget'), ['budget.lock'], 'reprise de budget.lock');
  assert.equal(lireCompteur(racine), 1);
});

// -- Seconde revue, n° 65, 69 et 71 -------------------------------------------------------------------------
test('seconde revue n° 65 : {"cout_usd":4.2} suivi de 100 Kio de journal → coût lu, sortie gardée bornée', async () => {
  const racine = nouveauDir();
  const bavard = 'process.stdout.write(JSON.stringify({ cout_usd: 4.2 }) + "\\n"); const l = "x".repeat(1023) + "\\n"; for (let i = 0; i < 100; i += 1) process.stdout.write(l);';
  const res = await lots.executerCommande([process.execPath, '-e', bavard], { cwd: racine, env: process.env });
  assert.equal(res.code, 0);
  assert.ok(res.stdout.length <= 64 * 1024, `stdout gardé : ${res.stdout.length} caractères`);
  assert.equal(lots.dernierCoutDeclare(res.stdout), 4.2);
  const deux = 'process.stdout.write(JSON.stringify({ cout_usd: 1 }) + "\\n" + "y".repeat(100 * 1024) + "\\n" + JSON.stringify({ cout_usd: 2 }));';
  const res2 = await lots.executerCommande([process.execPath, '-e', deux], { cwd: racine, env: process.env });
  assert.equal(lots.dernierCoutDeclare(res2.stdout), 2, 'la ligne de coût la plus tardive gagne (même sans saut de ligne final)');
});

test('seconde revue n° 69 : 16 écrivains simultanés du registre COUTS-SERVICES.md, départ commun → aucune ligne perdue (15 manches)', async () => {
  const { spawn } = require('child_process');
  const code = 'const lots = require(process.argv[1]); const d = process.argv[2]; const t0 = Number(process.argv[4]); while (Date.now() < t0) { /* barrière de départ (troisième revue, test 69) */ } lots.ecrireLigneCouts(d, d, { date: "2026-09-26T00:00:00Z", lot: "l", element: "e" + process.argv[3], service: "s", empreinte: "0123456789abcdef", cout_usd: 0.01, source: "reel", proprietaire: "p", etat: "fait" });';
  for (let manche = 0; manche < 15; manche += 1) {
    const racine = nouveauDir();
    const t0 = String(Date.now() + 700);
    await Promise.all(Array.from({ length: 16 }, (_x, i) => new Promise((resolve) => {
      const c = spawn(process.execPath, ['-e', code, path.join(__dirname, '..', 'bin', 'lots.js'), racine, String(i), t0], { stdio: 'ignore' });
      c.on('exit', resolve);
    })));
    const lignes = lots.parserTableCouts(fs.readFileSync(lots.coutsServicesPath(racine), 'utf8'));
    assert.equal(lignes.length, 16, `manche ${manche} : ${lignes.length} lignes sur 16`);
    assert.equal(fs.readFileSync(lots.coutsServicesPath(racine), 'utf8').split('\n')[0], '# Coûts des services — append-only, écrit par holarch-job');
    assert.equal(fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').length, 16);
  }
});

test('seconde revue n° 71 : lot dont tous les éléments sont en échec → jouer-lot rend 1 (job echoue), jamais fini 0', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const echec = elementDefaut('e1', creerEntree(racine, 'e.txt', 'e'), 'sortie/e.out', { echec: '1' });
  assert.equal(await jouerUnLot(racine, ecrireLot(racine, 'lot-71.json', { nom: 'lot-71', scriptPath: script, elements: [echec] })), 1);
  const bon = elementDefaut('b1', creerEntree(racine, 'b.txt', 'b'), 'sortie/b.out');
  assert.equal(await jouerUnLot(racine, ecrireLot(racine, 'lot-71b.json', { nom: 'lot-71b', scriptPath: script, elements: [bon] })), 0, 'témoin : lot fait → 0');
});

// -- Seconde revue, n° 33 (4) : câblage du sleep-guard, par le vrai hook -----------------------------------------
const HOOKS_JS = path.join(__dirname, '..', 'hooks', 'holarch-hooks.js');
const SKIP_HOOKS_LOTS = fs.existsSync(HOOKS_JS) ? false : 'holarch-hooks.js absent à côté de ce test (paquet non appliqué)';
test('seconde revue n° 33 (4) : sleep-guard ignore COUTS-SERVICES.md sous un lot vivant d\'autrui, jamais mes lignes', { skip: SKIP_HOOKS_LOTS }, () => {
  const racine = nouveauDir();
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: racine, encoding: 'utf8' });
  fs.mkdirSync(path.join(racine, 'mission', 'x'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'mission', 'x', 'STATUS.md'), '# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | DELIVERED |\n| Note | — |\n| Réveil | — |\n');
  fs.writeFileSync(path.join(racine, '.gitignore'), 'mission/.holarch/\n');
  lots.ecrireLigneCouts(racine, racine, { date: '2026-09-26T00:00:00Z', lot: 'l0', element: 'e0', service: 's', empreinte: '0123456789abcdef', cout_usd: 0.01, source: 'reel', proprietaire: 'x', etat: 'fait' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  let appel = 0;
  const bloque = () => {
    // Session neuve à chaque appel : le sleep-guard laisse passer après STOP_BLOCKS_MAX refus d'une même session.
    appel += 1;
    const input = { session_id: `n33-${process.pid}-${Date.now()}-${appel}`, cwd: racine, hook_event_name: 'Stop' };
    const r = spawnSync(process.execPath, [HOOKS_JS, 'sleep-guard'], { input: JSON.stringify(input), encoding: 'utf8',
      env: { ...process.env, HOLARCH_ROOT: racine, HOLARCH_INSTANCE: 'x', HOLARCH_COMMIT: 'oui' } });
    return /non committé/.test(r.stdout);
  };
  const ligne = (proprietaire) => lots.ecrireLigneCouts(racine, racine, { date: '2026-09-26T00:00:01Z', lot: 'l1', element: 'e1', service: 's', empreinte: 'fedcba9876543210', cout_usd: 0.02, source: 'reel', proprietaire, etat: 'fait' });
  ligne('autre');
  assert.equal(bloque(), true, 'témoin : sans lot vivant, COUTS-SERVICES.md modifié bloque');
  const verrou = lots.verrouLotPath(racine, 'cle-autre');
  const a = lots.acquerirVerrou(verrou, { proprietaire: 'autre', pid: process.pid, starttime: jobsMod.capturerVivacite(process.pid).starttime, job: null, debut: jobsMod.nowIso() });
  assert.equal(a.acquis, true);
  try {
    assert.equal(bloque(), false, 'lot vivant d\'autrui : ses lignes ne sont pas à committer par moi');
    ligne('x');
    assert.equal(bloque(), true, 'mes propres lignes non committées : toujours exigées (revue n° 28)');
  } finally { fs.rmSync(verrou, { force: true }); }
});

test('troisième revue (test 33 (4)) : seul mon propre lot vit → COUTS-SERVICES.md modifié n\'est pas ignoré (filtre de propriétaire)', { skip: SKIP_HOOKS_LOTS }, () => {
  const racine = nouveauDir();
  const git = (...args) => spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: racine, encoding: 'utf8' });
  fs.mkdirSync(path.join(racine, 'mission', 'x'), { recursive: true });
  fs.writeFileSync(path.join(racine, 'mission', 'x', 'STATUS.md'), '# Statut\n\n| Champ | Valeur |\n|---|---|\n| État | DELIVERED |\n| Note | — |\n| Réveil | — |\n');
  fs.writeFileSync(path.join(racine, '.gitignore'), 'mission/.holarch/\n');
  lots.ecrireLigneCouts(racine, racine, { date: '2026-09-26T00:00:00Z', lot: 'l0', element: 'e0', service: 's', empreinte: '0123456789abcdef', cout_usd: 0.01, source: 'reel', proprietaire: 'x', etat: 'fait' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  lots.ecrireLigneCouts(racine, racine, { date: '2026-09-26T00:00:01Z', lot: 'l1', element: 'e1', service: 's', empreinte: 'fedcba9876543210', cout_usd: 0.02, source: 'reel', proprietaire: 'autre', etat: 'fait' });
  const verrou = lots.verrouLotPath(racine, 'cle-mien');
  const a = lots.acquerirVerrou(verrou, { proprietaire: 'x', pid: process.pid, starttime: jobsMod.capturerVivacite(process.pid).starttime, job: null, debut: jobsMod.nowIso() });
  assert.equal(a.acquis, true);
  try {
    const input = { session_id: `n33b-${process.pid}-${Date.now()}`, cwd: racine, hook_event_name: 'Stop' };
    const r = spawnSync(process.execPath, [HOOKS_JS, 'sleep-guard'], { input: JSON.stringify(input), encoding: 'utf8',
      env: { ...process.env, HOLARCH_ROOT: racine, HOLARCH_INSTANCE: 'x', HOLARCH_COMMIT: 'oui' } });
    assert.match(r.stdout, /non committé/, 'mon propre lot vivant a fait ignorer COUTS-SERVICES.md (aucun lot d\'autrui)');
  } finally { fs.rmSync(verrou, { force: true }); }
});

// -- Troisième revue n° 75 et 83 ------------------------------------------------------------------------------------
const chargeMod = require(path.join(__dirname, '..', 'bin', 'charge.js'));
function dormir(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
/** `lot` joué par un processus qui sort aussitôt (comme la CLI) : le superviseur n'est pas un enfant du test. */
function lotParCli(racine, fichier, instance, compteur) {
  const r = spawnSync(process.execPath, ['-e', 'const r = require(process.argv[1]).lot(process.argv[2], { racine: process.argv[3], arbre: process.argv[3], proprietaire: process.argv[4], cwd: process.argv[3] }); process.stdout.write(JSON.stringify(r));',
    path.join(__dirname, '..', 'bin', 'lots.js'), fichier, racine, instance], { cwd: racine, env: { ...process.env, ...envLot(racine, instance, compteur) }, encoding: 'utf8' });
  const res = JSON.parse(r.stdout);
  if (res.ok) PIDS_A_TUER.push(res.pid);
  return res;
}
/** Attend que jouer-lot (chef du groupe du job) ait lancé le service : verrou d'élément posé. */
function attendreServiceLance(racine, r, verrouEl) {
  attendreQue(() => { const e = jobsMod.lireEtat(racine, r.id); return !!(e && e.pgid && fs.existsSync(verrouEl)); }, { maxMs: 8000 });
  const pgid = jobsMod.lireEtat(racine, r.id).pgid;
  PIDS_A_TUER.push(pgid);
  dormir(100);
  return pgid;
}
function lotN75(racine, nom) {
  const script = preparerService(racine);
  const A = elementDefaut('a1', creerEntree(racine, 'a.txt', 'a'), 'sortie/a.out', { cout: '4', delai: '1500', cout_estime_usd: 4 });
  const fichier = ecrireLot(racine, `${nom}.json`, { nom, scriptPath: script, elements: [A] });
  const lotObj = JSON.parse(fs.readFileSync(fichier, 'utf8'));
  return { fichier, verrouEl: lots.verrouElementPath(racine, lots.empreinteElement(lotObj, A, racine)) };
}

test('troisième revue n° 75 : jouer-lot tué seul (kill -9) pendant l\'appel, superviseur vivant → le groupe qui paie est tué, jamais deux appels payés (balayage du moment)', () => {
  for (const apresMs of [0, 500, 1100]) {
    const racine = nouveauDir();
    ecrireConfig(racine, '5');
    const compteur = compteurPath(racine);
    fs.writeFileSync(compteur, '0');
    const { fichier, verrouEl } = lotN75(racine, `lot-75a-${apresMs}`);
    const r1 = lotParCli(racine, fichier, 'inst-a', compteur);
    assert.equal(r1.ok, true, r1.message);
    const pgid = attendreServiceLance(racine, r1, verrouEl);
    dormir(apresMs);
    process.kill(pgid, 'SIGKILL'); // jouer-lot seul : le service, même groupe, reste
    let r2 = lotParCli(racine, fichier, 'inst-a', compteur);
    const debut = Date.now();
    while (!r2.ok && Date.now() - debut < 6000) { dormir(100); r2 = lotParCli(racine, fichier, 'inst-a', compteur); }
    assert.equal(r2.ok, true, `relance jamais acceptée : ${r2.message}`);
    attendreQue(() => jobTermine(racine, r1.id) && jobTermine(racine, r2.id), { maxMs: 15000 });
    dormir(1700); // l'orphelin, s'il avait survécu, aurait fini son appel
    assert.equal(lireCompteur(racine), 1, `kill à +${apresMs} ms : ${lireCompteur(racine)} appels payés 4 USD pour budget 5`);
  }
});

test('troisième revue n° 75 : superviseur et jouer-lot tués, service orphelin → relance refusée, sleep-guard et cumul le voient, arreter le tue', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '5');
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  const { fichier, verrouEl } = lotN75(racine, 'lot-75b');
  const r1 = lotParCli(racine, fichier, 'inst-a', compteur);
  assert.equal(r1.ok, true, r1.message);
  const pgid = attendreServiceLance(racine, r1, verrouEl);
  process.kill(r1.pid, 'SIGKILL');
  process.kill(pgid, 'SIGKILL');
  dormir(100);
  assert.equal(chargeMod.groupeVivant(pgid, null), true, 'le service orphelin tourne');
  const r2 = lotParCli(racine, fichier, 'inst-a', compteur);
  assert.equal(r2.ok, false, 'relance acceptée pendant que l\'orphelin paie');
  assert.equal(lots.verrousLotVivants(racine).length, 1, 'sleep-guard aveugle au lot orphelin');
  assert.equal(lots.cumulActuel(racine, racine), 4, 'réservation de l\'orphelin hors du cumul');
  const a = jobsMod.arreterJob(racine, r1.id, 'utilisateur');
  assert.equal(a.ok, true, a.message);
  attendreQue(() => !chargeMod.groupeVivant(pgid, null), { maxMs: 3000 });
  dormir(1600);
  assert.equal(lireCompteur(racine), 0, 'l\'orphelin a fini son appel malgré arreter');
});

test('troisième revue n° 83 : commande qui sort 0 en laissant un membre de son groupe → membre tué avant la fin du job', () => {
  const racine = nouveauDir();
  const r = envTemp(envLot(racine, 'inst-a', compteurPath(racine)), () => jobsMod.lancer({
    nom: 'survivant', commande: ['sh', '-c', 'sleep 20 & exit 0'], cwd: racine, root: racine, proprietaire: 'inst-a',
  }));
  PIDS_A_TUER.push(r.pid);
  attendreQue(() => jobTermine(racine, r.id), { maxMs: 8000 });
  const pgid = jobsMod.lireEtat(racine, r.id).pgid;
  PIDS_A_TUER.push(pgid);
  assert.equal(chargeMod.groupeVivant(pgid, null), false, 'sleep 20 survit au job terminé (jeton libéré, membre vivant)');
});

// -- Troisième revue : tests qui ne mordaient qu'à moitié (64, 68, 48) ----------------------------------------------
test('troisième revue (test 64) : élément hors devis sans plafond → recontrôlé contre budget_services_usd seul, jamais payé au-delà', () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const compteur = compteurPath(racine);
  fs.writeFileSync(compteur, '0');
  const Y = elementDefaut('Y', creerEntree(racine, 'y.txt', 'y'), 'sortie/y.out', { cout: '4', delai: '1500', cout_estime_usd: 4 });
  const X = elementDefaut('X', creerEntree(racine, 'x.txt', 'x'), 'sortie/x.out', { cout: '6', cout_estime_usd: 6 });
  const fichierLot = ecrireLot(racine, 'lot-64b.json', { nom: 'lot-64b', scriptPath: script, elements: [Y, X] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  lotObj.paralleles = 1;
  fs.writeFileSync(fichierLot, JSON.stringify(lotObj, null, 2));
  const verrouX = lots.verrouElementPath(racine, lots.empreinteElement(lotObj, X, racine));
  const autre = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
  PIDS_A_TUER.push(autre.pid);
  fs.mkdirSync(path.dirname(verrouX), { recursive: true });
  fs.writeFileSync(verrouX, JSON.stringify({ proprietaire: 'inst-a', pid: autre.pid, job: 'a' }));
  const r = envTemp(envLot(racine, 'inst-b', compteur), () => lots.lot(fichierLot, { racine, arbre: racine, proprietaire: 'inst-b', cwd: racine }));
  assert.equal(r.ok, true, r.message);
  assert.equal(r.devis, 4);
  PIDS_A_TUER.push(r.pid);
  // Un autre lot réserve 5 USD pendant que Y tourne : 4 + 5 + 6 > 10 — seul le budget refuse X (aucun plafond).
  fs.writeFileSync(lots.reservationPath(racine, 'autre-lot'), JSON.stringify({ proprietaire: 'inst-a', pid: autre.pid, montant: 5, job: 'a' }));
  fs.rmSync(verrouX);
  attendreQue(() => jobTermine(racine, r.id), { maxMs: 15000 });
  assert.equal(lireCompteur(racine), 1, 'X (6 USD) payé hors devis au-delà de budget_services_usd');
  const lignes = fs.readFileSync(lots.coutsJsonlPath(racine), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lignes.find((l) => l.element === 'X').etat, 'hors-budget');
});

test('troisième revue (test 68) : verrou de lot et réservation repris par un autre pendant le jeu → jouer-lot ne les retire pas en sortant', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const A = elementDefaut('a1', creerEntree(racine, 'a.txt', 'a'), 'sortie/a.out', { delai: '800' });
  const fichierLot = ecrireLot(racine, 'lot-68b.json', { nom: 'lot-68b', scriptPath: script, elements: [A] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  const cle = lots.cleLot([lots.empreinteElement(lotObj, A, racine)]);
  const autre = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 30000)'], { stdio: 'ignore' });
  PIDS_A_TUER.push(autre.pid);
  const jeu = lots.jouerLot(fichierLot, cle, { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine });
  await new Promise((r) => { setTimeout(r, 400); });
  const autrui = JSON.stringify({ proprietaire: 'inst-b', pid: autre.pid, montant: 1, job: 'b' });
  fs.writeFileSync(lots.reservationPath(racine, cle), autrui);
  fs.writeFileSync(lots.verrouLotPath(racine, cle), autrui);
  assert.equal(await jeu, 0);
  assert.equal(fs.readFileSync(lots.reservationPath(racine, cle), 'utf8'), autrui, 'réservation d\'autrui retirée');
  assert.equal(fs.readFileSync(lots.verrouLotPath(racine, cle), 'utf8'), autrui, 'verrou de lot d\'autrui retiré');
});

test('troisième revue (test 48) : jouer-lot lancé sur un verrou de lot au détenteur mort (ni lui ni son parent) → reprise journalisée', async () => {
  const racine = nouveauDir();
  ecrireConfig(racine, '10');
  const script = preparerService(racine);
  const A = elementDefaut('a1', creerEntree(racine, 'a.txt', 'a'), 'sortie/a.out');
  const fichierLot = ecrireLot(racine, 'lot-48b.json', { nom: 'lot-48b', scriptPath: script, elements: [A] });
  const lotObj = JSON.parse(fs.readFileSync(fichierLot, 'utf8'));
  const cle = lots.cleLot([lots.empreinteElement(lotObj, A, racine)]);
  fs.mkdirSync(path.dirname(lots.verrouLotPath(racine, cle)), { recursive: true });
  fs.writeFileSync(lots.verrouLotPath(racine, cle), JSON.stringify({ pid: 999999999, starttime: '1', proprietaire: 'mort-48' }));
  assert.equal(await lots.jouerLot(fichierLot, cle, { racine, arbre: racine, proprietaire: 'inst-a', cwd: racine }), 0);
  const reprises = fs.readFileSync(path.join(lots.lotsDir(racine), 'reprises.jsonl'), 'utf8');
  assert.match(reprises, new RegExp(`"quoi":"lot ${cle}".*"proprietaire":"mort-48"`), 'reprise du verrou de lot par prendreEnCharge non journalisée');
});
