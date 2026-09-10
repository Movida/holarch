<!--
Gabarit JOURNAL.md — append-only (KERNEL §5.3.6, §6.3). Une entrée horodatée par session au minimum,
ajoutée à la phase ON_ORIENT (plan de session) et complétée au fil de la session. Jamais modifié
rétroactivement : pour corriger une erreur passée, ajouter une nouvelle entrée qui la signale, ne pas
éditer l'ancienne. C'est la base de l'auditabilité (O4) — un humain doit pouvoir reconstituer toute
décision en lisant ce fichier + l'historique Git.
-->
# Journal — <chemin instance>

<!-- Ajouter une nouvelle entrée en fin de fichier à chaque session, jamais en tête ni en modification. -->

## <ISO 8601> — Session n° <n>
**Plan de session** : <ce que je compte faire dans cette session>

**Événements notables** : <décisions, obstacles, résultats>

**Justifications** : <pourquoi ces choix, notamment tout écart par rapport au plan initial>
