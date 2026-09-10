#!/usr/bin/env node
'use strict';
/**
 * mcp-door.js — la porte MCP (`holarch-mcp`) : serveur MCP stdio lancé par Claude Desktop, client
 * mince du démon `holarch-d`, **sans état lui-même** (§2, §3 de la spec). Utilise le SDK officiel
 * (`@modelcontextprotocol/sdk`, D1) plutôt qu'un transport fait main — seule dépendance externe
 * du dépôt, cantonnée à `tools/holarch-d/`.
 *
 * N'exécute jamais `claude -p` directement : toute la logique (résolution de modèle, garde-fous,
 * exécution) vit dans le démon, appelé ici en HTTP via `client.js` (qui démarre le démon s'il ne
 * tourne pas déjà, D3). **Sept outils à l'Étape 2**, tous de niveau 1 : les cinq de l'Étape 1
 * (`refine_prompt`, `submit_task`, `get_task`, `list_tasks`, `cancel_task`) plus
 * `list_specialists` et `rate_result`, qui dépendaient du catalogue et des espaces. `get_usage`
 * reste non implémenté (§14, Étape 3).
 *
 * **Aucun outil ne touche aux espaces**, et c'est structurel : `space add/list/digest` n'existent
 * qu'en CLI (§9 — accorder un droit de lecture est un acte de l'utilisateur, pas d'une
 * conversation). `test-mcp-door.js` le vérifie nommément sur la liste enregistrée ici.
 */

const { z } = require('zod');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const client = require('./client');

function texte(obj) {
  return { content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] };
}

function enErreur(e) {
  return { isError: true, content: [{ type: 'text', text: e && e.message ? e.message : String(e) }] };
}

function outil(nom, config, gestionnaire) {
  server.registerTool(nom, config, async (args) => {
    try {
      return texte(await gestionnaire(args || {}));
    } catch (e) {
      return enErreur(e);
    }
  });
}

const server = new McpServer(
  { name: 'holarch-mcp', version: '0.2.0-etape2' },
  {
    instructions:
      'Porte MCP de holarch-d (Étape 2) : `refine_prompt` (routage + devis, gratuit et synchrone) '
      + 'propose un niveau, mais ne lance rien — `submit_task` (niveau 1 uniquement à cette étape) '
      + "démarre réellement un avis de spécialiste, asynchrone : interroger `get_task` pour suivre "
      + "sa progression et récupérer le résultat. `list_specialists` dit à qui s'adresser ; "
      + "`rate_result` enregistre le verdict de l'utilisateur, qui contraindra les avis suivants "
      + "dans le même espace. Aucun niveau 2 (panel) ni 3 (mission) construit pour le moment — "
      + '`submit_task` les refuse explicitement. '
      + "Les **espaces** ne sont pas exposés ici, et ce n'est pas un oubli : les déclarer accorde "
      + "un droit de lecture sur des fichiers, ce qui est un acte de l'utilisateur en CLI "
      + '(`holarch space add`), jamais d\'une conversation.',
  },
);

outil(
  'refine_prompt',
  {
    title: 'Raffiner une demande',
    description:
      "Analyse une demande en langage naturel : reformule un prompt plus précis, suggère le niveau "
      + "d'appareil HOLARCH adapté (1 = spécialiste ; 2 = panel, pas encore implémenté ; 3 = mission, "
      + 'pas encore implémenté), un profil, et calcule un devis (coût/durée estimés). Ne lance rien : '
      + 'le niveau suggéré est une proposition, jamais appliqué automatiquement — passer par '
      + '`submit_task` pour agir. Synchrone, quelques centimes, ~15 s max.',
    inputSchema: { prompt: z.string(), space: z.string().optional() },
  },
  (args) => client.refinePrompt(args),
);

outil(
  'submit_task',
  {
    title: 'Soumettre une tâche',
    description:
      "Démarre une tâche asynchrone. **Seul le niveau 1 (spécialiste) est implémenté à cette "
      + "étape** — niveaux 2/3 refusés explicitement. `profile` est obligatoire "
      + "(conception|execution|relecture) : pas encore de routage automatique appliqué "
      + "directement ici (utiliser `refine_prompt` d'abord pour obtenir une suggestion). Retourne "
      + 'immédiatement un `task_id` et un devis — interroger `get_task` pour le résultat.',
    inputSchema: {
      prompt: z.string(),
      level: z.number(),
      profile: z.string(),
      space: z.string().optional(),
      specialists: z.array(z.string()).optional(),
      model: z.string().optional(),
      effort: z.string().optional(),
      instructions: z.string().optional(),
      review: z.boolean().optional(),
      max_budget_usd: z.number().optional(),
      max_turns: z.number().optional(),
      timeout_s: z.number().optional(),
      parent_task: z.string().optional(),
    },
  },
  (args) => client.submitTask(args),
);

outil(
  'get_task',
  {
    title: "État d'une tâche",
    description:
      "État courant d'une tâche (queued/running/done/failed/cancelled), coût courant, brouillon "
      + 'partiel pendant l\'exécution, et `result_md` (le livrable structuré) une fois `done`.',
    inputSchema: { task_id: z.string() },
  },
  ({ task_id: taskId }) => client.getTask(taskId),
);

outil(
  'list_tasks',
  {
    title: 'Lister les tâches',
    description: 'Liste les tâches connues, filtrables par espace, état, et nombre maximal.',
    inputSchema: { space: z.string().optional(), state: z.string().optional(), limit: z.number().optional() },
  },
  (args) => client.listTasks(args),
);

outil(
  'cancel_task',
  {
    title: 'Annuler une tâche',
    description: "Annule une tâche en file d'attente ou en cours (SIGTERM puis SIGKILL après 5 s).",
    inputSchema: { task_id: z.string() },
  },
  ({ task_id: taskId }) => client.cancelTask(taskId),
);

outil(
  'list_specialists',
  {
    title: 'Lister les spécialistes',
    description:
      'Catalogue des spécialistes disponibles : pour chacun, quand le solliciter, sa spécialité, '
      + "son profil par défaut, s'il a accès aux fichiers de l'espace, ses affinités de panel, et "
      + "le nombre de tâches qu'il a déjà traitées dans cet espace (un spécialiste qui connaît "
      + "déjà le terrain répond mieux et moins cher). À consulter avant `submit_task` pour "
      + 'renseigner `specialists` — un nom inconnu retombe silencieusement sur `generaliste`. '
      + 'Gratuit et instantané : aucun appel de modèle.',
    inputSchema: { space: z.string().optional() },
  },
  (args) => client.listSpecialists(args),
);

outil(
  'rate_result',
  {
    title: "Noter le résultat d'une tâche",
    description:
      "Enregistre le verdict de l'utilisateur sur une tâche terminée dans le journal de décisions "
      + "de l'espace (`DECISIONS.md`), qui sera injecté dans les tâches suivantes du même espace : "
      + "c'est ainsi qu'un avis rendu devient une contrainte pour les avis futurs. "
      + '`verdict` vaut good | mixed | bad. `decisions` liste les décisions actées à retenir '
      + "(une phrase chacune, à l'impératif ou au passé : « on garde X », « on abandonne Y »). "
      + "N'appeler qu'avec un jugement réellement exprimé par l'utilisateur — ne jamais noter à sa "
      + 'place. Le journal est append-only : une décision se corrige en en ajoutant une qui la '
      + 'remplace (`supersedes`), jamais en effaçant.',
    inputSchema: {
      task_id: z.string(),
      verdict: z.enum(['good', 'mixed', 'bad']),
      note: z.string().optional(),
      decisions: z.array(z.string()).optional(),
      supersedes: z.string().optional(),
    },
  },
  (args) => client.rateResult(args),
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`holarch-mcp ▸ ${e.stack || e.message}\n`);
    process.exit(1);
  });
}

module.exports = { server };
