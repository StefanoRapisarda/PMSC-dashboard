/**
 * Saving a picture of the graph, as PNG or as PDF.
 *
 * Two things make this less trivial than calling Cytoscape's own `png()`.
 *
 * The first is that Cytoscape does not draw the whole picture. The stage rings
 * of the shell view and the hulls of the clustered views live on a canvas of our
 * own, sitting over Cytoscape's. An export that skipped it would drop exactly
 * the labels that say what the positions mean.
 *
 * The second is that our canvas is drawn in SCREEN coordinates for the viewport
 * as it currently stands, so it cannot simply be scaled up for a "whole graph"
 * export. Rather than teach the overlay to draw itself in graph coordinates, the
 * detailed export briefly frames the whole graph on screen, lets the overlay
 * repaint itself the way it always does, takes the picture, and puts the
 * viewport back. The rings then cannot disagree with the nodes, because they are
 * the same rings the reader was just looking at.
 */
import type { Core } from 'cytoscape';

/** What the graph sits on. Kept in step with .graphwrap in the page. */
const BACKDROP = '#0c1320';
/** How much sharper than the screen an exported picture is. Two is the
    difference between a figure that survives a projector and one that does. */
const SCALE = 2;

export interface Caption {
  /** the study and the view, for someone reading the file weeks later */
  title: string;
  /** short lines: layout, what is on screen, which filters were on, the date */
  lines: string[];
}

export interface GraphShot {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Compose one picture out of Cytoscape's canvas and ours.
 *
 * The order matters and follows what the browser does: the overlay carries
 * z-index 1 over an unpositioned host, so it paints on top.
 */
async function compose(cy: Core, overlay: HTMLCanvasElement | null,
                       caption: Caption | null): Promise<GraphShot> {
  const shot = cy.png({ output: 'base64uri', full: false, scale: SCALE, bg: BACKDROP });
  const image = await loadImage(shot);

  const capHeight = caption ? captionHeight(caption) : 0;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height + capHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');

  ctx.fillStyle = BACKDROP;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  if (overlay && overlay.width && overlay.height) {
    ctx.drawImage(overlay, 0, 0, image.width, image.height);
  }
  if (caption) drawCaption(ctx, caption, image.height, canvas.width);

  return { canvas, width: canvas.width, height: canvas.height };
}

/** Exactly what is on screen, at twice the resolution. */
export function currentView(cy: Core, overlay: HTMLCanvasElement | null) {
  return compose(cy, overlay, null);
}

/**
 * The whole graph, with a caption recording what it is.
 *
 * The viewport is moved to frame everything and then put back. `onFramed` gives
 * the caller a chance to repaint the overlay for the new viewport before the
 * picture is taken, which is how the rings and hulls stay correct.
 */
export async function detailedView(cy: Core, overlay: HTMLCanvasElement | null,
                                   caption: Caption,
                                   onFramed?: () => void): Promise<GraphShot> {
  const pan = { ...cy.pan() };
  const zoom = cy.zoom();
  try {
    cy.fit(undefined, 40);
    onFramed?.();
    /* two frames: one for Cytoscape to render the new viewport, one for the
       overlay to be repainted off the render event that follows it */
    await frame();
    await frame();
    return await compose(cy, overlay, caption);
  } finally {
    cy.viewport({ zoom, pan });
    onFramed?.();
  }
}

/**
 * A picture of part of the page, for the views that are HTML rather than canvas.
 * The whole-path timeline is one of those.
 *
 * A dialog is a fixed-size window onto content that scrolls inside it, so
 * photographing it as it stands gives you the window rather than the content:
 * the first export of the timeline lost the lab cards off the right and the
 * footnote off the bottom. What is captured instead is a copy of the element,
 * parked off-screen with every scroller opened out, so the whole thing is laid
 * out at once. The copy means nothing the reader is looking at moves.
 */
export async function elementShot(element: HTMLElement,
                                  background: string): Promise<GraphShot> {
  /* imported lazily so that a page which never exports never pays for it */
  const { toCanvas } = await import('html-to-image');

  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed; left:-100000px; top:0; z-index:-1;';
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = 'static';
  clone.style.transform = 'none';
  clone.style.maxHeight = 'none';
  clone.style.maxWidth = 'none';
  clone.style.height = 'auto';
  clone.style.width = `${element.clientWidth}px`;

  /* Open every scroller. The computed style has to be read from the ORIGINAL,
     because a clone that is not yet in the document has no computed style of its
     own. Both trees are walked in the same order, so the two line up. */
  const originals = element.querySelectorAll<HTMLElement>('*');
  const copies = clone.querySelectorAll<HTMLElement>('*');
  originals.forEach((source, i) => {
    const copy = copies[i];
    if (!copy) return;
    const css = getComputedStyle(source);
    if (css.overflowX !== 'visible' || css.overflowY !== 'visible') {
      copy.style.overflow = 'visible';
      copy.style.maxHeight = 'none';
      copy.style.maxWidth = 'none';
    }
  });

  /* Controls belong to the app, not to the picture. Anything marked
     data-noexport is dropped from the copy: a saved timeline with a greyed-out
     Save button printed on it looks like a screenshot of an app rather than a
     figure. */
  clone.querySelectorAll('[data-noexport]').forEach((el) => el.remove());

  holder.appendChild(clone);
  document.body.appendChild(holder);
  try {
    const canvas = await toCanvas(clone, {
      backgroundColor: background,
      pixelRatio: SCALE,
      width: clone.scrollWidth,
      height: clone.scrollHeight,
    });
    return { canvas, width: canvas.width, height: canvas.height };
  } finally {
    holder.remove();
  }
}

export function savePng(shot: GraphShot, filename: string) {
  shot.canvas.toBlob((blob) => { if (blob) download(blob, `${filename}.png`); }, 'image/png');
}

/**
 * The same picture as a PDF, on a page cut to fit it.
 *
 * A fixed A4 page would letterbox a wide graph into a strip down the middle of
 * the sheet. Sizing the page to the picture means the PDF is the picture, which
 * is what someone dropping it into a report wants.
 */
export async function savePdf(shot: GraphShot, filename: string) {
  const { jsPDF } = await import('jspdf');
  /* points, at 96 dpi, halved back down from the export scale */
  const w = (shot.width / SCALE) * 0.75;
  const h = (shot.height / SCALE) * 0.75;
  const pdf = new jsPDF({
    orientation: w >= h ? 'landscape' : 'portrait',
    unit: 'pt', format: [w, h], compress: true,
  });
  pdf.addImage(shot.canvas.toDataURL('image/png'), 'PNG', 0, 0, w, h);
  pdf.save(`${filename}.pdf`);
}

/** A filename that sorts by date and says what it is. */
export function stamp(what: string, when = new Date()): string {
  const iso = when.toISOString().slice(0, 10);
  return `pmsc-${what}-${iso}`;
}

// ---------------------------------------------------------------- internals

const CAP_PAD = 18 * SCALE, CAP_TITLE = 20 * SCALE, CAP_LINE = 17 * SCALE;

function captionHeight(caption: Caption): number {
  return CAP_PAD * 2 + CAP_TITLE + caption.lines.length * CAP_LINE;
}

function drawCaption(ctx: CanvasRenderingContext2D, caption: Caption,
                     top: number, width: number) {
  ctx.fillStyle = '#080d16';
  ctx.fillRect(0, top, width, captionHeight(caption));
  ctx.strokeStyle = 'rgba(142, 160, 186, .35)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, top + 0.5); ctx.lineTo(width, top + 0.5); ctx.stroke();

  let y = top + CAP_PAD + CAP_TITLE * 0.75;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e8eef7';
  ctx.font = `700 ${13 * SCALE}px system-ui, sans-serif`;
  ctx.fillText(caption.title, CAP_PAD, y);

  ctx.fillStyle = '#aeb9c9';
  ctx.font = `400 ${11.5 * SCALE}px system-ui, sans-serif`;
  for (const line of caption.lines) {
    y += CAP_LINE;
    ctx.fillText(line, CAP_PAD, y);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not read the rendered graph'));
    image.src = src;
  });
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  /* the object URL holds the whole image in memory until it is let go */
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
