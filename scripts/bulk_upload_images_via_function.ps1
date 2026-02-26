$ErrorActionPreference = 'Stop'
$base = 'c:\Users\ebrat\OneDrive\SoftUni\AI VibeCoding\Exercise Databases and Supabase\Map tracking tourism TKX\Images'
$fnUrl = 'https://djbwtrfxzcvyenahhxpy.supabase.co/functions/v1/upload-image-file'
$jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRqYnd0cmZ4emN2eWVuYWhoeHB5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NjM0MTQsImV4cCI6MjA4NzQzOTQxNH0.cBpIM3-DvTx3EGkQ2_9dwMkVUoovgRc7WJw8ewHJqkQ'
$folders = @('Belmeken 12.08.2023','Polejan 17.08.2024','Sinanica 02.08.2025')

function Get-ContentType([string]$name) {
  $ext = [System.IO.Path]::GetExtension($name).ToLowerInvariant()
  switch ($ext) {
    '.jpg' { return 'image/jpeg' }
    '.jpeg' { return 'image/jpeg' }
    '.png' { return 'image/png' }
    '.webp' { return 'image/webp' }
    default { return 'application/octet-stream' }
  }
}

$total = 0
foreach ($folder in $folders) {
  $folderPath = Join-Path $base $folder
  Get-ChildItem -Path $folderPath -File | ForEach-Object {
    $storagePath = "public/$folder/$($_.Name)"
    $contentType = Get-ContentType $_.Name
    $bytes = [System.IO.File]::ReadAllBytes($_.FullName)
    $base64 = [System.Convert]::ToBase64String($bytes)
    $payload = @{ path = $storagePath; base64 = $base64; contentType = $contentType } | ConvertTo-Json -Compress
    Write-Host "Uploading: $storagePath"
    Invoke-RestMethod -Method Post -Uri $fnUrl -Headers @{ Authorization = "Bearer $jwt"; apikey = $jwt; 'Content-Type'='application/json' } -Body $payload | Out-Null
    $total++
  }
}
Write-Host "Upload finished. Files: $total"
