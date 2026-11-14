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
import { useEffect, useRef } from "react";
import { TOTAL_SUPPLY } from "../../../lib/kennel";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Marker = { ts: string; kind: string; data: { stance?: string; kind?: string; target?: number } };

/** Candles in market cap (NEAR) or price, with bark / trick / graduation markers. */
export function Chart({ candles, markers, mode }: { candles: Candle[]; markers: Marker[]; mode: "mcap" | "price" }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: "#16181d" }, textColor: "#9097a3" },
      grid: { vertLines: { color: "#20232b" }, horzLines: { color: "#20232b" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#2a2e37" },
      rightPriceScale: { borderColor: "#2a2e37" },
    });
    const k = mode === "mcap" ? TOTAL_SUPPLY : 1;
    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#3ccf8e", downColor: "#ff6b6b", wickUpColor: "#3ccf8e", wickDownColor: "#ff6b6b", borderVisible: false,
      priceFormat: mode === "mcap" ? { type: "price", precision: 3, minMove: 0.001 } : { type: "price", precision: 12, minMove: 1e-12 },
    });
    series.setData(candles.map((c) => ({
      time: c.time as UTCTimestamp, open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k,
    })));
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", color: "#3a404c", priceFormat: { type: "volume" } });
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
        if (m.kind === "post" && m.data.stance === "Bull") return { time, position: "belowBar", shape: "arrowUp", color: "#3ccf8e", text: "🐂 bark" };
        if (m.kind === "post" && m.data.stance === "Bear") return { time, position: "aboveBar", shape: "arrowDown", color: "#ff6b6b", text: "🐻 bark" };
        if (m.kind === "trick_burned") return { time, position: "aboveBar", shape: "circle", color: "#ff6b6b", text: `🔥 trick ${m.data.target}` };
        if (m.kind === "trick_passed") return { time, position: "belowBar", shape: "circle", color: "#f5b544", text: `✅ trick ${m.data.target}` };
        if (m.kind === "graduated") return { time, position: "aboveBar", shape: "square", color: "#f5b544", text: "🎓 Rhea" };
        return null;
      })
      .filter((m): m is SeriesMarker<Time> => m !== null && candles.length > 0)
      .sort((a, b) => Number(a.time) - Number(b.time));
    createSeriesMarkers(series, marks);
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [candles, markers, mode]);

  return <div ref={el} className="chart" />;
}
