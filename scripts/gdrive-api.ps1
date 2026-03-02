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

function Send-GDriveFile {
    <#
    .SYNOPSIS  Upload or update a single file to Google Drive.
    #>
    param(
        [string]$Token,
        [string]$FolderId,
        [string]$LocalPath
    )
    $fileName = Split-Path -Leaf $LocalPath
    $fileBytes = [System.IO.File]::ReadAllBytes($LocalPath)
    $headers = @{ Authorization = "Bearer $Token" }

    # Check if file already exists
    $q = [uri]::EscapeDataString("name='$fileName' and '$FolderId' in parents and trashed=false")
    $existing = Invoke-RestMethod -Uri "$($script:DRIVE_API)/files?q=$q&fields=files(id)&pageSize=1" -Headers $headers

    if ($existing.files -and $existing.files.Count -gt 0) {
        # Update existing file
        $fileId = $existing.files[0].id
        $url = "$($script:UPLOAD_API)/files/${fileId}?uploadType=media"
        Invoke-RestMethod -Uri $url -Method Patch -Headers $headers -Body $fileBytes -ContentType 'application/octet-stream' | Out-Null
    }
    else {
        # Create new file (multipart upload)
        $boundary = [guid]::NewGuid().ToString('N')
        $metadata = @{ name = $fileName; parents = @($FolderId) } | ConvertTo-Json -Compress
        $bodyLines = @(
            "--$boundary",
            "Content-Type: application/json; charset=UTF-8",
            "",
            $metadata,
            "--$boundary",
            "Content-Type: application/octet-stream",
            "Content-Transfer-Encoding: base64",
            "",
            [System.Convert]::ToBase64String($fileBytes),
            "--$boundary--"
        )
        $bodyStr = $bodyLines -join "`r`n"
        $headers['Content-Type'] = "multipart/related; boundary=$boundary"
        Invoke-RestMethod -Uri "$($script:UPLOAD_API)/files?uploadType=multipart" -Method Post -Headers $headers -Body $bodyStr | Out-Null
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
    Invoke-RestMethod -Uri $url -Headers $headers -OutFile $LocalPath
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
        Bidirectional sync between a local folder and a Google Drive folder.
    .PARAMETER Direction
        'export' = local → Drive, 'import' = Drive → local, 'both' = bidirectional
    .PARAMETER DryRun
        Preview changes without applying.
    #>
    param(
        [string]$Token,
        [string]$DriveFolderId,
        [string]$LocalPath,
        [ValidateSet('export', 'import', 'both')]
        [string]$Direction = 'both',
        [switch]$DryRun,
        [string]$Indent = '  ',
        [switch]$Recursive
    )

    if (-not (Test-Path $LocalPath)) { New-Item -ItemType Directory -Path $LocalPath -Force | Out-Null }

    # Get remote files and folders
    $remoteFiles = Get-GDriveFileList -Token $Token -FolderId $DriveFolderId
    $remoteFolders = Get-GDriveFolderList -Token $Token -FolderId $DriveFolderId
    if (-not $remoteFiles) { $remoteFiles = @() }
    if (-not $remoteFolders) { $remoteFolders = @() }

    # Get local files
    $localFiles = Get-ChildItem -Path $LocalPath -File -ErrorAction SilentlyContinue
    if (-not $localFiles) { $localFiles = @() }

    # Build lookup maps
    $remoteMap = @{}
    foreach ($rf in $remoteFiles) { $remoteMap[$rf.name] = $rf }
    $localMap = @{}
    foreach ($lf in $localFiles) { $localMap[$lf.Name] = $lf }

    $uploaded = 0; $downloaded = 0; $skipped = 0

    # ── Export: Local → Drive ──────────────────────────────────
    if ($Direction -eq 'export' -or $Direction -eq 'both') {
        foreach ($lf in $localFiles) {
            $rf = $remoteMap[$lf.Name]
            $shouldUpload = $false

            if (-not $rf) {
                $shouldUpload = $true  # New file
            }
            else {
                $remoteTime = [datetime]::Parse($rf.modifiedTime)
                if ($lf.LastWriteTimeUtc -gt $remoteTime.ToUniversalTime().AddSeconds(5)) {
                    $shouldUpload = $true  # Local is newer
                }
            }

            if ($shouldUpload) {
                if ($DryRun) {
                    Write-Host "$Indent  ⬆️  [DRY] Upload: $($lf.Name)" -ForegroundColor Yellow
                }
                else {
                    Write-Host "$Indent  ⬆️  Upload: $($lf.Name)" -ForegroundColor Cyan
                    Send-GDriveFile -Token $Token -FolderId $DriveFolderId -LocalPath $lf.FullName
                }
                $uploaded++
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

            if (-not $lf) {
                $shouldDownload = $true  # New file from cloud
            }
            else {
                $remoteTime = [datetime]::Parse($rf.modifiedTime)
                if ($remoteTime.ToUniversalTime() -gt $lf.LastWriteTimeUtc.AddSeconds(5)) {
                    $shouldDownload = $true  # Remote is newer
                }
            }

            if ($shouldDownload) {
                $destPath = Join-Path $LocalPath $rf.name
                if ($DryRun) {
                    Write-Host "$Indent  ⬇️  [DRY] Download: $($rf.name)" -ForegroundColor Yellow
                }
                else {
                    Write-Host "$Indent  ⬇️  Download: $($rf.name)" -ForegroundColor Cyan
                    Receive-GDriveFile -Token $Token -FileId $rf.id -LocalPath $destPath
                }
                $downloaded++
            }
            else {
                $skipped++
            }
        }
    }

    # ── Recursive: process subdirectories ──────────────────────
    if ($Recursive) {
        $localDirs = Get-ChildItem -Path $LocalPath -Directory -ErrorAction SilentlyContinue
        if (-not $localDirs) { $localDirs = @() }

        # Sync local folders → Drive
        if ($Direction -eq 'export' -or $Direction -eq 'both') {
            foreach ($ld in $localDirs) {
                # Skip hidden/system directories
                if ($ld.Name.StartsWith('.')) { continue }

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
                    Sync-GDriveFolder -Token $Token -DriveFolderId $subFolderId -LocalPath $ld.FullName `
                        -Direction $Direction -DryRun:$DryRun -Indent "$Indent  " -Recursive
                }
            }
        }

        # Sync Drive folders → Local
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
                Sync-GDriveFolder -Token $Token -DriveFolderId $rf.id -LocalPath $localDir `
                    -Direction $Direction -DryRun:$DryRun -Indent "$Indent  " -Recursive
            }
        }
    }

    return @{ Uploaded = $uploaded; Downloaded = $downloaded; Skipped = $skipped }
}
