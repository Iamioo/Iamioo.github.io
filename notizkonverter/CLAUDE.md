# Notizkonverter

Statische Web-App ohne Build-Schritt (ES-Module, kein npm). Lokal starten mit `python -m http.server 8765`.
Veröffentlicht über GitHub Pages aus dem `main`-Branch.

Bei jeder Änderung an JS- oder CSS-Dateien die Versionen `?v=` an Stylesheet und Skript in `index.html` erhöhen. Sonst lädt Safari alte Dateien aus dem Cache.

`js/formats/` stammt aus dem Repo Iamioo/handschrift. Änderungen an den Schreibern dort ebenfalls nachziehen.
Formatbeschreibung in `docs/dateiformate.md`.

## Texte

Für alle Texte (README, Oberfläche, Commit-Nachrichten, Doku) den Skill `deslop` in `.claude/skills/deslop` verwenden:
keine Gedankenstriche (em dash), keine fett beginnenden Aufzählungen, keine Füllphrasen, aktiv formulieren.
Oberflächentexte sind Deutsch.
