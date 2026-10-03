; Cross-build fallback. The standard Windows build uses Tauri's NSIS bundler.
Unicode True
!include "MUI2.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
Name "Trace"
OutFile "../dist/Trace-0.1.0-setup.exe"
InstallDir "$LOCALAPPDATA\Programs\Trace"
InstallDirRegKey HKCU "Software\Trace" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
!define MUI_ICON "../apps/desktop/src-tauri/icons/icon.ico"
!define MUI_UNICON "../apps/desktop/src-tauri/icons/icon.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\trace.exe"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK "This Trace build requires 64-bit Windows."
    Abort
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK "Trace requires Windows 10 or Windows 11."
    Abort
  ${EndIf}
FunctionEnd
Section "Trace" SEC_MAIN
  SetShellVarContext current
  IfFileExists "$INSTDIR\trace-agent.exe" 0 +3
    ExecWait '"$INSTDIR\trace-agent.exe" --stop'
    Sleep 600
  SetOutPath "$INSTDIR"
  File "../target/x86_64-pc-windows-gnu/release/trace.exe"
  File "../target/x86_64-pc-windows-gnu/release/trace-agent.exe"
  File "../dist/WebView2Loader.dll"
  CreateDirectory "$SMPROGRAMS\Trace"
  CreateShortcut "$SMPROGRAMS\Trace\Trace.lnk" "$INSTDIR\trace.exe"
  CreateShortcut "$SMPROGRAMS\Trace\Uninstall.lnk" "$INSTDIR\Uninstall.exe"
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\Trace" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace" "DisplayName" "Trace"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace" "DisplayVersion" "0.1.0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace" "DisplayIcon" "$INSTDIR\trace.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace" "NoRepair" 1
SectionEnd
Section "Uninstall"
  SetShellVarContext current
  ExecWait '"$INSTDIR\trace-agent.exe" --stop'
  Sleep 600
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Trace"
  Delete "$INSTDIR\trace-agent.exe"
  Delete "$INSTDIR\trace.exe"
  Delete "$INSTDIR\WebView2Loader.dll"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\Trace\Trace.lnk"
  Delete "$SMPROGRAMS\Trace\Uninstall.lnk"
  RMDir "$SMPROGRAMS\Trace"
  DeleteRegKey HKCU "Software\Trace"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Trace"
  ; User telemetry is intentionally retained; delete it in Trace before uninstalling if desired.
SectionEnd
