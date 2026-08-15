/**
 * Deck → PPTX. The slides in src/components/deck/deck-content.ts are the source
 * of truth; this turns them into a file you can hand over, drop into Google
 * Slides, or present offline. Edit the content module, run `bun run deck`, done
 * — never the other way round.
 *
 *   bun run deck            → public/utxopia-deck.pptx
 *   bun run deck --out x    → somewhere else
 *   bun run deck --pdf      → also refresh the PDF served on /careers
 *
 * The PDF step needs LibreOffice (`brew install --cask libreoffice`); without
 * it the pptx still gets written and the PDF is left alone.
 *
 * Layout mirrors slides.tsx block for block, in inches instead of Tailwind.
 * Icons are the one thing that doesn't survive the trip: PowerPoint has no
 * usable SVG path, so an icon becomes a tinted chip in the same spot.
 */

import { execFileSync } from "node:child_process";
import pptxgen from "pptxgenjs";
import { SLIDES, type Accent, type Block, type Card, type Slide } from "../src/components/deck/deck-content";

// Same tokens as src/styles/base.css, without the alpha — pptx does opacity per
// shape, so tints are expressed as `transparency` at the call site.
const BG = "0F0F12";
const FG = "F1F0F3";
const GRAY = "8B8A9E";
const GRAY_LIGHT = "C7C5D1";
const CARD_BG = "16161B";
const BORDER = "2C2C36";
const BTC = "F7931A";
const PRIVACY = "A674FF";

const FONT = "Inter";

const W = 13.333;
const H = 7.5;
const M = 0.62; // page margin
const CW = W - M * 2; // content width
const GAP = 0.22;

const BODY_BOTTOM = 6.45; // where the body must stop; footnote lives below
const accentOf = (a: Accent = "btc") => (a === "privacy" ? PRIVACY : BTC);

type Slot = { y: number; h: number };

/** Blocks that size to their content. Everything else absorbs the slack. */
function fixedHeight(block: Block): number | null {
  switch (block.kind) {
    case "pills":
      return 0.45;
    case "flow":
      return 1.55;
    case "callout":
      return block.boxed ? 0.85 : 0.45;
    case "links":
      return 0.75;
    default:
      return null;
  }
}

/** Stack the blocks top to bottom, sharing what's left between the flexible ones. */
function layout(blocks: Block[], top: number): Slot[] {
  const total = BODY_BOTTOM - top - GAP * (blocks.length - 1);
  const fixed = blocks.map(fixedHeight);
  const flexCount = fixed.filter((h) => h === null).length;
  const flexHeight = flexCount
    ? (total - fixed.reduce<number>((sum, h) => sum + (h ?? 0), 0)) / flexCount
    : 0;

  let y = top;
  return blocks.map((_, i) => {
    const h = fixed[i] ?? flexHeight;
    const slot = { y, h };
    y += h + GAP;
    return slot;
  });
}

const card = (s: pptxgen.Slide, x: number, y: number, w: number, h: number, opts?: { accent?: Accent; tinted?: boolean }) =>
  s.addShape("roundRect", {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    fill: opts?.tinted
      ? { color: accentOf(opts.accent), transparency: 94 }
      : { color: CARD_BG },
    line: opts?.tinted
      ? { color: accentOf(opts.accent), width: 1, transparency: 60 }
      : { color: BORDER, width: 1 },
  });

function drawCard(s: pptxgen.Slide, c: Card, x: number, y: number, w: number, h: number) {
  card(s, x, y, w, h);
  const pad = 0.26;
  let ty = y + pad;

  if (c.icon) {
    // No SVG in pptx: the chip keeps the card's vertical rhythm without it.
    s.addShape("roundRect", {
      x: x + pad,
      y: ty,
      w: 0.34,
      h: 0.34,
      rectRadius: 0.5,
      fill: { color: accentOf(c.accent), transparency: 82 },
      line: { color: accentOf(c.accent), width: 0.75, transparency: 50 },
    });
    ty += 0.52;
  }

  s.addText(c.title, {
    x: x + pad,
    y: ty,
    w: w - pad * 2,
    h: 0.3,
    fontFace: FONT,
    fontSize: 13,
    bold: true,
    color: FG,
    valign: "top",
  });

  const bodyTop = ty + 0.34;
  const noteH = c.note ? 0.62 : 0;
  s.addText(c.body, {
    x: x + pad,
    y: bodyTop,
    w: w - pad * 2,
    h: Math.max(0.3, y + h - pad - bodyTop - noteH),
    fontFace: FONT,
    fontSize: 10,
    color: GRAY,
    lineSpacingMultiple: 1.25,
    valign: "top",
    fit: "shrink",
  });

  if (c.note) {
    s.addText(c.note, {
      x: x + pad,
      y: y + h - pad - noteH,
      w: w - pad * 2,
      h: noteH,
      fontFace: FONT,
      fontSize: 10,
      color: accentOf(c.accent),
      lineSpacingMultiple: 1.25,
      valign: "bottom",
      fit: "shrink",
    });
  }
}

function drawBlock(s: pptxgen.Slide, block: Block, { y, h }: Slot) {
  switch (block.kind) {
    case "pills": {
      let x = M;
      for (const label of block.items) {
        const w = 0.42 + label.length * 0.085;
        s.addShape("roundRect", {
          x,
          y,
          w,
          h: 0.42,
          rectRadius: 0.5,
          fill: { color: BTC, transparency: 92 },
          line: { color: BTC, width: 1, transparency: 55 },
        });
        s.addText(label, {
          x,
          y,
          w,
          h: 0.42,
          fontFace: FONT,
          fontSize: 11,
          bold: true,
          color: BTC,
          align: "center",
          valign: "middle",
        });
        x += w + 0.16;
      }
      return;
    }

    case "cards": {
      const { cols, items } = block;
      const rows = Math.ceil(items.length / cols);
      const cw = (CW - GAP * (cols - 1)) / cols;
      const ch = (h - GAP * (rows - 1)) / rows;
      items.forEach((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        drawCard(s, c, M + col * (cw + GAP), y + row * (ch + GAP), cw, ch);
      });
      return;
    }

    case "flow": {
      const n = block.items.length;
      const arrow = 0.34;
      const bw = (CW - arrow * (n - 1)) / n;
      block.items.forEach((step, i) => {
        const x = M + i * (bw + arrow);
        card(s, x, y, bw, h, { accent: step.accent, tinted: Boolean(step.accent) });
        s.addText(step.title, {
          x: x + 0.24,
          y: y + 0.24,
          w: bw - 0.48,
          h: 0.3,
          fontFace: FONT,
          fontSize: 13,
          bold: true,
          color: step.accent ? accentOf(step.accent) : FG,
        });
        s.addText(step.body, {
          x: x + 0.24,
          y: y + 0.62,
          w: bw - 0.48,
          h: h - 0.86,
          fontFace: FONT,
          fontSize: 10,
          color: GRAY,
          lineSpacingMultiple: 1.25,
          valign: "top",
          fit: "shrink",
        });
        if (i < n - 1) {
          s.addText("→", {
            x: x + bw,
            y,
            w: arrow,
            h,
            fontFace: FONT,
            fontSize: 14,
            color: BTC,
            align: "center",
            valign: "middle",
          });
        }
      });
      return;
    }

    case "numbered": {
      const n = block.items.length;
      const ih = (h - 0.16 * (n - 1)) / n;
      block.items.forEach((item, i) => {
        const iy = y + i * (ih + 0.16);
        card(s, M, iy, CW, ih);
        s.addShape("ellipse", {
          x: M + 0.26,
          y: iy + ih / 2 - 0.19,
          w: 0.38,
          h: 0.38,
          fill: { color: BTC, transparency: 88 },
          line: { color: BTC, width: 1, transparency: 40 },
        });
        s.addText(String(i + 1), {
          x: M + 0.26,
          y: iy + ih / 2 - 0.19,
          w: 0.38,
          h: 0.38,
          fontFace: FONT,
          fontSize: 11,
          color: BTC,
          align: "center",
          valign: "middle",
        });
        s.addText(item.title, {
          x: M + 0.85,
          y: iy + 0.22,
          w: CW - 1.1,
          h: 0.28,
          fontFace: FONT,
          fontSize: 13,
          bold: true,
          color: FG,
        });
        s.addText(item.body, {
          x: M + 0.85,
          y: iy + 0.52,
          w: CW - 1.1,
          h: ih - 0.72,
          fontFace: FONT,
          fontSize: 10,
          color: GRAY,
          valign: "top",
          fit: "shrink",
        });
      });
      return;
    }

    case "callout": {
      const pad = block.boxed ? 0.28 : 0;
      if (block.boxed) {
        s.addShape("roundRect", {
          x: M,
          y,
          w: CW,
          h,
          rectRadius: 0.08,
          fill: { color: accentOf(block.accent), transparency: 95 },
          line: { color: accentOf(block.accent), width: 1, transparency: 55 },
        });
      }
      s.addText(
        [
          ...(block.label
            ? [{ text: `${block.label} `, options: { bold: true, color: accentOf(block.accent) } }]
            : []),
          { text: block.body, options: { color: GRAY_LIGHT } },
        ],
        {
          x: M + pad,
          y,
          w: CW - pad * 2,
          h,
          fontFace: FONT,
          fontSize: 11,
          lineSpacingMultiple: 1.3,
          valign: "middle",
          fit: "shrink",
        },
      );
      return;
    }

    case "links": {
      const n = block.items.length;
      const lw = (CW - GAP * (n - 1)) / n;
      block.items.forEach((l, i) => {
        const x = M + i * (lw + GAP);
        card(s, x, y, lw, h);
        s.addText(l.label, {
          x,
          y,
          w: lw,
          h,
          fontFace: FONT,
          fontSize: 11,
          color: BTC,
          align: "center",
          valign: "middle",
          hyperlink: { url: l.href },
          fit: "shrink",
        });
      });
      return;
    }
  }
}

/** Slide 1 is the only one that isn't kicker-over-title: it's the brand mark. */
function drawTitleSlide(s: pptxgen.Slide, slide: Slide) {
  s.addText("UTXOpia", {
    x: M,
    y: 1.85,
    w: 7.5,
    h: 1,
    fontFace: FONT,
    fontSize: 54,
    bold: true,
    color: FG,
  });
  s.addText(slide.title, {
    x: M,
    y: 2.95,
    w: 7.5,
    h: 0.5,
    fontFace: FONT,
    fontSize: 20,
    bold: true,
    color: BTC,
  });
  if (slide.blocks) drawBlock(s, slide.blocks[0], { y: 3.7, h: 0.45 });
  if (slide.lead) {
    s.addText(slide.lead, {
      x: M,
      y: 4.6,
      w: 7.2,
      h: 1,
      fontFace: FONT,
      fontSize: 12,
      italic: true,
      color: GRAY_LIGHT,
      lineSpacingMultiple: 1.35,
      valign: "top",
    });
  }
  s.addImage({ path: "public/brand/logo-transparent-1024.png", x: 8.9, y: 1.9, w: 3.2, h: 3.2 });
}

function drawSlide(deck: pptxgen, slide: Slide) {
  const s = deck.addSlide();
  s.background = { color: BG };

  if (slide.n === 1) {
    drawTitleSlide(s, slide);
  } else {
    s.addText(slide.kicker.toUpperCase(), {
      x: M,
      y: 0.42,
      w: CW,
      h: 0.25,
      fontFace: FONT,
      fontSize: 10,
      bold: true,
      charSpacing: 1.2,
      color: BTC,
    });
    s.addText(slide.title, {
      x: M,
      y: 0.72,
      w: CW,
      h: slide.n === 10 ? 1.9 : 0.7,
      fontFace: FONT,
      fontSize: slide.n === 10 ? 34 : 30,
      bold: true,
      color: FG,
      lineSpacingMultiple: 1.15,
      valign: "top",
    });

    let top = 1.62;
    if (slide.lead) {
      s.addText(slide.lead, {
        x: M,
        y: 1.55,
        w: CW - 1.5,
        h: 0.4,
        fontFace: FONT,
        fontSize: 12,
        color: GRAY_LIGHT,
        valign: "top",
      });
      top = 2.1;
    }
    if (slide.n === 10) top = 3.1;

    if (slide.blocks) {
      const slots = layout(slide.blocks, top);
      slide.blocks.forEach((b, i) => drawBlock(s, b, slots[i]));
    }
  }

  if (slide.footnote) {
    s.addText(slide.footnote, {
      x: M,
      y: 6.72,
      w: CW - 1.6,
      h: 0.4,
      fontFace: FONT,
      fontSize: 11,
      bold: true,
      italic: true,
      color: BTC,
      valign: "middle",
      fit: "shrink",
    });
  }

  s.addText(`UTXOpia · ${String(slide.n).padStart(2, "0")}`, {
    x: W - M - 1.6,
    y: 6.95,
    w: 1.6,
    h: 0.25,
    fontFace: FONT,
    fontSize: 9,
    color: GRAY,
    align: "right",
  });
}

const outFlag = process.argv.indexOf("--out");
const out = outFlag > -1 ? process.argv[outFlag + 1] : "public/utxopia-deck.pptx";

const deck = new pptxgen();
deck.defineLayout({ name: "16x9", width: W, height: H });
deck.layout = "16x9";
deck.author = "UTXOpia";
deck.company = "UTXOpia";
deck.title = "UTXOpia — put idle bitcoin to work without giving it up";

SLIDES.forEach((slide) => drawSlide(deck, slide));
await deck.writeFile({ fileName: out });
console.log(`${SLIDES.length} slides → ${out}`);

if (process.argv.includes("--pdf")) {
  const soffice = ["soffice", "/Applications/LibreOffice.app/Contents/MacOS/soffice"].find((bin) => {
    try {
      execFileSync(bin, ["--version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!soffice) {
    console.log("skipped --pdf: LibreOffice not found (brew install --cask libreoffice)");
  } else {
    const dir = out.slice(0, out.lastIndexOf("/")) || ".";
    execFileSync(soffice, ["--headless", "--convert-to", "pdf", "--outdir", dir, out], {
      stdio: "ignore",
    });
    console.log(`→ ${out.replace(/\.pptx$/, ".pdf")}`);
  }
}
