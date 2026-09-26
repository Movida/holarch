# Image vers vidéo : premier photogramme, arc temporel, limites des services

Garantit : des clips générés qui jouent une action au lieu d'animer une attente, et des lots qui ne partent pas au
refus du service (longueur, modération) après avoir été payés en partie.
Vérifier : `python3 verificateurs/lot-plans.py --a-sec` (forme) puis `lot-plans.py <plans.json> <sortie>` sur le
vrai lot : longueurs de prompt sous la limite du service, négatif présent, devis affiché avant tout appel.

## Règle du premier photogramme
L'image clé fournie au modèle vidéo **est le premier photogramme du plan**, pas son résumé. Une image qui montre
déjà le résultat (le gâteau renversé, les verres levés) ne laisse rien à jouer : le clip devient une image qui
respire. Écrire l'image clé comme l'état *juste avant* l'action. Mesuré : sur une mission, plus d'un tiers de la
dépense générative a été régénérée pour cette seule raison — c'est la première règle à valider sur un échantillon.

## Arc temporel d'un plan
- Un plan = une action. Deux actions dans 5 s n'en produisent aucune de lisible.
- Entrer tard, sortir tôt : le plan commence juste avant l'action, s'arrête sur sa chute.
- Le prompt vidéo décrit l'arc : état initial (= l'image clé), le geste, la chute, l'état final.
- Une caméra nommée par plan, une seule (« travelling avant lent », « plan fixe ») : non dite, elle dérive.
- Raccord sur une pose stable, jamais au milieu d'un geste ; chaque coupe a un son (ambiance, transition).

## Identité et univers
- Identité constante : mêmes images de référence à chaque génération, même description de visage, même tenue par univers.
- Le style de l'univers s'applique aux personnages aussi, sinon les visages redeviennent photoréalistes.
- Interdits explicites dans le négatif : personnage en trop, visage qui change, texte à l'image, coupure, bascule de style.

## Limites des services (datées : 2026-09, à revérifier par la veille)
| Service | Limite | Conséquence |
|---|---|---|
| Kling (image → vidéo) | prompt ≤ 2 500 caractères | au-delà, refus de la requête |
| Kling | HTTP 422 | refus de **modération** (contenu), pas une erreur de forme : reformuler, ne pas rejouer tel quel |
| Tous | HTTP 429 | limitation de débit **ou** crédit épuisé : lire le corps de la réponse avant de conclure |
| Tous | taux de réussite d'un plan ≈ 1 sur 2 | deux variantes sur les plans clés, garder la meilleure ; les démonstrations publiées ne montrent pas leurs ratés |

Composer le prompt depuis `prompts/image-vers-video.md` ; l'image clé depuis `prompts/image-cle.md`.
