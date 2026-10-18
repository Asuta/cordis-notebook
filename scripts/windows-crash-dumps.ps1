param(
  [string]$Directory,
  [switch]$Disable
)

$ErrorActionPreference = 'Stop'
$key = 'HKCU:\Software\Microsoft\Windows\Windows Error Reporting\LocalDumps\node.exe'

if ($Disable) {
  if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key -Recurse -Force }
  [pscustomobject]@{ Enabled = $false; Key = $key }
  return
}

if (-not $Directory) { $Directory = Join-Path $PSScriptRoot '..\.workbench\diagnostics\windows-dumps' }
$resolved = [IO.Path]::GetFullPath($Directory)
[IO.Directory]::CreateDirectory($resolved) | Out-Null
New-Item -Path $key -Force | Out-Null
New-ItemProperty -LiteralPath $key -Name 'DumpFolder' -PropertyType ExpandString -Value $resolved -Force | Out-Null
New-ItemProperty -LiteralPath $key -Name 'DumpCount' -PropertyType DWord -Value 5 -Force | Out-Null
New-ItemProperty -LiteralPath $key -Name 'DumpType' -PropertyType DWord -Value 1 -Force | Out-Null

[pscustomobject]@{
  Enabled = $true
  Key = $key
  DumpFolder = $resolved
  DumpCount = 5
  DumpType = 'Mini'
}
