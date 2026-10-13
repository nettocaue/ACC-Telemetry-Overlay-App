Unicode True
!include "MUI2.nsh"

; ── Metadados ─────────────────────────────────────────────
!ifndef APP_VERSION
  !define APP_VERSION "1.2.0"
!endif
!define APP_NAME      "ACC Telemetry App"
!define APP_PUBLISHER "nettocaue"
!define APP_URL       "https://github.com/nettocaue/ACC-Telemetry-Overlay-App"
!define APP_EXE       "acc-telemetry-app.exe"
!define REG_UNINST    "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
!define REG_APP       "Software\${APP_NAME}"

Name    "${APP_NAME}"
OutFile "dist\ACC-Telemetry-App-${APP_VERSION}-Setup.exe"

; Sem UAC — instala em perfil do usuário
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\${APP_NAME}"
InstallDirRegKey HKCU "${REG_APP}" "InstallDir"

; ── Visual MUI2 ───────────────────────────────────────────
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE    "Bem-vindo ao ${APP_NAME}"
!define MUI_WELCOMEPAGE_TEXT     "Este assistente irá instalar o ${APP_NAME} ${APP_VERSION} no seu computador.$\r$\n$\r$\nO aplicativo fornece overlays de telemetria em tempo real para o Assetto Corsa Competizione.$\r$\n$\r$\nClique em Avançar para continuar."

!define MUI_DIRECTORYPAGE_TEXT_TOP "Escolha a pasta onde o ${APP_NAME} será instalado:"

!define MUI_FINISHPAGE_TITLE     "Instalação concluída"
!define MUI_FINISHPAGE_TEXT      "${APP_NAME} ${APP_VERSION} foi instalado com sucesso.$\r$\n$\r$\nUm atalho foi criado na área de trabalho."
!define MUI_FINISHPAGE_RUN       "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT  "Executar ${APP_NAME}"

; ── Páginas ───────────────────────────────────────────────
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

; ── Idioma ────────────────────────────────────────────────
!insertmacro MUI_LANGUAGE "PortugueseBR"

; ── Metadados do executável ───────────────────────────────
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=0 "ProductName"     "${APP_NAME}"
VIAddVersionKey /LANG=0 "ProductVersion"  "${APP_VERSION}"
VIAddVersionKey /LANG=0 "LegalCopyright"  "${APP_PUBLISHER}"
VIAddVersionKey /LANG=0 "FileDescription" "${APP_NAME} Installer"
VIAddVersionKey /LANG=0 "FileVersion"     "${APP_VERSION}"

; ── Instalação ────────────────────────────────────────────
Section "Principal"
  SetOutPath "$INSTDIR"
  File /r "out\ACC Telemetry App-win32-x64\*.*"

  ; Grava diretório no registro
  WriteRegStr HKCU "${REG_APP}" "InstallDir" "$INSTDIR"

  ; Atalhos
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Desinstalar.lnk" "$INSTDIR\Uninstall.exe"

  ; Desinstalador
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Entrada em Programas e Recursos
  WriteRegStr   HKCU "${REG_UNINST}" "DisplayName"     "${APP_NAME}"
  WriteRegStr   HKCU "${REG_UNINST}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr   HKCU "${REG_UNINST}" "DisplayIcon"     "$INSTDIR\${APP_EXE}"
  WriteRegStr   HKCU "${REG_UNINST}" "Publisher"       "${APP_PUBLISHER}"
  WriteRegStr   HKCU "${REG_UNINST}" "DisplayVersion"  "${APP_VERSION}"
  WriteRegStr   HKCU "${REG_UNINST}" "URLInfoAbout"    "${APP_URL}"
  WriteRegDWORD HKCU "${REG_UNINST}" "NoModify"        1
  WriteRegDWORD HKCU "${REG_UNINST}" "NoRepair"        1
SectionEnd

; ── Desinstalação ─────────────────────────────────────────
Section "Uninstall"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${REG_UNINST}"
  DeleteRegKey HKCU "${REG_APP}"
SectionEnd
