/**
 * pdf.js in the interface: pages are rendered to canvases for the sheet viewer, the
 * thumbnails and the pixel comparison, and the page text is read for search and for
 * guessing the sheet number and title from the title block.
 */
import type * as PdfJs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// pdf.js is loaded on first use: it is large, needs browser globals that tests lack, and
// most sessions never open a sheet.
let library: Promise<typeof PdfJs> | null = null;
function pdfjs(): Promise<typeof PdfJs> {
  if (!library) {
    library = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString();
      return lib;
    });
  }
  return library;
}

export type PdfDocument = PDFDocumentProxy;

export interface PageText {
  /** Whole page text with line breaks where the layout breaks.*/
  text: string;
  /** Text runs in page fractions from the top-left corner. */
  runs: TextRun[];
}

export interface TextRun {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function loadPdf(bytes: Uint8Array): Promise<PdfDocument> {
  // pdf.js takes ownership of the buffer it is given; hand it a copy.
  return (await pdfjs()).getDocument({ data: bytes.slice() }).promise;
}

export async function pageSize(
  doc: PdfDocument,
  page: number,
): Promise<{ width: number; height: number }> {
  const p = await doc.getPage(page);
  const viewport = p.getViewport({ scale: 1 });
  return { width: viewport.width, height: viewport.height };
}

/** Renders a page so that it is `width` CSS pixels wide (times the device ratio). */
export async function renderPage(
  doc: PdfDocument,
  page: number,
  width: number,
  canvas: HTMLCanvasElement,
  pixelRatio = window.devicePixelRatio || 1,
): Promise<{ width: number; height: number; scale: number }> {
  const p = await doc.getPage(page);
  const base = p.getViewport({ scale: 1 });
  const scale = width / base.width;
  const viewport = p.getViewport({ scale: scale * pixelRatio });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width / pixelRatio)}px`;
  canvas.style.height = `${Math.ceil(viewport.height / pixelRatio)}px`;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('canvas has no 2d context');
  await p.render({ canvasContext: context, viewport, canvas }).promise;
  return { width: viewport.width, height: viewport.height, scale };
}

/** A small PNG of the page as a data URL. */
export async function thumbnail(doc: PdfDocument, page: number, width = 240): Promise<string> {
  const canvas = document.createElement('canvas');
  await renderPage(doc, page, width, canvas, 1);
  return canvas.toDataURL('image/png');
}

export async function pageText(doc: PdfDocument, page: number): Promise<PageText> {
  const p: PDFPageProxy = await doc.getPage(page);
  const viewport = p.getViewport({ scale: 1 });
  const content = await p.getTextContent();
  const runs: TextRun[] = [];
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const t = item as TextItem;
    if (!t.str.trim()) continue;
    // transform = [a, b, c, d, e, f]; (e, f) is the baseline origin in PDF space (y up).
    const [a, b, , , e, f] = t.transform as number[];
    const fontHeight = Math.hypot(a ?? 0, b ?? 0) || t.height;
    runs.push({
      text: t.str,
      x: (e ?? 0) / viewport.width,
      y: 1 - ((f ?? 0) + fontHeight) / viewport.height,
      w: t.width / viewport.width,
      h: fontHeight / viewport.height,
    });
  }
  // Reading order: top to bottom, then left to right, with a break between lines.
  const sorted = [...runs].sort((p1, p2) => p1.y - p2.y || p1.x - p2.x);
  let text = '';
  let lastY = -1;
  for (const r of sorted) {
    if (lastY >= 0 && Math.abs(r.y - lastY) > r.h * 0.6) text += '\n';
    else if (text && !text.endsWith('\n')) text += ' ';
    text += r.text.trim();
    lastY = r.y;
  }
  return { text, runs };
}

const NUMBER_PATTERN = /^[A-Z]{1,3}[- ]?\d{2,4}[A-Z]?$/;
const LABELS = /^(SHEET|DWG|DRAWING|SHT)\.?\s*(NO|NUMBER|#)?\.?:?$/i;
const TITLE_LABELS = /^(TITLE|DRAWING TITLE|SHEET TITLE):?$/i;

/**
 * Guesses the sheet number and title from the title block, which almost always sits in
 * the bottom-right corner. The number is a short code like S-101; the title is the most
 * prominent line of capitals in that corner that is not the number, a label or a date.
 */
export function guessSheetFields(runs: TextRun[]): { number: string | null; title: string | null } {
  const corner = runs.filter((r) => r.y > 0.72 && r.x > 0.55);
  const pool = corner.length >= 2 ? corner : runs.filter((r) => r.y > 0.72);
  let number: string | null = null;
  // A value next to a "Sheet No" label wins; else the first code-like run.
  for (const r of pool) {
    if (LABELS.test(r.text.trim())) {
      const near = pool
        .filter((c) => c !== r && Math.abs(c.y - r.y) < 0.03 && c.x > r.x)
        .sort((a, b) => a.x - b.x)[0];
      const below = pool
        .filter((c) => c !== r && c.y > r.y && c.y - r.y < 0.05 && Math.abs(c.x - r.x) < 0.1)
        .sort((a, b) => a.y - b.y)[0];
      const candidate = (near ?? below)?.text.trim();
      if (candidate && NUMBER_PATTERN.test(candidate)) {
        number = candidate;
        break;
      }
    }
  }
  if (!number) {
    const code = pool
      .filter((r) => NUMBER_PATTERN.test(r.text.trim()))
      .sort((a, b) => b.y - a.y || b.x - a.x)[0];
    number = code?.text.trim() ?? null;
  }
  const titleCandidates = pool
    .filter((r) => {
      const t = r.text.trim();
      return (
        t.length >= 6 &&
        t !== number &&
        !NUMBER_PATTERN.test(t) &&
        !LABELS.test(t) &&
        !TITLE_LABELS.test(t) &&
        !/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(t) &&
        /[A-Z]/.test(t) &&
        t === t.toUpperCase()
      );
    })
    .sort((a, b) => b.h - a.h || b.text.length - a.text.length);
  const title = titleCandidates[0]?.text.trim() ?? null;
  return { number, title };
}

/**
 * Pixel comparison of two renderings of the same size. Returns an image where ink only in
 * `a` is blue, ink only in `b` is red and shared ink is dark, plus the changed blocks of a
 * grid in page fractions.
 */
export function comparePixels(
  a: ImageData,
  b: ImageData,
  block = 24,
): { image: ImageData; changed: { x: number; y: number; w: number; h: number }[] } {
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  const out = new ImageData(w, h);
  const cols = Math.ceil(w / block);
  const rows = Math.ceil(h / block);
  const diff = new Float32Array(cols * rows);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ia = (y * a.width + x) * 4;
      const ib = (y * b.width + x) * 4;
      const inkA = 255 - (a.data[ia]! + a.data[ia + 1]! + a.data[ia + 2]!) / 3;
      const inkB = 255 - (b.data[ib]! + b.data[ib + 1]! + b.data[ib + 2]!) / 3;
      const o = (y * w + x) * 4;
      // White paper; A's ink takes red and green away (blue), B's takes green and blue (red).
      out.data[o] = 255 - inkA;
      out.data[o + 1] = 255 - Math.max(inkA, inkB);
      out.data[o + 2] = 255 - inkB;
      out.data[o + 3] = 255;
      const d = Math.abs(inkA - inkB);
      if (d > 64) diff[Math.floor(y / block) * cols + Math.floor(x / block)]! += 1;
    }
  }
  const changed: { x: number; y: number; w: number; h: number }[] = [];
  const threshold = Math.max(4, (block * block) / 200);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (diff[r * cols + c]! >= threshold) {
        changed.push({ x: (c * block) / w, y: (r * block) / h, w: block / w, h: block / h });
      }
    }
  }
  return { image: out, changed: mergeBlocks(changed) };
}

/** Joins touching blocks into larger rectangles so a change reads as one region. */
function mergeBlocks(blocks: { x: number; y: number; w: number; h: number }[]) {
  const out = [...blocks];
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const p = out[i]!;
        const q = out[j]!;
        const eps = 1e-6;
        const touch =
          p.x <= q.x + q.w + eps &&
          q.x <= p.x + p.w + eps &&
          p.y <= q.y + q.h + eps &&
          q.y <= p.y + p.h + eps;
        if (touch) {
          const x = Math.min(p.x, q.x);
          const y = Math.min(p.y, q.y);
          const r = {
            x,
            y,
            w: Math.max(p.x + p.w, q.x + q.w) - x,
            h: Math.max(p.y + p.h, q.y + q.h) - y,
          };
          out.splice(j, 1);
          out.splice(i, 1, r);
          merged = true;
          break outer;
        }
      }
    }
  }
  return out;
}
