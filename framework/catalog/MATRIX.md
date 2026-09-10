# Croisement métiers × compétences

> Compétences candidates par défaut pour chaque métier — pas un chargement systématique : `ON_PLAN`
> (module `role-composition`) retient seulement celles utiles à la mission réelle, dans la limite
> de `max_competences_role`.

| Métier | Compétences principales | Livrable caractéristique |
|---|---|---|
| Chef de projet | `cadrage-besoin`, `planification`, `synthese-redaction` | Plan de mission, dépendances, bilan |
| Product manager | `cadrage-besoin`, `priorisation-produit`, `recherche-utilisateur` | Proposition de valeur, roadmap priorisée |
| Business analyst | `cadrage-besoin`, `modelisation-donnees`, `synthese-redaction` | Spécifications et règles métier |
| Architecte logiciel | `architecture-logicielle`, `modelisation-donnees`, `securite-applicative` | Architecture, contrats, décisions motivées |
| Tech lead | `architecture-logicielle`, `revue-code`, `planification` | Plan technique et arbitrages d'intégration |
| Développeur back-end | `implementation-backend`, `conception-api`, `tests-automatises`, `modelisation-donnees`, `securite-applicative` | Implémentation testée |
| Développeur front-end | `implementation-frontend`, `accessibilite`, `tests-automatises` | Interface fonctionnelle et accessible |
| Ingénieur intégration | `integration-systemes`, `conception-api`, `diagnostic-debugging` | Connecteur ou automatisation validée |
| Ingénieur QA | `tests-automatises`, `revue-code`, `diagnostic-debugging` | Rapport de tests et anomalies reproductibles |
| Ingénieur DevOps | `git-cicd`, `observabilite`, `diagnostic-debugging` | Pipeline et procédure d'exploitation |
| Ingénieur cybersécurité | `securite-applicative`, `protection-donnees`, `revue-code` | Analyse de risques et correctifs proposés |
| Data analyst | `analyse-statistique`, `recherche-sourcee`, `synthese-redaction` | Analyse reproductible et limites explicites |
| Data engineer | `pipelines-donnees`, `modelisation-donnees`, `tests-automatises` | Pipeline avec contrôles de qualité |
| Ingénieur LLM | `conception-llm-rag`, `evaluation-llm`, `protection-donnees` | Assistant évalué sur un jeu de cas |
| Product designer | `conception-interface`, `accessibilite`, `recherche-utilisateur` | Parcours, maquettes ou spécifications UI |
| UX researcher | `recherche-utilisateur`, `recherche-sourcee`, `synthese-redaction` | Protocole, observations et recommandations |
| Rédacteur technique | `documentation-technique`, `synthese-redaction` | Documentation vérifiable |
| Content strategist | `strategie-contenu`, `recherche-sourcee`, `synthese-redaction` | Stratégie éditoriale et contenus sourcés |
| Support technique | `diagnostic-debugging`, `documentation-technique`, `cadrage-besoin` | Diagnostic et procédure de résolution |
| Concepteur pédagogique | `ingenierie-pedagogique`, `documentation-technique`, `synthese-redaction` | Parcours d'apprentissage et exercices |

Vingt métiers, vingt-huit compétences, dix recettes (`ROLES.md`) — le périmètre complet de la
proposition d'origine. Règles d'inclusion, d'exclusion et d'évolution : `SELECTION.md`.
