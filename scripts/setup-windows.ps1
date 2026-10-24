#Requires -Version 5.1
<#
.SYNOPSIS
  Installs the toolchain KingPost Connect needs on Windows.

.DESCRIPTION
  1. Checks Node.js and enables pnpm through corepack.
  2. Installs Visual Studio Build Tools with the C++ workload (MSVC compiler and
     Windows SDK), which the Rust MSVC toolchain and SQLite's bundled C sources need.
     This step asks for administrator permission and takes 10-20 minutes.
  3. Installs Rust through rustup (stable, MSVC target, with clippy and rustfmt).

  Safe to re-run: each step is skipped when it is already satisfied.
  The WebView2 runtime is part of Windows 10/11 and is not installed here.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Step([string] $Message) { Write-Host "`n==> $Message" -ForegroundColor Cyan }

Step 'Node.js and pnpm'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js 20 or newer is required. Install it from https://nodejs.org and re-run this script.'
}
Write-Host "node $(node -v)"
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  corepack enable pnpm
}
Write-Host "pnpm $(pnpm -v)"

Step 'Visual Studio Build Tools (C++ workload)'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$vcInstalled = $false
if (Test-Path $vswhere) {
  $path = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  $vcInstalled = -not [string]::IsNullOrWhiteSpace($path)
}
if ($vcInstalled) {
  Write-Host "already installed at $path"
} else {
  $installer = Join-Path $env:TEMP 'vs_BuildTools.exe'
  Write-Host 'downloading installer...'
  Invoke-WebRequest 'https://aka.ms/vs/17/release/vs_BuildTools.exe' -OutFile $installer
  Write-Host 'installing; accept the Windows permission prompt when it appears (10-20 minutes)...'
  $arguments = @(
    '--passive', '--wait', '--norestart', '--nocache',
    '--add', 'Microsoft.VisualStudio.Workload.VCTools',
    '--includeRecommended'
  )
  $process = Start-Process -FilePath $installer -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) {
    throw "Build Tools installer exited with code $($process.ExitCode)"
  }
  Write-Host 'installed'
}

Step 'Rust (rustup, stable, MSVC)'
$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path (Join-Path $cargoBin 'cargo.exe')) {
  $env:Path = "$cargoBin;$env:Path"
}
if (Get-Command cargo -ErrorAction SilentlyContinue) {
  Write-Host "$(cargo --version)"
  rustup component add clippy rustfmt | Out-Null
} else {
  $rustupInit = Join-Path $env:TEMP 'rustup-init.exe'
  Write-Host 'downloading rustup-init...'
  Invoke-WebRequest 'https://win.rustup.rs/x86_64' -OutFile $rustupInit
  & $rustupInit -y --default-toolchain stable-x86_64-pc-windows-msvc --profile default
  if ($LASTEXITCODE -ne 0) { throw "rustup-init exited with code $LASTEXITCODE" }
  $env:Path = "$cargoBin;$env:Path"
  Write-Host "$(cargo --version)"
}

Step 'Done'
Write-Host 'Open a new terminal so PATH changes take effect, then run: pnpm install && pnpm tauri dev'
