# Lots payants : devis avant lot, reprise par empreinte

Garantit : aucun appel payant lancé sans devis affiché et comparé au budget ; un lot interrompu se reprend sans
repayer ce qui est fait ni sauter ce qui a changé.
Vérifier : `python3 verificateurs/lot-plans.py --a-sec`, puis `lot-plans.py <plans.json> <sortie> --budget <usd>`
avant chaque lot réel (code 1 si le devis dépasse le budget).
Sous HOLARCH (module `jobs-et-lots`) : `node framework/bin/holarch-job.js lot <fichier> --devis` puis `lot <fichier>`
(`framework/templates/LOT.template.json`) portent devis contre `budget_services_usd`, verrou de lot, reprise par
empreinte et registre `COUTS-SERVICES.md` ; `lot-plans.py` reste l'outil hors HOLARCH.

## Avant le lot
1. **Échantillon d'abord** : un ou deux plans, relus sur pièces (planche, pas description), validés par qui décide
   (porte déclarée, `regles-du-metier`). Multiplier un plan non validé multiplie l'erreur et la facture.
2. **Devis** : nombre de plans à faire × tarif du service, affiché et consigné avant le premier appel. Les tarifs
   changent : la ligne de tarif porte sa date et sa source.
3. **Limites du service** vérifiées hors ligne (longueur de prompt, formats d'image) : un refus au 30ᵉ appel d'un
   lot de 40 coûte les 29 premiers si le lot n'est pas reprenable.

## Pendant le lot
- **Reprise par empreinte, pas par présence** : un plan est fait si l'empreinte de ses entrées (image, prompt,
  négatif, durée, service, modèle) est celle enregistrée à sa validation **et** que sa sortie existe. « Fichier
  présent = fait » saute un plan dont le prompt a changé ; la date de modification (`touch -d`) est un bricolage.
- **Publication atomique** : écrire la sortie sous un nom temporaire, la valider (taille, durée, lisibilité), puis
  renommer ; enregistrer l'empreinte ensuite (`lot-plans.py --marquer <id>`). Jamais un fichier à moitié écrit
  sous son nom final.
- **Un seul acteur par lot** : deux sessions qui lisent l'état puis lancent ensemble paient deux fois. Un verrou de
  lot (fichier créé en exclusif) ou un propriétaire unique déclaré ; lire l'INBOX ne suffit pas.
- **Coûts au fil de l'eau** : chaque réponse de service qui porte un coût est ajoutée à un registre append-only du
  lot ; le total se lit, il ne se reconstitue pas de mémoire.
- **Parallélisme** : les appels réseau n'occupent pas la machine (6 à 8 requêtes simultanées sont sûres) ; les
  rendus locaux, si (`references/charge-machine.md`).

## Codes d'erreur
- 422 (Kling) : modération — reformuler le plan, ne pas le rejouer tel quel.
- 429 : débit ou crédit — lire le corps de la réponse ; attendre ne sert à rien si le crédit est épuisé.
- Délai dépassé : juger sur l'absence de progression (rien de nouveau depuis N minutes), pas sur une durée totale.

## Clés
Une clé de service se lit dans l'environnement ou un fichier de secrets hors dépôt (`chmod 600`), jamais sur une
ligne de commande (visible dans la liste des processus) ni dans un fichier suivi par Git.
