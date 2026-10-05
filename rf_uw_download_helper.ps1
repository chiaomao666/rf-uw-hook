param(
    [switch]$ChooseFolder
)

# RF UW Download Helper
# 本機下載服務：讓 GitHub Pages 可委派下載工作，避開瀏覽器跨網域讀取限制。
$ErrorActionPreference = 'Stop'
$Port = 17642
$AllowedOrigin = 'https://chiaomao666.github.io'
$SettingsDirectory = Join-Path $env:LOCALAPPDATA 'rf-uw-hook'
$SettingsPath = Join-Path $SettingsDirectory 'download-helper.json'

Add-Type -AssemblyName System.Windows.Forms

function Select-DownloadRoot {
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '選擇圖資下載根資料夾（assets/passionfruit）'
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        throw '尚未選擇下載資料夾。'
    }
    return $dialog.SelectedPath
}

function Read-DownloadRoot {
    if (-not $ChooseFolder -and (Test-Path -LiteralPath $SettingsPath)) {
        try {
            $saved = Get-Content -Raw -LiteralPath $SettingsPath | ConvertFrom-Json
            if ($saved.root -and (Test-Path -LiteralPath $saved.root)) { return [string]$saved.root }
        } catch {}
    }

    $root = Select-DownloadRoot
    New-Item -ItemType Directory -Force -Path $SettingsDirectory | Out-Null
    @{ root = $root } | ConvertTo-Json | Set-Content -Encoding UTF8 -LiteralPath $SettingsPath
    return $root
}

function Add-CorsHeaders($Response) {
    $Response.Headers['Access-Control-Allow-Origin'] = $AllowedOrigin
    $Response.Headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    $Response.Headers['Access-Control-Allow-Headers'] = 'Content-Type'
    $Response.Headers['Access-Control-Allow-Private-Network'] = 'true'
    $Response.Headers['Vary'] = 'Origin, Access-Control-Request-Private-Network'
}

function Send-Json($Context, $Body, [int]$StatusCode = 200) {
    $json = $Body | ConvertTo-Json -Depth 6 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($json)
    $Context.Response.StatusCode = $StatusCode
    $Context.Response.ContentType = 'application/json; charset=utf-8'
    $Context.Response.ContentLength64 = $bytes.Length
    $Context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Context.Response.Close()
}

function Get-SafePathParts([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw '缺少檔案路徑。' }
    $parts = $Path -replace '\\', '/' -split '/' | Where-Object { $_ }
    if ($parts.Count -eq 0 -or $parts | Where-Object { $_ -eq '.' -or $_ -eq '..' -or $_ -match '[:*?"<>|]' }) {
        throw '不安全的檔案路徑。'
    }
    return $parts
}

$DownloadRoot = Read-DownloadRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://127.0.0.1:$Port/")

try {
    $listener.Start()
} catch {
    Write-Error "無法啟動本機下載小幫手：$($_.Exception.Message)"
    Write-Host '若已有另一個小幫手視窗正在執行，請直接保留原視窗即可。'
    Read-Host '按 Enter 關閉'
    exit 1
}

Write-Host 'RF UW Download Helper 已啟動。請保持此視窗開啟。' -ForegroundColor Green
Write-Host "下載位置：$DownloadRoot"
Write-Host "網站連線：http://127.0.0.1:$Port/status"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        Add-CorsHeaders $context.Response

        if ($request.HttpMethod -eq 'OPTIONS') {
            $context.Response.StatusCode = 204
            $context.Response.Close()
            continue
        }

        if ($request.Headers['Origin'] -and $request.Headers['Origin'] -ne $AllowedOrigin) {
            Send-Json $context @{ error = '來源不被允許。' } 403
            continue
        }

        if ($request.HttpMethod -eq 'GET' -and $request.Url.AbsolutePath -eq '/status') {
            Send-Json $context @{ ready = $true; rootName = (Split-Path -Leaf $DownloadRoot) }
            continue
        }

        if ($request.HttpMethod -ne 'POST' -or $request.Url.AbsolutePath -ne '/download') {
            Send-Json $context @{ error = '找不到此功能。' } 404
            continue
        }

        try {
            $reader = New-Object IO.StreamReader($request.InputStream, $request.ContentEncoding)
            $payload = $reader.ReadToEnd() | ConvertFrom-Json
            $items = @($payload.assets)
            if ($items.Count -eq 0) { throw '沒有可下載的項目。' }

            $success = 0
            $failed = @()
            foreach ($item in $items) {
                try {
                    $parts = Get-SafePathParts ([string]$item.path)
                    $uri = [Uri][string]$item.url
                    if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'media.komisureiya.com') {
                        throw '網址不在允許的圖資主機。'
                    }
                    $destination = $DownloadRoot
                    foreach ($part in $parts) { $destination = Join-Path $destination $part }
                    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $destination) | Out-Null
                    Invoke-WebRequest -Uri $uri -OutFile $destination -UseBasicParsing -ErrorAction Stop
                    $success++
                    Write-Host "[$success/$($items.Count)] $($item.path)" -ForegroundColor Green
                } catch {
                    $failed += [string]$item.path
                    Write-Warning "下載失敗：$($item.path) — $($_.Exception.Message)"
                }
            }
            Send-Json $context @{ success = $success; failed = $failed; total = $items.Count }
        } catch {
            Send-Json $context @{ error = $_.Exception.Message } 400
        }
    }
} finally {
    if ($listener.IsListening) { $listener.Stop() }
    $listener.Close()
}
