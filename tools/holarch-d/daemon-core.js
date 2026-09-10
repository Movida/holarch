'use strict';
/**
 * daemon-core.js — logique du démon indépendante du transport HTTP (daemon.js s'en sert, une
 * requête = un appel de fonction ici). `launch` est injecté plutôt qu'importé en dur : les tests
 * substituent un faux lanceur (aucun sous-processus réel, aucun coût) ; `daemon.js` branche le
 * vrai `launch.js`. `ledger.js`/`tasks.js` restent importés directement — ils sont déjà sûrs à
 * tester tels quels (redirigés via `HOLARCH_HOME`, jamais de sous-processus).
 */

const policy = require('./policy');
const router = require('./router');
const ledger = require('./ledger');
const tasks = require('./tasks');
const spaces = require('./spaces');
const catalogue = require('./specialists'); // « catalogue » ici : `specialists` est déjà un paramètre de submit_task

const NIVEAUX_IMPLEMENTES = [1]; // niveaux 2 et 3 : hors périmètre des Étapes 1-2 (§14)

const VERDICTS = ['good', 'mixed', 'bad'];

/**
 * Mode de la passe mémoire (D9), tranché par la mesure et non par la spec — voir README,
 * « Résultats mesurés ». `neuf` = appel neuf avec le `RESULT.md` en entrée (repli prévu par la
 * spec) ; `resume` = reprise de la session de la tâche. Surchargeable par `HOLARCH_MEMOIRE_MODE`
 * pour pouvoir re-mesurer sans retoucher le code.
 */
const MODE_MEMOIRE = process.env.HOLARCH_MEMOIRE_MODE || 'resume';

function espace(s) {
  return s || 'default';
}

function construireResultMd({ reponse, tache, sortie }) {
  const res = sortie && sortie.res;
  const cout = res && typeof res.total_cost_usd === 'number' ? res.total_cost_usd : null;
  const duree = sortie ? sortie.elapsedMs : null;
  const tours = res ? res.num_turns : null;
  const pied = [
    '',
    '## Coût réel',
    `Profil : ${tache.profile} · Modèle : ${tache.model || '—'}/${tache.effort || '—'} · `
      + `Coût : ${cout !== null ? `${cout.toFixed(4)} USD` : 'inconnu'} · `
      + `Durée : ${duree !== null ? `${(duree / 1000).toFixed(1)} s` : 'inconnue'} · `
      + `Tours : ${tours !== null ? tours : '—'}`,
    '',
  ].join('\n');
  return `${String(reponse || '(réponse vide)').trim()}\n${pied}`;
}

/**
 * Résout l'espace d'une demande. `default` est auto-créé (compatibilité Étape 1 : rien ne casse
 * pour qui n'a jamais déclaré d'espace) ; tout autre espace doit avoir été **déclaré en CLI**
 * (§9) — un espace inconnu est une erreur explicite, jamais une création implicite : accorder un
 * droit de lecture est un acte de l'utilisateur, pas un effet de bord d'une conversation.
 */
function assurerEspace(nom) {
  const n = espace(nom);
  if (n === spaces.ESPACE_DEFAUT) {
    spaces.assurerEspaceDefaut();
    return n;
  }
  if (!spaces.existe(n)) {
    throw new Error(`espace inconnu : « ${n} » — le déclarer d'abord en CLI (holarch space add ${n} --root <chemin>) ; les espaces ne se créent jamais depuis MCP`);
  }
  return n;
}

/**
 * Rassemble tout ce que le prompt système de niveau 1 doit contenir (§6) : fiche du spécialiste,
 * mémoire de l'espace, carte du dépôt, décisions déjà prises, racines lisibles. C'est ici que
 * l'état sur disque entre dans l'appel — `launch.js` reste pur et ne lit rien.
 */
function contexteNiveau1(nomEspace, specialiste) {
  const esp = spaces.lireEspace(nomEspace);
  const f = catalogue.fiche(specialiste);
  return {
    fiche: f ? f.texte : null,
    outilsFiche: f ? (f.meta.tools || 'none') : 'none',
    memoire: spaces.lireMemoire(nomEspace, specialiste),
    digest: spaces.lireDigest(nomEspace),
    decisions: spaces.lireDecisions(nomEspace),
    racines: esp ? esp.roots : [],
  };
}

/**
 * @param {{launch: object, depotRacine: string, concurrenceMax?: number}} deps
 */
function creerCoeur({ launch, depotRacine, concurrenceMax }) {
  const cfg = () => policy.chargerPolitique();
  const maxParalleles = () => concurrenceMax || Number(policy.parametre(cfg(), 'concurrence_max', 2));
  const enCours = new Set();
  const enAttente = [];
  const handles = new Map(); // task_id -> { kill }

  // ---------------------------------------------------------------------
  // refine_prompt (niveau 0, synchrone)
  // ---------------------------------------------------------------------
  async function refinePrompt({ prompt, space }) {
    if (!prompt || !String(prompt).trim()) throw new Error('prompt requis');
    const configuration = cfg();
    const appel = launch.preparerTriage({ prompt });
    const sortie = await launch.executerTriage(appel);
    const id = ledger.nouvelId();
    const exit = !sortie.res ? 'sans_resultat' : (sortie.res.is_error ? 'erreur' : 'ok');
    ledger.enregistrer({
      id, space: espace(space), task: null, level: 0, specialist: null,
      profil: appel.profil, modele: appel.modele, effort: appel.effort,
      resultat: sortie.res, elapsedMs: sortie.elapsedMs, exit, depotRacine,
    });

    const brut = sortie.res && sortie.res.structured_output;
    const { sortie: triage, repli_specialistes: repliSpecialistes } = router.validerTriage(brut, prompt);
    const chosenBy = brut ? 'router' : 'fallback';
    const dv = router.devis({ space: espace(space), level: triage.level, profil: triage.profile, cfg: configuration });

    return {
      ...triage,
      chosen_by: chosenBy,
      repli_specialistes: repliSpecialistes,
      estimate: dv,
      ledger_id: id,
    };
  }

  // ---------------------------------------------------------------------
  // submit_task / get_task / list_tasks / cancel_task (niveau 1 uniquement à l'Étape 1)
  // ---------------------------------------------------------------------
  function submitTask({
    prompt, level, space, specialists: specialistesDemandes, profile, model, effort, instructions, review,
    max_budget_usd: maxBudgetUsd, max_turns: maxTurns, timeout_s: timeoutS, parent_task: parentTask,
  }) {
    if (!prompt || !String(prompt).trim()) throw new Error('prompt requis');
    const niveau = Number(level);
    if (!NIVEAUX_IMPLEMENTES.includes(niveau)) {
      throw new Error(`niveau ${level} non implémenté à cette étape (seul le niveau 1 l'est — voir README « Prochaines étapes »)`);
    }
    if (review) throw new Error('review non implémenté à cette étape (niveau 1 uniquement, sans relecture)');
    if (parentTask) throw new Error('parent_task (fils de discussion) non implémenté à cette étape');
    // Valide le profil tôt (avant de créer quoi que ce soit) en réutilisant policy.js.
    const meta = policy.resoudreProfil(cfg(), profile, {});
    const nomEspace = assurerEspace(space);
    // §8 : un nom hors catalogue retombe sur `generaliste` plutôt que d'échouer — un routeur qui
    // invente un spécialiste est un cas attendu, la demande doit aboutir en le signalant.
    const choix = catalogue.resoudre(Array.isArray(specialistesDemandes) && specialistesDemandes[0]);

    const id = ledger.nouvelId();
    const dv = router.devis({ space: nomEspace, level: niveau, profil: meta.profil, cfg: cfg() });
    const tache = tasks.creer({
      id, prompt, level: niveau, space: nomEspace,
      specialist: choix.nom,
      specialistDemande: choix.repli ? choix.demande : null,
      profile: meta.profil, model: model || null, effort: effort || null,
      instructions: instructions || null, maxBudgetUsd: maxBudgetUsd || null, maxTurns: maxTurns || null,
      timeoutS: timeoutS || null, devis: dv,
    });
    enAttente.push(id);
    essayerDemarrer();
    return {
      task_id: id,
      devis: dv,
      state: tache.state,
      specialist: choix.nom,
      specialist_fallback: choix.repli ? choix.demande : null,
    };
  }

  function essayerDemarrer() {
    while (enCours.size < maxParalleles() && enAttente.length) {
      const id = enAttente.shift();
      enCours.add(id);
      executerTache(id).finally(() => {
        enCours.delete(id);
        essayerDemarrer();
      });
    }
  }

  async function executerTache(id) {
    const tache = tasks.lire(id);
    tasks.patch(id, { state: 'running', startedAt: new Date().toISOString() });
    let appel;
    try {
      appel = launch.preparerTacheNiveau1({
        prompt: tache.prompt, profile: tache.profile, model: tache.model, effort: tache.effort,
        instructions: tache.instructions, maxTurns: tache.maxTurns, maxBudgetUsd: tache.maxBudgetUsd,
        timeoutS: tache.timeoutS,
        space: tache.space, specialist: tache.specialist,
        contexte: contexteNiveau1(tache.space, tache.specialist),
      });
    } catch (e) {
      tasks.patch(id, { state: 'failed', error: e.message, finishedAt: new Date().toISOString() });
      return;
    }

    const cancelable = {};
    handles.set(id, cancelable);
    const sortie = await launch.executerTacheNiveau1(appel, {
      cancelable,
      onPartial: (texte) => tasks.patch(id, { partial: texte }),
      onLine: (ligneBrute) => tasks.ajouterLigneTranscript(id, ligneBrute),
    });
    handles.delete(id);

    const apresCoup = tasks.lire(id);
    const annulee = apresCoup && apresCoup.cancelRequested;
    const exit = annulee ? 'annulee' : (!sortie.res ? 'sans_resultat' : (sortie.res.is_error ? 'erreur' : 'ok'));
    ledger.enregistrer({
      id, space: tache.space, task: id, level: tache.level, specialist: tache.specialist,
      profil: appel.profil, modele: appel.modele, effort: appel.effort,
      resultat: sortie.res, elapsedMs: sortie.elapsedMs, exit, depotRacine,
    });

    let state = 'failed';
    if (annulee) state = 'cancelled';
    else if (sortie.res && !sortie.res.is_error) state = 'done';

    if (sortie.res) {
      const reponse = sortie.res.result || '';
      tasks.ecrireResultat(id, construireResultMd({ reponse, tache, sortie }));
    }

    tasks.patch(id, {
      state,
      finishedAt: new Date().toISOString(),
      cost_usd: sortie.res && typeof sortie.res.total_cost_usd === 'number' ? sortie.res.total_cost_usd : null,
      turns: sortie.res ? sortie.res.num_turns : null,
      duration_ms: sortie.elapsedMs,
      session_id: (sortie.res && sortie.res.session_id) || null,
      error: !sortie.res ? `pas de résultat exploitable (code ${sortie.exitCode}, signal ${sortie.signal || '—'})` : null,
      partial: null,
    });

    if (state === 'done') await passeMemoire(id);
  }

  // ---------------------------------------------------------------------
  // Passe mémoire (D8/D9)
  // ---------------------------------------------------------------------

  /**
   * Réécrit intégralement la mémoire du spécialiste pour l'espace, **après une tâche réussie
   * seulement** (D9) : mémoriser coûte un appel de plus, il ne doit jamais s'ajouter à une tâche
   * qui a déjà dérapé.
   *
   * **La garde est unique et c'est `state !== 'done'`.** Elle couvre les deux cas que D9 veut
   * exclure, parce que `executerTache` ne pose `done` que sur un résultat sans `is_error` : la
   * tâche qui échoue (pas de résultat exploitable, sous-processus mort) *et* la tâche qui atteint
   * un plafond — `--max-turns`/`--max-budget-usd` épuisés font répondre au CLI un résultat
   * `is_error: true` (`subtype: error_max_turns`), donc `failed`. Il n'existe volontairement pas de
   * champ `budgetEpuise` sur la tâche : il ne distinguerait rien de plus que ce que l'état dit
   * déjà. Les deux cas sont couverts par un test de `test-daemon-core.js` chacun.
   *
   * Un échec de la passe mémoire n'échoue **jamais** la tâche : l'utilisateur a son avis, c'est ce
   * qui compte. L'échec est journalisé au ledger, la mémoire reste celle d'avant.
   */
  async function passeMemoire(id) {
    const tache = tasks.lire(id);
    if (!tache || tache.state !== 'done') return { saute: 'tâche non réussie' };

    if (!launch.preparerPasseMemoire) return { saute: 'lanceur sans passe mémoire' };

    const appel = launch.preparerPasseMemoire({
      mode: MODE_MEMOIRE,
      sessionId: tache.session_id || null,
      resultMd: tasks.lireResultat(id),
      memoireActuelle: spaces.lireMemoire(tache.space, tache.specialist),
      space: tache.space,
      specialist: tache.specialist,
    });

    let sortie;
    try {
      sortie = await launch.executerPasseMemoire(appel);
    } catch (e) {
      return { saute: `passe mémoire impossible : ${e.message}` };
    }

    const idLedger = ledger.nouvelId();
    const ok = !!(sortie.res && !sortie.res.is_error && String(sortie.res.result || '').trim());
    ledger.enregistrer({
      id: idLedger, space: tache.space, task: id, level: 1, specialist: tache.specialist,
      profil: appel.profil, modele: appel.modele, effort: appel.effort,
      resultat: sortie.res, elapsedMs: sortie.elapsedMs, exit: ok ? 'ok' : 'erreur', depotRacine,
    });
    if (!ok) return { saute: 'passe mémoire sans résultat exploitable', mode: appel.mode };

    spaces.ecrireMemoire(tache.space, tache.specialist, sortie.res.result);
    tasks.patch(id, { memoryUpdatedAt: new Date().toISOString() });
    return { ok: true, mode: appel.mode, cout_usd: sortie.res.total_cost_usd ?? null };
  }

  // ---------------------------------------------------------------------
  // rate_result (§13.2) et list_specialists (§9)
  // ---------------------------------------------------------------------

  /**
   * Verdict de l'utilisateur sur une tâche, écrit dans le `DECISIONS.md` de son espace. C'est le
   * seul canal par lequel un jugement humain entre dans l'état de holarch-d — et il est
   * append-only : une note se corrige en en ajoutant une qui la remplace, jamais en effaçant.
   */
  function rateResult({
    task_id: taskId, verdict, note, decisions, supersedes,
  }) {
    const t = tasks.lire(taskId);
    if (!t) throw new Error(`tâche introuvable : ${taskId}`);
    if (!VERDICTS.includes(verdict)) {
      throw new Error(`verdict invalide : « ${verdict} » (attendu : ${VERDICTS.join(' | ')})`);
    }
    const listeDecisions = Array.isArray(decisions) ? decisions : (decisions ? [decisions] : []);
    const entree = spaces.ajouterDecision(t.space, {
      taskId, verdict, note: note || null, decisions: listeDecisions,
      supersedes: supersedes || null, specialist: t.specialist,
    });
    tasks.patch(taskId, { verdict, ratedAt: entree.date });
    ledger.enregistrer({
      id: ledger.nouvelId(), space: t.space, task: taskId, level: 1, specialist: t.specialist,
      profil: t.profile, modele: null, effort: null, resultat: null, elapsedMs: 0,
      exit: `note:${verdict}`, depotRacine,
    });
    return {
      ok: true, task_id: taskId, space: t.space, verdict,
      decisions_recorded: listeDecisions.length, decisions_path: spaces.cheminDecisions(t.space),
    };
  }

  /** Fiches résumées + nombre de tâches déjà faites par chacun dans l'espace (§9). */
  function listSpecialists({ space } = {}) {
    const nomEspace = espace(space);
    const cat = catalogue.catalogue();
    return {
      space: nomEspace,
      specialists: catalogue.resumes({ space: nomEspace }),
      catalogue_errors: cat.erreurs,
    };
  }

  // ---------------------------------------------------------------------
  // Espaces et digest (CLI uniquement — jamais exposés en MCP, §9)
  // ---------------------------------------------------------------------

  function spaceAdd({ name, roots, repo, description, force }) {
    const esp = spaces.creerEspace({
      nom: name, racines: roots || [], repo: repo || null, description: description || null, ecraser: !!force,
    });
    return { ok: true, space: esp, path: spaces.cheminEspace(esp.name) };
  }

  function spaceList() {
    spaces.assurerEspaceDefaut();
    return spaces.listerEspaces().map((esp) => Object.assign({}, esp, {
      digest: spaces.digestPerime(esp.name),
      tasks: tasks.lister({ space: esp.name }).length,
    }));
  }

  /** Régénère `DIGEST.md` : la seule fonction du démon qui laisse un modèle explorer un dépôt. */
  async function spaceDigest({ name, force }) {
    const esp = spaces.lireEspace(name);
    if (!esp) throw new Error(`espace inconnu : « ${name} »`);
    const etat = spaces.digestPerime(name);
    if (!etat.perime && !force) {
      return { ok: true, regenere: false, motif: etat.motif, path: spaces.cheminDigest(name) };
    }
    const appel = launch.preparerDigest({ racines: esp.roots });
    const sortie = await launch.executerDigest(appel);
    const idLedger = ledger.nouvelId();
    ledger.enregistrer({
      id: idLedger, space: name, task: null, level: 1, specialist: 'cartographe',
      profil: appel.profil, modele: appel.modele, effort: appel.effort,
      resultat: sortie.res, elapsedMs: sortie.elapsedMs,
      exit: sortie.res && !sortie.res.is_error ? 'ok' : 'erreur', depotRacine,
    });
    if (!sortie.res || sortie.res.is_error || !String(sortie.res.result || '').trim()) {
      throw new Error(`la passe de cartographie n'a rien produit d'exploitable (code ${sortie.exitCode})`);
    }
    const chemin = spaces.ecrireDigest(name, {
      corps: sortie.res.result,
      commit: spaces.headDepot(name),
      cout: sortie.res.total_cost_usd ?? null,
    });
    return {
      ok: true, regenere: true, motif: etat.motif, path: chemin,
      cout_usd: sortie.res.total_cost_usd ?? null, commit: spaces.headDepot(name),
    };
  }

  function getTask(id) {
    const t = tasks.lire(id);
    if (!t) throw new Error(`tâche introuvable : ${id}`);
    if (t.state === 'done') return Object.assign({}, t, { result_md: tasks.lireResultat(id) });
    return t;
  }

  function listTasks({ space: s, state, limit }) {
    return tasks.lister({ space: s, state, limit });
  }

  function cancelTask(id) {
    const t = tasks.lire(id);
    if (!t) throw new Error(`tâche introuvable : ${id}`);
    if (t.state === 'queued') {
      const idx = enAttente.indexOf(id);
      if (idx !== -1) enAttente.splice(idx, 1);
      return tasks.patch(id, { state: 'cancelled', finishedAt: new Date().toISOString() });
    }
    if (t.state === 'running') {
      const h = handles.get(id);
      if (h && h.kill) {
        h.kill('SIGTERM');
        setTimeout(() => { if (handles.has(id) && h.kill) h.kill('SIGKILL'); }, 5000);
      }
      return tasks.patch(id, { cancelRequested: true });
    }
    return t; // état déjà terminal : no-op
  }

  return {
    refinePrompt, submitTask, getTask, listTasks, cancelTask,
    rateResult, listSpecialists, spaceAdd, spaceList, spaceDigest, passeMemoire,
    _enCours: enCours, _enAttente: enAttente,
  };
}

module.exports = {
  creerCoeur, construireResultMd, espace, assurerEspace, contexteNiveau1,
  NIVEAUX_IMPLEMENTES, VERDICTS, MODE_MEMOIRE,
};
