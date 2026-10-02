# AI Media Workflow - one-click start for Windows 10/11 (called by khoidong.bat).
# 1. Uses Node.js 22.12+ if installed, otherwise downloads a portable Node.js 22 LTS into .\runtime\node (no admin rights needed)
# 2. Creates .env from .env.example
# 3. Installs dependencies (first run, or when package-lock.json changes)
# 4. Builds the web interface when the source changed
# 5. Starts the server (the database is created/updated automatically) and opens the browser
# Messages are ASCII on purpose (Windows PowerShell 5.1 reads BOM-less scripts as ANSI).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root

function Say($msg, $color = 'Cyan') { Write-Host $msg -ForegroundColor $color }

function Test-NodeOk([string]$exe) {
    try {
        $v = (& $exe -p "process.versions.node" 2>$null)
        if (-not $v) { return $false }
        $parts = $v.Trim().Split('.')
        $major = [int]$parts[0]; $minor = [int]$parts[1]
        return ($major -gt 22) -or ($major -eq 22 -and $minor -ge 12)
    } catch { return $false }
}

function Get-EnvValue([string]$name, [string]$default) {
    if (Test-Path -LiteralPath '.env') {
        foreach ($line in Get-Content -LiteralPath '.env') {
            if ($line -match "^\s*$name\s*=\s*(.+?)\s*$") { return $Matches[1] }
        }
    }
    return $default
}

function Invoke-Npm([string[]]$npmArgs) {
    & npm.cmd @npmArgs
    if ($LASTEXITCODE -ne 0) { throw "npm $($npmArgs -join ' ') that bai (ma loi $LASTEXITCODE)." }
}

try {
    Say ''
    Say '=== AI Media Workflow ==='
    Say "Thu muc: $Root" 'Gray'

    # ---------- 1. Node.js ----------
    $runtime = Join-Path $Root 'runtime'
    $portable = Join-Path $runtime 'node'
    $portableExe = Join-Path $portable 'node.exe'
    if (Test-NodeOk $portableExe) {
        $env:Path = "$portable;$env:Path"
        Say 'Dung Node.js portable trong thu muc runtime\node' 'Gray'
    } elseif ((Get-Command node.exe -ErrorAction SilentlyContinue) -and (Test-NodeOk 'node.exe')) {
        Say "Dung Node.js da cai tren may: $(& node.exe -v)" 'Gray'
    } else {
        Say 'Chua co Node.js 22.12+ -> dang tai Node.js 22 LTS ban portable (khoang 30 MB, chi lam 1 lan)...' 'Yellow'
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
        $index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -UseBasicParsing
        $ver = ($index | Where-Object { $_.version -like 'v22.*' } | Select-Object -First 1).version
        if (-not $ver) { throw 'Khong lay duoc danh sach phien ban Node.js tu nodejs.org.' }
        $name = "node-$ver-win-$arch"
        New-Item -ItemType Directory -Force -Path $runtime | Out-Null
        $zip = Join-Path $runtime "$name.zip"
        Say "Tai $name.zip ..." 'Gray'
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$ver/$name.zip" -OutFile $zip -UseBasicParsing
        Say 'Giai nen ...' 'Gray'
        if (Test-Path -LiteralPath $portable) { Remove-Item -LiteralPath $portable -Recurse -Force }
        $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
        if ($tar) { & tar.exe -xf $zip -C $runtime; if ($LASTEXITCODE -ne 0) { throw 'Giai nen Node.js that bai.' } }
        else { Expand-Archive -LiteralPath $zip -DestinationPath $runtime -Force }
        Rename-Item -LiteralPath (Join-Path $runtime $name) -NewName 'node'
        Remove-Item -LiteralPath $zip -Force
        if (-not (Test-NodeOk $portableExe)) { throw 'Cai Node.js portable khong thanh cong.' }
        $env:Path = "$portable;$env:Path"
        Say "Da cai Node.js $ver (portable)" 'Green'
    }

    # ---------- 2. .env ----------
    if (-not (Test-Path -LiteralPath '.env') -and (Test-Path -LiteralPath '.env.example')) {
        Copy-Item -LiteralPath '.env.example' -Destination '.env'
        Say 'Da tao file .env (them API key vao day neu muon tao anh/video that).' 'Gray'
    }

    # ---------- 3. Dependencies ----------
    $marker = Join-Path $Root 'node_modules\.amw-install'
    $lockHash = (Get-FileHash -LiteralPath (Join-Path $Root 'package-lock.json') -Algorithm SHA256).Hash
    $installed = if (Test-Path -LiteralPath $marker) { (Get-Content -LiteralPath $marker -Raw).Trim() } else { '' }
    if ($installed -ne $lockHash) {
        Say 'Dang cai thu vien (lan dau mat vai phut, can Internet)...' 'Yellow'
        Invoke-Npm @('install', '--no-audit', '--no-fund')
        Set-Content -LiteralPath $marker -Value $lockHash
        Say 'Cai thu vien xong.' 'Green'
    }

    # ---------- 4. Already running? ----------
    $port = [int](Get-EnvValue 'PORT' '8787')
    $url = "http://127.0.0.1:$port"
    $listening = $null
    try { $listening = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue } catch { }
    if ($listening) {
        Say "Ung dung dang chay roi -> mo $url" 'Green'
        Start-Process $url
        exit 0
    }

    # ---------- 5. Build UI when needed ----------
    $dist = Join-Path $Root 'frontend\dist\index.html'
    $needBuild = -not (Test-Path -LiteralPath $dist)
    if (-not $needBuild) {
        $built = (Get-Item -LiteralPath $dist).LastWriteTimeUtc
        $newer = Get-ChildItem -Recurse -File -Path (Join-Path $Root 'frontend\src'), (Join-Path $Root 'shared\src'), (Join-Path $Root 'frontend\index.html') |
            Where-Object { $_.LastWriteTimeUtc -gt $built } | Select-Object -First 1
        $needBuild = [bool]$newer
    }
    if ($needBuild) {
        Say 'Dang build giao dien...' 'Yellow'
        Invoke-Npm @('run', 'build')
    }

    # ---------- 6. Start ----------
    Say ''
    Say "AI Media Workflow dang chay tai $url" 'Green'
    Say 'Giu cua so nay mo trong khi lam viec. Dong cua so hoac chay dung.bat de tat.' 'Green'
    Say ''
    Start-Process -WindowStyle Hidden -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-Command', "Start-Sleep -Seconds 4; Start-Process '$url'"
    & npm.cmd run start -w backend
    exit $LASTEXITCODE
} catch {
    Say ''
    Say "LOI: $($_.Exception.Message)" 'Red'
    Say 'Goi y: kiem tra ket noi Internet (lan dau can tai Node.js va thu vien), hoac xem HUONG-DAN-CAI-DAT.txt.' 'Yellow'
    exit 1
}
