# Bloc de prompt : image vers vidéo (un plan, une action)

Garantit : un prompt vidéo qui décrit un arc temporel unique à partir de l'image clé, sous la limite de longueur du
service et avec une caméra nommée — les deux causes de rejet ou de clip inutilisable les plus fréquentes.
Vérifier : `python3 verificateurs/lot-plans.py <plans.json> <sortie>` — longueur sous la limite du service et
négatif présent, pour chaque plan, avant tout appel.

## Contraintes du service (en tête, à revérifier par la veille)
- Kling : prompt ≤ 2 500 caractères ; HTTP 422 = refus de modération (reformuler, ne pas rejouer) ; durée 5 ou 10 s.
- L'image fournie est le **premier photogramme** : le prompt ne la redécrit pas, il dit ce qui se passe ensuite.
- Taux de réussite ≈ 1 sur 2 : prévoir deux variantes pour les plans clés dans le devis.

## Composition (une ligne par champ, dans cet ordre)
```
ACTION : <une seule action, sujet + verbe + objet — « elle souffle les bougies »>
ARC : début = l'image clé ; <le geste> ; chute = <l'instant final lisible, pose stable pour le raccord>
CAMÉRA : <un seul mouvement nommé — plan fixe, travelling avant lent, panoramique gauche>
RYTHME : entrer tard, sortir tôt — aucun temps mort avant le geste ni après la chute
UNIVERS : <même ligne que l'image clé>
NÉGATIF : personnage supplémentaire, visage qui change, texte à l'image, coupure ou changement de plan,
          bascule de style, <interdits propres au plan>
```

## Relecture avant d'envoyer
- Une seule action ? Deux verbes d'action dans ACTION = deux plans.
- Longueur totale (prompt + négatif selon le service) sous la limite ? `lot-plans.py` le dit.
