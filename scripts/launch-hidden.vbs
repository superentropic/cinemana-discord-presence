Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")
root = files.GetParentFolderName(files.GetParentFolderName(WScript.ScriptFullName))
node = shell.ExpandEnvironmentStrings("%ProgramFiles%\nodejs\node.exe")
shell.Run """" & node & """ """" & files.BuildPath(root, "app\index.js") & """", 0, False
