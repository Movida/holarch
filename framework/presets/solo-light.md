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

## Paramètres
| Paramètre | Valeur |
|---|---|
| budget_instances_total | 5 |
| profondeur_max | 2 |
| langue_de_travail | fr |
| commit_par_session | oui |
| permission_mode | acceptEdits |
| format_rapport_final | simple |
| budget_usd_par_session | 5 |
| max_tours_par_session | 200 |
| seuil_contexte_tokens | 120000 |

## Politique de modèle
| Profil | Modèle | Effort |
|---|---|---|
| conception | opus | high |
| execution | sonnet | medium |
| relecture | opus | medium |
| exploration | fable | xhigh |

## Valeurs organisationnelles
- Préfère une organisation plate : ne décompose que si le questionnaire `self-assessment` le justifie clairement (spec §15, décision 1 : ce preset sert de socle au test T3).
- En cas de doute entre faire seul et spawner, faire seul.
```
