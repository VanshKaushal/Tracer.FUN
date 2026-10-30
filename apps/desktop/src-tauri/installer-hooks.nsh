!macro NSIS_HOOK_PREINSTALL
  ; Tauri handles the running dashboard before this hook. Stop the separate
  ; collector as well so upgrades can replace it without losing pending data.
  IfFileExists "$INSTDIR\trace-agent.exe" 0 +3
    ExecWait '"$INSTDIR\trace-agent.exe" --stop'
    Sleep 600
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\trace-agent.exe" --stop'
  Sleep 600
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Trace"
!macroend
