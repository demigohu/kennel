"use client";
import { AreaSeries, ColorType, createChart, type UTCTimestamp } from "lightweight-charts";
import { useEffect, useRef } from "react";

/** Portfolio value line (NEAR) like pump.fun's profile chart. */
export function PortfolioChart({ points }: { points: { time: number; value: number }[] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current || points.length === 0) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: "#9097a3" },
      grid: { vertLines: { visible: false }, horzLines: { visible: false } },
      rightPriceScale: { visible: false },
      timeScale: { visible: false },
      handleScroll: false,
      handleScale: false,
    });
    const series = chart.addSeries(AreaSeries, { lineColor: "#3ccf8e", topColor: "rgba(60,207,142,.25)", bottomColor: "rgba(60,207,142,0)", lineWidth: 2 });
    // One point per second at most; lightweight-charts needs strictly increasing times.
    const byTime = new Map<number, number>();
    for (const p of points) byTime.set(Math.floor(p.time / 1000), p.value);
    series.setData([...byTime].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time: time as UTCTimestamp, value })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points]);
  return <div ref={el} style={{ height: 180 }} />;
}
