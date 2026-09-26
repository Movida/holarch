# Photos sources : pré-traitement d'un album avant montage

Garantit : aucune photo n'entre au montage sans orientation appliquée, sans date fiable ou signalée comme
incertaine, et sans verdict sur sa définition et ses bandes.
Vérifier : `python3 verificateurs/photos-sources.py --a-sec`, puis `photos-sources.py <album/>` en réel : une ligne
par photo avec ses défauts et la recommandation.

## Normalisation (une fois, avant toute sélection)
- Formats hétérogènes (HEIC de téléphone, PNG de capture, JPEG) → JPEG unique, **orientation EXIF appliquée** aux
  pixels (sinon un portrait s'affiche couché dans certains lecteurs et pas dans d'autres).
- Numérotation chronologique (`p001…`) et inventaire (date, **source de la date** : EXIF, nom de fichier ou date du
  fichier — cette dernière est souvent celle de la copie, pas de la prise de vue), dimensions, orientation.
- Planches-contacts (12 vignettes par planche) pour la sélection : on choisit sur planche, pas photo par photo.
- Copie réduite (800 px) pour les appels génératifs de référence : moins cher, et suffisant pour une identité.

## Défauts à traiter
| Défaut | Seuil indicatif | Traitement |
|---|---|---|
| Basse définition | côté long < 1 100 px pour un plein écran 1080p | petit format (diptyque, vignette) ou super-résolution **non générative** (réseau de super-résolution classique, CPU) — jamais un modèle génératif, qui réinvente les visages |
| Bandes | bordure uniforme sombre ou claire > 2 % du côté (scan, capture d'écran, photo de photo) | recadrer avant toute mise à l'échelle |
| Doublons, rafales | même minute, cadrage voisin | garder une image, sauf rafale voulue |
| Flou de bougé | relecture sur planche | écarter ; aucun traitement ne le rattrape en grand |

## Pièges
- La super-résolution locale coûte 30 s à 2 min par photo sur CPU : c'est un rendu lourd
  (`references/charge-machine.md`).
- Une photo agrandie reste une photo agrandie : la relire à la taille d'affichage finale, sur planche.
