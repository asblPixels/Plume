# Développement de Plume

## Structure du dépôt

| Dossier | Rôle |
| --- | --- |
| `js/`, `css/`, `icons/`, `vendor/` | Application web et ressources |
| `desktop/` | Application Electron et installateur Windows |
| `mobile/` | Applications Android et iOS avec Capacitor |
| `flatpak/` | Manifeste du paquet Flatpak |
| `tests/` | Tests et scripts de recette |
| `outils/` | Outils de préparation et manifeste de version |

## Lancement local

À la racine du dépôt, lancer `python3 -m http.server 8765`, puis ouvrir
[localhost:8765](http://localhost:8765/). Pour l’application de bureau,
exécuter `npm ci` puis `npm start` dans `desktop/`.

## Vérification

Après une modification des fichiers servis, régénérer le manifeste avec
`node outils/version.js`, puis le vérifier avec `node outils/version.js --check`.
L’audit structurel du DOCX et la réouverture dans Word sont décrits dans le
[protocole d’interopérabilité](compatibilite-word.md).

## Distribution

Les éditions publiées et leurs sommes de contrôle sont sur
[GitHub Releases](https://github.com/asblPixels/Plume/releases).
L’application web est servie par GitHub Pages depuis la branche principale.
