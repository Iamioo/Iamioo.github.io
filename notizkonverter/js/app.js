import { PAGE, setOrientation, drawPage } from './page.js';
import { readNoteFile } from './import.js';
import { vectorize, placeOnPage } from './vectorize.js';
import { buildPdf } from './pdf.js';
import { buildGoodnotes } from './formats/goodnotes.js';
import { buildNotabilityFile, notePackageName } from './formats/notability.js';
import { canvasBlob } from './formats/zip.js';

const $ = (id) => document.getElementById(id);

// GoodNotes zeigt PDF-Punkte 11/6-fach (132 ppi / 72), darum ist seine Papier-PDF kleiner als das Blatt.
const GOODNOTES_PDF_SCALE = 6 / 11;

const state = {
  note: null,   // { title, kind, pages, warnings }
  image: null,  // { title, quer, items: [{ name, img, data, bg }], pages }
};

/* ---------- Ansicht ---------- */

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + t.dataset.view));
}));

function setupDrop(dropId, inputId, onFiles) {
  const drop = $(dropId), input = $(inputId);
  input.addEventListener('change', () => { if (input.files.length) onFiles([...input.files]); input.value = ''; });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    if (e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
  });
}

function renderPages(container, pages, { ghost = null } = {}) {
  container.innerHTML = '';
  pages.forEach((page, i) => {
    const fig = document.createElement('figure');
    const c = document.createElement('canvas');
    const scale = 440 / PAGE.w;
    c.width = Math.round(PAGE.w * scale);
    c.height = Math.round(PAGE.h * scale);
    const ctx = c.getContext('2d');
    drawPage(ctx, ghost?.[i] ? { strokes: [], bg: ghost[i] } : { strokes: [], bg: page.bg }, scale);
    if (ghost?.[i]) { ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(0, 0, c.width, c.height); }
    drawPage(ctx, { strokes: page.strokes }, scale, true);
    fig.append(c);
    const cap = document.createElement('figcaption');
    cap.textContent = `Seite ${i + 1} · ${page.strokes.length} Striche`;
    fig.append(cap);
    container.append(fig);
  });
}

/* ---------- Notiz umwandeln ---------- */

setupDrop('note-drop', 'note-file', async ([file]) => {
  try {
    setOrientation(false);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await readNoteFile(bytes);
    state.note = res;
    const strokes = res.pages.reduce((s, p) => s + p.strokes.length, 0);
    $('note-title').textContent = res.title;
    $('note-stats').textContent = `${res.kind === 'goodnotes' ? 'GoodNotes-Notizbuch' : 'Notability-Notiz'} · ${res.pages.length} ${res.pages.length === 1 ? 'Seite' : 'Seiten'} · ${strokes} Striche`;
    $('note-warnings').innerHTML = '';
    for (const w of res.warnings) {
      const li = document.createElement('li');
      li.textContent = w;
      $('note-warnings').append(li);
    }
    // Das jeweils andere Format hervorheben
    document.querySelectorAll('[data-src="note"]').forEach((b) => {
      b.classList.toggle('suggested', b.dataset.export === (res.kind === 'goodnotes' ? 'notability' : 'goodnotes'));
    });
    $('note-result').hidden = false;
    renderPages($('note-pages'), res.pages);
  } catch (err) {
    console.error(err);
    alert('Die Datei konnte nicht gelesen werden: ' + (err.message || err));
  }
});

/* ---------- Bild zu Notiz ---------- */

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(`${file.name} ist kein lesbares Bild.`));
    img.src = url;
  });
}

// Bild verkleinern und als Pixel lesen; zusätzlich JPEG für den Hintergrund
async function prepareImage(file, maxSide) {
  const img = await loadImage(file);
  const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  // Hintergrund-JPEG: Transparenz auf Weiß
  const bk = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const bc = document.createElement('canvas');
  bc.width = Math.round(img.naturalWidth * bk); bc.height = Math.round(img.naturalHeight * bk);
  const bctx = bc.getContext('2d');
  bctx.fillStyle = '#fff';
  bctx.fillRect(0, 0, bc.width, bc.height);
  bctx.drawImage(img, 0, 0, bc.width, bc.height);
  const jpeg = new Uint8Array(await (await canvasBlob(bc, 'image/jpeg', 0.85)).arrayBuffer());
  return { name: file.name, img, data, bg: { img, jpeg, pw: bc.width, ph: bc.height } };
}

let imageFiles = [];
let busy = false, again = false;

async function processImages() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      const maxSide = Number($('opt-detail').value);
      $('img-stats').textContent = 'Bilder werden gelesen …';
      const items = [];
      for (const f of imageFiles) items.push(await prepareImage(f, maxSide));
      const quer = items.filter((it) => it.data.width > it.data.height).length > items.length / 2;
      setOrientation(quer);
      const opts = {
        sensitivity: Number($('opt-sens').value),
        keepColors: $('opt-colors').checked,
        widthScale: Number($('opt-width').value),
      };
      const pages = [];
      for (let i = 0; i < items.length; i++) {
        $('img-stats').textContent = `Striche werden erkannt (Bild ${i + 1} von ${items.length}) …`;
        await new Promise((r) => setTimeout(r, 20));
        const it = items[i];
        const { strokes } = vectorize(it.data, opts);
        const placed = placeOnPage(strokes, it.data.width, it.data.height, PAGE);
        it.bg.rect = placed.rect;
        pages.push({ strokes: placed.strokes });
      }
      const base = (imageFiles[0]?.name || 'Zeichnung').replace(/\.[^.]+$/, '');
      state.image = { title: imageFiles.length > 1 ? `${base} und ${imageFiles.length - 1} weitere` : base, quer, items, pages };
      const total = pages.reduce((s, p) => s + p.strokes.length, 0);
      $('img-stats').textContent = `${pages.length} ${pages.length === 1 ? 'Seite' : 'Seiten'} · ${total} Striche erkannt${quer ? ' · Querformat' : ''}`;
      redrawImages();
    } while (again);
  } catch (err) {
    console.error(err);
    $('img-stats').textContent = '';
    alert('Fehler beim Umwandeln: ' + (err.message || err));
  } finally {
    busy = false;
  }
}

// Seiten für Vorschau und Export: mit oder ohne Hintergrundbild
function imagePages() {
  const keepBg = $('opt-bg').checked;
  return state.image.pages.map((p, i) => ({ strokes: p.strokes, bg: keepBg ? state.image.items[i].bg : undefined }));
}

function redrawImages() {
  if (!state.image) return;
  setOrientation(state.image.quer);
  const ghost = $('opt-ghost').checked && !$('opt-bg').checked ? state.image.items.map((it) => it.bg) : null;
  renderPages($('img-pages'), imagePages(), { ghost });
}

setupDrop('img-drop', 'img-file', (files) => {
  imageFiles = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|heic|webp|gif|bmp)$/i.test(f.name));
  if (!imageFiles.length) { alert('Bitte Bilddateien wählen (PNG, JPG, HEIC).'); return; }
  $('img-result').hidden = false;
  processImages();
});

let timer = 0;
const later = () => { clearTimeout(timer); timer = setTimeout(() => imageFiles.length && processImages(), 250); };
['opt-sens', 'opt-width', 'opt-detail', 'opt-colors'].forEach((id) => $(id).addEventListener('input', later));
['opt-bg', 'opt-ghost'].forEach((id) => $(id).addEventListener('change', redrawImages));

/* ---------- Export ---------- */

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}

// Auf dem iPad über das Teilen-Menü, dann lässt sich die Datei direkt in GoodNotes oder Notability öffnen.
async function deliver(blob, name) {
  const isTablet = navigator.maxTouchPoints > 1 && /Mac|iPad|iPhone/.test(navigator.userAgent);
  if (isTablet && navigator.canShare) {
    const file = new File([blob], name, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
  }
  download(blob, name);
}

async function thumbnail(page, type) {
  const c = document.createElement('canvas');
  const scale = 640 / PAGE.w;
  c.width = Math.round(PAGE.w * scale);
  c.height = Math.round(PAGE.h * scale);
  drawPage(c.getContext('2d'), page, scale);
  return new Uint8Array(await (await canvasBlob(c, type, 0.85)).arrayBuffer());
}

const safeFileName = (s) => (s || 'Notiz').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 60) || 'Notiz';

async function exportAs(kind, src) {
  const data = src === 'note' ? state.note : state.image;
  if (!data) return;
  setOrientation(src === 'image' ? data.quer : false);
  const pages = src === 'note' ? data.pages : imagePages();
  const title = data.title || 'Notiz';
  const hasBg = pages.some((p) => p.bg);
  const buttons = document.querySelectorAll(`[data-src="${src}"]`);
  buttons.forEach((b) => { b.disabled = true; });
  try {
    if (kind === 'goodnotes') {
      const paperPdf = hasBg
        ? pages.map((p) => buildPdf([{ strokes: [], bg: p.bg }], { title: 'Papier', scale: GOODNOTES_PDF_SCALE }))
        : buildPdf([{ strokes: [] }], { title: 'Papier', scale: GOODNOTES_PDF_SCALE });
      const bytes = buildGoodnotes(pages, {
        title,
        paperPdf,
        paperName: 'Notizkonverter',
        thumbnailJpg: await thumbnail(pages[0], 'image/jpeg'),
      });
      await deliver(new Blob([bytes], { type: 'application/octet-stream' }), `${safeFileName(title)}.goodnotes`);
    } else if (kind === 'notability') {
      const pdfBytes = buildPdf(pages.map((p) => ({ strokes: [], bg: p.bg })), { title: 'Papier' });
      const bytes = await buildNotabilityFile(pages, { name: title, thumbnailPng: await thumbnail(pages[0], 'image/png'), pdfBytes });
      await deliver(new Blob([bytes], { type: 'application/octet-stream' }), `${notePackageName(title)}.note`);
    } else {
      const bytes = buildPdf(pages, { title });
      await deliver(new Blob([bytes], { type: 'application/pdf' }), `${safeFileName(title)}.pdf`);
    }
  } catch (err) {
    console.error(err);
    alert('Export fehlgeschlagen: ' + (err.message || err));
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => exportAs(b.dataset.export, b.dataset.src)));
