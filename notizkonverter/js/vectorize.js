// Macht aus einem Bild (Zeichnung, Skizze, Foto) einzelne Striche.
// Ablauf: Papier erkennen -> Farben zu einer Palette zusammenfassen -> Krümel glätten
// -> pro Farbe Flächen ausmalen und dünne Teile über das Skelett zu Linien machen
// -> Linien gleicher Farbe zusammenhängen. Beschreibung in docs/dateiformate.md.
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

// Zusammenhängende Teile einer Maske mit Rahmen
function components(mask, W, H) {
  const seen = new Uint8Array(W * H);
  const out = [];
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp = { px: [], x0: W, y0: H, x1: 0, y1: 0 };
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      comp.px.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x < comp.x0) comp.x0 = x; if (x > comp.x1) comp.x1 = x;
      if (y < comp.y0) comp.y0 = y; if (y > comp.y1) comp.y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    out.push(comp);
  }
  return out;
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
  const dx = bx - ax, dy = by - ay;
  if (Math.hypot(dx, dy) < 1) {
    // geschlossene Form: am weitesten entfernten Punkt teilen, sonst schrumpft sie zu einem Punkt
    let far = 1, fd = 0;
    for (let i = 1; i < pts.length - 1; i++) { const d = Math.hypot(pts[i][0] - ax, pts[i][1] - ay); if (d > fd) { fd = d; far = i; } }
    if (fd < eps) return [pts[0], pts[pts.length - 1]];
    return rdp(pts.slice(0, far + 1), eps).slice(0, -1).concat(rdp(pts.slice(far), eps));
  }
  const len = Math.hypot(dx, dy);
  let max = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return rdp(pts.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(pts.slice(idx), eps));
}

// Glättet die Treppenstufen der Pixel (Gauß-ähnlich, mehrere Durchgänge). Enden bleiben fest.
// Die dritte Koordinate (örtlicher Radius) wird mitgeglättet.
function smooth(pts, passes = 3) {
  if (pts.length < 4) return pts;
  let cur = pts;
  for (let k = 0; k < passes; k++) {
    cur = cur.map((p, i) => {
      if (i === 0 || i === cur.length - 1) return p;
      const a = cur[i - 1], b = cur[i + 1];
      return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4, (a[2] + 2 * p[2] + b[2]) / 4];
    });
  }
  return cur;
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

const hex2 = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

// Linien aus einer Maske: Skelett -> Pfade -> geglättete Striche mit Druck aus der Strichbreite.
function lineStrokes(mask, W, H, { widthScale, color }) {
  const dist = distance(mask, W, H);
  const sk = thin(mask, W, H);
  const paths = trace(sk, W, H).flatMap((p) => splitSharp(p, W));

  const strokes = [];
  for (const { px, ends } of paths) {
    let wsum = 0;
    for (const p of px) wsum += dist[p];
    const avgR = Math.max(0.5, wsum / px.length);
    // kurze Sporne an Ecken dicker Linien weglassen
    if (ends === 1 && px.length < avgR * 2.2) continue;
    if (px.length === 1 && avgR < 1) continue;
    // Radius pro Punkt mitführen, später wird daraus der Stiftdruck
    let pts = px.map((p) => [p % W, (p / W) | 0, Math.max(0.5, dist[p])]);
    pts = rdp(smooth(pts), 0.35);
    pts = pts.map(([x, y, r]) => [x, y, Math.max(0, Math.min(1, (r / avgR - 0.55) / 0.9))]);
    strokes.push({ pts, w: avgR * 2 * widthScale, c: color });
  }
  // Lange Striche zuerst, das sieht beim Aufbau natürlicher aus
  strokes.sort((a, b) => b.pts.length - a.pts.length);
  return strokes;
}

/* ---------- Farben und Flächen ---------- */

// Papierfarbe aus dem Bildrand. Nur wenn der Rand überwiegend hell und fast farblos ist,
// gilt das Bild als Zeichnung auf Papier. Sonst (Foto, ausgemaltes Bild) wird alles übernommen.
function paperColor(data, W, H) {
  const hist = new Map();
  let total = 0;
  const add = (i) => {
    if (data[i * 4 + 3] < 128) return;
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    hist.set(key, (hist.get(key) || 0) + 1);
    total++;
  };
  for (let x = 0; x < W; x += 2) { add(x); add((H - 1) * W + x); }
  for (let y = 0; y < H; y += 2) { add(y * W); add(y * W + W - 1); }
  // benachbarte Töne zusammenzählen, Papier ist selten ganz gleichmäßig
  let best = -1, bestN = 0;
  for (const k of hist.keys()) {
    let n = 0;
    for (const [k2, n2] of hist) {
      if (Math.abs((k >> 8) - (k2 >> 8)) <= 1 && Math.abs(((k >> 4) & 15) - ((k2 >> 4) & 15)) <= 1 && Math.abs((k & 15) - (k2 & 15)) <= 1) n += n2;
    }
    if (n > bestN) { bestN = n; best = k; }
  }
  if (best < 0 || bestN < total * 0.45) return null;
  const c = [(best >> 8) * 16 + 8, ((best >> 4) & 15) * 16 + 8, (best & 15) * 16 + 8];
  if (Math.min(...c) < 165 || Math.max(...c) - Math.min(...c) > 45) return null;
  return c;
}

// Farben der Zeichnung per k-Means zu einer Palette zusammenfassen
function palette(data, idx, k, mergeD) {
  const step = Math.max(1, Math.floor(idx.length / 30000));
  const sample = [];
  for (let i = 0; i < idx.length; i += step) { const p = idx[i]; sample.push([data[p * 4], data[p * 4 + 1], data[p * 4 + 2]]); }
  if (!sample.length) return [];
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // Start: dunkelste Farbe, dann jeweils die am weitesten entfernte
  let cents = [sample.reduce((a, b) => (a[0] + a[1] + a[2] < b[0] + b[1] + b[2] ? a : b)).slice()];
  const near = new Float64Array(sample.length).fill(Infinity);
  while (cents.length < k) {
    const last = cents[cents.length - 1];
    let far = -1, farD = 0;
    for (let i = 0; i < sample.length; i++) {
      const d = d2(sample[i], last);
      if (d < near[i]) near[i] = d;
      if (near[i] > farD) { farD = near[i]; far = i; }
    }
    if (far < 0 || farD < mergeD * mergeD) break;
    cents.push(sample[far].slice());
  }
  for (let it = 0; it < 12; it++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (const s of sample) {
      let bi = 0, bd = Infinity;
      for (let j = 0; j < cents.length; j++) { const d = d2(s, cents[j]); if (d < bd) { bd = d; bi = j; } }
      sum[bi][0] += s[0]; sum[bi][1] += s[1]; sum[bi][2] += s[2]; sum[bi][3]++;
    }
    cents = sum.filter((v) => v[3]).map((v) => [v[0] / v[3], v[1] / v[3], v[2] / v[3]]);
  }
  // fast gleiche Farben zusammenlegen
  const out = [];
  for (const c of cents) if (!out.some((o) => d2(o, c) < mergeD * mergeD * 0.6)) out.push(c);
  return out;
}

// 3×3-Weichzeichner (nur Farbe, Deckkraft bleibt)
function blur3(src, W, H) {
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const q = (ny * W + nx) * 4;
      r += src[q]; g += src[q + 1]; b += src[q + 2]; n++;
    }
    const p = (y * W + x) * 4;
    out[p] = r / n; out[p + 1] = g / n; out[p + 2] = b / n; out[p + 3] = src[p + 3];
  }
  return out;
}

// Mehrheitsfilter 3×3 auf der Farbkarte: glättet Kanten und entfernt einzelne Ausreißer
function smoothLabels(label, W, H, K) {
  const out = new Int8Array(label.length);
  const cnt = new Int32Array(K + 1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const touched = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const l = label[ny * W + nx] + 1;
      if (!cnt[l]) touched.push(l);
      cnt[l]++;
    }
    const own = label[y * W + x] + 1;
    let best = own, bestN = cnt[own];
    for (const l of touched) { if (cnt[l] > bestN) { bestN = cnt[l]; best = l; } }
    out[y * W + x] = best - 1;
    for (const l of touched) cnt[l] = 0;
  }
  return out;
}

// Kleine Farbinseln bekommen die Farbe ihrer Umgebung, statt als Krümel übrig zu bleiben
function absorbSmall(label, W, H, minArea) {
  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let s = 0; s < W * H; s++) {
    if (seen[s]) continue;
    const l = label[s];
    const comp = [];
    seen[s] = 1; stack.push(s);
    while (stack.length) {
      const p = stack.pop();
      comp.push(p);
      const x = p % W, y = (p / W) | 0;
      if (x > 0 && !seen[p - 1] && label[p - 1] === l) { seen[p - 1] = 1; stack.push(p - 1); }
      if (x < W - 1 && !seen[p + 1] && label[p + 1] === l) { seen[p + 1] = 1; stack.push(p + 1); }
      if (y > 0 && !seen[p - W] && label[p - W] === l) { seen[p - W] = 1; stack.push(p - W); }
      if (y < H - 1 && !seen[p + W] && label[p + W] === l) { seen[p + W] = 1; stack.push(p + W); }
    }
    if (comp.length >= minArea) continue;
    const votes = new Map();
    for (const p of comp) {
      const x = p % W, y = (p / W) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q < 0 || label[q] === l) continue;
        votes.set(label[q], (votes.get(label[q]) || 0) + 1);
      }
    }
    let best = l, bestN = 0;
    for (const [k, n] of votes) if (n > bestN) { bestN = n; best = k; }
    for (const p of comp) label[p] = best;
  }
}

// Fläche in Schlangenlinien ausmalen: Zeile für Zeile hin und her, so entstehen wenige lange
// Striche statt vieler kurzer. Dazu ein Umriss für saubere Kanten.
function fillStrokes(region, W, H, spacing, c, hatch, outlineW, withOutline, inset = true) {
  const strokes = [];
  const w = spacing * 1.5;
  if (hatch) {
    const rows = [];
    for (let y = Math.floor(spacing / 2); y < H; y += spacing) {
      const runs = [];
      let x = 0;
      while (x < W) {
        if (!region[y * W + x]) { x++; continue; }
        const x0 = x;
        while (x < W && (region[y * W + x] || (x + 1 < W && region[y * W + x + 1]))) x++;
        // Enden etwas einrücken, damit die runde Stiftspitze nicht über den Rand malt
        const ins = inset ? Math.min(spacing * 0.4, (x - 1 - x0) / 2) : 0;
        runs.push({ x0: x0 + ins, x1: x - 1 - ins, y, used: false });
      }
      rows.push(runs);
    }
    for (let r = 0; r < rows.length; r++) {
      for (const start of rows[r]) {
        if (start.used) continue;
        start.used = true;
        const pts = [[start.x0, start.y, 0.5], [start.x1, start.y, 0.5]];
        let cur = start, atRight = true;
        for (let rr = r + 1; rr < rows.length && pts.length < 3000; rr++) {
          const endX = atRight ? cur.x1 : cur.x0;
          let next = null, nd = Infinity;
          for (const n of rows[rr]) {
            if (n.used || n.x1 < cur.x0 - 1 || n.x0 > cur.x1 + 1) continue;
            const d = Math.abs((atRight ? n.x1 : n.x0) - endX);
            if (d < nd) { nd = d; next = n; }
          }
          if (!next) break;
          next.used = true;
          if (atRight) pts.push([next.x1, next.y, 0.5], [next.x0, next.y, 0.5]);
          else pts.push([next.x0, next.y, 0.5], [next.x1, next.y, 0.5]);
          atRight = !atRight;
          cur = next;
        }
        strokes.push({ pts, w, c });
      }
    }
  }
  if (!withOutline && hatch) return strokes;
  // Umriss: Randpixel der Fläche als Linien
  const edge = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!region[i]) continue;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1 || !region[i - 1] || !region[i + 1] || !region[i - W] || !region[i + W]) edge[i] = 1;
  }
  const sk = thin(edge, W, H);
  for (const { px } of trace(sk, W, H)) {
    if (px.length < 3) continue;
    let pts = px.map((p) => [p % W, (p / W) | 0, 0.5]);
    pts = rdp(smooth(pts, 2), 0.4);
    strokes.push({ pts, w: hatch ? spacing * 1.2 : outlineW, c });
  }
  return strokes;
}

// Hängt Linien gleicher Farbe aneinander, deren Enden sich fast berühren und in dieselbe Richtung zeigen.
function mergeLines(strokes) {
  const len = (s) => { let l = 0; for (let i = 1; i < s.pts.length; i++) l += Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]); return l; };
  // Richtung am Ende (aus dem Strich heraus)
  const dirAt = (s, atEnd) => {
    const p = s.pts, n = p.length;
    if (n < 2) return null;
    const a = atEnd ? p[n - 1] : p[0];
    let b = atEnd ? p[n - 2] : p[1];
    for (let i = 2; i < Math.min(n, 5) && Math.hypot(a[0] - b[0], a[1] - b[1]) < 3; i++) b = atEnd ? p[n - 1 - i] : p[i];
    const l = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    return [(a[0] - b[0]) / l, (a[1] - b[1]) / l];
  };
  const byColor = new Map();
  for (const s of strokes) { if (!byColor.has(s.c)) byColor.set(s.c, []); byColor.get(s.c).push(s); }
  const out = [];
  for (const list of byColor.values()) {
    let alive = list.map((s) => ({ ...s, len: len(s) }));
    for (let pass = 0; pass < 6; pass++) {
      const cell = 8;
      const grid = new Map();
      const key = (x, y) => ((x / cell) | 0) + ',' + ((y / cell) | 0);
      alive.forEach((s, i) => {
        for (const end of [0, 1]) {
          const p = end ? s.pts[s.pts.length - 1] : s.pts[0];
          const k = key(p[0], p[1]);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push([i, end]);
        }
      });
      const dead = new Uint8Array(alive.length);
      let merged = 0;
      for (let i = 0; i < alive.length; i++) {
        if (dead[i]) continue;
        for (const endA of [1, 0]) {
          const a = alive[i];
          if (dead[i]) break;
          const pa = endA ? a.pts[a.pts.length - 1] : a.pts[0];
          const da = dirAt(a, endA === 1);
          let best = null, bestScore = Infinity;
          const gx = (pa[0] / cell) | 0, gy = (pa[1] / cell) | 0;
          for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
            for (const [j, endB] of grid.get((gx + ox) + ',' + (gy + oy)) || []) {
              if (j === i || dead[j]) continue;
              const b = alive[j];
              if (Math.max(a.w, b.w) / Math.max(0.1, Math.min(a.w, b.w)) > 1.8) continue;
              const pb = endB ? b.pts[b.pts.length - 1] : b.pts[0];
              const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
              if (d > Math.max(2, 0.9 * Math.max(a.w, b.w))) continue;
              const db = dirAt(b, endB === 1);
              // Enden müssen aufeinander zu zeigen
              const cos = da && db ? -(da[0] * db[0] + da[1] * db[1]) : 1;
              if (cos < 0.5) continue;
              const score = d - cos * 2;
              if (score < bestScore) { bestScore = score; best = [j, endB]; }
            }
          }
          if (!best) continue;
          const [j, endB] = best;
          const b = alive[j];
          const ap = endA ? a.pts : a.pts.slice().reverse();
          const bp = endB ? b.pts.slice().reverse() : b.pts;
          const total = a.len + b.len || 1;
          alive[i] = { pts: ap.concat(bp), w: (a.w * a.len + b.w * b.len) / total, c: a.c, len: total };
          dead[j] = 1;
          merged++;
        }
      }
      alive = alive.filter((_, i) => !dead[i]);
      if (!merged) break;
    }
    for (const s of alive) { delete s.len; out.push(s); }
  }
  return out;
}

// colors: höchstens so viele Farben. Mehr Farben = mehr Details, aber mehr Striche.
function colorMode(img, { sensitivity, widthScale, keepColors, fill, detail = 2 }) {
  const { width: W, height: H } = img;
  let data = img.data;
  // Stufe 1 = wenig, 2 = mittel, 3 = viele Details
  const colors = [8, 16, 28][detail - 1];
  const islandShare = [0.00015, 0.00006, 0.00002][detail - 1];
  const N = W * H;
  const res = Math.max(W, H) / 1400;              // Maße an die Auflösung anpassen
  const bg = paperColor(data, W, H);
  const fg = [];
  if (bg) {
    const { mask: ink } = inkMask(img, { sensitivity });
    const thr = 14 + (1 - sensitivity) * 36;      // ab dieser Farbabweichung zählt ein Pixel zur Zeichnung
    for (let i = 0; i < N; i++) {
      if (data[i * 4 + 3] < 128) continue;
      const d = Math.hypot(data[i * 4] - bg[0], data[i * 4 + 1] - bg[1], data[i * 4 + 2] - bg[2]);
      if (ink[i] || d > thr) fg.push(i);
    }
  } else {
    // kein Papier erkennbar (Foto, ausgemaltes Bild): das ganze Bild ist Zeichnung.
    // Leicht weichzeichnen, damit Bildrauschen keine Farbkrümel erzeugt.
    data = blur3(data, W, H);
    for (let i = 0; i < N; i++) if (data[i * 4 + 3] >= 128) fg.push(i);
  }
  const mergeD = Math.max(12, 340 / colors);
  const cents = palette(data, fg, colors, mergeD);
  let label = new Int8Array(N).fill(-1);
  for (const p of fg) {
    let bi = 0, bd = Infinity;
    for (let j = 0; j < cents.length; j++) {
      const c = cents[j];
      const d = (data[p * 4] - c[0]) ** 2 + (data[p * 4 + 1] - c[1]) ** 2 + (data[p * 4 + 2] - c[2]) ** 2;
      if (d < bd) { bd = d; bi = j; }
    }
    label[p] = bi;
  }
  label = smoothLabels(label, W, H, cents.length);
  absorbSmall(label, W, H, Math.max(6, Math.round(N * islandShare)));

  // Ab diesem Radius gilt etwas als Fläche. Ohne Füllen bleiben auch dicke Linien Linien.
  const T = fill ? Math.max(2, 2.5 * res) : Math.max(6, 9 * res);
  const spacing = Math.max(2, Math.round(2.5 * res));
  const outlineW = Math.max(1.5, 3 * res) * widthScale;
  const fills = [], lines = [];
  // Hellste Farben zuerst ausmalen, dunkle Linien liegen oben
  const order = cents.map((c, j) => [c[0] + c[1] + c[2], j]).sort((a, b) => b[0] - a[0]).map(([, j]) => j);
  for (const j of order) {
    const c = cents[j];
    // ohne Farben: Graustufen, damit Flächen trotzdem unterscheidbar bleiben
    const g = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
    const hex = keepColors ? '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]) : fill ? '#' + hex2(g) + hex2(g) + hex2(g) : '#000000';
    // Nur im Rahmen dieser Farbe rechnen, das spart bei vielen Farben viel Zeit
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let i = 0; i < N; i++) if (label[i] === j) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) continue;
    const cw = x1 - x0 + 3, ch = y1 - y0 + 3, CN = cw * ch;
    const m = new Uint8Array(CN);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (label[y * W + x] === j) m[(y - y0 + 1) * cw + x - x0 + 1] = 1;
    const shift = (st) => { st.pts = st.pts.map(([x, y, p]) => [x + x0 - 1, y + y0 - 1, p]); return st; };
    const dist = distance(m, cw, ch);
    // Kern = weit vom Rand; Fläche = alles in Reichweite T eines Kernpixels
    const notCore = new Uint8Array(CN);
    let anyCore = false;
    for (let i = 0; i < CN; i++) { if (dist[i] >= T) anyCore = true; else notCore[i] = 1; }
    const region = new Uint8Array(CN);
    if (anyCore) {
      const dc = distance(notCore, cw, ch);
      for (let i = 0; i < CN; i++) if (m[i] && dc[i] <= T + 0.5) region[i] = 1;
      // Jede Fläche einzeln: kleine Flecken (Augen, Punkte) werden immer ausgemalt
      for (const comp of components(region, cw, ch)) {
        let maxD = 0;
        for (const p of comp.px) if (dist[p] > maxD) maxD = dist[p];
        const hatch = fill || maxD < 4 * T;
        const bw = comp.x1 - comp.x0 + 3, bh = comp.y1 - comp.y0 + 3;
        const crop = new Uint8Array(bw * bh);
        for (const p of comp.px) crop[(((p / cw) | 0) - comp.y0 + 1) * bw + (p % cw) - comp.x0 + 1] = 1;
        // Umriss nur bei größeren Flächen, bei kleinen reicht die Füllung
        const withOutline = comp.px.length > spacing * spacing * 60;
        for (const st of fillStrokes(crop, bw, bh, spacing, hex, hatch, outlineW, withOutline, !fill)) {
          st.pts = st.pts.map(([x, y, p]) => [x + comp.x0 - 1, y + comp.y0 - 1, p]);
          fills.push(shift(st));
        }
      }
    }
    const thinPart = new Uint8Array(CN);
    for (let i = 0; i < CN; i++) if (m[i] && !region[i]) thinPart[i] = 1;
    removeSpecks(thinPart, cw, ch, 3);
    for (const st of lineStrokes(thinPart, cw, ch, { widthScale, color: hex })) {
      // beim Ausfüllen etwas breiter, damit zwischen Nachbarfarben kein Papier durchscheint
      if (fill) st.w += 1;
      lines.push(shift(st));
    }
  }
  // Sehr kurze, dünne Reste weglassen: das sind fast immer Krümel
  const merged = mergeLines(lines).filter((s) => s.pts.length > 1 || s.w > 2 * res);
  merged.sort((a, b) => b.pts.length - a.pts.length);
  return { strokes: fills.concat(merged), inkPixels: fg.length };
}

// Ergebnis: Striche in Pixelkoordinaten des Bildes. Dritte Koordinate = Stiftdruck 0..1.
// Jede Farbe wird getrennt bearbeitet: dünne Teile werden Linien, breite Flächen bekommen
// einen Umriss und mit fill = true zusätzlich eine Füllung.
export function vectorize(img, { sensitivity = 0.5, keepColors = true, widthScale = 1, fill = false, detail = 2 } = {}) {
  return colorMode(img, { sensitivity, widthScale, keepColors, fill, detail });
}

// Pixel-Striche auf das Blatt setzen: Bild zentriert einpassen
export function placeOnPage(strokes, imgW, imgH, page, margin = 24) {
  const k = Math.min((page.w - 2 * margin) / imgW, (page.h - 2 * margin) / imgH);
  const ox = (page.w - imgW * k) / 2, oy = (page.h - imgH * k) / 2;
  return {
    rect: [ox, oy, imgW * k, imgH * k],
    strokes: strokes.map((s) => ({
      pts: s.pts.map(([x, y, p]) => [ox + (x + 0.5) * k, oy + (y + 0.5) * k, p ?? 0.5]),
      w: Math.max(0.5, s.w * k),
      c: s.c,
    })),
  };
}
