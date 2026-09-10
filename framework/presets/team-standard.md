# Preset : team-standard

> Usage : projet moyen. Décomposition assumée sur plusieurs niveaux, coordination par dépendances, mémoire allégée mais journal complet, archivage tracé.
> En clair : un projet de taille moyenne, réparti entre plusieurs personnes qui se coordonnent selon l'ordre des tâches, avec un historique complet de qui a fait quoi.

Pour démarrer une mission avec ce preset, copie le contenu du bloc ci-dessous (sans les balises de bloc) vers `framework/CONFIG.md`, en remplaçant `<nom de la mission>` par un intitulé court.

```markdown
# Configuration — mission : <nom de la mission>
> Preset de base : team-standard · Framework : v1.1

## Modules actifs
| # | Catégorie | Module |
|---|---|---|
| 1 | orchestration | direct-spawn |
| 2 | synchronisation | dependency-graph |
| 3 | memoire | journal-synthesis |
| 4 | recursion | self-assessment |
| 5 | recursion | instance-budget |
| 6 | recursion | max-depth |
| 7 | recursion | context-budget |
| 8 | conflits | typed-escalation |
| 9 | conflits | graveyard-handover |
| 10 | registre | sharded-files |
| 11 | observabilite | heartbeat-log |

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 15 |
| profondeur_max | 3 |
| langue_de_travail | fr |
| commit_par_session | oui |
| permission_mode | acceptEdits |
| format_rapport_final | executive-summary |
| budget_usd_par_session | 8 |
| max_tours_par_session | 300 |
| seuil_contexte_tokens | 120000 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | sonnet | medium |
| relecture | opus | medium |
| exploration | fable | xhigh |

## Valeurs organisationnelles
- La qualité d'un livrable d'enfant prime sur la vitesse : ne jamais accepter un livrable non conforme pour "avancer".
- Toute décomposition doit rester justifiable par le questionnaire `self-assessment`, même dans une organisation à plusieurs niveaux.
```
