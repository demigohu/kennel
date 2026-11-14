'use client';
import { useEffect, useId, useRef, useState } from 'react';

// Mermaid themed with the Kennel tokens (apps/web/DESIGN.md).
const THEME = {
  startOnLoad: false,
  securityLevel: 'strict' as const,
  theme: 'base' as const,
  fontFamily: 'Departure Mono, ui-monospace, monospace',
  // Natural size: the frame scrolls sideways instead of shrinking text until it can't be read.
  flowchart: { useMaxWidth: false },
  sequence: { useMaxWidth: false },
  state: { useMaxWidth: false },
  class: { useMaxWidth: false },
  timeline: { useMaxWidth: false },
  xyChart: { useMaxWidth: false, width: 640, height: 320 },
  themeVariables: {
    darkMode: true,
    background: '#0A0A0A',
    fontFamily: 'Departure Mono, ui-monospace, monospace',
    fontSize: '13px',
    primaryColor: '#161616',
    primaryTextColor: '#F4F4F2',
    primaryBorderColor: '#60CE8B',
    secondaryColor: '#1E1E1C',
    secondaryTextColor: '#F4F4F2',
    secondaryBorderColor: '#3B3B38',
    tertiaryColor: '#161616',
    tertiaryTextColor: '#F4F4F2',
    tertiaryBorderColor: '#3B3B38',
    lineColor: '#9B9B96',
    textColor: '#F4F4F2',
    mainBkg: '#161616',
    nodeBorder: '#60CE8B',
    clusterBkg: '#0F0F0F',
    clusterBorder: '#3B3B38',
    titleColor: '#F4F4F2',
    edgeLabelBackground: '#0A0A0A',
    actorBkg: '#161616',
    actorBorder: '#60CE8B',
    actorTextColor: '#F4F4F2',
    actorLineColor: '#3B3B38',
    signalColor: '#F4F4F2',
    signalTextColor: '#F4F4F2',
    labelBoxBkgColor: '#161616',
    labelBoxBorderColor: '#3B3B38',
    labelTextColor: '#F4F4F2',
    loopTextColor: '#9B9B96',
    noteBkgColor: '#1E1E1C',
    noteBorderColor: '#60CE8B',
    noteTextColor: '#F4F4F2',
    activationBkgColor: '#1E1E1C',
    activationBorderColor: '#60CE8B',
    sequenceNumberColor: '#0A0A0A',
    git0: '#60CE8B',
    pie1: '#60CE8B',
    pie2: '#E2584E',
    pie3: '#3B3B38',
    pie4: '#9B9B96',
    pieStrokeColor: '#0A0A0A',
    pieSectionTextColor: '#0A0A0A',
    pieTitleTextColor: '#F4F4F2',
    pieLegendTextColor: '#F4F4F2',
    xyChart: { backgroundColor: '#0A0A0A', titleColor: '#F4F4F2', xAxisLabelColor: '#9B9B96', yAxisLabelColor: '#9B9B96', xAxisLineColor: '#3B3B38', yAxisLineColor: '#3B3B38', xAxisTickColor: '#3B3B38', yAxisTickColor: '#3B3B38', xAxisTitleColor: '#9B9B96', yAxisTitleColor: '#9B9B96', plotColorPalette: '#60CE8B, #E2584E' },
  },
};

let ready: Promise<typeof import('mermaid').default> | null = null;
const load = () =>
  (ready ??= import('mermaid').then((m) => {
    m.default.initialize(THEME);
    return m.default;
  }));

/** A Mermaid diagram in a captioned frame. The source stays in the page as text until it renders. */
export function Diagram({ chart, title, kind }: { chart: string; title?: string; kind?: string }) {
  const id = 'd' + useId().replace(/[^a-zA-Z0-9]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    load()
      .then((m) => m.render(id, chart.trim()))
      .then(({ svg }) => {
        if (live && ref.current) ref.current.innerHTML = svg;
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [chart, id]);

  return (
    <figure className="diagram not-prose" role="group" aria-label={title ?? kind ?? 'Diagram'}>
      {(title || kind) && (
        <figcaption className="diagram-cap">
          <span>{title}</span>
          {kind && <b>{kind}</b>}
        </figcaption>
      )}
      <div className="diagram-body" ref={ref}>
        <pre aria-label={failed ? 'Diagram source (could not render)' : undefined}>{chart.trim()}</pre>
      </div>
    </figure>
  );
}
