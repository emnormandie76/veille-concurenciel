<#
.SYNOPSIS
  Lance l'application sur le poste : le backend FastAPI dans sa propre
  fenêtre, puis le Next.js de développement dans celle-ci.

.DESCRIPTION
  npm run local. Plan backend-local, étape 6 (docs/features/backend-local.md).
  Le backend n'est plus hébergé : l'admin le lance à la main sur son poste,
  quand il veut chercher ou traiter les contributions.

  1. Refuse si le port 8000 est déjà pris : un second backend ferait un second
     TavilyKeyManager, et deux comptabilités de crédits qui s'ignorent.
  2. Démarre le backend dans sa propre fenêtre : fermer Next.js ne doit pas
     tuer une passe en cours. La fenêtre reste ouverte quand le backend
     s'arrête, pour qu'on y lise son erreur.
  3. Attend /health jusqu'à 60 s, puis affiche les erreurs de démarrage
     (startup_errors) s'il y en a.
  4. Lance npm run dev, sauf si Next.js tourne déjà sur le port 3000 : l'écran
     /admin/cron cite cette commande quand le backend ne répond pas, alors que
     Next.js tourne.

  Le backend n'écoute que sur 127.0.0.1, jamais sur toutes les interfaces :
  sur le réseau de l'établissement, l'API interne et /docs deviendraient
  joignables par les autres postes (architecture.md §10.6).

  Lancer le backend peut payer : le traitement des contributions part dès le
  démarrage et appelle Tavily et Gemma s'il trouve des tickets Pending_AI. Le
  démarrage écrit aussi dans la base (reprise et purge des jobs).
#>

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root 'backend\.venv\Scripts\python.exe'
$BackendHost = '127.0.0.1'
$BackendPort = 8000
# Les arguments de `npm run backend` (package.json), à l'identique :
# test/local-launcher.test.ts vérifie que les deux disent la même chose.
$UvicornArgs = '-m uvicorn backend.main:app --host 127.0.0.1 --port 8000'
$HealthUrl = "http://${BackendHost}:${BackendPort}/health"
$HealthTimeoutSeconds = 60
$NextPort = 3000

function Write-Step([string]$Message) {
    Write-Host "[local] $Message" -ForegroundColor Cyan
}

function Stop-Launcher([string]$Message) {
    Write-Host ''
    Write-Host "[local] $Message" -ForegroundColor Red
    exit 1
}

# Le processus qui écoute sur ce port (« python (PID 1234) »), ou $null.
function Get-PortOwner([int]$Port) {
    try {
        $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
            Select-Object -First 1
        $process = Get-Process -Id $listener.OwningProcess -ErrorAction Stop
        return "$($process.ProcessName) (PID $($process.Id))"
    } catch {
        return $null
    }
}

# Vrai si une connexion à 127.0.0.1:$Port aboutit : repli quand
# Get-NetTCPConnection ne dit rien.
function Test-PortAnswers([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $attempt = $client.BeginConnect($BackendHost, $Port, $null, $null)
        if (-not $attempt.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($attempt)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

# Le corps de /health, ou $null tant que le backend ne répond pas. Sans proxy :
# celui de l'établissement n'a pas à voir passer une requête vers 127.0.0.1.
function Get-BackendHealth {
    try {
        $request = [System.Net.WebRequest]::Create($HealthUrl)
        $request.Proxy = $null
        $request.Timeout = 2000
        $response = $request.GetResponse()
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [System.Text.Encoding]::UTF8)
            return ($reader.ReadToEnd() | ConvertFrom-Json)
        } finally {
            $response.Close()
        }
    } catch {
        return $null
    }
}

# Le bilan du démarrage, d'après /health : prêt, ou ses startup_errors.
function Write-HealthReport($Health) {
    if ($null -eq $Health) {
        Write-Host ("[local] Le backend n'a pas répondu en $HealthTimeoutSeconds s. Il démarre peut-être encore " +
            "(réveil de la base) : voyez sa fenêtre. /admin/cron le verra dès qu'il répondra.") -ForegroundColor Yellow
    } elseif ($Health.status -eq 'ok') {
        Write-Host "[local] Backend prêt (version $($Health.version))." -ForegroundColor Green
    } else {
        Write-Host "[local] Backend démarré avec des erreurs (état : $($Health.status)) :" -ForegroundColor Red
        if ($Health.PSObject.Properties['errors']) {
            foreach ($message in @($Health.errors)) {
                Write-Host "[local]   - $message" -ForegroundColor Red
            }
        }
        Write-Host '[local] Elles s''affichent aussi en rouge dans /admin/cron.' -ForegroundColor Red
    }
}

# Vrai tant que l'interpréteur tourne dans la fenêtre du backend. Le python.exe
# du venv est un lanceur : il vit aussi longtemps que l'interpréteur réel.
function Test-BackendAlive([System.Diagnostics.Process]$Window) {
    if ($Window.HasExited) { return $false }
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($Window.Id) AND Name = 'python.exe'" -ErrorAction SilentlyContinue)
    return $children.Count -gt 0
}

Set-Location $Root

# ── 1. Un seul backend à la fois ─────────────────────────────────────
$owner = Get-PortOwner $BackendPort
if ($owner -or (Test-PortAnswers $BackendPort)) {
    if (-not $owner) { $owner = 'un autre programme' }
    Stop-Launcher ("Le port $BackendPort est déjà pris par $owner. Un backend tourne peut-être déjà : " +
        "un second ferait un second TavilyKeyManager, et deux comptabilités de crédits qui s'ignorent.`n" +
        "[local] S'il s'agit du backend lancé plus tôt, gardez sa fenêtre ; si Next.js est arrêté, lancez seulement npm run dev.`n" +
        "[local] Sinon, arrêtez ce programme, puis relancez npm run local.")
}

if (-not (Test-Path $Python)) {
    Stop-Launcher ("Interpréteur introuvable : backend\.venv\Scripts\python.exe. Créez l'environnement " +
        "(README, Démarrage rapide) : python -m venv backend/.venv, puis pip install -r backend/requirements-dev.txt.")
}

# ── 2. Le backend, dans sa propre fenêtre ────────────────────────────
Write-Step "Démarrage du backend FastAPI sur ${BackendHost}:${BackendPort}, dans une nouvelle fenêtre."
Write-Step 'Le traitement des contributions part dès le démarrage : des tickets Pending_AI appellent Tavily et Gemma.'
# cmd /k garde la fenêtre ouverte quand le backend s'arrête, pour qu'on y lise
# son erreur. Ctrl+C dans cette fenêtre arrête le backend ; la fermer aussi.
$window = Start-Process -FilePath $env:ComSpec -WorkingDirectory $Root -PassThru `
    -ArgumentList "/k title Backend FastAPI - appVC & `"$Python`" $UvicornArgs"

# ── 3. Attendre /health ──────────────────────────────────────────────
Write-Step "Attente de $HealthUrl (jusqu'à $HealthTimeoutSeconds s)..."
$started = Get-Date
$health = $null
while ($true) {
    # Le test du port d'abord : sous Windows, une connexion refusée sur
    # 127.0.0.1 met 2 s à échouer, contre 0,5 s ici.
    if (Test-PortAnswers $BackendPort) {
        $health = Get-BackendHealth
        if ($null -ne $health) { break }
    }
    $elapsed = ((Get-Date) - $started).TotalSeconds
    if ($window.HasExited) {
        Stop-Launcher "La fenêtre du backend a été fermée avant qu'il réponde. Next.js n'est pas lancé."
    }
    if ($elapsed -gt 3 -and -not (Test-BackendAlive $window)) {
        Stop-Launcher ("Le backend s'est arrêté au démarrage : lisez l'erreur dans sa fenêtre, corrigez, " +
            "puis relancez npm run local. Next.js n'est pas lancé.")
    }
    if ($elapsed -ge $HealthTimeoutSeconds) { break }
    Start-Sleep -Milliseconds 500
}

Write-HealthReport $health

# ── 4. Next.js ───────────────────────────────────────────────────────
$nextOwner = Get-PortOwner $NextPort
if ($nextOwner) {
    Write-Step ("Next.js tourne déjà sur le port $NextPort ($nextOwner) : il n'est pas relancé. " +
        'Rechargez /admin/cron : le backend y apparaît.')
    exit 0
}
Write-Step "Next.js sur http://localhost:$NextPort (back-office : /admin). Ctrl+C l'arrête ; le backend continue dans sa fenêtre."
& npm.cmd run dev
exit $LASTEXITCODE
