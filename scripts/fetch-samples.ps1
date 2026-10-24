#Requires -Version 5.1
<#
.SYNOPSIS
  Downloads the public sample models listed in samples/README.md into samples/public/.
  Files already present are skipped. Project-specific models are never fetched here.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'samples\public'
New-Item -ItemType Directory -Force $target | Out-Null

$base = 'https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/tests/ifcfiles/public/'
$files = @('IfcOpenHouse_IFC4.ifc', 'duplex.ifc', 'AC20-FZK-Haus.ifc')

foreach ($name in $files) {
  $path = Join-Path $target $name
  if (Test-Path $path) {
    Write-Host "present  $name"
    continue
  }
  Write-Host "fetching $name"
  Invoke-WebRequest ($base + $name) -OutFile $path
}

Write-Host "Samples are in $target"
