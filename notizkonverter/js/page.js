// Gemeinsames Seitenmaß aller Formate (PDF-Punkte, y nach unten).
// 834,24 × 1078,82 ist das Standardpapier von GoodNotes.
export const PAGE_HOCH = { w: 834.24, h: 1078.82 };
export const PAGE = { ...PAGE_HOCH };

export function setOrientation(quer) {
  PAGE.w = quer ? PAGE_HOCH.h : PAGE_HOCH.w;
  PAGE.h = quer ? PAGE_HOCH.w : PAGE_HOCH.h;
}

// Stiftdruck (0..1) -> Breitenfaktor. Gleiche Formel wie in der Handschrift-App.
export const widthFactor = (p) => 0.55 + 0.9 * (p ?? 0.5);
export const pressureFromFactor = (f) => Math.max(0, Math.min(1, (f - 0.55) / 0.9));

// Ein Strich: { pts: [[x, y, druck], ...], w: Breite, c: '#rrggbb', a: Deckkraft 0..1 (optional) }
// overlay = true: nur Bild und Striche, ohne weißes Blatt darunter
export function drawPage(ctx, page, scale, overlay = false) {
  if (!overlay) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE.w * scale, PAGE.h * scale);
  }
  if (page.bg?.img) {
    const [x, y, w, h] = page.bg.rect;
    ctx.drawImage(page.bg.img, x * scale, y * scale, w * scale, h * scale);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of page.strokes) {
    ctx.strokeStyle = s.c;
    ctx.globalAlpha = s.a ?? 1;
    const p = s.pts;
    if (p.length === 1) {
      ctx.fillStyle = s.c;
      ctx.beginPath();
      ctx.arc(p[0][0] * scale, p[0][1] * scale, (s.w * widthFactor(p[0][2]) * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    for (let i = 1; i < p.length; i++) {
      ctx.lineWidth = Math.max(0.5, s.w * widthFactor((p[i - 1][2] + p[i][2]) / 2) * scale);
      ctx.beginPath();
      ctx.moveTo(p[i - 1][0] * scale, p[i - 1][1] * scale);
      ctx.lineTo(p[i][0] * scale, p[i][1] * scale);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
