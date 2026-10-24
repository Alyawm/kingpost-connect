// Writes two revisions of a small general-arrangement drawing set as PDFs, with a title
// block (sheet number and title) on every page, a grid and a few framing members drawn
// as lines and text. Revision B changes one beam size and adds a note on the ground
// floor plan, so the sheet comparison has something to find.
//
//   node scripts/make-sample-drawings.mjs samples/public/drawings
//
// The PDFs are written by hand (uncompressed content streams, a classic xref table), so
// nothing beyond Node is needed.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.argv[2] ?? 'samples/public/drawings';
mkdirSync(outDir, { recursive: true });

const W = 1190.55; // A3 landscape, points
const H = 841.89;

function esc(text) {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function text(x, y, size, str, font = 'F1') {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(str)}) Tj ET\n`;
}

function line(x1, y1, x2, y2, width = 1) {
  return `${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S\n`;
}

function rect(x, y, w, h, width = 1) {
  return `${width} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S\n`;
}

function titleBlock(number, title, revision) {
  let s = '';
  s += rect(20, 20, W - 40, H - 40, 2); // border
  s += rect(W - 380, 20, 360, 150, 1.5); // title block
  s += line(W - 380, 110, W - 20, 110, 1);
  s += line(W - 200, 20, W - 200, 110, 1);
  s += text(W - 370, 150, 11, 'KINGPOST CONNECT SAMPLE PROJECT');
  s += text(W - 370, 132, 9, 'WORKSHOP BUILDING - STRUCTURAL');
  s += text(W - 370, 118, 8, `REV ${revision}    DATE 24/10/2026    SCALE 1:100`);
  s += text(W - 370, 92, 8, 'TITLE');
  s += text(W - 370, 60, 16, title, 'F2');
  s += text(W - 190, 92, 8, 'SHEET NO');
  s += text(W - 190, 50, 24, number, 'F2');
  return s;
}

function grid(cols, rows, x0, y0, dx, dy) {
  let s = '';
  for (let c = 0; c < cols; c++) {
    const x = x0 + c * dx;
    s += line(x, y0 - 30, x, y0 + (rows - 1) * dy + 30, 0.4);
    s += text(x - 4, y0 + (rows - 1) * dy + 40, 12, String.fromCharCode(65 + c));
  }
  for (let r = 0; r < rows; r++) {
    const y = y0 + r * dy;
    s += line(x0 - 30, y, x0 + (cols - 1) * dx + 30, y, 0.4);
    s += text(x0 - 50, y - 4, 12, String(r + 1));
  }
  return s;
}

function framingPlan(revision) {
  const x0 = 120;
  const y0 = 260;
  const dx = 160;
  const dy = 140;
  let s = grid(5, 4, x0, y0, dx, dy);
  // Columns at every grid intersection.
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 4; r++) {
      s += rect(x0 + c * dx - 8, y0 + r * dy - 8, 16, 16, 1.2);
    }
  }
  // Beams along the grid lines with their marks.
  let mark = 1;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const x = x0 + c * dx;
      const y = y0 + r * dy;
      s += line(x + 8, y, x + dx - 8, y, 2);
      const size = revision === 'B' && r === 1 && c === 2 ? '800x750' : '800x700';
      s += text(x + 40, y + 6, 7, `B${mark} ${size}`);
      mark += 1;
    }
  }
  for (let c = 0; c < 5; c++) {
    for (let r = 0; r < 3; r++) {
      const x = x0 + c * dx;
      const y = y0 + r * dy;
      s += line(x, y + 8, x, y + dy - 8, 2);
    }
  }
  s += text(x0, y0 + 3 * dy + 70, 14, 'GROUND FLOOR FRAMING PLAN  1:100', 'F2');
  if (revision === 'B') {
    s += rect(x0 + 2 * dx + 20, y0 + dy - 30, 120, 20, 0.8);
    s += text(x0 + 2 * dx + 26, y0 + dy - 24, 8, 'REV B: B11 DEEPENED');
  }
  return s;
}

function coverSheet(revision) {
  let s = '';
  s += text(120, 700, 28, 'WORKSHOP BUILDING', 'F2');
  s += text(120, 660, 18, 'STRUCTURAL DRAWINGS - GENERAL ARRANGEMENT', 'F2');
  s += text(120, 600, 12, 'SHEET INDEX');
  s += text(120, 575, 11, 'S-000   COVER SHEET');
  s += text(120, 557, 11, 'S-101   GROUND FLOOR FRAMING PLAN');
  s += text(120, 539, 11, 'S-201   SECTION A-A');
  if (revision === 'B') s += text(120, 500, 11, 'REVISION B - BEAM B11 DEEPENED TO 800x750');
  return s;
}

function section(revision) {
  let s = '';
  const x0 = 200;
  const y0 = 250;
  s += line(x0 - 40, y0, x0 + 700, y0, 2); // ground
  for (let c = 0; c < 5; c++) {
    const x = x0 + c * 160;
    s += rect(x - 8, y0, 16, 320, 1.2);
    s += text(x - 4, y0 + 335, 10, String.fromCharCode(65 + c));
  }
  for (let level = 1; level <= 2; level++) {
    const y = y0 + level * 150;
    s += line(x0, y, x0 + 640, y, 2);
    s += text(x0 + 660, y - 4, 9, level === 1 ? 'LEVEL 1  +4.000' : 'ROOF  +8.000');
  }
  s += text(x0, y0 + 400, 14, 'SECTION A-A  1:100', 'F2');
  if (revision === 'B') s += text(x0 + 300, y0 + 160, 8, 'B11 800x750');
  return s;
}

function buildPdf(revision) {
  const pages = [
    { number: 'S-000', title: 'COVER SHEET', body: coverSheet(revision) },
    { number: 'S-101', title: 'GROUND FLOOR FRAMING PLAN', body: framingPlan(revision) },
    { number: 'S-201', title: 'SECTION A-A', body: section(revision) },
  ];
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  const pageIds = [];
  for (const page of pages) {
    const content = page.body + titleBlock(page.number, page.title, revision);
    const stream = add(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`,
    );
    const id = add(
      `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${stream} 0 R >>`,
    );
    pageIds.push(id);
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

for (const revision of ['A', 'B']) {
  const file = join(outDir, `workshop-GA-rev${revision}.pdf`);
  writeFileSync(file, buildPdf(revision));
  console.log('wrote', file);
}
