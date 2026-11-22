; =====================================================================
;  Plume — installateur Windows (NSIS, compilable sous Linux sans Wine)
;  Installation par utilisateur (aucun droit administrateur requis),
;  raccourcis, associations de fichiers, désinstallation propre.
;  Usage : makensis -DVERSION=1.2.0 -DSRC=chemin/win-unpacked -DOUT=fichier.exe plume.nsi
; =====================================================================
Unicode true
SetCompressor /SOLID lzma
SetCompressorDictSize 64
RequestExecutionLevel user
ManifestDPIAware true

; séparateur de chemin : « \ » sous Windows (défaut), passer -DSEP=/ pour compiler sous Linux
!ifndef SEP
  !define SEP "\"
!endif
!ifndef VERSION
  !define VERSION "1.4.0"
!endif
!define APPNAME "Plume"
!define COMPANY "Pixel's ASBL"
!define PROGID "Plume.Document"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Plume"

Name "${APPNAME}"
OutFile "${OUT}"
InstallDir "$LOCALAPPDATA\Programs\Plume"
InstallDirRegKey HKCU "Software\Plume" "InstallDir"
BrandingText "${APPNAME} ${VERSION} — ${COMPANY}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${APPNAME}"
VIAddVersionKey "CompanyName" "${COMPANY}"
VIAddVersionKey "FileDescription" "Installation de Plume, traitement de texte"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "© 2026 ${COMPANY}"

!include "MUI2.nsh"
!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "Bienvenue dans l'installation de Plume ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Plume est le traitement de texte libre de Pixel's ASBL. Il ouvre et enregistre les documents Word, OpenDocument, RTF et PDF.$\r$\n$\r$\nL'installation ne demande aucun droit administrateur.$\r$\n$\r$\nCliquez sur Suivant pour continuer."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Plume.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Lancer Plume"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "French"

; Association d'une extension au type de document Plume (si personne d'autre ne la gère, Plume devient proposé dans « Ouvrir avec »)
!macro Assoc EXT DESC
  WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}" ""
  WriteRegStr HKCU "Software\Classes\Applications\Plume.exe\SupportedTypes" ".${EXT}" ""
!macroend
!macro UnAssoc EXT
  DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
!macroend

Section "Plume" SecMain
  SetOutPath "$INSTDIR"
  ; ferme une instance ouverte avant de remplacer les fichiers
  nsExec::Exec 'taskkill /F /IM Plume.exe'
  File /r "${SRC}${SEP}*.*"
  WriteUninstaller "$INSTDIR\Desinstaller Plume.exe"

  ; raccourcis
  CreateShortcut "$SMPROGRAMS\Plume.lnk" "$INSTDIR\Plume.exe" "" "$INSTDIR\Plume.exe" 0
  CreateShortcut "$DESKTOP\Plume.lnk" "$INSTDIR\Plume.exe" "" "$INSTDIR\Plume.exe" 0

  ; type de document et commande d'ouverture
  WriteRegStr HKCU "Software\Classes\${PROGID}" "" "Document Plume"
  WriteRegStr HKCU "Software\Classes\${PROGID}\DefaultIcon" "" "$INSTDIR\Plume.exe,0"
  WriteRegStr HKCU "Software\Classes\${PROGID}\shell\open\command" "" '"$INSTDIR\Plume.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\Plume.exe" "FriendlyAppName" "Plume"
  WriteRegStr HKCU "Software\Classes\Applications\Plume.exe\shell\open\command" "" '"$INSTDIR\Plume.exe" "%1"'
  !insertmacro Assoc "docx" "Document Word"
  !insertmacro Assoc "docm" "Document Word"
  !insertmacro Assoc "dotx" "Modèle Word"
  !insertmacro Assoc "doc" "Document Word 97-2003"
  !insertmacro Assoc "dot" "Modèle Word 97-2003"
  !insertmacro Assoc "odt" "Document OpenDocument"
  !insertmacro Assoc "ott" "Modèle OpenDocument"
  !insertmacro Assoc "fodt" "Document OpenDocument"
  !insertmacro Assoc "rtf" "Texte enrichi"
  !insertmacro Assoc "md" "Markdown"
  !insertmacro Assoc "txt" "Texte"
  !insertmacro Assoc "pdf" "PDF"
  !insertmacro Assoc "wpd" "WordPerfect"
  !insertmacro Assoc "wps" "Works"
  !insertmacro Assoc "pages" "Apple Pages"
  !insertmacro Assoc "sxw" "OpenOffice 1.x"

  ; « Applications par défaut » de Windows
  WriteRegStr HKCU "Software\Plume\Capabilities" "ApplicationName" "Plume"
  WriteRegStr HKCU "Software\Plume\Capabilities" "ApplicationDescription" "Traitement de texte compatible Word, OpenDocument, RTF et PDF"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".docx" "${PROGID}"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".doc" "${PROGID}"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".odt" "${PROGID}"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".rtf" "${PROGID}"
  WriteRegStr HKCU "Software\Plume\Capabilities\FileAssociations" ".md" "${PROGID}"
  WriteRegStr HKCU "Software\RegisteredApplications" "Plume" "Software\Plume\Capabilities"
  WriteRegStr HKCU "Software\Plume" "InstallDir" "$INSTDIR"

  ; « Programmes et fonctionnalités »
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Plume"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "${COMPANY}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\Plume.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "URLInfoAbout" "https://github.com/asblPixels/Plume"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\Desinstaller Plume.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1

  ; prévenir l'Explorateur que les associations ont changé
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd

Section "Uninstall"
  nsExec::Exec 'taskkill /F /IM Plume.exe'
  Delete "$SMPROGRAMS\Plume.lnk"
  Delete "$DESKTOP\Plume.lnk"
  RMDir /r "$INSTDIR"
  !insertmacro UnAssoc "docx"
  !insertmacro UnAssoc "docm"
  !insertmacro UnAssoc "dotx"
  !insertmacro UnAssoc "doc"
  !insertmacro UnAssoc "dot"
  !insertmacro UnAssoc "odt"
  !insertmacro UnAssoc "ott"
  !insertmacro UnAssoc "fodt"
  !insertmacro UnAssoc "rtf"
  !insertmacro UnAssoc "md"
  !insertmacro UnAssoc "txt"
  !insertmacro UnAssoc "pdf"
  !insertmacro UnAssoc "wpd"
  !insertmacro UnAssoc "wps"
  !insertmacro UnAssoc "pages"
  !insertmacro UnAssoc "sxw"
  DeleteRegKey HKCU "Software\Classes\${PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\Plume.exe"
  DeleteRegValue HKCU "Software\RegisteredApplications" "Plume"
  DeleteRegKey HKCU "Software\Plume"
  DeleteRegKey HKCU "${UNINSTKEY}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
SectionEnd
