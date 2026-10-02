# Rebuilds co2-interference.zip on the Desktop with all project files
# (excludes node_modules, .next and .git, which can be regenerated).
$src = Split-Path -Parent $PSScriptRoot
$zip = Join-Path ([Environment]::GetFolderPath('Desktop')) 'co2-interference.zip'
$stage = Join-Path $env:TEMP 'co2-interference-stage'
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory $stage | Out-Null
robocopy $src (Join-Path $stage 'co2-interference') /E /XD node_modules .next .git /XF *.log /NFL /NDL /NJH /NJS /NP | Out-Null
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage 'co2-interference') -DestinationPath $zip
Remove-Item $stage -Recurse -Force
Write-Host "Created $zip ($([math]::Round((Get-Item $zip).Length/1KB)) KB)"
