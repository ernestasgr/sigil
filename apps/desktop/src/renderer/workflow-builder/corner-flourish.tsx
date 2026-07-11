import type { CSSProperties, ReactElement } from 'react';

interface CornerFlourishProps {
    readonly corner: 'tl' | 'br';
    readonly size?: number;
    readonly inset?: number;
    readonly opacity?: number;
}

interface Line {
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
}

function flourishLines(corner: 'tl' | 'br', size: number): readonly Line[] {
    const directions =
        corner === 'tl'
            ? [
                  { dx: 0.83, dy: 0.25 },
                  { dx: 0.58, dy: 0.58 },
                  { dx: 0.25, dy: 0.83 },
              ]
            : [
                  { dx: 0.17, dy: 0.75 },
                  { dx: 0.42, dy: 0.42 },
                  { dx: 0.75, dy: 0.17 },
              ];
    const apex = corner === 'tl' ? { x: 0, y: 0 } : { x: size, y: size };
    return directions.map((dir) => ({
        x1: apex.x,
        y1: apex.y,
        x2: dir.dx * size,
        y2: dir.dy * size,
    }));
}

export function CornerFlourish({
    corner,
    size = 12,
    inset = 3,
    opacity = 1,
}: CornerFlourishProps): ReactElement {
    const style: CSSProperties =
        corner === 'tl'
            ? { top: inset, left: inset, width: size, height: size, opacity }
            : { bottom: inset, right: inset, width: size, height: size, opacity };
    return (
        <svg
            viewBox={`0 0 ${size} ${size}`}
            aria-hidden="true"
            className="text-gilt pointer-events-none absolute z-[5]"
            style={style}
        >
            {flourishLines(corner, size).map((line, index) => (
                <line
                    // biome-ignore lint/suspicious/noArrayIndexKey: SVG lines are static decorative elements
                    key={index}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke="currentColor"
                    strokeWidth="1"
                />
            ))}
        </svg>
    );
}
