/**
 * SVG primitives for the technical architecture diagrams.
 *
 * No hooks — these render as server components. Arrow markers are defined once
 * per page by <SvgDefs />; every diagram references them by fixed id.
 */

import type { ReactNode } from "react";

export type Tone = "btc" | "sol" | "zk" | "ika" | "er" | "gray";

export const TONE_COLOR: Record<Tone, string> = {
  btc: "var(--color-btc)",
  sol: "var(--color-privacy)",
  zk: "var(--color-purple)",
  ika: "var(--color-warning)",
  er: "var(--color-cyan)",
  gray: "var(--color-gray)",
};

const stroke = (t: Tone, pct = 45) =>
  `color-mix(in srgb, ${TONE_COLOR[t]} ${pct}%, transparent)`;
const fill = (t: Tone, pct = 9) =>
  `color-mix(in srgb, ${TONE_COLOR[t]} ${pct}%, transparent)`;

const MONO = "ui-monospace, SFMono-Regular, Menlo, monospace";

/** Step numbers live in a left gutter — message labels are often wider than
 *  the arrow they sit on, so a badge on the line would land under the text. */
const GUTTER = 26;

function StepBadge({ n, y, tone }: { n: number; y: number; tone: Tone }) {
  return (
    <g>
      <circle
        cx={GUTTER}
        cy={y}
        r={9}
        fill={fill(tone, 16)}
        stroke={stroke(tone, 45)}
      />
      <text
        x={GUTTER}
        y={y + 3.5}
        textAnchor="middle"
        fontSize={9}
        fontFamily={MONO}
        fill={stroke(tone, 95)}
      >
        {n}
      </text>
    </g>
  );
}

/* ── page-level marker defs ── */

export function SvgDefs() {
  return (
    <svg width="0" height="0" aria-hidden className="absolute">
      <defs>
        {(Object.keys(TONE_COLOR) as Tone[]).map((t) => (
          <marker
            key={t}
            id={`ux-arw-${t}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke(t, 75)} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}

/* ── frame ── */

export function DiagramFrame({
  title,
  note,
  viewBox,
  minWidth = 880,
  legend,
  children,
}: {
  title: string;
  note?: string;
  viewBox: string;
  minWidth?: number;
  legend?: { tone: Tone; label: string }[];
  children: ReactNode;
}) {
  return (
    // Figures break out past the prose column on wide screens. The measure that
    // suits a paragraph starves a schematic: at the text width these render at
    // 0.93 scale, so a nominal 9.5px label reaches the reader at 8.8px.
    <figure className="my-6 rounded-xl border border-gray/10 bg-muted/20 lg:-mx-8 xl:-mx-20">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-gray/10 px-4 py-3 sm:px-5">
        <span className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
          {title}
        </span>
        {note && (
          <span className="font-mono text-[12px] text-gray/60">{note}</span>
        )}
      </figcaption>

      {/* These diagrams are 880–960px wide inside a phone-width scroller. The
          scrolling worked; nothing said so, and a diagram that runs off the
          edge with no affordance reads as broken rather than as continued. */}
      <p className="px-4 pt-2.5 font-mono text-[12px] text-gray/60 sm:hidden">
        Scroll sideways to see all of it →
      </p>

      <div className="overflow-x-auto px-2 py-3 sm:px-4 sm:py-4">
        {/* Below sm the diagram is inside a scroller already, so rendering it
            larger costs the reader nothing and is the only lever that reaches
            the label type: the geometry is fixed and the tightest label has
            1.05x of room inside its own box, so the glyphs cannot grow in
            place. Scaling the whole canvas moves every label together and
            cannot overflow anything. */}
        <svg
          viewBox={viewBox}
          role="img"
          aria-label={title}
          style={{
            ["--dgm-w" as string]: `${minWidth}px`,
            ["--dgm-w-narrow" as string]: `${Math.round(minWidth * 1.4)}px`,
          }}
          className="h-auto w-full min-w-[var(--dgm-w-narrow)] sm:min-w-[var(--dgm-w)]"
        >
          {children}
        </svg>
      </div>

      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-gray/10 px-4 py-2.5 sm:px-5">
          {legend.map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: stroke(l.tone, 70) }}
              />
              <span className="font-mono text-[12px] text-gray/70">
                {l.label}
              </span>
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

/* ── boxes ── */

export function Box({
  x,
  y,
  w,
  h,
  tone = "gray",
  title,
  lines = [],
  tag,
  center = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  tone?: Tone;
  title: string;
  lines?: string[];
  tag?: string;
  center?: boolean;
}) {
  const tx = center ? x + w / 2 : x + 13;
  const anchor = center ? "middle" : "start";
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill={fill(tone)}
        stroke={stroke(tone)}
      />
      <text
        x={tx}
        y={y + 21}
        textAnchor={anchor}
        fontSize={12.5}
        fontWeight={600}
        fill="var(--color-foreground)"
      >
        {title}
      </text>
      {tag && (
        <text
          x={x + w - 12}
          y={y + 21}
          textAnchor="end"
          fontSize={9.5}
          fontFamily={MONO}
          fill={stroke(tone, 85)}
        >
          {tag}
        </text>
      )}
      {lines.map((l, i) => (
        <text
          key={i}
          x={tx}
          y={y + 39 + i * 14}
          textAnchor={anchor}
          fontSize={10.5}
          fontFamily={MONO}
          fill="var(--color-gray)"
        >
          {l}
        </text>
      ))}
    </g>
  );
}

/** Grouping band with a label in its top-left corner. */
export function Lane({
  x,
  y,
  w,
  h,
  label,
  tone = "gray",
  upper = true,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tone?: Tone;
  upper?: boolean;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={12}
        fill="color-mix(in srgb, var(--color-gray) 4%, transparent)"
        stroke={stroke(tone, 20)}
        strokeDasharray="4 4"
      />
      <text
        x={x + 14}
        y={y + 17}
        fontSize={9.5}
        fontFamily={MONO}
        letterSpacing="0.14em"
        fill={stroke(tone, 80)}
      >
        {upper ? label.toUpperCase() : label}
      </text>
    </g>
  );
}

/* ── edges ── */

export function Arrow({
  d,
  tone = "gray",
  dashed = false,
  label,
  sub,
  lx,
  ly,
  anchor = "middle",
  both = false,
}: {
  d: string;
  tone?: Tone;
  dashed?: boolean;
  label?: string;
  sub?: string;
  lx?: number;
  ly?: number;
  anchor?: "start" | "middle" | "end";
  both?: boolean;
}) {
  return (
    <g>
      <path
        d={d}
        fill="none"
        stroke={stroke(tone, 55)}
        strokeWidth={1.4}
        strokeDasharray={dashed ? "5 4" : undefined}
        markerEnd={`url(#ux-arw-${tone})`}
        markerStart={both ? `url(#ux-arw-${tone})` : undefined}
      />
      {label && lx !== undefined && ly !== undefined && (
        <text
          x={lx}
          y={ly}
          textAnchor={anchor}
          fontSize={10}
          fill="var(--color-gray-light)"
        >
          {label}
        </text>
      )}
      {sub && lx !== undefined && ly !== undefined && (
        <text
          x={lx}
          y={ly + 12}
          textAnchor={anchor}
          fontSize={9}
          fontFamily={MONO}
          fill="var(--color-gray)"
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/** Free-standing annotation. */
export function Note({
  x,
  y,
  lines,
  anchor = "start",
  tone,
}: {
  x: number;
  y: number;
  lines: string[];
  anchor?: "start" | "middle" | "end";
  tone?: Tone;
}) {
  return (
    <g>
      {lines.map((l, i) => (
        <text
          key={i}
          x={x}
          y={y + i * 13}
          textAnchor={anchor}
          fontSize={9.5}
          fontFamily={MONO}
          fill={tone ? stroke(tone, 85) : "var(--color-gray)"}
        >
          {l}
        </text>
      ))}
    </g>
  );
}

/* ── sequence-diagram helpers ── */

export function Lifeline({
  x,
  y,
  h,
  label,
  sub,
  tone = "gray",
  w = 152,
}: {
  x: number;
  y: number;
  h: number;
  label: string;
  sub?: string;
  tone?: Tone;
  w?: number;
}) {
  const headH = sub ? 40 : 30;
  return (
    <g>
      <rect
        x={x - w / 2}
        y={y}
        width={w}
        height={headH}
        rx={8}
        fill={fill(tone, 11)}
        stroke={stroke(tone)}
      />
      <text
        x={x}
        y={y + (sub ? 17 : 19)}
        textAnchor="middle"
        fontSize={11.5}
        fontWeight={600}
        fill="var(--color-foreground)"
      >
        {label}
      </text>
      {sub && (
        <text
          x={x}
          y={y + 31}
          textAnchor="middle"
          fontSize={9}
          fontFamily={MONO}
          fill="var(--color-gray)"
        >
          {sub}
        </text>
      )}
      <line
        x1={x}
        y1={y + headH}
        x2={x}
        y2={y + h}
        stroke={stroke(tone, 22)}
        strokeWidth={1}
        strokeDasharray="3 5"
      />
    </g>
  );
}

/** Message between two lifelines. */
export function Msg({
  n,
  from,
  to,
  y,
  label,
  sub,
  tone = "gray",
  dashed = false,
}: {
  n?: number;
  from: number;
  to: number;
  y: number;
  label: string;
  sub?: string;
  tone?: Tone;
  dashed?: boolean;
}) {
  const mid = (from + to) / 2;
  return (
    <g>
      <path
        d={`M ${from} ${y} L ${to} ${y}`}
        stroke={stroke(tone, 55)}
        strokeWidth={1.4}
        strokeDasharray={dashed ? "5 4" : undefined}
        markerEnd={`url(#ux-arw-${tone})`}
      />
      {n !== undefined && <StepBadge n={n} y={y} tone={tone} />}
      <text
        x={mid}
        y={y - (sub ? 19 : 8)}
        textAnchor="middle"
        fontSize={10.5}
        fill="var(--color-gray-light)"
      >
        {label}
      </text>
      {sub && (
        <text
          x={mid}
          y={y - 7}
          textAnchor="middle"
          fontSize={9}
          fontFamily={MONO}
          fill="var(--color-gray)"
        >
          {sub}
        </text>
      )}
    </g>
  );
}

/** Work a participant does on its own lifeline. */
export function SelfMsg({
  n,
  x,
  y,
  w = 300,
  h = 34,
  label,
  sub,
  tone = "gray",
  side = "right",
}: {
  n?: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
  sub?: string;
  tone?: Tone;
  side?: "left" | "right";
}) {
  const bx = side === "right" ? x + 6 : x - 6 - w;
  const tx = bx + 12;
  return (
    <g>
      <rect
        x={bx}
        y={y - h / 2}
        width={w}
        height={h}
        rx={7}
        fill={fill(tone, 10)}
        stroke={stroke(tone, 38)}
      />
      <path
        d={`M ${x} ${y - h / 2 + 8} L ${x} ${y + h / 2 - 8}`}
        stroke={stroke(tone, 45)}
        strokeWidth={1.4}
      />
      {n !== undefined && <StepBadge n={n} y={y} tone={tone} />}
      <text
        x={tx}
        y={y + (sub ? -2 : 4)}
        fontSize={10.5}
        fill="var(--color-gray-light)"
      >
        {label}
      </text>
      {sub && (
        <text
          x={tx}
          y={y + 11}
          fontSize={9}
          fontFamily={MONO}
          fill="var(--color-gray)"
        >
          {sub}
        </text>
      )}
    </g>
  );
}
