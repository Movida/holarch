# Preset : solo-light

> Usage : test, petite tâche. Cible les tests T1-T3 (spec §13). Décomposition minimale, garde-fous serrés.
> En clair : une petite tâche, traitée seule du début à la fin, sans faire appel à personne d'autre. Le choix par défaut en cas d'hésitation.

Pour démarrer une mission avec ce preset, copie le contenu du bloc ci-dessous (sans les balises de bloc) vers `framework/CONFIG.md`, en remplaçant `<nom de la mission>` par un intitulé court.

```markdown
# Configuration — mission : <nom de la mission>
> Preset de base : solo-light · Framework : v1.1

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

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | sonnet | medium |
| relecture | opus | medium |
| exploration | fable | xhigh |

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
  opus@openrouter · openrouter · anthropic/claude-opus-5 · — · 15 / 75 · conception · opus -->
| Nom | Exécuteur | URL (variable) | Jeton (variable) | Secours |
|---|---|---|---|---|
| anthropic | claude-code | — | — | — |
| openrouter | passerelle | HOLARCH_FOURNISSEUR_OPENROUTER_URL | HOLARCH_FOURNISSEUR_OPENROUTER_JETON | — |

## Catalogue de modèles
| Identifiant | Fournisseur | Modèle réel | Efforts | Coût entrée / sortie [/ cache écrit / cache lu] (USD par Mtok) | Aptitudes | Équivalent |
|---|---|---|---|---|---|---|
| opus | anthropic | claude-opus-5 | low…max | 15 / 75 | conception, relecture | — |
| sonnet | anthropic | claude-sonnet-5 | low…high | 3 / 15 | execution | — |
| haiku | anthropic | claude-haiku-4-5-20251001 | — | 1 / 5 | — | — |
| fable | anthropic | claude-fable-5-1 | low…max | 10 / 50 / 12,50 / 0,25 | exploration | — |

## Valeurs organisationnelles
- Préfère une organisation plate : ne décompose que si le questionnaire `self-assessment` le justifie clairement (spec §15, décision 1 : ce preset sert de socle au test T3).
- En cas de doute entre faire seul et spawner, faire seul.
```
