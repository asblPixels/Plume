<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="icons/plume-wordmark-light.svg">
  <img src="icons/plume-wordmark-dark.svg" alt="Plume" width="320">
</picture>

**Le traitement de texte de Pixel's ASBL : libre d'usage, hors ligne et compatible Word (.docx)**

![Version](https://img.shields.io/badge/version-1.0.0-26EFC5?style=flat-square&labelColor=0D1013)
![Plateformes](https://img.shields.io/badge/plateformes-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Android%20%7C%20iOS-26EFC5?style=flat-square&labelColor=0D1013)
![Format](https://img.shields.io/badge/format-.docx%20(OOXML)-26EFC5?style=flat-square&labelColor=0D1013)
![Hors ligne](https://img.shields.io/badge/hors%20ligne-oui-26EFC5?style=flat-square&labelColor=0D1013)
![Dépendances](https://img.shields.io/badge/d%C3%A9pendances-1%20(JSZip)-26EFC5?style=flat-square&labelColor=0D1013)

<img src="docs/captures/plume-accueil.png" alt="Plume — fenêtre principale" width="900">

</div>

---

## Sommaire

1. [Présentation](#présentation)
2. [Captures d'écran](#captures-décran)
3. [Fonctionnalités](#fonctionnalités)
4. [Compatibilité .docx](#compatibilité-docx)
5. [Installation et lancement](#installation-et-lancement)
6. [Installer Plume comme une application](#installer-plume-comme-une-application)
7. [Déploiement en production](#déploiement-en-production)
8. [Navigateurs pris en charge](#navigateurs-pris-en-charge)
9. [Raccourcis clavier](#raccourcis-clavier)
10. [Architecture technique](#architecture-technique)
11. [Guide du développeur](#guide-du-développeur)
12. [Tests et assurance qualité](#tests-et-assurance-qualité)
13. [Sécurité, vie privée et RGPD](#sécurité-vie-privée-et-rgpd)
14. [Feuille de route](#feuille-de-route)
15. [Historique des versions](#historique-des-versions)
16. [Licence et crédits](#licence-et-crédits)
17. [Contact](#contact)

---

## Présentation

Plume est un traitement de texte complet qui s'exécute entièrement dans le navigateur. Il a été conçu par **Pixel's ASBL** (Boussu, Belgique) pour trois usages :

- offrir à nos bénéficiaires un outil **gratuit**, **sans compte** et **sans abonnement** ;
- permettre d'**ouvrir et de renvoyer des documents Word** reçus de l'administration, d'un employeur ou d'une école ;
- servir de **support de formation** : l'organisation de l'interface est celle des traitements de texte du marché, ce qui facilite le passage de l'un à l'autre.

| Principe | Mise en œuvre |
|---|---|
| **Familiarité** | Menu Fichier, ruban à onglets, galerie de styles, règle, barre d'état et raccourcis standards : un habitué s'y retrouve immédiatement. |
| **Compatibilité** | Lecture et écriture natives du format Office Open XML (`.docx`), sans conversion par un service tiers. |
| **Autonomie** | Aucun serveur applicatif, aucune base de données. Fonctionne hors ligne après la première visite. |
| **Confidentialité** | Les documents ne quittent jamais l'appareil. |
| **Accessibilité matérielle** | Tourne sur de vieux PC comme sur les téléphones, sous tous les systèmes d'exploitation. |
| **Sobriété** | Une seule bibliothèque externe (JSZip). Pas de framework, pas de compilation. |

> Plume est un logiciel indépendant, sans aucun lien avec Microsoft Corporation. « Microsoft Word » et « Office 365 » sont des marques de Microsoft Corporation. L'identité visuelle de Plume (nom, logo, couleurs, icônes) lui est propre.

---

## Captures d'écran

| Fenêtre principale | Ruban Insertion et volet de navigation |
|---|---|
| <img src="docs/captures/plume-accueil.png" alt="Fenêtre principale" width="440"> | <img src="docs/captures/plume-insertion.png" alt="Onglet Insertion" width="440"> |
| **Thème sombre** | **Menu Fichier (modèles et documents récents)** |
| <img src="docs/captures/plume-sombre.png" alt="Thème sombre" width="440"> | <img src="docs/captures/plume-fichier.png" alt="Menu Fichier" width="440"> |

<p align="center"><b>Sur téléphone</b><br><img src="docs/captures/plume-mobile.png" alt="Plume sur téléphone" width="260"></p>

---

## Fonctionnalités

### Fichier
| Fonction | Détail |
|---|---|
| Nouveau | Document vierge ou modèle : **Lettre**, **Curriculum vitae**, **Rapport**, **Compte rendu de réunion** |
| Ouvrir | `.docx`, `.html`, `.txt`, `.md` ; glisser-déposer d'un fichier dans la fenêtre ; documents récents |
| Enregistrer | `.docx`. Sous Chrome et Edge, **Ctrl+S réécrit directement le fichier d'origine** (File System Access API). Ailleurs, le fichier est téléchargé. |
| Enregistrement automatique | Chaque modification est sauvegardée dans le navigateur (IndexedDB). Le dernier document est rouvert au démarrage. |
| Exporter | PDF (via l'impression), page web `.html` autonome (images incluses), texte brut `.txt` |
| Imprimer | Respect du format, des marges, de l'en-tête et du pied de page |
| Informations | Titre, auteur, nombre de pages, de mots et de caractères, format de page |

### Accueil
| Groupe | Commandes |
|---|---|
| Presse-papiers | Coller, Couper, Copier, Reproduire la mise en forme |
| Police | Police (aperçu dans le menu), taille, agrandir et réduire, modifier la casse (5 modes), gras, italique, souligné, barré, indice, exposant, couleur de police (palette et nuancier libre), surlignage, effacer la mise en forme, boîte de dialogue **Police** complète |
| Paragraphe | Puces (rond, cercle, carré, tiret), numérotation (1., a., A., i., I.), niveaux de liste, retraits, 4 alignements, interligne (1,0 à 3,0), espacement avant et après, marques de paragraphe ¶, boîte de dialogue **Paragraphe** |
| Styles | Normal, Titre 1, Titre 2, Titre 3, Titre, Sous-titre, Citation, Code |
| Modification | Rechercher (surlignage de tous les résultats), Remplacer / Remplacer tout (casse, mot entier), Sélectionner tout |

### Insertion
Page de garde · Page vierge · Saut de page · **Tableau** (grille 10 × 8 ou dialogue) · **Images** (fichier, glisser-déposer, coller ; redimensionnement à la souris) · Lien · Signet · **En-tête** et **pied de page** répétés sur chaque page · **Numéro de page** (« X » ou « Page X sur Y ») · Zone de texte · Ligne horizontale · Date et heure (6 formats) · Symboles (€, ©, flèches, lettres grecques…).

### Création
Police du document · Espacement des paragraphes (Compact, Normal, Aéré, Ouvert, Double) · Couleur des titres · Page sombre (affichage uniquement).

### Mise en page
Marges (Normales 2,5 cm, Étroites, Modérées, Larges, ou personnalisées) · Orientation portrait ou paysage · Taille (A4, A5, A3, Lettre, Légal, B5 ou personnalisée) · Retraits et espacements chiffrés du paragraphe · **Marges ajustables à la souris sur la règle**.

### Références
**Table des matières** générée à partir des titres, avec numéros de page. Elle est exportée comme un vrai champ TOC, que Word met à jour à l'ouverture. **Notes de bas de page** : numérotation automatique, affichage en bas de page, modification au clic.

### Révision
Vérification orthographique (dictionnaire du navigateur ou du système) · Langue du document (FR-BE, FR-FR, NL-BE, EN-GB, EN-US, DE, ES, IT, AR) · Statistiques · **Lecture à voix haute** du document ou de la sélection.

### Affichage
Mode Lecture · Plein écran · Règle · **Volet de navigation** (plan des titres cliquable et résultats de recherche avec extraits) · Zoom de 25 à 300 % (100 %, Une page, Largeur de la page, Ctrl+molette) · Thème clair ou sombre (le choix du système est suivi par défaut).

### Tableau (onglet contextuel)
Il apparaît dès que le curseur entre dans un tableau : insérer une ligne au-dessus ou en dessous, une colonne à gauche ou à droite · supprimer une ligne, une colonne ou le tableau · fusionner, fractionner · bordures · trame de fond · ligne d'en-tête répétée · uniformiser les colonnes. **Tab** passe à la cellule suivante et crée une ligne à la fin du tableau.

### Ergonomie
- **Recherche de commandes** (`Alt+Q`) : tapez « marge », « puce » ou « pdf » pour lancer la commande sans chercher dans le ruban.
- **Mini barre flottante** au-dessus d'une sélection de texte.
- **Pagination visuelle** en pages A4 réelles, avec numéro de page courante dans la barre d'état.
- **Annuler / Rétablir** sur 300 niveaux, y compris pour les opérations sur les tableaux, la mise en page et les en-têtes.
- Ruban repliable (`Ctrl+F1`) et interface adaptée aux écrans tactiles et aux petits écrans.

---

## Compatibilité .docx

Plume lit et écrit directement le format **Office Open XML** (ISO/IEC 29500). Les fichiers produits sont reconnus par Microsoft Word 2007 et suivants (dont Microsoft 365), LibreOffice, Google Docs, Pages et OnlyOffice.

### Éléments pris en charge

| Élément | Lecture | Écriture | Remarques |
|---|:---:|:---:|---|
| Styles de paragraphe (Normal, Titres 1-6, Titre, Sous-titre, Citation) | ✅ | ✅ | Les styles Word sont générés à partir de l'aspect réel dans Plume |
| Police, taille, gras, italique, souligné, barré, couleur | ✅ | ✅ | |
| Surlignage et trame de caractère | ✅ | ✅ | |
| Exposant, indice, majuscules, petites majuscules, espacement des caractères | ✅ | ✅ | |
| Polices et couleurs du thème Office | ✅ | — | Résolues en valeurs explicites |
| Alignement, retraits, première ligne, retrait suspendu | ✅ | ✅ | |
| Espacement avant/après, interligne (multiple ou exact) | ✅ | ✅ | |
| Bordures et trame de paragraphe | ✅ | ✅ | |
| Listes à puces et numérotées, 9 niveaux, reprise de numérotation | ✅ | ✅ | |
| Tableaux, largeurs de colonnes, fusions horizontales et verticales | ✅ | ✅ | |
| Trame et alignement vertical des cellules, ligne d'en-tête répétée | ✅ | ✅ | |
| Images en ligne PNG, JPEG, GIF | ✅ | ✅ | WebP, SVG et BMP convertis en PNG à l'export |
| Liens hypertextes (externes et internes) et signets | ✅ | ✅ | |
| En-tête et pied de page, champs PAGE / NUMPAGES | ✅ | ✅ | |
| Notes de bas de page et de fin | ✅ | ✅ | Les notes de fin deviennent des notes de bas de page |
| Table des matières (champ TOC) | ✅ | ✅ | Mise à jour automatique à l'ouverture dans Word |
| Sauts de page, sauts de section | ✅ | ✅ | |
| Format, orientation, marges de page | ✅ | ✅ | |
| Propriétés (titre, auteur, dates) | ✅ | ✅ | |
| Contrôles de contenu, champs complexes, révisions insérées | ✅ | — | Le contenu est conservé |

### Limites connues

| Élément | Comportement actuel |
|---|---|
| Images flottantes (habillage) | Converties en images en ligne ; l'alignement gauche ou droite est gardé à l'écran |
| Zones de texte, formes | Affichées comme encadrés dans le flux du texte |
| Graphiques, SmartArt | Remplacés par un repère `[Graphique]` / `[SmartArt]` |
| Images EMF / WMF | Remplacées par un repère `[Image]` (format non affichable par les navigateurs) |
| En-têtes de première page / pages paires | Seul l'en-tête par défaut est repris |
| Commentaires | Non importés |
| Suivi des modifications | Les modifications sont acceptées à l'ouverture |
| Colonnes multiples | Le texte est affiché sur une colonne |
| Équations | Conservées sous forme de texte |
| Styles de tableau conditionnels (bandes, première colonne) | Seules les bordures sont reprises |
| Macros (`.docm`) | Ouvertes sans les macros, qui ne sont jamais exécutées |
| Ancien format `.doc` (Word 97-2003) | Non pris en charge : convertir d'abord en `.docx` |

> **Pagination.** Plume découpe les pages paragraphe par paragraphe : un paragraphe n'est jamais coupé entre deux pages. L'affichage peut donc différer de quelques lignes de celui de Word, qui coupe à la ligne. Le fichier `.docx` exporté est repaginé normalement par Word.

---

## Installation et lancement

Plume est un ensemble de **fichiers statiques**. Il suffit de les servir en HTTP.

### Fedora Linux

```bash
# Récupérer le projet (dépôt privé : authentification GitHub requise)
git clone https://github.com/asblPixels/plume.git
cd plume

# Lancer un serveur local
python3 -m http.server 8080
```

Ouvrez **http://localhost:8080**.

Navigateur recommandé (installation en application et enregistrement direct dans le fichier) :

```bash
sudo dnf install chromium
# ou, via Flathub :
flatpak install flathub org.chromium.Chromium
```

Polices métriquement compatibles avec Calibri, Cambria, Arial et Times New Roman, pour une mise en page fidèle des documents Office :

```bash
sudo dnf install google-carlito-fonts google-caladea-fonts liberation-fonts
```

### Autres systèmes

| Système | Commande |
|---|---|
| Debian / Ubuntu | `sudo apt install python3 fonts-crosextra-carlito fonts-crosextra-caladea fonts-liberation` puis `python3 -m http.server 8080` |
| macOS | `python3 -m http.server 8080` (Python est fourni avec les outils Xcode) |
| Windows | `py -m http.server 8080` dans le dossier du projet |
| Node.js (tout système) | `npx serve .` |

> ⚠️ N'ouvrez pas `index.html` par un double-clic. Avec une adresse `file://`, le mode hors ligne et l'installation sont désactivés par les navigateurs.

---

## Installer Plume comme une application

Plume est une **Progressive Web App (PWA)**. Une fois installée, elle a son icône, sa propre fenêtre sans barre d'adresse et fonctionne sans connexion.

| Plateforme | Navigateur | Procédure |
|---|---|---|
| **Linux** | Chromium, Chrome, Edge | Icône ⊕ « Installer » dans la barre d'adresse |
| **Windows** | Edge, Chrome | Icône « Installer l'application » dans la barre d'adresse → Plume apparaît dans le menu Démarrer |
| **macOS** | Chrome, Edge ; Safari 17+ | Chrome : icône d'installation ; Safari : *Fichier → Ajouter au Dock* |
| **Android** | Chrome, Edge, Samsung Internet | Menu ⋮ → *Installer l'application* |
| **iPhone / iPad** | Safari | Bouton *Partager* → *Sur l'écran d'accueil* |

Sur ordinateur, l'application installée s'enregistre comme **gestionnaire des fichiers `.docx`** : clic droit sur un document → *Ouvrir avec → Plume*.

> L'installation exige une connexion sécurisée **HTTPS** (ou `localhost`).

---

## Déploiement en production

Pour mettre Plume à disposition des bénéficiaires, hébergez le dossier sur n'importe quel serveur web en HTTPS. Aucun traitement côté serveur n'est nécessaire.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name plume.asblpixels.be;
    root /var/www/plume;
    index index.html;

    # Types MIME
    types { application/manifest+json webmanifest; }
    include mime.types;

    # Le service worker ne doit jamais être mis en cache
    location = /sw.js { add_header Cache-Control "no-cache"; }

    # En-têtes de sécurité
    add_header Content-Security-Policy "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' blob: data:" always;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
}
```

### Apache (`.htaccess`)

```apache
AddType application/manifest+json .webmanifest
<Files "sw.js">
  Header set Cache-Control "no-cache"
</Files>
```

### Hébergements statiques

| Service | Remarque |
|---|---|
| GitHub Pages | Gratuit pour un dépôt public ; nécessite une offre payante pour un dépôt privé |
| Netlify, Cloudflare Pages | Glisser-déposer du dossier, HTTPS automatique |
| Serveur de l'ASBL | Configuration Nginx ou Apache ci-dessus |

### Mise à jour des postes

À chaque nouvelle version, incrémentez la constante `CACHE` dans `sw.js` (par exemple `plume-v2`). Les applications installées récupèrent la mise à jour au lancement suivant.

---

## Navigateurs pris en charge

| Navigateur | Version minimale | Remarques |
|---|---|---|
| Chrome / Chromium / Edge | 120 | Prise en charge complète, dont l'enregistrement direct dans le fichier et l'ouverture des `.docx` depuis le système |
| Firefox | 126 | Complète ; l'enregistrement passe par un téléchargement |
| Safari (macOS, iOS, iPadOS) | 17.2 | Complète ; l'enregistrement passe par un téléchargement |
| Samsung Internet | 25 | Complète |

Fonctions avancées utilisées : propriété CSS `zoom`, CSS Custom Highlight API (surlignage des résultats de recherche ; dégradation gracieuse si elle est absente), IndexedDB, Service Worker, File System Access API (facultative), Web Speech API (facultative).

---

## Raccourcis clavier

| Action | Raccourci | | Action | Raccourci |
|---|---|---|---|---|
| Nouveau | `Ctrl+N` | | Gras / Italique / Souligné | `Ctrl+B` / `Ctrl+I` / `Ctrl+U` |
| Ouvrir | `Ctrl+O` | | Gauche / Centrer / Droite / Justifier | `Ctrl+L` / `Ctrl+E` / `Ctrl+R` / `Ctrl+J` |
| Enregistrer | `Ctrl+S` | | Titre 1 / 2 / 3 | `Ctrl+Alt+1` / `2` / `3` |
| Enregistrer sous | `F12` | | Style Normal | `Ctrl+Maj+N` |
| Imprimer / PDF | `Ctrl+P` | | Liste à puces | `Ctrl+Maj+L` |
| Annuler | `Ctrl+Z` | | Boîte de dialogue Police | `Ctrl+D` |
| Rétablir | `Ctrl+Y` ou `Ctrl+Maj+Z` | | Effacer la mise en forme | `Ctrl+Espace` |
| Rechercher | `Ctrl+F` | | Agrandir / réduire la police | `Ctrl+>` / `Ctrl+<` |
| Remplacer | `Ctrl+H` | | Indice / Exposant | `Ctrl+=` / `Ctrl+Maj+=` |
| Lien | `Ctrl+K` | | Note de bas de page | `Ctrl+Alt+F` |
| Saut de page | `Ctrl+Entrée` | | Marques de paragraphe | `Ctrl+*` |
| Recherche de commande | `Alt+Q` | | Orthographe (activer/désactiver) | `F7` |
| Réduire le ruban | `Ctrl+F1` | | Plein écran | `F11` |
| Tabulation / niveau de liste | `Tab` / `Maj+Tab` | | Suivre un lien | `Ctrl+clic` |

Sur macOS, `Ctrl` est remplacé par `⌘ Cmd`.

---

## Architecture technique

```
plume/
├── index.html              Structure de l'interface (barre de titre, ruban, page, barre d'état)
├── manifest.webmanifest    Déclaration PWA : nom, icônes, ouverture des .docx, raccourcis
├── sw.js                   Service worker : cache de l'application, fonctionnement hors ligne
├── css/
│   └── plume.css           Thèmes clair/sombre, ruban, page, impression, responsive
├── js/
│   ├── util.js             Outils DOM, conversions d'unités, couleurs, dialogues, stockage IndexedDB
│   ├── docx-import.js      Lecteur OOXML → HTML (styles, thème, numérotation, relations, médias)
│   ├── docx-export.js      Générateur HTML → OOXML (styles, numérotation, notes, en-têtes, médias)
│   ├── editor.js           Moteur : pagination, en-têtes/pieds, historique, commandes, tableaux
│   ├── ribbon.js           Registre des commandes, ruban, menus, mini barre, reproduction de mise en forme
│   ├── backstage.js        Menu Fichier, modèles, boîtes de dialogue
│   ├── app.js              Orchestration : fichiers, enregistrement, zoom, règle, navigation, raccourcis
│   └── icons.js            Tracés d'icônes (base Lucide, ISC)
├── icons/                  Logo « Plume » (SVG clair/sombre), icône P (SVG), icônes PWA (192, 512, maskable), apple-touch-icon, favicon
├── vendor/
│   └── jszip.min.js        Lecture/écriture des archives ZIP (.docx)
└── docs/captures/          Captures d'écran
```

### Principes de conception

**Modèle d'édition.** Le document est un élément `contenteditable` dont le HTML est volontairement limité : paragraphes, titres, listes, tableaux, images, plus quelques éléments propres à Plume (`.pl-pagebreak`, `.pl-field`, `.pl-fn`, `.pl-toc`, `.pl-anchor`, `.pl-tab`). Tout contenu entrant (collage, ouverture HTML) passe par une **liste blanche** (`Sanitize`).

**Pagination.** Les pages sont des cartes dessinées derrière un flux de texte unique. Après chaque modification, un algorithme mesure les blocs et repousse sur la page suivante tout paragraphe qui franchirait la marge basse. Le décalage est appliqué par une **feuille de style générée** (sélecteurs `:nth-child`) et non en modifiant le document. L'historique d'annulation et le contenu exporté ne sont donc jamais pollués.

**Historique.** L'historique fonctionne par instantanés : HTML du document, en-tête, pied de page et position de la sélection, codée en chemin de nœuds. La frappe est regroupée par pauses de 450 ms ; chaque commande crée un point d'annulation. Les images sont stockées en `blob:` pour que les instantanés restent légers.

**Import .docx.** `docx-import.js` suit les relations du paquet (`_rels`), résout la chaîne d'héritage des styles (`basedOn`), les valeurs par défaut du document, le thème (polices et couleurs) et la numérotation (`abstractNum`, `lvlOverride`). Il interprète les champs complexes (`fldChar`) et reconstruit les fusions de cellules (`gridSpan`, `vMerge`). La mise en forme est convertie en CSS sur le principe de la **différence avec le style parent** : le HTML reste minimal.

**Export .docx.** `docx-export.js` lit l'**aspect calculé** (`getComputedStyle`) de chaque bloc et de chaque fragment de texte. Il génère d'abord les styles Word (`styles.xml`) à partir d'échantillons rendus par Plume, puis n'écrit en mise en forme directe que ce qui s'en écarte. Résultat : un document propre, dont les styles « Titre 1 », « Normal »… se modifient normalement dans Word. Sont aussi générés `numbering.xml` (une instance par liste), `footnotes.xml`, `header1.xml` / `footer1.xml` avec leurs relations, ainsi que les métadonnées `core.xml` et `app.xml`.

**Stockage.** Les documents sont conservés dans IndexedDB (base `plume`, magasins `docs` et `kv`), images converties en `data:` URL. Les préférences (thème, nom d'auteur) sont dans `localStorage`.

---

## Guide du développeur

### Conventions
- JavaScript moderne (ES2020+), sans framework ni étape de compilation ; un fichier = un module global (`Ed`, `App`, `Ribbon`, `DocxImport`, `DocxExport`…).
- Commentaires et textes d'interface **en français**.
- Pas de `alert()`, `confirm()` ni `prompt()` natifs : utiliser `dialog()` (`util.js`).
- Toute modification du document passe par `Ed.changed()` ou `Ed.afterCmd()` pour alimenter l'historique, la pagination et l'enregistrement automatique.

### Ajouter une commande au ruban

1. Déclarer la commande dans `registerCommands()` (`js/ribbon.js`) :
   ```js
   cmd('monId', 'Libellé affiché', 'nom-icone', arg => { /* action */ }, { kbd: 'Ctrl+M' });
   ```
2. La placer dans un groupe de `Ribbon.tabs` : `'monId'` (petit bouton), `{ big: 'monId' }` (grand bouton) ou `{ bigMenu: 'monId', menu: 'monMenu' }` (bouton à menu, à définir dans `Menus.open`).
3. Si l'icône n'existe pas encore, l'ajouter au générateur d'icônes (voir ci-dessous).

La commande est automatiquement disponible dans la recherche `Alt+Q` et, si elle a un raccourci, dans la liste **Aide → Raccourcis clavier**.

### Régénérer les icônes

```bash
npm install lucide-static
node outils/mkicons.js save bold italic …   # liste des icônes utilisées
```

Le script lit les tracés SVG de `lucide-static` et produit `js/icons.js`. Le style (trait de 1,65, duo-ton turquoise) est appliqué en CSS.

### Régénérer les icônes d'application

Les PNG de `icons/` sont rendus à partir de `icons/favicon.svg` (icône standard) et `icons/maskable.svg` (zone de sécurité Android) avec un navigateur sans interface : Playwright + Chromium.

---

## Tests et assurance qualité

Les tests de bout en bout pilotent Chromium en mode sans interface (Playwright) :

| Scénario | Vérification |
|---|---|
| Saisie, gras, styles, annuler/rétablir | HTML attendu après chaque étape |
| Import d'un `.docx` produit par python-docx (titres, listes, tableau fusionné, image, en-tête, saut de page) | Contenu, nombre de pages, absence d'erreur console |
| Export puis relecture avec **python-docx** | Styles, mise en forme directe, cellules fusionnées, en-tête, image |
| Export puis conversion PDF avec **LibreOffice** | Ouverture sans erreur, table des matières, notes, numéros de page |
| Validation XML | Toutes les parties du paquet sont des XML bien formés |
| Ré-import dans Plume du fichier exporté | Aller-retour sans perte sur les éléments pris en charge |
| Captures mobile (390 × 844) et bureau (1440 × 900) | Mise à l'échelle automatique, thèmes clair et sombre |

Avant chaque version, nous recommandons aussi une vérification manuelle dans **Microsoft Word (Microsoft 365)** : ouverture sans message de réparation et mise à jour de la table des matières.

---

## Sécurité, vie privée et RGPD

- **Aucune donnée transmise.** Plume ne fait aucune requête réseau en dehors du chargement de ses propres fichiers. Aucun compte, aucun traceur, aucune statistique d'usage, aucun service tiers.
- **Stockage local uniquement.** Les documents restent dans le navigateur de l'utilisateur (IndexedDB) ou dans les fichiers qu'il enregistre lui-même. Pour les effacer : *Fichier → Ouvrir → Documents récents → corbeille*, ou vider les données du site dans le navigateur.
- **Contenu non fiable neutralisé.** Les scripts, gestionnaires d'événements, liens `javascript:`, objets incorporés et iframes sont supprimés à l'ouverture et au collage. Les macros des documents ne sont jamais lues.
- **Postes partagés** (espace public numérique, formation) : rappelez aux utilisateurs de supprimer leurs documents récents en fin de séance, ou utilisez une fenêtre de navigation privée.
- Pixel's ASBL n'ayant accès à aucun document, l'usage de Plume ne crée **aucun traitement de données personnelles** pour l'ASBL au sens du RGPD.

---

## Feuille de route

| Priorité | Évolution |
|---|---|
| Haute | Commentaires (lecture, ajout, export) |
| Haute | Suivi des modifications |
| Haute | Images flottantes avec habillage du texte |
| Haute | Coupure des paragraphes entre deux pages (pagination à la ligne) |
| Moyenne | En-tête de première page différente, pages paires/impaires |
| Moyenne | Colonnes multiples |
| Moyenne | Styles de tableau prédéfinis (bandes, en-tête coloré) |
| Moyenne | Correcteur grammatical local (LanguageTool auto-hébergé, en option) |
| Moyenne | Publipostage depuis un fichier CSV |
| Basse | Export `.odt` (OpenDocument) |
| Basse | Équations éditables |
| Basse | Formes et zones de texte positionnées |

---

## Historique des versions

### 1.0.0 — 16 novembre 2026
- Première version : ruban complet (Accueil, Insertion, Création, Mise en page, Références, Révision, Affichage, Aide, Tableau)
- Import et export `.docx`
- Pagination, en-têtes et pieds de page, numéros de page, table des matières, notes de bas de page
- Modèles de documents, enregistrement automatique, documents récents
- Application installable et hors ligne (Windows, macOS, Linux, Android, iOS)
- Thèmes clair et sombre, interface adaptée au mobile

---

## Licence et crédits

© 2026 **Pixel's ASBL**. Tous droits réservés. La licence de diffusion du code reste à définir.

| Composant | Auteur | Licence |
|---|---|---|
| [JSZip](https://stuk.github.io/jszip/) | Stuart Knightley et contributeurs | MIT |
| Tracés d'icônes [Lucide](https://lucide.dev) | Lucide Contributors | ISC |

Le nom **Plume**, le logotype (P turquoise #26EFC5 + « lume »), l'icône P et l'identité visuelle sont la propriété de Pixel's ASBL.

---

## Contact

**Pixel's ASBL** — accompagnement numérique, coaching informatique à domicile, repair café
Rue Alfred Dendal 56, 7300 Boussu, Belgique
✉ [info@asblpixels.be](mailto:info@asblpixels.be) · ☎ +32 456 96 03 28 · [facebook.com/asblpixels](https://facebook.com/asblpixels)
N° d'entreprise / TVA : BE 1013.334.947

<div align="center"><sub>Fait avec soin à Boussu 🇧🇪</sub></div>
