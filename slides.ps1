# html-slides local tool for PowerShell: .\slides add "deck.html" --title "R&D"
# Arguments go straight to Python (no cmd.exe), so characters like & stay intact.
& python -X utf8 (Join-Path $PSScriptRoot "tools\slides.py") @args
exit $LASTEXITCODE
