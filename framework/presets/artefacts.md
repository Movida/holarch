# Preset : artefacts

> Usage : mission qui produit des fichiers pour un tiers (média, documents, code livré, données). Socle `solo-light`, plus la spécialisation avant production (`regles-du-metier` : fichier de règles relu en jalon J0), la revue par jalons (`milestone-reviews`), un arbre de travail par instance (`git-branches`, `isolation = worktree`) et les travaux longs, lourds ou payants hors session (`jobs-et-lots` : `holarch-job`, jetons machine, lots devisés).
> En clair : quelqu'un d'autre va regarder, lire ou utiliser ce que la mission fabrique. Avant de produire, l'instance écrit les règles du métier et les fait relire ; à chaque étape, le travail est vérifié sur pièces ; un rendu ou un lot payant survit à la session qui l'a lancé et n'est jamais payé deux fois. Sans ligne `budget_services_usd`, tout lot payant est refusé : ajoute-la, avec le montant que tu acceptes de dépenser en services.

Pour démarrer une mission avec ce preset, copie le contenu du bloc ci-dessous (sans les balises de bloc) vers `framework/CONFIG.md`, en remplaçant `<nom de la mission>` par un intitulé court. Pour attacher un kit de domaine (`framework/kits/<domaine>/`), ajoute une ligne « Kits » à la section « Contexte hérité » de `mission/OBJECTIVE.md`.

```markdown
# Configuration — mission : <nom de la mission>
> Preset de base : artefacts · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | fork-join |
| 3 | memoire | unites-indexees |
| 4 | recursion | max-depth |
| 5 | recursion | self-assessment |
| 6 | recursion | instance-budget |
| 7 | recursion | context-budget |
| 8 | conflits | typed-escalation |
| 9 | registre | sharded-files |
| 10 | observabilite | heartbeat-log |
| 11 | extensions | delegation-intra-session |
| 12 | extensions | git-branches |
| 13 | extensions | milestone-reviews |
| 14 | extensions | regles-du-metier |
| 15 | extensions | jobs-et-lots |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 5 |
| profondeur_max | 2 |
| langue_de_travail | fr |
| commit_par_session | oui |
| permission_mode | acceptEdits |
| format_rapport_final | simple |
| budget_usd_par_session | 8 |
| max_tours_par_session | 200 |
| seuil_contexte_tokens | 240000 |
| autocompact_tokens | 400000 |
| mode_attente | detache |
| isolation | worktree |
| sessions_sans_unite_max | 3 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | opus | low |
| relecture | opus | medium |
| exploration | opus | xhigh |

## Fournisseurs
<!-- Catalogue (chantier 9, volet 2 — docs/IMPLEMENTATION.md §11.2). Ce commentaire est placé sous le titre,
et non avant lui, pour être élagué avec la section : le lanceur retire « Fournisseurs » et « Catalogue de
modèles » du CONFIG.md injecté dans le prompt système des instances (donnée du lanceur, pas du contrat).
Les deux tables sont FACULTATIVES : un CONFIG.md qui ne les porte pas reste valide (config-lint) et
exécutable, l'identifiant de modèle étant alors passé tel quel à l'exécuteur. « Secours » et « Équivalent »
restent vides tant qu'un seul fournisseur est configuré : le repli sur limite (429) n'a alors rien à viser
et le lanceur garde son comportement d'attente. Pour l'activer : mettre « openrouter » dans la colonne
Secours d'« anthropic » et déclarer les identifiants équivalents, soit une ligne de catalogue de la forme
(pipes omis ici : une ligne de table dans un commentaire serait lue comme une ligne de la table précédente)
  opus@openrouter · openrouter · anthropic/claude-opus-5.5 · — · 4 / 20 / 5 / 0,2 · conception · opus -->
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | — |
| openrouter | passerelle | HOLARCH_FOURNISSEUR_OPENROUTER_URL | HOLARCH_FOURNISSEUR_OPENROUTER_JETON | — |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie [/ cache écrit / cache lu] (USD par Mtok) | Aptitudes | Équivalent | Fenêtre (tokens) |
|---|---|---|---|---|---|---|---|
| opus | anthropic | claude-opus-5-5 | low…max | 4 / 20 / 5 / 0,2 | conception, execution, relecture, exploration | — | — |
| sonnet | anthropic | claude-sonnet-5 | low…high | 2 / 10 / 2,5 / 0,2 | execution | — | — |
| haiku | anthropic | claude-haiku-4-5-20251001 | — | 1 / 5 | — | — | — |
| fable | anthropic | claude-fable-5-1 | low…max | 10 / 50 / 12,50 / 0,25 | exploration | — | — |

## Valeurs organisationnelles
- Préfère une organisation plate : ne décompose que si le questionnaire `self-assessment` le justifie clairement.
- En cas de doute entre faire seul et spawner, faire seul.
- Rien n'est produit en série avant que le fichier de règles du métier (`REGLES-OR.md`, jalon J0) ait été relu, ni avant qu'un échantillon ait passé ses contrôles.
```
