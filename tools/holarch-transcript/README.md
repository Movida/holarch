# holarch-transcript — lire ce qu'une session a réellement consommé

> Outil du diagnostic [`docs/diagnostics/2026-09-09-contexte-fixe-au-reveil.md`](../../docs/diagnostics/2026-09-09-contexte-fixe-au-reveil.md),
> promu dans `tools/` le 2026-09-09. Graine de l'étage à sec du banc de mesure (`docs/ROADMAP.md`, chantier 5).

## Ce que c'est

Claude Code écrit une transcription complète de chaque session dans
`~/.claude/projects/<slug>/<session-id>.jsonl`. Chaque message assistant y porte son `usage` : le
contexte réel du tour est `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`,
exactement ce que lit le hook `context-watch`. Ce script rend cette information lisible : une ligne
par tour, les appels d'outils, la taille de chaque résultat d'outil, et les compactions
automatiques (`compact_boundary`), sans rien estimer.

Node pur, aucune dépendance, aucun réseau, lecture seule.

## Utilisation

```bash
# Un ou plusieurs identifiants pris dans mission/registry/SESSIONS.md (colonne Session)
node tools/holarch-transcript/analyse.js 337d610d-3e6e-43e1-9bb4-4e738537c70d

# Un fichier .jsonl directement, ou un autre projet Claude Code
node tools/holarch-transcript/analyse.js /chemin/vers/session.jsonl
node tools/holarch-transcript/analyse.js <id> --projet -workspaces-autre-depot

# Sortie structurée
node tools/holarch-transcript/analyse.js <id> --json
```

Le slug du projet est dérivé du répertoire courant (`/workspaces/holon` → `-workspaces-holon`) :
lancer depuis la racine du dépôt.

## Lire la sortie

```
tour  1  contexte= 126432  (entrée 2 / cache lu 39373 / cache écrit 87057 / sortie 3543)
      ← résultat     161 c  Write(/…/ckpt.txt)  « The file … has been updated »
tour  4  contexte= 130088  (…)
      ⟲ compaction auto : 148416 → 12459 tokens
pic de contexte : 130088 tokens · 15 tour(s) · 1 compaction(s)
```

- Le contexte du **tour 1** est le prompt fixe (système + utilisateur) : s'il dépasse
  `seuil_contexte_tokens`, la session hibernera à son premier appel d'outil quoi qu'elle fasse.
- `cache lu` au tour 1 = prompt système déjà en cache (identique pour toutes les instances de la
  mission) ; `cache écrit` = prompt utilisateur de cette session.
- Une **compaction** signale que Claude Code a résumé le contexte de lui-même, hors du contrat
  (aucun passage par `MEMORY.md`) : à surveiller si elle survient sous le seuil configuré.

## Limites assumées

- Lit seulement ce que Claude Code a écrit : une session tuée avant sa fin a une transcription
  partielle, une session lancée avec un autre `~/.claude` n'en a pas ici.
- Le nombre de caractères d'un résultat d'outil n'est pas un nombre de tokens ; pour ce corpus
  (français, markdown dense) le ratio observé est d'environ 2,1 caractères par token.
- Ne modifie rien : pour agir sur le prompt de réveil, voir `docs/IMPLEMENTATION.md` §1 et §2.

## Tests

`node --test tools/holarch-transcript/test-analyse.js` (transcription synthétique), branché sur `npm test`.
