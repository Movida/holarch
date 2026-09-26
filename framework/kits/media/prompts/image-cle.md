# Bloc de prompt : image clé (premier photogramme)

Garantit : une image clé qui est l'état juste avant l'action, avec une identité et un univers constants d'un plan à
l'autre — elle sert telle quelle de premier photogramme au modèle vidéo.
Vérifier : relecture sur planche des images clés d'un échantillon avant le lot (aucune ne montre déjà le résultat
de l'action) ; `python3 verificateurs/lot-plans.py <plans.json> <sortie>` pour le devis du lot.

## Contraintes du service (en tête, à revérifier par la veille)
- Modèle image vers image ou texte vers image ; images de référence en entrée (portraits : copies réduites 800 px).
- Ratio demandé explicitement (16:9 pour un montage 1920×1080) ; le modèle ne le déduit pas des références.
- Le texte à l'image est mal rendu : jamais de texte demandé, et « aucun texte » dans les interdits.

## Composition (remplir chaque champ, dans cet ordre)
```
UNIVERS : <style visuel de l'univers, appliqué au décor ET aux personnages — matière, lumière, palette>
PERSONNAGES : <pour chaque personnage : « même personne que la référence n », description de visage fixe,
              tenue de cet univers — texte identique d'un plan à l'autre>
ÉTAT INITIAL : <ce qu'on voit JUSTE AVANT l'action : positions, regards, objets — pas le résultat>
CADRAGE : <valeur de plan (large, moyen, rapproché), angle>
INTERDITS : personnage supplémentaire, visage différent des références, texte ou lettrage, style photoréaliste
            sur les personnages si l'univers ne l'est pas, <interdits propres au plan>
```

## Relecture avant d'envoyer
- L'état initial laisse-t-il quelque chose à jouer ? Si l'image raconte déjà la chute, réécrire.
- La ligne PERSONNAGES est-elle mot pour mot celle des autres plans du même univers ?
