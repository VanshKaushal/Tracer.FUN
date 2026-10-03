param(
    [int]$DurationSeconds = 60,
    [string]$Output = (Join-Path $PSScriptRoot '..\test-results\collector-performance.csv')
)
$ErrorActionPreference = 'Stop'
if ($DurationSeconds -lt 5) { throw 'Use at least five seconds of sampling.' }
$collectorProcess = Get-Process -Name trace-agent | Select-Object -First 1
if (-not $collectorProcess) { throw 'Launch Trace and choose your tracking preferences before measuring.' }
$outputPath = [IO.Path]::GetFullPath($Output)
[IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($outputPath)) | Out-Null
$processorCount = [Environment]::ProcessorCount
$previousCpu = $collectorProcess.TotalProcessorTime.TotalSeconds
$stopwatch = [Diagnostics.Stopwatch]::StartNew()
$previousElapsed = 0.0
$sampleCount = 0
$totalMachineCpu = 0.0
$peakWorkingSet = 0.0
$peakPrivateMemory = 0.0
while ($stopwatch.Elapsed.TotalSeconds -lt $DurationSeconds) {
    Start-Sleep -Seconds 1
    $collectorProcess.Refresh()
    if ($collectorProcess.HasExited) { throw 'The collector exited during measurement.' }
    $elapsed = $stopwatch.Elapsed.TotalSeconds
    $cpu = $collectorProcess.TotalProcessorTime.TotalSeconds
    $singleCorePercent = 100 * ($cpu - $previousCpu) / ($elapsed - $previousElapsed)
    $sample = [pscustomobject]@{
        timestamp = (Get-Date).ToString('o')
        cpu_percent_of_machine = [math]::Round($singleCorePercent / $processorCount, 4)
        cpu_percent_of_one_core = [math]::Round($singleCorePercent, 4)
        working_set_mib = [math]::Round($collectorProcess.WorkingSet64 / 1MB, 3)
        private_memory_mib = [math]::Round($collectorProcess.PrivateMemorySize64 / 1MB, 3)
    }
    if ($sampleCount -eq 0) { $sample | Export-Csv -LiteralPath $outputPath -NoTypeInformation }
    else { $sample | Export-Csv -LiteralPath $outputPath -NoTypeInformation -Append }
    $sampleCount++
    $totalMachineCpu += $sample.cpu_percent_of_machine
    $peakWorkingSet = [math]::Max($peakWorkingSet, $sample.working_set_mib)
    $peakPrivateMemory = [math]::Max($peakPrivateMemory, $sample.private_memory_mib)
    $previousCpu = $cpu
    $previousElapsed = $elapsed
}
[pscustomobject]@{
    samples = $sampleCount
    average_cpu_percent_of_machine = [math]::Round($totalMachineCpu / $sampleCount, 4)
    peak_working_set_mib = $peakWorkingSet
    peak_private_memory_mib = $peakPrivateMemory
}
Write-Output "Saved measurements to $outputPath"
