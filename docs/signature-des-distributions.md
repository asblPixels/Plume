# Signature des distributions Windows et Android

Le workflow **Compilation** utilise l’environnement GitHub Actions
`release-signing` sur les branches `release/*` et les tags `v*`. Les autres
compilations utilisent `build-preview`. Limiter les déploiements de
`release-signing` aux branches et aux tags de publication et y enregistrer les
secrets. Les valeurs ci-dessous doivent venir du titulaire des certificats.

| Paramètre | Type | Valeur |
| --- | --- | --- |
| `PLUME_WINDOWS_PFX_B64` | Secret | Fichier PFX de signature de code encodé en Base64 |
| `PLUME_WINDOWS_PFX_PASSWORD` | Secret | Mot de passe du PFX |
| `PLUME_WINDOWS_CERT_SHA256` | Variable | Empreinte SHA-256 du certificat de signature Windows, 64 chiffres hexadécimaux sans séparateurs |
| `PLUME_ANDROID_KEYSTORE_B64` | Secret | Keystore de distribution directe Android encodé en Base64 |
| `PLUME_ANDROID_STORE_PASSWORD` | Secret | Mot de passe du keystore |
| `PLUME_ANDROID_KEY_PASSWORD` | Secret | Mot de passe de la clé |
| `PLUME_ANDROID_KEY_ALIAS` | Variable | Alias de la clé de distribution directe |
| `PLUME_ANDROID_CERT_SHA256` | Variable | Empreinte SHA-256 du certificat Android, 64 chiffres hexadécimaux sans séparateurs |
| `PLUME_REQUIRE_SIGNED_RELEASE` | Variable | Valeur `true` pour refuser les builds de publication tant qu’une signature est indisponible |

Sous Windows, le workflow signe et horodate avec Authenticode l’installateur
NSIS et le `Plume.exe` inclus dans l’installation et l’archive portable. SignTool
vérifie le résultat avec la politique Authenticode et le workflow contrôle
le certificat du signataire et l’horodatage. Cette configuration nécessite un
certificat utilisable via PFX. Une clé sur jeton ou dans un service de signature
distant nécessite l’intégration de ce fournisseur.

Pour Android, le workflow construit l’APK de production, l’aligne, le signe
avec `apksigner`, puis vérifie la signature, l’empreinte du signataire et le
nom et la version du paquet. Conserver la même clé de distribution directe
pour les mises à jour des installations existantes. Un APK de débogage utilise
une identité différente et ne permet pas d’installer une mise à jour par-dessus
une installation signée par une autre clé.

Sans secrets configurés, les compilations d’aperçu produisent un installateur
Windows sans signature Plume et un APK de débogage clairement nommé. Les
compilations de publication se comportent de la même façon tant que
`PLUME_REQUIRE_SIGNED_RELEASE` est désactivée. Une configuration partielle ou
une signature invalide fait échouer la compilation.
