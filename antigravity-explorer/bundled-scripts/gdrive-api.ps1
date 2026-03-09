<#
.SYNOPSIS
    Google Drive REST API v3 module for Antigravity Memory Sync.
.DESCRIPTION
    Provides OAuth2 authentication (Desktop App flow with localhost redirect)
    and file operations (list, upload, download, create folder, sync) against
    Google Drive via REST API. No Google Drive for Desktop required.

    Usage: dot-source this file, then call the exported functions.
    . .\scripts\gdrive-api.ps1
#>

# ─── OAuth2 Credentials ─────────────────────────────────────
# Loaded from credentials.json (gitignored). See credentials.example.json for format.
$script:CREDENTIALS_FILE = Join-Path $PSScriptRoot '..\credentials.json'
if (Test-Path $script:CREDENTIALS_FILE) {
    $creds = Get-Content $script:CREDENTIALS_FILE -Raw | ConvertFrom-Json
    $script:CLIENT_ID = $creds.client_id
    $script:CLIENT_SECRET = $creds.client_secret
}
else {
    $script:CLIENT_ID = $env:GDRIVE_CLIENT_ID
    $script:CLIENT_SECRET = $env:GDRIVE_CLIENT_SECRET
}
$script:REDIRECT_URI = 'http://localhost:8580'
$script:SCOPE = 'https://www.googleapis.com/auth/drive.file'
$script:AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
$script:TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
$script:DRIVE_API = 'https://www.googleapis.com/drive/v3'
$script:UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'

# ─── Token Cache ────────────────────────────────────────────────
$script:AccessToken = $null
$script:TokenExpiry = [datetime]::MinValue

# ─── Retry Helper (exponential backoff for transient errors) ────
function Invoke-WithRetry {
    <#
    .SYNOPSIS
        Retries a script block on transient network errors with exponential backoff.
    #>
    param(
        [scriptblock]$ScriptBlock,
        [int]$MaxRetries = 3,
        [int]$BaseDelaySeconds = 2,
        [string]$Operation = 'API call'
    )
    $attempt = 0
    while ($true) {
        try {
            $attempt++
            return (& $ScriptBlock)
        }
        catch {
            $errMsg = $_.Exception.Message
            $isTransient = ($errMsg -match 'transient|transmit|timeout|503|429|reset|connection' -or
                $_.Exception.InnerException -match 'transient|transmit|timeout|reset|connection')
            if ($isTransient -and $attempt -le $MaxRetries) {
                $delay = $BaseDelaySeconds * [Math]::Pow(2, $attempt - 1)
                Write-Host "    ⏳ $Operation failed (attempt $attempt/$MaxRetries): $($errMsg.Substring(0, [Math]::Min(80, $errMsg.Length)))..." -ForegroundColor Yellow
                Write-Host "    ⏳ Retrying in ${delay}s..." -ForegroundColor Yellow
                Start-Sleep -Seconds $delay
            }
            else {
                throw
            }
        }
    }
}

# ─── OAuth2 Authorization (one-time, browser-based) ─────────────

function Invoke-GDriveAuth {
    <#
    .SYNOPSIS
        Perform OAuth2 authorization flow. Opens browser, listens on localhost.
        Returns: @{ access_token, refresh_token, expires_in }
    #>
    param([int]$Port = 8580)

    $redirectUri = "http://localhost:$Port"
    $state = [guid]::NewGuid().ToString('N')

    # Build authorization URL
    $authUrl = "$($script:AUTH_ENDPOINT)?" + (@(
            "client_id=$($script:CLIENT_ID)",
            "redirect_uri=$([uri]::EscapeDataString($redirectUri))",
            "response_type=code",
            "scope=$([uri]::EscapeDataString($script:SCOPE))",
            "access_type=offline",
            "prompt=consent",
            "state=$state"
        ) -join '&')

    # Start HTTP listener
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("$redirectUri/")
    $listener.Start()

    Write-Host ""
    Write-Host "  🌐 Opening browser for Google authorization..." -ForegroundColor Cyan
    Write-Host "     (If the browser doesn't open, visit this URL manually)" -ForegroundColor Gray
    Write-Host ""
    Start-Process $authUrl

    # Wait for the redirect callback
    Write-Host "  ⏳ Waiting for authorization..." -ForegroundColor Yellow
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    # Extract authorization code from query string
    $query = [System.Web.HttpUtility]::ParseQueryString($request.Url.Query)
    $code = $query['code']
    $returnedState = $query['state']
    $error_param = $query['error']

    if ($error_param) {
        # Return error page
        $html = "<html><body><h2>❌ Authorization failed: $error_param</h2><p>You can close this window.</p></body></html>"
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
        $response.ContentType = 'text/html; charset=utf-8'
        $response.OutputStream.Write($buffer, 0, $buffer.Length)
        $response.Close()
        $listener.Stop()
        throw "OAuth authorization failed: $error_param"
    }

    if ($returnedState -ne $state) {
        $listener.Stop()
        throw "OAuth state mismatch — possible CSRF attack"
    }

    # Return success page
    $html = @"
<html><body style="font-family: sans-serif; text-align: center; padding: 50px;">
<h2>✅ Authorization successful!</h2>
<p>You can close this window and return to PowerShell.</p>
<script>setTimeout(() => window.close(), 3000);</script>
</body></html>
"@
    $buffer = [System.Text.Encoding]::UTF8.GetBytes($html)
    $response.ContentType = 'text/html; charset=utf-8'
    $response.OutputStream.Write($buffer, 0, $buffer.Length)
    $response.Close()
    $listener.Stop()

    # Exchange authorization code for tokens
    Write-Host "  🔑 Exchanging code for tokens..." -ForegroundColor Cyan
    $tokenBody = @{
        client_id     = $script:CLIENT_ID
        client_secret = $script:CLIENT_SECRET
        code          = $code
        redirect_uri  = $redirectUri
        grant_type    = 'authorization_code'
    }

    $tokenResp = Invoke-RestMethod -Uri $script:TOKEN_ENDPOINT -Method Post -Body $tokenBody -ContentType 'application/x-www-form-urlencoded'

    # Cache access token
    $script:AccessToken = $tokenResp.access_token
    $script:TokenExpiry = (Get-Date).AddSeconds($tokenResp.expires_in - 60)

    Write-Host "  ✅ Authorization complete!" -ForegroundColor Green
    return $tokenResp
}

# ─── Token Refresh ──────────────────────────────────────────────

function Get-GDriveToken {
    <#
    .SYNOPSIS
        Get a valid access token. Refreshes if expired.
    .PARAMETER RefreshToken
        The refresh_token from initial authorization.
    #>
    param([string]$RefreshToken)

    if ($script:AccessToken -and (Get-Date) -lt $script:TokenExpiry) {
        return $script:AccessToken
    }

    $body = @{
        client_id     = $script:CLIENT_ID
        client_secret = $script:CLIENT_SECRET
        refresh_token = $RefreshToken
        grant_type    = 'refresh_token'
    }

    $resp = Invoke-RestMethod -Uri $script:TOKEN_ENDPOINT -Method Post -Body $body -ContentType 'application/x-www-form-urlencoded'
    $script:AccessToken = $resp.access_token
    $script:TokenExpiry = (Get-Date).AddSeconds($resp.expires_in - 60)
    return $script:AccessToken
}

# ─── Drive API: Folder Operations ───────────────────────────────

function Find-GDriveFolder {
    <#
    .SYNOPSIS  Find a folder by name under a parent folder.
    .RETURNS   Folder ID or $null.
    #>
    param(
        [string]$Token,
        [string]$ParentId = 'root',
        [string]$Name
    )
    $q = [uri]::EscapeDataString("name='$Name' and '$ParentId' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
    $url = "$($script:DRIVE_API)/files?q=$q&fields=files(id,name)&pageSize=1"
    $headers = @{ Authorization = "Bearer $Token" }
    $resp = Invoke-RestMethod -Uri $url -Headers $headers
    if ($resp.files -and $resp.files.Count -gt 0) { return $resp.files[0].id }
    return $null
}

function New-GDriveFolder {
    <#
    .SYNOPSIS  Create a folder under a parent.
    .RETURNS   New folder ID.
    #>
    param(
        [string]$Token,
        [string]$ParentId = 'root',
        [string]$Name
    )
    $headers = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }
    $body = @{
        name     = $Name
        mimeType = 'application/vnd.google-apps.folder'
        parents  = @($ParentId)
    } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$($script:DRIVE_API)/files" -Method Post -Headers $headers -Body $body
    return $resp.id
}

function Get-OrCreateFolder {
    <#
    .SYNOPSIS  Find or create a folder chain. Returns final folder ID.
    #>
    param(
        [string]$Token,
        [string]$ParentId = 'root',
        [string[]]$PathParts
    )
    $currentParent = $ParentId
    foreach ($part in $PathParts) {
        $folderId = Find-GDriveFolder -Token $Token -ParentId $currentParent -Name $part
        if (-not $folderId) {
            $folderId = New-GDriveFolder -Token $Token -ParentId $currentParent -Name $part
            Write-Host "    📁 Created folder: $part" -ForegroundColor Green
        }
        $currentParent = $folderId
    }
    return $currentParent
}

# ─── Drive API: File Operations ─────────────────────────────────

function Get-GDriveFileList {
    <#
    .SYNOPSIS  List files in a folder (non-recursive, non-folder items).
    #>
    param(
        [string]$Token,
        [string]$FolderId
    )
    $q = [uri]::EscapeDataString("'$FolderId' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'")
    $url = "$($script:DRIVE_API)/files?q=$q&fields=files(id,name,modifiedTime,size,mimeType)&pageSize=1000"
    $headers = @{ Authorization = "Bearer $Token" }
    $resp = Invoke-RestMethod -Uri $url -Headers $headers
    return $resp.files
}

function Get-GDriveFolderList {
    <#
    .SYNOPSIS  List sub-folders in a folder.
    #>
    param(
        [string]$Token,
        [string]$FolderId
    )
    $q = [uri]::EscapeDataString("'$FolderId' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'")
    $url = "$($script:DRIVE_API)/files?q=$q&fields=files(id,name)&pageSize=1000"
    $headers = @{ Authorization = "Bearer $Token" }
    $resp = Invoke-RestMethod -Uri $url -Headers $headers
    return $resp.files
}

function Get-GDriveAllItems {
    <#
    .SYNOPSIS  List ALL items (files + folders) in a single API call. Returns @{ Files; Folders }.
    #>
    param(
        [string]$Token,
        [string]$FolderId
    )
    $q = [uri]::EscapeDataString("'$FolderId' in parents and trashed=false")
    $url = "$($script:DRIVE_API)/files?q=$q&fields=files(id,name,modifiedTime,size,mimeType)&pageSize=1000"
    $headers = @{ Authorization = "Bearer $Token" }
    $resp = Invoke-RestMethod -Uri $url -Headers $headers
    $all = if ($resp.files) { $resp.files } else { @() }
    $folderMime = 'application/vnd.google-apps.folder'
    return @{
        Files   = @($all | Where-Object { $_.mimeType -ne $folderMime })
        Folders = @($all | Where-Object { $_.mimeType -eq $folderMime })
    }
}

function Send-GDriveFile {
    <#
    .SYNOPSIS  Upload or update a single file to Google Drive.
    .PARAMETER ExistingFileId
        If provided, skip the existence check and directly update this file. Saves 1 API call.
    #>
    param(
        [string]$Token,
        [string]$FolderId,
        [string]$LocalPath,
        [string]$ExistingFileId = ''
    )
    $fileName = Split-Path -Leaf $LocalPath
    $fileBytes = [System.IO.File]::ReadAllBytes($LocalPath)
    $headers = @{ Authorization = "Bearer $Token" }

    # Determine file ID (skip query if already known)
    $fileId = $ExistingFileId
    if (-not $fileId) {
        $q = [uri]::EscapeDataString("name='$fileName' and '$FolderId' in parents and trashed=false")
        $existing = Invoke-RestMethod -Uri "$($script:DRIVE_API)/files?q=$q&fields=files(id)&pageSize=1" -Headers $headers
        if ($existing.files -and $existing.files.Count -gt 0) {
            $fileId = $existing.files[0].id
        }
    }

    if ($fileId) {
        # Update existing file (with retry)
        $url = "$($script:UPLOAD_API)/files/${fileId}?uploadType=media"
        Invoke-WithRetry -Operation "Upload $fileName" -ScriptBlock {
            Invoke-RestMethod -Uri $url -Method Patch -Headers $headers -Body $fileBytes -ContentType 'application/octet-stream' | Out-Null
        }
    }
    else {
        # Create new file — build binary multipart body (avoids base64 bloat)
        $boundary = [guid]::NewGuid().ToString('N')
        $metadata = @{ name = $fileName; parents = @($FolderId) } | ConvertTo-Json -Compress

        # Build binary multipart body to avoid base64 inflation (+33% size)
        $enc = [System.Text.Encoding]::UTF8
        $nl = $enc.GetBytes("`r`n")
        $ms = [System.IO.MemoryStream]::new()
        $ms.Write($enc.GetBytes("--$boundary`r`nContent-Type: application/json; charset=UTF-8`r`n`r`n$metadata`r`n--$boundary`r`nContent-Type: application/octet-stream`r`n`r`n"), 0, $enc.GetByteCount("--$boundary`r`nContent-Type: application/json; charset=UTF-8`r`n`r`n$metadata`r`n--$boundary`r`nContent-Type: application/octet-stream`r`n`r`n"))
        $ms.Write($fileBytes, 0, $fileBytes.Length)
        $ms.Write($enc.GetBytes("`r`n--$boundary--"), 0, $enc.GetByteCount("`r`n--$boundary--"))
        $bodyBytes = $ms.ToArray()
        $ms.Dispose()

        $uploadHeaders = @{
            Authorization  = "Bearer $Token"
            'Content-Type' = "multipart/related; boundary=$boundary"
        }
        Invoke-WithRetry -Operation "Create $fileName" -ScriptBlock {
            Invoke-RestMethod -Uri "$($script:UPLOAD_API)/files?uploadType=multipart" -Method Post -Headers $uploadHeaders -Body $bodyBytes | Out-Null
        }
    }
}

function Receive-GDriveFile {
    <#
    .SYNOPSIS  Download a file from Google Drive to a local path.
    #>
    param(
        [string]$Token,
        [string]$FileId,
        [string]$LocalPath
    )
    $headers = @{ Authorization = "Bearer $Token" }
    $url = "$($script:DRIVE_API)/files/${FileId}?alt=media"
    $fileName = Split-Path -Leaf $LocalPath
    Invoke-WithRetry -Operation "Download $fileName" -ScriptBlock {
        Invoke-RestMethod -Uri $url -Headers $headers -OutFile $LocalPath
    }
}

function Remove-GDriveFile {
    <#
    .SYNOPSIS  Delete a file from Google Drive.
    #>
    param(
        [string]$Token,
        [string]$FileId
    )
    $headers = @{ Authorization = "Bearer $Token" }
    Invoke-RestMethod -Uri "$($script:DRIVE_API)/files/${FileId}" -Method Delete -Headers $headers | Out-Null
}

# ─── Sync Logic ─────────────────────────────────────────────────

function Sync-GDriveFolder {
    <#
    .SYNOPSIS
        Bidirectional sync with conflict detection between local and Google Drive.
    .PARAMETER ConflictStrategy
        'newer-wins' (default) = keep newer, backup older as .conflict
        'keep-both' = keep both versions with .conflict suffix
    .PARAMETER Manifest
        Hashtable of file hashes from last sync for conflict detection.
    .PARAMETER MachineId
        Unique machine identifier for conflict backup filenames.
    #>
    param(
        [string]$Token,
        [string]$DriveFolderId,
        [string]$LocalPath,
        [ValidateSet('export', 'import', 'both')]
        [string]$Direction = 'both',
        [ValidateSet('newer-wins', 'keep-both')]
        [string]$ConflictStrategy = 'newer-wins',
        [hashtable]$Manifest = @{},
        [string]$MachineId = '',
        [string]$ManifestBasePath = '',
        [string[]]$IgnorePatterns = @(),
        [switch]$DryRun,
        [string]$Indent = '  ',
        [switch]$Recursive
    )

    if (-not (Test-Path $LocalPath)) { New-Item -ItemType Directory -Path $LocalPath -Force | Out-Null }

    # Get remote items in a SINGLE API call (optimization: 1 call instead of 2)
    $remoteItems = Get-GDriveAllItems -Token $Token -FolderId $DriveFolderId
    $remoteFiles = $remoteItems.Files
    $remoteFolders = $remoteItems.Folders
    if (-not $remoteFolders) { $remoteFolders = @() }

    $localFiles = Get-ChildItem -Path $LocalPath -File -ErrorAction SilentlyContinue
    if (-not $localFiles) { $localFiles = @() }

    # Build lookup maps
    $remoteMap = @{}
    foreach ($rf in $remoteFiles) { $remoteMap[$rf.name] = $rf }
    $localMap = @{}
    foreach ($lf in $localFiles) { $localMap[$lf.Name] = $lf }

    $uploaded = 0; $downloaded = 0; $skipped = 0; $conflicts = 0; $ignored = 0

    # ── Helper: check if file/dir should be ignored ───────────
    function Test-SyncIgnored($name, $relativePath) {
        foreach ($pattern in $IgnorePatterns) {
            # Directory pattern (ends with /)
            if ($pattern.EndsWith('/') -and $name -eq $pattern.TrimEnd('/')) { return $true }
            # Glob match on filename
            if ($name -like $pattern) { return $true }
            # Glob match on relative path
            if ($relativePath -and $relativePath -like $pattern) { return $true }
        }
        return $false
    }

    # ── Helper: get relative path for manifest key ────────────
    function Get-ManifestKey($filePath) {
        if ($ManifestBasePath) {
            return $filePath.Replace($ManifestBasePath, '').TrimStart('\', '/').Replace('\', '/')
        }
        return (Split-Path -Leaf $filePath)
    }

    # ── Helper: detect conflict (uses manifest to avoid unnecessary hash) ──
    function Test-Conflict($localFile, $remoteFile) {
        if (-not $localFile -or -not $remoteFile) { return $false }

        $key = Get-ManifestKey $localFile.FullName
        $lastHash = $Manifest[$key]

        if (-not $lastHash) { return $false }

        # Compute local hash only when needed (lazy)
        $localHash = (Get-FileHash -Path $localFile.FullName -Algorithm SHA256).Hash
        if ($localHash -eq $lastHash) { return $false }  # Unchanged

        # Local changed — check if remote also changed
        $remoteTime = [datetime]::Parse($remoteFile.modifiedTime)
        $timeDiff = [Math]::Abs(($localFile.LastWriteTimeUtc - $remoteTime.ToUniversalTime()).TotalSeconds)
        return ($timeDiff -gt 5)
    }

    # ── Helper: handle conflict ───────────────────────────────
    function Resolve-Conflict($localFile, $remoteFile, $action) {
        $timestamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
        $suffix = ".conflict.$MachineId.$timestamp"
        $logPath = Join-Path (Split-Path $LocalPath) "sync-conflicts.log"

        if ($ConflictStrategy -eq 'keep-both') {
            # Keep both versions
            if ($action -eq 'upload') {
                $backupName = "$($localFile.Name)$suffix"
                $backupPath = Join-Path $LocalPath $backupName
                Copy-Item $localFile.FullName $backupPath -Force
                Write-Host "$Indent  ⚠️  Conflict (keep-both): $($localFile.Name)" -ForegroundColor Magenta
            }
        }
        else {
            # newer-wins: backup the loser
            $remoteTime = [datetime]::Parse($remoteFile.modifiedTime).ToUniversalTime()
            $localTime = $localFile.LastWriteTimeUtc

            if ($action -eq 'download' -and $localTime -gt [datetime]::MinValue) {
                # Remote wins, backup local
                $backupPath = Join-Path $LocalPath "$($localFile.Name)$suffix"
                Copy-Item $localFile.FullName $backupPath -Force
                Write-Host "$Indent  ⚠️  Conflict: $($localFile.Name) — 保留較新版，本地備份為 $($localFile.Name)$suffix" -ForegroundColor Magenta
            }
        }

        # Log conflict
        $logEntry = "[$(Get-Date -Format 'o')] CONFLICT: $($localFile.Name) | Machine: $MachineId | Strategy: $ConflictStrategy"
        Add-Content -Path $logPath -Value $logEntry -ErrorAction SilentlyContinue
        $script:conflictCount++
    }

    $script:conflictCount = 0

    # ── Export: Local → Drive ──────────────────────────────────
    if ($Direction -eq 'export' -or $Direction -eq 'both') {
        foreach ($lf in $localFiles) {
            # Check syncignore
            $relPath = Get-ManifestKey $lf.FullName
            if (Test-SyncIgnored $lf.Name $relPath) {
                $ignored++
                continue
            }

            $rf = $remoteMap[$lf.Name]
            $shouldUpload = $false
            $isConflict = $false

            if (-not $rf) {
                $shouldUpload = $true
            }
            else {
                # Check for conflict first
                if ($Direction -eq 'both' -and (Test-Conflict $lf $rf)) {
                    $isConflict = $true
                    $remoteTime = [datetime]::Parse($rf.modifiedTime).ToUniversalTime()
                    if ($lf.LastWriteTimeUtc -gt $remoteTime) {
                        $shouldUpload = $true
                    }
                }
                else {
                    # Quick skip: if manifest hash matches, file unchanged — skip entirely
                    $key = Get-ManifestKey $lf.FullName
                    $lastHash = $Manifest[$key]
                    if ($lastHash) {
                        $currentHash = (Get-FileHash -Path $lf.FullName -Algorithm SHA256).Hash
                        if ($currentHash -eq $lastHash) {
                            $skipped++
                            continue  # Fast path: no change since last sync
                        }
                    }
                    $remoteTime = [datetime]::Parse($rf.modifiedTime)
                    if ($lf.LastWriteTimeUtc -gt $remoteTime.ToUniversalTime().AddSeconds(5)) {
                        $shouldUpload = $true
                    }
                }
            }

            if ($shouldUpload) {
                if ($DryRun) {
                    $conflictTag = if ($isConflict) { " ⚠️CONFLICT" } else { "" }
                    Write-Host "$Indent  ⬆️  [DRY] Upload: $($lf.Name)$conflictTag" -ForegroundColor Yellow
                }
                else {
                    if ($isConflict) { Resolve-Conflict $lf $rf 'upload' }
                    Write-Host "$Indent  ⬆️  Upload: $($lf.Name)" -ForegroundColor Cyan
                    # Pass existing file ID to avoid redundant existence query
                    $existingId = if ($rf) { $rf.id } else { '' }
                    Send-GDriveFile -Token $Token -FolderId $DriveFolderId -LocalPath $lf.FullName -ExistingFileId $existingId
                }
                $uploaded++
                if ($isConflict) { $conflicts++ }

                # Update manifest
                $key = Get-ManifestKey $lf.FullName
                $Manifest[$key] = (Get-FileHash -Path $lf.FullName -Algorithm SHA256).Hash
            }
            else {
                $skipped++
            }
        }
    }

    # ── Import: Drive → Local ──────────────────────────────────
    if ($Direction -eq 'import' -or $Direction -eq 'both') {
        foreach ($rf in $remoteFiles) {
            $lf = $localMap[$rf.name]
            $shouldDownload = $false
            $isConflict = $false

            if (-not $lf) {
                $shouldDownload = $true
            }
            else {
                if ($Direction -eq 'both' -and (Test-Conflict $lf $rf)) {
                    $isConflict = $true
                    $remoteTime = [datetime]::Parse($rf.modifiedTime).ToUniversalTime()
                    if ($remoteTime -gt $lf.LastWriteTimeUtc) {
                        $shouldDownload = $true  # Remote is newer
                    }
                }
                else {
                    $remoteTime = [datetime]::Parse($rf.modifiedTime)
                    if ($remoteTime.ToUniversalTime() -gt $lf.LastWriteTimeUtc.AddSeconds(5)) {
                        $shouldDownload = $true
                    }
                }
            }

            if ($shouldDownload) {
                $destPath = Join-Path $LocalPath $rf.name
                if ($DryRun) {
                    $conflictTag = if ($isConflict) { " ⚠️CONFLICT" } else { "" }
                    Write-Host "$Indent  ⬇️  [DRY] Download: $($rf.name)$conflictTag" -ForegroundColor Yellow
                }
                else {
                    if ($isConflict -and $lf) { Resolve-Conflict $lf $rf 'download' }
                    Write-Host "$Indent  ⬇️  Download: $($rf.name)" -ForegroundColor Cyan
                    Receive-GDriveFile -Token $Token -FileId $rf.id -LocalPath $destPath
                }
                $downloaded++
                if ($isConflict) { $conflicts++ }

                # Update manifest after download
                if (-not $DryRun -and (Test-Path $destPath)) {
                    $key = Get-ManifestKey $destPath
                    $Manifest[$key] = (Get-FileHash -Path $destPath -Algorithm SHA256).Hash
                }
            }
            else {
                $skipped++
                # Still update manifest hash for unchanged files
                if ($lf) {
                    $key = Get-ManifestKey $lf.FullName
                    if (-not $Manifest[$key]) {
                        $Manifest[$key] = (Get-FileHash -Path $lf.FullName -Algorithm SHA256).Hash
                    }
                }
            }
        }
    }

    # ── Recursive: process subdirectories ──────────────────────
    if ($Recursive) {
        $localDirs = Get-ChildItem -Path $LocalPath -Directory -ErrorAction SilentlyContinue
        if (-not $localDirs) { $localDirs = @() }

        if ($Direction -eq 'export' -or $Direction -eq 'both') {
            foreach ($ld in $localDirs) {
                if ($ld.Name.StartsWith('.')) { continue }
                # Check syncignore for directories
                if (Test-SyncIgnored ($ld.Name + '/') '') { 
                    $ignored++
                    continue 
                }

                $matchingRemote = $remoteFolders | Where-Object { $_.name -eq $ld.Name }
                $subFolderId = if ($matchingRemote) { $matchingRemote.id } else {
                    if ($DryRun) {
                        Write-Host "$Indent  📁 [DRY] Create folder: $($ld.Name)" -ForegroundColor Yellow
                        $null
                    }
                    else {
                        New-GDriveFolder -Token $Token -ParentId $DriveFolderId -Name $ld.Name
                    }
                }
                if ($subFolderId) {
                    Write-Host "$Indent  📂 $($ld.Name)/" -ForegroundColor Gray
                    $subResult = Sync-GDriveFolder -Token $Token -DriveFolderId $subFolderId -LocalPath $ld.FullName `
                        -Direction $Direction -ConflictStrategy $ConflictStrategy -Manifest $Manifest `
                        -MachineId $MachineId -ManifestBasePath $ManifestBasePath `
                        -IgnorePatterns $IgnorePatterns `
                        -DryRun:$DryRun -Indent "$Indent  " -Recursive
                    $uploaded += $subResult.Uploaded
                    $downloaded += $subResult.Downloaded
                    $skipped += $subResult.Skipped
                    $conflicts += $subResult.Conflicts
                }
            }
        }

        if ($Direction -eq 'import' -or $Direction -eq 'both') {
            foreach ($rf in $remoteFolders) {
                $localDir = Join-Path $LocalPath $rf.name
                if (-not (Test-Path $localDir)) {
                    if ($DryRun) {
                        Write-Host "$Indent  📁 [DRY] Create local: $($rf.name)/" -ForegroundColor Yellow
                    }
                    else {
                        New-Item -ItemType Directory -Path $localDir -Force | Out-Null
                    }
                }
                Write-Host "$Indent  📂 $($rf.name)/" -ForegroundColor Gray
                $subResult = Sync-GDriveFolder -Token $Token -DriveFolderId $rf.id -LocalPath $localDir `
                    -Direction $Direction -ConflictStrategy $ConflictStrategy -Manifest $Manifest `
                    -MachineId $MachineId -ManifestBasePath $ManifestBasePath `
                    -IgnorePatterns $IgnorePatterns `
                    -DryRun:$DryRun -Indent "$Indent  " -Recursive
                $uploaded += $subResult.Uploaded
                $downloaded += $subResult.Downloaded
                $skipped += $subResult.Skipped
                $conflicts += $subResult.Conflicts
            }
        }
    }

    return @{ Uploaded = $uploaded; Downloaded = $downloaded; Skipped = $skipped; Conflicts = $conflicts; Ignored = $ignored }
}
