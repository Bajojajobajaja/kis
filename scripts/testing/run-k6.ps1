param(
    [ValidateSet('search', 'writeoffs', 'reports', 'all')]
    [string]$Scenario = 'all'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
    Write-Error 'k6 is not installed or not available in PATH.'
}

$scripts = @()

switch ($Scenario) {
    'search' {
        $scripts += 'tests/performance/k6/search.js'
    }
    'writeoffs' {
        $scripts += 'tests/performance/k6/writeoffs.js'
    }
    'reports' {
        $scripts += 'tests/performance/k6/reports.js'
    }
    'all' {
        $scripts += 'tests/performance/k6/search.js'
        $scripts += 'tests/performance/k6/writeoffs.js'
        $scripts += 'tests/performance/k6/reports.js'
    }
}

foreach ($script in $scripts) {
    Write-Host "Running $script"
    k6 run $script
}
