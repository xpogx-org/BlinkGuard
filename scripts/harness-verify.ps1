# harness-stock: true
# One-exit-code harness verify. PowerShell 5.1: no &&.
# Reads docs/harness/manifest.json. Writes .harness-last-verify.json only on success.

$ErrorActionPreference = "Continue"
$Root = (Get-Location).Path
$StampPath = Join-Path $Root ".harness-last-verify.json"
$ManifestPath = Join-Path $Root "docs\harness\manifest.json"

function Write-HarnessError {
	param([string]$Message, [int]$Code = 1)
	Write-Error "harness-verify: $Message"
	exit $Code
}

if (Test-Path $StampPath) {
	Remove-Item -Force $StampPath
}

if (-not (Test-Path $ManifestPath)) {
	Write-HarnessError "missing docs/harness/manifest.json"
}

$Manifest = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
$Layer1 = @($Manifest.layer1Commands)
$Layer2 = @($Manifest.layer2Commands)

if ($Layer1.Count -eq 0 -or $Layer2.Count -eq 0) {
	Write-HarnessError "manifest missing layer1Commands or layer2Commands"
}

function Invoke-HarnessLayer {
	param([string]$Label, [object[]]$Commands)
	foreach ($Command in $Commands) {
		if (-not $Command) {
			Write-HarnessError "invalid command in layer $Label"
		}
		Write-Host "harness-verify layer ${Label}: $Command"
		cmd.exe /c $Command
		if ($LASTEXITCODE -ne 0) {
			Write-HarnessError "layer $Label failed ($LASTEXITCODE)" $LASTEXITCODE
		}
	}
}

Invoke-HarnessLayer -Label "1" -Commands $Layer1
Invoke-HarnessLayer -Label "2" -Commands $Layer2

if ($Manifest.layer3Status -eq "present" -and $Manifest.layer3Command) {
	Invoke-HarnessLayer -Label "3" -Commands @($Manifest.layer3Command)
} else {
	Write-Host "harness-verify: layer 3 skipped (missing)"
}

$Stamp = @{
	exitCode = 0
	at = [DateTime]::UtcNow.ToString("o")
	command = $Manifest.verifyCommand
}
$Stamp | ConvertTo-Json | Set-Content -Path $StampPath -Encoding UTF8
exit 0
