"use client";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { TOTAL_SUPPLY } from "../../../lib/kennel";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Marker = { ts: string; kind: string; data: { stance?: string; kind?: string; target?: number } };

/** Candles in market cap (NEAR) or price, with bark / trick / graduation markers. */
export function Chart({ candles, markers, mode, label }: { candles: Candle[]; markers: Marker[]; mode: "mcap" | "price"; label: string }) {
  const el = useRef<HTMLDivElement>(null);
  const k = mode === "mcap" ? TOTAL_SUPPLY : 1;
  const last = candles.at(-1);
  const [hover, setHover] = useState<Candle | null>(null);
  const shown = hover ?? last;

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#0A0A0A" }, textColor: "#9B9B96", fontFamily: "Departure Mono, monospace" },
      grid: { vertLines: { color: "#161616" }, horzLines: { color: "#161616" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#3B3B38" },
      rightPriceScale: { borderColor: "#3B3B38" },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#60CE8B", downColor: "#E2584E", wickUpColor: "#60CE8B", wickDownColor: "#E2584E", borderVisible: false,
      priceFormat: mode === "mcap" ? { type: "price", precision: 3, minMove: 0.001 } : { type: "price", precision: 12, minMove: 1e-12 },
    });
    series.setData(candles.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k,
    })));
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", color: "rgba(96,206,139,0.25)", priceFormat: { type: "volume" } });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    vol.setData(candles.map((c) => ({ time: c.time as UTCTimestamp, value: c.volume })));

    const first = candles[0]?.time ?? 0;
    const bucket = candles.length > 1 ? candles[1]!.time - candles[0]!.time : 60;
    const snap = (ts: string) => {
      const t = Math.floor(Date.parse(ts) / 1000);
      return (Math.max(first, t - (t % bucket)) as UTCTimestamp) as Time;
    };
    const marks: SeriesMarker<Time>[] = markers
      .map((m): SeriesMarker<Time> | null => {
        const time = snap(m.ts);
        if (m.kind === "post" && m.data.stance === "Bull") return { time, position: "belowBar", shape: "arrowUp", color: "#60CE8B", text: "BULL" };
        if (m.kind === "post" && m.data.stance === "Bear") return { time, position: "aboveBar", shape: "arrowDown", color: "#E2584E", text: "BEAR" };
        if (m.kind === "trick_burned") return { time, position: "aboveBar", shape: "circle", color: "#E2584E", text: `BURN ${m.data.target}` };
        if (m.kind === "trick_passed") return { time, position: "belowBar", shape: "circle", color: "#F4F4F2", text: `TRICK ${m.data.target}` };
        if (m.kind === "graduated") return { time, position: "aboveBar", shape: "square", color: "#F4F4F2", text: "RHEA" };
        return null;
      })
      .filter((m): m is SeriesMarker<Time> => m !== null && candles.length > 0)
      .sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(series, marks);
    chart.subscribeCrosshairMove((p) => {
      const t = p.time as number | undefined;
      setHover(t === undefined ? null : candles.find((c) => c.time === t) ?? null);
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, markers, mode]);

  const f = (v: number) => (mode === "mcap" ? (v * k).toFixed(3) : (v * k).toExponential(3));
  return (
    <div style={{ position: "relative" }}>
      {shown && (
        <div className="legend">
          {label} · <span className="muted">O</span>{f(shown.open)} <span className="muted">H</span>{f(shown.high)}{" "}
          <span className="muted">L</span>{f(shown.low)} <span className="muted">C</span>{f(shown.close)}{" "}
          <span className={shown.close >= shown.open ? "bull" : "bear"}>
            ({(((shown.close - shown.open) / (shown.open || 1)) * 100).toFixed(2)}%)
          </span>{" "}
          <span className="muted">Vol</span> {shown.volume.toFixed(3)} NEAR
        </div>
      )}
      <div ref={el} className="chart" />
    </div>
  );
}
