param([string]$DocPath)
Add-Type -AssemblyName System.IO.Compression.FileSystem

$path = $DocPath
try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
    $entry = $zip.Entries | Where-Object { $_.FullName -eq "word/document.xml" }
    
    if ($entry) {
        $stream = $entry.Open()
        $reader = New-Object System.IO.StreamReader($stream)
        $xmlStr = $reader.ReadToEnd()
        $reader.Close()
    }
    
    $zip.Dispose()
    
    if ($xmlStr) {
        $xmlStr = $xmlStr -replace '<w:p ', "`n<w:p "
        $xmlStr = $xmlStr -replace '<w:t[^>]*>', "" -replace '</w:t>', "" -replace '<[^>]+>', ""
        Write-Output $xmlStr
    }
} catch {
    Write-Error $_.Exception.Message
}
