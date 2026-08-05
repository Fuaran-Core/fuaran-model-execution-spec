#Requires -Version 7.0
<#
.SYNOPSIS
    Verify the model-execution wire specification's conformance corpus.

.DESCRIPTION
    Drop into this directory, run one command, and the corpus verifies
    itself with no build step and no dependency beyond Node.js:

      1. emit.mjs      — an independent emitter re-derives every
                         round-trip and hash document from unsorted input
                         models and compares the bytes. A divergence is a
                         specification defect, not a bug in either emitter.
      2. validate.mjs  — index integrity, profile partition, JSON Schema
                         structure, and the four rules no schema can
                         express (identity, partition, collision,
                         refusal vocabulary).
      3. --self-test   — both scripts prove they go RED. A conformance
                         suite is exactly the kind of code that passes by
                         doing nothing, so this is not optional (§9.3).

.PARAMETER SkipEmit
    Skip the independent-emitter byte comparison.

.PARAMETER SkipValidate
    Skip the schema and rule checks.

.PARAMETER SkipSelfTest
    Skip the go-red proofs. Do not skip these in CI.

.PARAMETER Write
    Rewrite the round-trip and hash documents from the emitter, and
    refresh the index's DERIVED fields (every vector's sha256, and each
    hash vector's digest and canonical bytes) to match. Use after a
    deliberate specification change, then re-run without this switch:
    the verification pass recomputes all of it independently, so a
    rewrite is never self-certifying. Read the diff before committing —
    a rewrite that moves a digest you did not intend to move is the
    thing this switch is capable of hiding.
#>
[CmdletBinding()]
param(
    [switch] $SkipEmit,
    [switch] $SkipValidate,
    [switch] $SkipSelfTest,
    [switch] $Write
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Node {
    # Resolve node.exe directly rather than relying on a shell shim — the
    # workspace launcher convention, applied to the one external runtime
    # this corpus needs.
    [CmdletBinding()]
    param([Parameter(ValueFromRemainingArguments = $true)] $Arguments)
    $cmd = Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1
    & $cmd.Source @Arguments
    if ($LASTEXITCODE -ne 0) { throw "node $($Arguments -join ' ') exited $LASTEXITCODE" }
}

$fixtures = Join-Path $PSScriptRoot "wire-fixtures"

if ($Write) {
    Write-Host "`n=== rewriting the corpus from the emitter ===" -ForegroundColor Yellow
    Invoke-Node (Join-Path $fixtures "emit.mjs") "--write"
    Write-Host "Documents and index rewritten. Review the diff, then re-run without -Write." -ForegroundColor Yellow
    exit 0
}

if (-not $SkipEmit) {
    Write-Host "`n=== independent emitter: byte comparison ===" -ForegroundColor Cyan
    Invoke-Node (Join-Path $fixtures "emit.mjs")
}

if (-not $SkipValidate) {
    Write-Host "`n=== corpus: index, schema and rule checks ===" -ForegroundColor Cyan
    Invoke-Node (Join-Path $fixtures "validate.mjs")
}

if (-not $SkipSelfTest) {
    Write-Host "`n=== self-test: prove both checkers go red ===" -ForegroundColor Cyan
    if (-not $SkipEmit) { Invoke-Node (Join-Path $fixtures "emit.mjs") "--self-test" }
    if (-not $SkipValidate) { Invoke-Node (Join-Path $fixtures "validate.mjs") "--self-test" }
}

Write-Host "`nCorpus verified." -ForegroundColor Green
