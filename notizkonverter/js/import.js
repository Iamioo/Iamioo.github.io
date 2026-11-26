// Liest Notability-Notizen (.note) und GoodNotes-Notizbücher (.goodnotes) in ein gemeinsames Modell:
// { title, pages: [{ strokes: [{ pts: [[x, y, druck]], w, c, a }] }], warnings: [] }
// Koordinaten im Blattmaß von PAGE (page.js). Aufbau der Formate siehe docs/dateiformate.md.
import { readZip, readBplist, keyedArchive, readPb, pbGet, pbStr, readDelimited, appleLz4Decode, readStrokeTpl } from './formats/readers.js';
import { PAGE, pressureFromFactor } from './page.js';

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);

export async function readNoteFile(bytes) {
  if (bytes[0] === 0x25 && bytes[1] === 0x50) throw new Error('Das ist eine PDF. Bitte die Notiz als .note (Notability) oder .goodnotes exportieren.');
  const files = readZip(bytes);
  if (files.has('index.events.pb')) return { kind: 'goodnotes', ...(await readGoodnotes(files)) };
  if ([...files.keys()].some((n) => n.endsWith('/Session.plist'))) return { kind: 'notability', ...(await readNotability(files)) };
  throw new Error('Unbekanntes Dateiformat. Erwartet wird eine .note- oder .goodnotes-Datei.');
}

/* ---------- Notability ---------- */

// Seitenverhältnis der Notability-Papiergrößen (Höhe / Breite)
const NB_PAPER_RATIO = { letter: 792 / 612, a4: 841.89 / 595.28, a5: 595.28 / 419.53, legal: 1008 / 612 };

async function readNotability(files) {
  const warnings = [];
  const names = [...files.keys()];
  const sessionName = names.find((n) => n.endsWith('/Session.plist'));
  const folder = sessionName.slice(0, -'Session.plist'.length);
  const { R, root } = keyedArchive(readBplist(await files.get(sessionName)()));
  let title = R(root.name) || folder.replace(/\/$/, '') || 'Notiz';
  const metaName = folder + 'metadata.plist';
  if (files.has(metaName)) {
    try { const m = keyedArchive(readBplist(await files.get(metaName)())); title = m.R(m.root.noteName) || title; } catch { /* egal */ }
  }

  const rich = R(root.richText);
  const overlay = R(rich?.['Handwriting Overlay']);
  const sh = overlay ? R(overlay.SpatialHash) : null;

  // Blattbreite in Notability-Einheiten
  let docW = Number(R(R(rich?.reflowState)?.pageWidthInDocumentCoordsKey)) || 0;
  const paper = R(R(root.NBNoteTakingSessionDocumentPaperLayoutModelKey)?.documentPaperAttributes);
  const sizing = String(R(paper?.paperSizingBehavior) || '');
  const locked = sizing.match(/lockedWidth:([\d.]+)/);
  if (!docW && locked) docW = parseFloat(locked[1]);
  if (!docW) docW = 567;
  const ratio = NB_PAPER_RATIO[String(R(paper?.paperSize) || 'letter').toLowerCase()] || NB_PAPER_RATIO.letter;
  const docPageH = docW * ratio;
  // So skalieren, dass eine Notability-Seite ganz auf ein Blatt passt
  const k = Math.min(PAGE.w / docW, PAGE.h / docPageH);

  if (names.some((n) => /\/PDFs\/.+\.pdf$/i.test(n))) warnings.push('Die Notiz enthält eine PDF. Übernommen werden nur deine Striche, der PDF-Hintergrund noch nicht.');
  if (names.some((n) => /\/Images\/./.test(n))) warnings.push('Eingefügte Bilder werden noch nicht übernommen.');
  const typed = R(R(rich?.attributedString)?.['NS.objects']?.[0]);
  if (typeof typed === 'string' && typed.trim()) warnings.push('Getippter Text wird nicht übernommen.');

  const pages = [];
  if (!sh) return { title, pages: [{ strokes: [] }], warnings: warnings.concat('Keine Handschrift in dieser Notiz gefunden.') };

  const view = (d, T) => (d instanceof Uint8Array ? new T(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new T(0));
  const counts = view(R(sh.curvesnumpoints), Int32Array);
  const pts = view(R(sh.curvespoints), Float32Array);
  const widths = view(R(sh.curveswidth), Float32Array);
  const colors = R(sh.curvescolors) || new Uint8Array(0);
  const frac = view(R(sh.curvesfractionalwidths), Float32Array);

  let o = 0, fo = 0;
  counts.forEach((c, i) => {
    const P = [];
    for (let j = 0; j < c; j++) P.push([pts[(o + j) * 2], pts[(o + j) * 2 + 1]]);
    o += c;
    const segs = Math.max(0, Math.floor((c - 1) / 3));
    const knotP = (s) => (frac.length > fo + s ? pressureFromFactor(frac[fo + s]) : 0.5);
    const poly = P.length ? [[P[0][0], P[0][1], knotP(0)]] : [];
    for (let s = 0; s < segs; s++) {
      const [p0, p1, p2, p3] = [P[s * 3], P[s * 3 + 1], P[s * 3 + 2], P[s * 3 + 3]];
      const pa = knotP(s), pb = knotP(s + 1);
      for (let u = 0.25; u <= 1.001; u += 0.25) {
        const a = (1 - u) ** 3, b = 3 * (1 - u) ** 2 * u, cc = 3 * (1 - u) * u * u, d = u ** 3;
        poly.push([a * p0[0] + b * p1[0] + cc * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + cc * p2[1] + d * p3[1], pa + (pb - pa) * u]);
      }
    }
    fo += segs + 1;
    if (!poly.length) return;
    const midY = poly.reduce((s, p) => s + p[1], 0) / poly.length;
    const pi = Math.max(0, Math.floor(midY / docPageH));
    while (pages.length <= pi) pages.push({ strokes: [] });
    const col = colors.length >= i * 4 + 4 ? colors.subarray(i * 4, i * 4 + 4) : [0, 0, 0, 255];
    pages[pi].strokes.push({
      pts: poly.map(([x, y, p]) => [x * k, (y - pi * docPageH) * k, p]),
      w: (widths[i] || 1) * k,
      c: toHex(col[0], col[1], col[2]),
      a: Math.round((col[3] / 255) * 100) / 100,
    });
  });
  if (!pages.length) pages.push({ strokes: [] });
  return { title, pages, warnings };
}

/* ---------- GoodNotes ---------- */

function uuidPlusOne(u) {
  const h = (BigInt('0x' + u.replace(/-/g, '')) + 1n).toString(16).toUpperCase().padStart(32, '0');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const TPL_STROKE = 'vuA(v)A(S(uu))A(S(uuuu))vA(f)';

async function readGoodnotes(files) {
  const warnings = [];
  const get = (name) => files.get(name)?.();
  const templates = new Map(), pages = new Map();
  let title = 'Notizbuch';
  for (const rec of readDelimited((await get('index.events.pb')) || new Uint8Array(0))) {
    let top;
    try { top = readPb(rec); } catch { continue; }
    for (const [f, v] of top) {
      if (!(v instanceof Uint8Array) || f === 1) continue;
      let m;
      try { m = readPb(v); } catch { continue; }
      if (f === 30) {
        const t = pbGet(m, 2);
        if (t instanceof Uint8Array) { try { title = pbStr(pbGet(readPb(t), 1)) || title; } catch { /* egal */ } }
      } else if (f === 2) {
        const size = pbGet(m, 8);
        const t = { id: pbStr(pbGet(m, 2)) };
        if (size instanceof Uint8Array) { const s = readPb(size); t.w = pbGet(s, 1); t.h = pbGet(s, 2); }
        if (t.id) templates.set(t.id, { ...(templates.get(t.id) || {}), ...Object.fromEntries(Object.entries(t).filter(([, x]) => x !== undefined)) });
      } else if (f === 54) {
        const id = pbStr(pbGet(m, 2));
        if (!id) continue;
        const prev = pages.get(id) || { id };
        const tpl = pbGet(m, 3), ord = pbGet(m, 4);
        if (tpl instanceof Uint8Array) prev.template = pbStr(pbGet(readPb(tpl), 1));
        if (ord instanceof Uint8Array) prev.order = pbStr(pbGet(readPb(ord), 1));
        pages.set(id, prev);
      }
    }
  }
  const pageList = [...pages.values()].sort((a, b) => String(a.order || '').localeCompare(String(b.order || '')));
  const notesIds = readDelimited((await get('index.notes.pb')) || new Uint8Array(0))
    .map((r) => { try { return pbStr(pbGet(readPb(r), 1)); } catch { return null; } }).filter(Boolean);
  if ([...files.keys()].some((n) => n.startsWith('attachments/'))) warnings.push('Papier und PDF-Hintergründe aus GoodNotes werden nicht übernommen, nur die Striche.');

  const out = [];
  let skipped = 0;
  const count = pageList.length || notesIds.length;
  for (let i = 0; i < count; i++) {
    const p = pageList[i];
    let notesId = null;
    if (p && notesIds.includes(uuidPlusOne(p.id))) notesId = uuidPlusOne(p.id);
    else if (p && notesIds.includes(p.id)) notesId = p.id;
    else notesId = notesIds[i];
    const t = (p && templates.get(p.template)) || {};
    const k = Math.min(PAGE.w / (t.w || PAGE.w), PAGE.h / (t.h || PAGE.h));
    const strokes = new Map();
    const deleted = new Set();
    const notes = notesId ? await get('notes/' + notesId) : null;
    for (const rec of readDelimited(notes || new Uint8Array(0))) {
      let top;
      try { top = readPb(rec); } catch { continue; }
      const body = pbGet(top, 7);
      if (!(body instanceof Uint8Array)) {
        // Kopf: Feld 3 = 1 heißt gelöscht
        const id = pbStr(pbGet(top, 1));
        if (id && pbGet(top, 3) === 1) deleted.add(id);
        continue;
      }
      let m;
      try { m = readPb(body); } catch { continue; }
      const id = pbStr(pbGet(m, 1)) || 's' + strokes.size;
      if (pbGet(m, 14) === 1) { strokes.set(id, null); continue; }
      const blob = pbGet(m, 2);
      if (!(blob instanceof Uint8Array) || !blob.length) { strokes.set(id, null); continue; }
      let st;
      try {
        const raw = appleLz4Decode(blob);
        const fmt = new TextDecoder().decode(raw.subarray(8, raw.indexOf(0, 8)));
        if (fmt !== TPL_STROKE) { skipped++; continue; }
        st = readStrokeTpl(raw);
      } catch { skipped++; continue; }
      let c = '#000000', a = 1;
      const col = pbGet(m, 4);
      if (col instanceof Uint8Array) {
        const cf = readPb(col);
        c = toHex((pbGet(cf, 1) ?? 0) * 255, (pbGet(cf, 2) ?? 0) * 255, (pbGet(cf, 3) ?? 0) * 255);
        a = Math.round((pbGet(cf, 4) ?? 1) * 100) / 100;
      }
      strokes.set(id, st.points.length ? { pts: st.points.map(([x, y]) => [x * k, y * k, 0.5]), w: st.width * k, c, a } : null);
    }
    out.push({ strokes: [...strokes.entries()].filter(([id, s]) => s && !deleted.has(id)).map(([, s]) => s) });
  }
  if (skipped) warnings.push(`${skipped} Elemente (Formen, Text oder Bilder) konnten nicht gelesen werden und fehlen.`);
  if (!out.length) out.push({ strokes: [] });
  return { title, pages: out, warnings };
}
