# Notizkonverter

Web-App zum Umwandeln von Notizen zwischen Notability und GoodNotes. Außerdem macht sie aus Bildern und PNGs bearbeitbare Striche, die du in GoodNotes oder Notability weiterzeichnen, radieren und verschieben kannst.

Alles läuft im Browser. Deine Dateien werden nirgends hochgeladen.

Seite: https://iamioo.github.io/notizkonverter/

## Was die App kann

1. Notability-Notiz (`.note`) in ein GoodNotes-Notizbuch (`.goodnotes`) umwandeln und umgekehrt. Striche behalten Farbe, Breite, Druck und Deckkraft (Textmarker).
2. Bilder (PNG, JPG, HEIC) in Striche zerlegen. Jedes Bild wird eine Seite. Empfindlichkeit, Strichstärke und Genauigkeit lassen sich einstellen, das Originalbild kann als Hintergrund bleiben.
3. Beides zusätzlich als PDF ausgeben.

Auf dem iPad öffnet der Export das Teilen-Menü. Dort direkt GoodNotes oder Notability wählen.

## Grenzen

Beide Formate sind nicht offiziell dokumentiert. Die Schreiber stammen aus dem Projekt [Handschrift](https://github.com/Iamioo/handschrift) und sind mit GoodNotes 6 und Notability 16 getestet.

Beim Umwandeln von Notizen fehlen noch PDF-Hintergründe, eingefügte Bilder, getippter Text und Audioaufnahmen. In GoodNotes gezeichnete Formen werden übersprungen.

Die Bilderkennung ist für Strichzeichnungen gedacht. Ausgemalte Flächen werden zu Mittellinien.

## Lokal starten

```
python -m http.server 8765
```

Dann http://localhost:8765 öffnen.

## Aufbau

| Datei | Aufgabe |
|-------|---------|
| `js/app.js` | Oberfläche und Export |
| `js/import.js` | liest `.note` und `.goodnotes` |
| `js/vectorize.js` | Bild zu Strichen |
| `js/pdf.js` | PDF-Schreiber |
| `js/formats/` | ZIP, Plist, Protobuf, Schreiber für beide Formate |
| `docs/dateiformate.md` | Aufbau der Formate und Vorgehen |

## Lizenz

MIT
