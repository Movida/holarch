#!/usr/bin/env node
'use strict';
/**
 * cli.js — la CLI `holarch` (§10) : même client HTTP que la porte MCP (`client.js`), permet de
 * tout tester sans Claude Desktop. Étape 2 : `refine`, `ask`, `status`, `cancel`, `stop`,
 * `specialists`, `rate`, et `space add|list|digest`. `answer`/`usage` dépendent des niveaux 2-3 et
 * des quotas (étapes ultérieures) — refusés explicitement plutôt qu'absents en silence.
 *
 * `space` n'existe **que** ici, jamais en MCP (§9) : déclarer les racines qu'un LLM peut lire est
 * un acte de l'utilisateur, pas d'une conversation.
 */

const client = require('./client');

function usage() {
  return [
    'Usage : node tools/holarch-d/cli.js <commande> [args]',
    '',
    'Commandes (Étape 2) :',
    '  refine "<prompt>" [--space <nom>]',
    '  ask "<prompt>" --profile <conception|execution|relecture> [--level 1] [--space <nom>]',
    '                 [--specialist <nom>] [--model <m>] [--effort <e>] [--instructions "<texte>"]',
    '                 [--max-budget-usd <n>] [--max-turns <n>] [--timeout-s <n>]',
    '  status [<task_id>] [--space <nom>] [--state <etat>] [--limit <n>]   (sans id : liste)',
    '  cancel <task_id>',
    '  specialists [--space <nom>]',
    '  rate <task_id> <good|mixed|bad> [--note "<texte>"] [--decision "<texte>"]... [--supersedes <id>]',
    '  space add <nom> --root <chemin> [--root <chemin>]... [--repo <chemin>]',
    '                  [--description "<texte>"] [--force]',
    '  space list',
    '  space digest <nom> [--force]',
    '  stop',
    '',
    'Les espaces se déclarent ici et nulle part ailleurs : jamais en MCP (SPEC §9).',
    'Pas encore implémenté à cette étape : answer, usage (niveaux 2/3, quotas).',
  ].join('\n');
}

function parseFlags(argv) {
  const positionnels = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const cle = a.slice(2);
      const suivant = argv[i + 1];
      const valeur = (suivant !== undefined && !suivant.startsWith('--')) ? (i++, suivant) : true;
      // Un drapeau répété (`--root a --root b`) s'accumule au lieu d'écraser : `space add` en a
      // besoin (plusieurs racines), et l'écrasement silencieux ferait perdre une racine déclarée.
      if (cle in options) {
        options[cle] = Array.isArray(options[cle]) ? options[cle].concat(valeur) : [options[cle], valeur];
      } else {
        options[cle] = valeur;
      }
    } else {
      positionnels.push(a);
    }
  }
  return { positionnels, options };
}

/** Normalise une option qui peut être absente, unique ou répétée, en liste de chaînes. */
function liste(valeur) {
  if (valeur === undefined || valeur === true) return [];
  return (Array.isArray(valeur) ? valeur : [valeur]).filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim());
}

/**
 * Assemble la charge utile `submit_task` à partir des drapeaux de `ask`. Fonction pure, extraite
 * de `executer` pour être testable : la version en ligne oubliait silencieusement `--space` et
 * `--specialist` (pourtant documentés dans `usage()`), et aucun test ne pouvait l'attraper —
 * `test-cli.js` ne couvrait que `parseFlags`, et les tests du démon partent de la charge utile
 * déjà assemblée. Le trou était exactement entre les deux.
 */
function chargeAsk(positionnels, options) {
  if (!options.profile) throw new Error('--profile est obligatoire (conception|execution|relecture)');
  return {
    prompt: positionnels[0],
    level: options.level ? Number(options.level) : 1,
    space: options.space,
    // Le démon attend `specialists` (tableau, contrat MCP) ; la CLI expose `--specialist` au
    // singulier parce qu'un panel n'existe qu'au niveau 2, hors périmètre de l'Étape 2.
    specialists: liste(options.specialist),
    profile: options.profile,
    model: options.model,
    effort: options.effort,
    instructions: options.instructions,
    max_budget_usd: options['max-budget-usd'] ? Number(options['max-budget-usd']) : undefined,
    max_turns: options['max-turns'] ? Number(options['max-turns']) : undefined,
    timeout_s: options['timeout-s'] ? Number(options['timeout-s']) : undefined,
  };
}

function afficher(obj) {
  process.stdout.write(`${typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2)}\n`);
}

async function executer(commande, positionnels, options) {
  switch (commande) {
    case 'refine':
      return client.refinePrompt({ prompt: positionnels[0], space: options.space });
    case 'ask': {
      const r = await client.submitTask(chargeAsk(positionnels, options));
      return r;
    }
    case 'status':
      return positionnels[0]
        ? client.getTask(positionnels[0])
        : client.listTasks({ space: options.space, state: options.state, limit: options.limit });
    case 'cancel':
      if (!positionnels[0]) throw new Error('cancel <task_id>');
      return client.cancelTask(positionnels[0]);
    case 'specialists':
      return client.listSpecialists({ space: options.space });
    case 'rate': {
      const [taskId, verdict] = positionnels;
      if (!taskId || !verdict) throw new Error('rate <task_id> <good|mixed|bad> [--note "..."] [--decision "..."]');
      return client.rateResult({
        task_id: taskId,
        verdict,
        note: typeof options.note === 'string' ? options.note : undefined,
        decisions: liste(options.decision),
        supersedes: typeof options.supersedes === 'string' ? options.supersedes : undefined,
      });
    }
    case 'space': {
      const [sous, nom] = positionnels;
      if (sous === 'list') return client.spaceList();
      if (sous === 'add') {
        if (!nom) throw new Error('space add <nom> --root <chemin> [--root <chemin>]...');
        const racines = liste(options.root);
        if (!racines.length) {
          throw new Error("space add exige au moins un --root : un espace sans racine n'accorde aucun accès en lecture");
        }
        return client.spaceAdd({
          name: nom,
          roots: racines,
          repo: typeof options.repo === 'string' ? options.repo : undefined,
          description: typeof options.description === 'string' ? options.description : undefined,
          force: !!options.force,
        });
      }
      if (sous === 'digest') {
        if (!nom) throw new Error('space digest <nom> [--force]');
        return client.spaceDigest({ name: nom, force: !!options.force });
      }
      throw new Error(`sous-commande inconnue : space ${sous || '(aucune)'} (attendu : add | list | digest)`);
    }
    case 'stop':
      return client.stop();
    case 'answer':
    case 'usage':
      throw new Error(`« ${commande} » pas encore implémenté à cette étape (voir tools/holarch-d/README.md « Prochaines étapes »)`);
    default:
      throw new Error(`commande inconnue : ${commande}\n\n${usage()}`);
  }
}

async function main() {
  const [commande, ...reste] = process.argv.slice(2);
  if (!commande || commande === '-h' || commande === '--help') {
    process.stdout.write(`${usage()}\n`);
    process.exit(commande ? 0 : 1);
  }
  const { positionnels, options } = parseFlags(reste);
  try {
    const resultat = await executer(commande, positionnels, options);
    afficher(resultat);
    if (commande === 'ask' && resultat && resultat.task_id) {
      process.stdout.write(`\nSuivre : node tools/holarch-d/cli.js status ${resultat.task_id}\n`);
    }
  } catch (e) {
    process.stderr.write(`holarch ▸ ${e.message}\n`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { parseFlags, usage, executer, chargeAsk };
