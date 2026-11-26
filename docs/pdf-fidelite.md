# PDF dans Plume — fidélité et limites de l'édition

## Ouverture sans dégradation

Un PDF est lu comme un véritable PDF par PDF.js ; le moteur de traitement
de texte n'en reconstruit pas les paragraphes. Les pages, polices, positions,
dessins et images sont affichés à partir des instructions du PDF d'origine.

Un document **non modifié** est réenregistré avec ses octets exacts : aucune
conversion, repagination ni reconstruction n'est effectuée.

## Édition

- **Lire et sélectionner** : rendu des pages d'origine et couche de sélection
  des fragments de texte, lorsque le texte est extractible.
- **Annoter et surligner** : ajout dans le PDF avec pdf-lib ; les pages
  non touchées ne sont pas rasterisées.
- **Modifier ou supprimer du texte** : le fragment choisi est remplacé
  visuellement. Une zone rectangulaire peut aussi être effacée à la souris, y compris sur un PDF scanné sans texte extractible. Pour ne pas laisser du texte accessible sous une zone blanche,
  **la page modifiée est convertie en image** lors de l'export. Les pages
  non concernées restent des pages PDF natives.

La page reconstruite reçoit une couche de sélection et de recherche pour les
fragments extractibles hors des zones effacées et le texte ajouté, lorsque
l’encodage de la police PDF le permet. Les fragments qui chevauchent une zone
effacée sont exclus de cette couche. Le rendu de la page reste une image.
Le texte ajouté peut différer de l’original par sa police et son espacement,
et n’entraîne aucun déplacement du texte voisin.

Les PDF signés numériquement perdent leur validité de signature après une
édition ; des formulaires, signets ou métadonnées complexes peuvent aussi
ne pas être intégralement conservés après la reconstruction d'une page.

Ne pas considérer la suppression de texte comme une procédure de caviardage
confidentiel certifiée : inspecter le résultat avant partage, et ne pas
utiliser cette fonction seule pour masquer des données très sensibles.

## Fiabilité et confidentialité

La source reste en mémoire et n'est pas envoyée vers un serveur. Aucun
enregistrement automatique de la version PDF n'est effectué. Les actions
« Nouveau » et « Ouvrir » signalent les modifications non enregistrées.
La sauvegarde sans modification restitue l'original.

Le moteur pdf-lib 1.17.1 est embarqué hors ligne, avec sa licence MIT, et
PDF.js conserve sa licence Apache 2.0.

## Vérifications de non-régression

```sh
node --check js/pdf-editor.js
node tests/pdf_editor.test.cjs
node tests/pdf_native_real.test.cjs
node outils/version.js --check
```
