// Kleiner PDF-Schreiber ohne Abhängigkeiten (gekürzt aus der Handschrift-App).
// pages: [{ strokes, bg: { jpeg, pw, ph, rect: [x, y, w, h] } }], Maße in Punkten, y nach unten.
// scale: Seitenmaß in der PDF = Blattmaß * scale. GoodNotes rechnet PDF-Punkte mit 11/6 in Blattmaße um.
import { PAGE, widthFactor } from './page.js';

const n = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? '0' : String(r);
};

function rgb(hex) {
  const m = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(m.substr(i, 2), 16) / 255);
}

function strokeOps(s, H) {
  const [r, g, b] = rgb(s.c);
  let out = (s.a ?? 1) < 1 ? `/GSa${Math.round((s.a ?? 1) * 100)} gs\n` : '/GSa100 gs\n';
  out += `${n(r)} ${n(g)} ${n(b)} RG 1 J 1 j\n`;
  const p = s.pts;
  if (p.length === 1) {
    return out + `${n(s.w * widthFactor(p[0][2]))} w ${n(p[0][0])} ${n(H - p[0][1])} m ${n(p[0][0] + 0.05)} ${n(H - p[0][1])} l S\n`;
  }
  let curW = -1, path = '';
  for (let i = 1; i < p.length; i++) {
    const w = Math.round(s.w * widthFactor((p[i - 1][2] + p[i][2]) / 2) * 10) / 10;
    if (w !== curW) {
      if (path) out += path + ' S\n';
      out += `${n(w)} w `;
      path = `${n(p[i - 1][0])} ${n(H - p[i - 1][1])} m`;
      curW = w;
    }
    path += ` ${n(p[i][0])} ${n(H - p[i][1])} l`;
  }
  return out + path + ' S\n';
}

const binary = (u8) => {
  let out = '';
  for (let i = 0; i < u8.length; i += 0x8000) out += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return out;
};

export function buildPdf(pages, { title = 'Notiz', scale = 1 } = {}) {
  const W = PAGE.w, H = PAGE.h;
  const objs = [null, null];
  const add = (s) => { objs.push(s); return objs.length; };
  const pageIds = [];
  // Deckkraft-Stufen für Textmarker
  const alphas = new Set([100]);
  for (const p of pages) for (const s of p.strokes) alphas.add(Math.round((s.a ?? 1) * 100));
  const gsIds = [...alphas].map((a) => [a, add(`<< /Type /ExtGState /CA ${a / 100} /ca ${a / 100} >>`)]);
  const gsRes = `/ExtGState << ${gsIds.map(([a, id]) => `/GSa${a} ${id} 0 R`).join(' ')} >>`;
  const sc = String(Math.round(scale * 1e6) / 1e6);

  for (const page of pages) {
    const pageId = add(null);
    pageIds.push(pageId);
    let content = '', xobj = '';
    if (page.bg?.jpeg) {
      const bin = binary(page.bg.jpeg);
      const imgId = add(`<< /Type /XObject /Subtype /Image /Width ${page.bg.pw} /Height ${page.bg.ph} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bin.length} >>\nstream\n${bin}\nendstream`);
      const [x, y, w, h] = page.bg.rect;
      xobj = `/XObject << /Im0 ${imgId} 0 R >>`;
      content += `q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(H - y - h)} cm /Im0 Do Q\n`;
    }
    for (const s of page.strokes) content += strokeOps(s, H);
    if (scale !== 1) content = `q ${sc} 0 0 ${sc} 0 0 cm\n${content}Q\n`;
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    objs[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(W * scale)} ${n(H * scale)}] /Contents ${contentId} 0 R /Resources << ${gsRes} ${xobj} >> >>`;
  }
  objs[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((i) => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`;
  const safeTitle = title.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[()\\]/g, '');
  const infoId = add(`<< /Title (${safeTitle}) /Producer (Notizkonverter) >>`);

  let out = '%PDF-1.7\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += String(off).padStart(10, '0') + ' 00000 n \n';
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
