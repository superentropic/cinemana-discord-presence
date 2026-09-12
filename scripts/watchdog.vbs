Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
Set system = GetObject("winmgmts:\\.\root\cimv2")

root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
app = LCase(files.BuildPath(root, "app\index.js"))
node = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")

Do
  running = False
  Set processes = system.ExecQuery("Select CommandLine From Win32_Process Where Name='node.exe'")
  For Each process In processes
    If Not IsNull(process.CommandLine) Then
      If InStr(LCase(process.CommandLine), app) > 0 Then running = True
    End If
  Next
  If Not running Then shell.Run """" & node & """ """ & app & """", 0, False
  WScript.Sleep 10000
Loop
