Option Explicit

Dim shell, fs, projectRoot, nodePath, lookup, candidates, candidate, health, command, healthText, wmi, processes, proc
Set shell = CreateObject("WScript.Shell")
Set fs = CreateObject("Scripting.FileSystemObject")
projectRoot = fs.GetParentFolderName(WScript.ScriptFullName)

' Keep the recurring startup check idempotent. This launcher uses no PowerShell.
On Error Resume Next
Set health = CreateObject("WinHttp.WinHttpRequest.5.1")
health.SetTimeouts 1000, 1000, 1000, 1500
health.Open "GET", "http://127.0.0.1:3001/api/health", False
health.Send
If Err.Number = 0 Then
    If health.Status = 200 Then
        healthText = health.ResponseText
        If InStr(healthText, "2026.11.05-campus-posters-v32") > 0 Then WScript.Quit 0

        ' A healthy but older portal is still stale. Stop only Node processes
        ' launched from this exact project folder before starting the new code.
        On Error Resume Next
        Set wmi = GetObject("winmgmts:\\.\root\cimv2")
        If Err.Number = 0 Then
            Set processes = wmi.ExecQuery("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'")
            If Err.Number = 0 Then
                For Each proc In processes
                    command = LCase(CStr(proc.CommandLine))
                    If InStr(command, LCase(projectRoot & "\server.js")) > 0 Then proc.Terminate 0
                Next
            End If
        End If
        Err.Clear
        On Error GoTo 0
        WScript.Sleep 1000
    End If
End If
Err.Clear
On Error GoTo 0

' Prefer Node from PATH, then fall back to the bundled Codex runtime location.
nodePath = ""
On Error Resume Next
Set lookup = shell.Exec("cmd.exe /d /c where.exe node.exe")
candidates = lookup.StdOut.ReadAll
If Err.Number = 0 Then
    For Each candidate In Split(candidates, vbCrLf)
        candidate = Trim(candidate)
        If Len(candidate) > 0 And fs.FileExists(candidate) Then
            nodePath = candidate
            Exit For
        End If
    Next
End If
Err.Clear
On Error GoTo 0

If Len(nodePath) = 0 Then
    nodePath = shell.ExpandEnvironmentStrings("%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
End If
If Not fs.FileExists(nodePath) Then WScript.Quit 1

shell.CurrentDirectory = projectRoot
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & projectRoot & "\server.js" & Chr(34)
shell.Run command, 0, False
