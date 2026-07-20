import type { ReactElement } from 'react';

import type { SigilGlyphState } from '../../shared/workflow.js';
import { cn } from '../lib/utils.js';

interface SigilGlyphProps {
    /** Stable per-Workflow value (its id) — the same seed always draws the same mark. */
    readonly seed: string;
    readonly state: SigilGlyphState;
    /** Rendered width/height in px. Defaults to the guidance's ~24-32px range. */
    readonly size?: number;
    readonly className?: string;
    readonly title?: string;
}

const ANCHOR_COUNT = 8;
const STROKE_COUNT = 4;

interface Point {
    readonly x: number;
    readonly y: number;
}

/** Small deterministic string hash (FNV-1a) — no crypto needed, just stable seeding. */
function hashSeed(seed: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < seed.length; i++) {
        hash ^= seed.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** mulberry32 — tiny, fast, good-enough PRNG for a decorative glyph. */
function mulberry32(seed: number): () => number {
    let a = seed;
    return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Anchor points evenly spaced on the hidden radial grid, like letters traced on a circle. */
function anchorPoints(center: number, radius: number): readonly Point[] {
    return Array.from({ length: ANCHOR_COUNT }, (_, i) => {
        const angle = (i / ANCHOR_COUNT) * Math.PI * 2 - Math.PI / 2;
        return {
            x: center + radius * Math.cos(angle),
            y: center + radius * Math.sin(angle),
        };
    });
}

/** Walks a random, non-repeating path across the anchors — the traced sigil line. */
function traceGlyph(seed: string, center: number, radius: number): readonly Point[] {
    const rng = mulberry32(hashSeed(seed));
    const anchors = anchorPoints(center, radius);
    const visited = new Set<number>();
    const trace: Point[] = [];
    let current = Math.floor(rng() * ANCHOR_COUNT);

    for (let step = 0; step <= STROKE_COUNT; step++) {
        visited.add(current);
        const anchor = anchors[current];
        if (anchor) trace.push(anchor);

        let next = current;
        let attempts = 0;
        while ((next === current || visited.has(next)) && attempts < ANCHOR_COUNT) {
            next = Math.floor(rng() * ANCHOR_COUNT);
            attempts++;
        }
        current = next;
    }
    return trace;
}

const STATE_COLOR: Record<SigilGlyphState, string> = {
    dormant: 'text-veil',
    active: 'text-gilt',
    running: 'text-verdigris-foreground',
    error: 'text-old-blood-foreground',
};

const STATE_LABEL: Record<SigilGlyphState, string> = {
    dormant: 'dormant',
    active: 'active',
    running: 'running',
    error: 'errored',
};

/**
 * The signature element from UI_STYLE_GUIDANCE.md: a small procedurally-generated
 * glyph, seeded from a Workflow's id, that replaces the generic status dot on
 * Home, the Workflows list, and (eventually) the tray menu.
 */
export function SigilGlyph({
    seed,
    state,
    size = 28,
    className,
    title,
}: SigilGlyphProps): ReactElement {
    const center = size / 2;
    const radius = size * 0.36;
    const trace = traceGlyph(seed, center, radius);
    const points = trace.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
    const strokeWidth = state === 'dormant' ? 1 : 1.5;

    return (
        <svg
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            role="img"
            aria-label={title ?? `Sigil, ${STATE_LABEL[state]}`}
            className={cn(
                STATE_COLOR[state],
                state === 'running' && 'sigil-glyph-running',
                className,
            )}
        >
            {/* the hidden radial grid the mark was traced on, barely there */}
            <circle
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={0.75}
                opacity={0.22}
            />
            <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
            />
            {trace.map((point) => (
                <circle
                    key={`${point.x.toFixed(2)}-${point.y.toFixed(2)}`}
                    cx={point.x}
                    cy={point.y}
                    r={state === 'dormant' ? 0.75 : 1.15}
                    fill="currentColor"
                />
            ))}
            {state === 'error' ? (
                <line
                    x1={size * 0.14}
                    y1={size * 0.82}
                    x2={size * 0.86}
                    y2={size * 0.18}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                />
            ) : null}
        </svg>
    );
}
