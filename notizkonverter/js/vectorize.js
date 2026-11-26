// Macht aus einem Bild (Zeichnung, Skizze, Foto einer Seite) einzelne Striche.
// Ablauf: Tinte erkennen -> kleine Flecken entfernen -> Abstandskarte (Strichbreite)
// -> Skelett (Zhang-Suen) -> Skelett in Linien zerlegen -> Linien vereinfachen.
// Arbeitet auf { data, width, height } wie ImageData, damit es auch ohne Browser testbar ist.

// opts.sensitivity 0..1: höher = auch blasse Linien zählen als Tinte
export function inkMask(img, { sensitivity = 0.5 } = {}) {
  const { data, width: W, height: H } = img;
  const N = W * H;
  const dark = new Uint8Array(N);   // 255 - kleinster Farbkanal: erkennt auch Gelb und Hellblau
  let transparent = 0;
  for (let i = 0; i < N; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2], a = data[i * 4 + 3];
    if (a < 200) transparent++;
    // durchsichtige Pixel zählen als weißes Papier
    const m = Math.min(r, g, b);
    dark[i] = Math.round((255 - m) * (a / 255));
  }
  // Örtlicher Mittelwert über ein Integralbild gleicht Schatten und graues Papier aus.
  const rad = Math.max(8, Math.round(Math.min(W, H) / 30));
  const integ = new Float64Array((W + 1) * (H + 1));
  for (let y = 0; y < H; y++) {
    let row = 0;
    for (let x = 0; x < W; x++) {
      row += dark[y * W + x];
      integ[(y + 1) * (W + 1) + x + 1] = integ[y * (W + 1) + x + 1] + row;
    }
  }
  const minContrast = 20 + (1 - sensitivity) * 60;   // 20..80
  const mask = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    const y0 = Math.max(0, y - rad), y1 = Math.min(H, y + rad + 1);
    for (let x = 0; x < W; x++) {
      const x0 = Math.max(0, x - rad), x1 = Math.min(W, x + rad + 1);
      const sum = integ[y1 * (W + 1) + x1] - integ[y0 * (W + 1) + x1] - integ[y1 * (W + 1) + x0] + integ[y0 * (W + 1) + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      const d = dark[y * W + x];
      if (d > minContrast && d > mean + minContrast * 0.5) mask[y * W + x] = 1;
    }
  }
  return { mask, transparentShare: transparent / N };
}

function removeSpecks(mask, W, H, minArea) {
  const label = new Int32Array(W * H);
  const stack = [];
  let id = 0;
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || label[s]) continue;
    id++;
    const comp = [];
    stack.push(s); label[s] = id;
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (mask[q] && !label[q]) { label[q] = id; stack.push(q); }
      }
    }
    if (comp.length < minArea) for (const p of comp) mask[p] = 0;
  }
}

// Chamfer-Abstand (3-4) zum nächsten Hintergrundpixel, Ergebnis in Pixeln
function distance(mask, W, H) {
  const BIG = 1e9;
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = mask[i] ? BIG : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x;
    if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
  }
  for (let i = 0; i < W * H; i++) d[i] /= 3;
  return d;
}

function thin(mask, W, H) {
  const m = mask.slice();
  const del = [];
  let changed = true;
  const P = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : m[y * W + x]);
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        if (!m[y * W + x]) continue;
        const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1);
        const p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
        const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (B < 2 || B > 6) continue;
        const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
        let A = 0;
        for (let k = 0; k < 8; k++) if (!seq[k] && seq[k + 1]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (p2 * p4 * p6 || p4 * p6 * p8) : (p2 * p4 * p8 || p2 * p6 * p8)) continue;
        del.push(y * W + x);
      }
      for (const i of del) m[i] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

const NB = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]]; // 4er-Nachbarn zuerst
// Nachbarn im Kreis (N, NO, O, SO, S, SW, W, NW) für die Übergangszahl
const RING = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];

// Treppenstufen entfernen: Eckpixel, deren zwei 4er-Nachbarn sich schon diagonal berühren
function pruneCorners(sk, W, H) {
  const P = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : sk[y * W + x]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!sk[y * W + x]) continue;
    const n = P(x, y - 1), e = P(x + 1, y), so = P(x, y + 1), w = P(x - 1, y);
    const ne = P(x + 1, y - 1), se = P(x + 1, y + 1), sw = P(x - 1, y + 1), nw = P(x - 1, y - 1);
    if ((n && e && !so && !w && !sw && !se && !nw) || (e && so && !n && !w && !nw && !ne && !sw) ||
        (so && w && !n && !e && !ne && !nw && !se) || (w && n && !e && !so && !se && !ne && !sw)) sk[y * W + x] = 0;
  }
}

function trace(sk, W, H) {
  pruneCorners(sk, W, H);
  const nbrs = (p) => {
    const x = p % W, y = (p / W) | 0, out = [];
    for (const [dx, dy] of NB) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H && sk[ny * W + nx]) out.push(ny * W + nx);
    }
    return out;
  };
  const crossing = (p) => {
    const x = p % W, y = (p / W) | 0;
    const v = RING.map(([dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < W && ny < H ? sk[ny * W + nx] : 0; });
    let c = 0;
    for (let k = 0; k < 8; k++) if (!v[k] && v[(k + 1) % 8]) c++;
    return c;
  };
  const deg = new Uint8Array(W * H);
  const cn = new Uint8Array(W * H);
  const pix = [];
  for (let i = 0; i < W * H; i++) if (sk[i]) { deg[i] = nbrs(i).length; cn[i] = crossing(i); pix.push(i); }
  const isJ = (p) => cn[p] >= 3;
  const used = new Uint8Array(W * H);
  const paths = [];
  const walk = (start, first) => {
    const path = [start];
    let cur = first;
    for (;;) {
      path.push(cur);
      if (isJ(cur) && path.length > 1) break;
      used[cur] = 1;
      const next = nbrs(cur).filter((q) => !used[q] && q !== path[path.length - 2] && !(isJ(q) && q === start && path.length < 3));
      if (!next.length) break;
      const plain = next.find((q) => !isJ(q));
      cur = plain ?? next[0];
    }
    return path;
  };
  // 1. von Endpunkten aus
  for (const p of pix) {
    if (deg[p] === 0) { used[p] = 1; paths.push({ px: [p], ends: 2 }); continue; }
    if ((deg[p] !== 1 && cn[p] !== 1) || used[p] || isJ(p)) continue;
    used[p] = 1;
    const path = walk(p, nbrs(p)[0]);
    paths.push({ px: path, ends: isJ(path[path.length - 1]) ? 1 : 2 });
  }
  // 2. Äste zwischen Knoten
  for (const p of pix) {
    if (!isJ(p)) continue;
    for (const q of nbrs(p)) {
      if (used[q] || isJ(q)) continue;
      paths.push({ px: walk(p, q), ends: 0 });
    }
  }
  // 3. geschlossene Schleifen
  for (const p of pix) {
    if (used[p] || isJ(p)) continue;
    used[p] = 1;
    const n = nbrs(p).filter((q) => !used[q]);
    if (!n.length) { paths.push({ px: [p], ends: 2 }); continue; }
    const path = walk(p, n[0]);
    if (path[path.length - 1] !== p && nbrs(path[path.length - 1]).includes(p)) path.push(p);
    paths.push({ px: path, ends: 0 });
  }
  return paths;
}

function rdp(pts, eps) {
  if (pts.length < 3) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

// Glättet die Treppenstufen der Pixel (gleitender Mittelwert, Enden bleiben)
function smooth(pts) {
  if (pts.length < 4) return pts;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const a = pts[i - 1], b = pts[i + 1];
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4];
  });
}

// Teilt einen Pfad an scharfen Knicken (> ~80°). Dort treffen sich meist zwei Linien,
// die das Skelett ohne erkennbaren Knoten verbunden hat.
function splitSharp(path, W) {
  const px = path.px, K = 5;
  if (px.length < 2 * K + 2) return [path];
  const xy = (p) => [p % W, (p / W) | 0];
  const cuts = [];
  for (let i = K; i < px.length - K; i++) {
    const [ax, ay] = xy(px[i - K]), [bx, by] = xy(px[i]), [cx, cy] = xy(px[i + K]);
    const ux = bx - ax, uy = by - ay, vx = cx - bx, vy = cy - by;
    const cos = (ux * vx + uy * vy) / ((Math.hypot(ux, uy) * Math.hypot(vx, vy)) || 1);
    if (cos < 0.2 && (!cuts.length || i - cuts[cuts.length - 1] > K)) cuts.push(i);
  }
  if (!cuts.length) return [path];
  const out = [];
  let start = 0;
  for (const c of cuts) { out.push({ px: px.slice(start, c + 1), ends: 0 }); start = c; }
  out.push({ px: px.slice(start), ends: 0 });
  return out;
}

// Teilt einen Pfad, wo die Farbe deutlich wechselt (zwei verschiedenfarbige Linien kreuzen sich).
function splitColor(path, data) {
  const px = path.px, K = 4;
  if (px.length < 4 * K) return [path];
  const col = px.map((p) => [data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]);
  const avg = (a, b) => {
    const s = [0, 0, 0];
    for (let i = a; i < b; i++) for (let c = 0; c < 3; c++) s[c] += col[i][c];
    return s.map((v) => v / (b - a));
  };
  const cuts = [];
  for (let i = 2 * K; i <= px.length - 2 * K; i++) {
    const a = avg(i - 2 * K, i), b = avg(i, i + 2 * K);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    if (d > 70 && (!cuts.length || i - cuts[cuts.length - 1] > 2 * K)) cuts.push(i);
  }
  if (!cuts.length) return [path];
  const out = [];
  let start = 0;
  for (const c of cuts) { out.push({ px: px.slice(start, c + 1), ends: 0 }); start = c; }
  out.push({ px: px.slice(start), ends: 0 });
  return out;
}

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

// Ergebnis: Striche in Pixelkoordinaten des Bildes
export function vectorize(img, { sensitivity = 0.5, keepColors = true, widthScale = 1 } = {}) {
  const { width: W, height: H, data } = img;
  const { mask } = inkMask(img, { sensitivity });
  removeSpecks(mask, W, H, Math.max(4, Math.round(W * H * 0.000015)));
  const dist = distance(mask, W, H);
  const sk = thin(mask, W, H);
  let paths = trace(sk, W, H).flatMap((p) => splitSharp(p, W));
  if (keepColors) paths = paths.flatMap((p) => splitColor(p, data));

  const strokes = [];
  for (const { px, ends } of paths) {
    let wsum = 0;
    for (const p of px) wsum += dist[p];
    const avgR = Math.max(0.5, wsum / px.length);
    // kurze Sporne an Ecken dicker Linien weglassen
    if (ends === 1 && px.length < avgR * 2.2) continue;
    if (px.length === 1 && avgR < 1) continue;
    let r = 0, g = 0, b = 0, cnt = 0;
    for (const p of px) {
      // Farbe aus dem Strichkern, nicht vom Rand
      if (dist[p] < avgR * 0.6 && px.length > 3) continue;
      r += data[p * 4]; g += data[p * 4 + 1]; b += data[p * 4 + 2]; cnt++;
    }
    if (!cnt) for (const p of px) { r += data[p * 4]; g += data[p * 4 + 1]; b += data[p * 4 + 2]; cnt++; }
    r /= cnt; g /= cnt; b /= cnt;
    let c = '#000000';
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (keepColors && (spread > 40 || Math.max(r, g, b) > 110)) {
      // Farbe kräftiger machen: Fotos wirken sonst ausgewaschen
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b);
      const f = mx > mn ? 255 / mx : 1;
      c = '#' + hex2(r * f * 0.85) + hex2(g * f * 0.85) + hex2(b * f * 0.85);
      if (spread < 40) c = '#' + hex2(r * 0.6) + hex2(g * 0.6) + hex2(b * 0.6);
    }
    let pts = px.map((p) => [p % W, (p / W) | 0]);
    pts = rdp(smooth(pts), 0.8);
    strokes.push({ pts, w: avgR * 2 * widthScale, c });
  }
  // Lange Striche zuerst, das sieht beim Aufbau natürlicher aus
  strokes.sort((a, b) => b.pts.length - a.pts.length);
  return { strokes, inkPixels: mask.reduce((s, v) => s + v, 0) };
}

// Pixel-Striche auf das Blatt setzen: Bild zentriert einpassen
export function placeOnPage(strokes, imgW, imgH, page, margin = 24) {
  const k = Math.min((page.w - 2 * margin) / imgW, (page.h - 2 * margin) / imgH);
  const ox = (page.w - imgW * k) / 2, oy = (page.h - imgH * k) / 2;
  return {
    rect: [ox, oy, imgW * k, imgH * k],
    strokes: strokes.map((s) => ({
      pts: s.pts.map(([x, y]) => [ox + (x + 0.5) * k, oy + (y + 0.5) * k, 0.5]),
      w: Math.max(0.5, s.w * k),
      c: s.c,
    })),
  };
}
