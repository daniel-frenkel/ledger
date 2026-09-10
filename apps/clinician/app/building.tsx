'use client';

/**
 * The eight floors, drawn once.
 *
 * Ported from docs/design/floor-locator.html and used by two pages that shade
 * it differently: /formulate lights the floors a tick scores, /stack shades
 * them by how deeply the clinician's training reaches each one. The geometry
 * and the labels are the same drawing either way, so they live here rather
 * than in whichever page happened to need it first.
 *
 * Floor 8 is drawn as ground, not as a storey. That is the teaching point —
 * no upper-floor tool reaches it.
 */
import React from 'react';
import { FLOOR_CONTENT, floor } from '@/content/floors';

const FLOOR_Y = (i: number) => 14 + (i - 1) * 39;

export interface BuildingProps {
  /** Extra class per floor, e.g. 'lit' or a coverage level. Empty for none. */
  classFor: (n: number) => string;
  /** The floor drawn as selected, if any. */
  selected?: number | null;
  onPick?: (n: number) => void;
  /** Per-floor accessible suffix, e.g. "reached at Fluent". */
  describe?: (n: number) => string;
  caption?: string;
}

export function Building({ classFor, selected = null, onPick, describe, caption }: BuildingProps) {
  const pick = (n: number) => () => onPick?.(n);
  const onKey = (n: number) => (e: React.KeyboardEvent) => {
    if (!onPick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPick(n);
    }
  };
  const label = (n: number, name: string) => {
    const extra = describe?.(n);
    return `Floor ${n}, ${name}${extra ? `, ${extra}` : ''}`;
  };
  // Without a handler the shapes are a picture, not controls — so they should
  // not be in the tab order and should not claim to be buttons.
  const asButton = onPick ? ({ tabIndex: 0, role: 'button' } as const) : {};

  return (
    <div className="buildingwrap">
      <svg
        className="building"
        viewBox="0 0 200 340"
        role="img"
        aria-label="Eight floors of the self, floor one at the top"
      >
        <g>
          {FLOOR_CONTENT.filter((x) => x.n <= 7).map((x) => {
            const y = FLOOR_Y(x.n);
            const extra = classFor(x.n);
            return (
              <g
                key={x.n}
                className={`floor${extra ? ` ${extra}` : ''}${x.n === selected ? ' sel' : ''}`}
                aria-label={label(x.n, x.name)}
                onClick={pick(x.n)}
                onKeyDown={onKey(x.n)}
                {...asButton}
              >
                <rect className="fl-body" x={22} y={y} width={156} height={35} />
                {[0, 1, 2, 3, 4].map((w) => (
                  <rect key={w} className="win" x={34 + w * 27} y={y + 22} width={11} height={7} />
                ))}
                <text className="fl-num" x={30} y={y + 15}>
                  {x.n}
                </text>
                <text className="fl-label" x={44} y={y + 15}>
                  {x.name}
                </text>
              </g>
            );
          })}
        </g>
        <rect
          className={`ground${classFor(8) ? ` ${classFor(8)}` : ''}${selected === 8 ? ' sel' : ''}`}
          x={8}
          y={292}
          width={184}
          height={34}
          aria-label={label(8, 'the cultural substrate')}
          onClick={pick(8)}
          onKeyDown={onKey(8)}
          {...asButton}
        />
        <text className="fl-num" x={16} y={313}>
          8
        </text>
        <text className="fl-label" x={30} y={313}>
          {floor(8)?.name}
        </text>
      </svg>
      {caption ? <p className="b-cap">{caption}</p> : null}
    </div>
  );
}
