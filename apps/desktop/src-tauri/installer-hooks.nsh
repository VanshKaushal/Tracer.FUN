!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$INSTDIR\trace-agent.exe" 0 +3
    ExecWait '"$INSTDIR\trace-agent.exe" --stop'
    Sleep 600
!macroend
!macro NSIS_HOOK_PREUNINSTALL
  ExecWait '"$INSTDIR\trace-agent.exe" --stop'
  Sleep 600
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Trace"
!macroend
