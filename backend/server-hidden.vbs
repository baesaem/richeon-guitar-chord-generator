' Richeon guitar class - start the analysis server without a console window.
' ASCII only on purpose: VBScript reads this file with the system codepage,
' and non-ASCII text here has broken the Run call before.
Dim fso, sh, here
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh  = CreateObject("WScript.Shell")
here = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = here
sh.Run "cmd /c """ & here & "\server.bat""", 0, False
