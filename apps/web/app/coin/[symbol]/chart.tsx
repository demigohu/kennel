"use client";
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  CrosshairMode,
  HistogramSeries,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useEffect, useRef, useState } from "react";
import { TOTAL_SUPPLY } from "../../../lib/kennel";
import { DotAvatar } from "../../ascii";

export type Candle = { time: number; open: number; high: number; low: number; close: number; volume: number };
export type Marker = { ts: string; kind: string; data: { stance?: string; kind?: string; target?: number; author?: string } };
export type ChartTrade = { ts: string; side: string; account: string; is_agent: boolean; price?: string; near: string };

const GREEN = "#60CE8B";
const RED = "#E2584E";

/** Fill empty intervals with flat candles so the chart reads as continuous time, like pump.fun. */
function continuous(candles: Candle[], interval: number): Candle[] {
  if (candles.length === 0) return [];
  const out: Candle[] = [];
  const end = Math.max(candles.at(-1)!.time, Math.floor(Date.now() / 1000 / interval) * interval);
  const start = Math.max(candles[0]!.time, end - interval * 600);
  let i = candles.findIndex((c) => c.time >= start);
  let prev = candles[Math.max(0, i - 1)]!.close;
  for (let t = start; t <= end; t += interval) {
    const c = candles[i];
    if (c && c.time === t) {
      out.push(c);
      prev = c.close;
      i++;
    } else out.push({ time: t, open: prev, high: prev, low: prev, close: prev, volume: 0 });
  }
  return out;
}

const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  if (a >= 1) return v.toFixed(2);
  if (a === 0) return "0";
  return v.toPrecision(3);
};

/** Candles in market cap (NEAR) or price, with bark / trick / graduation markers and trader bubbles. */
export function Chart({ candles, markers, trades = [], mode, label, interval, usd = null }: {
  candles: Candle[]; markers: Marker[]; trades?: ChartTrade[]; mode: "mcap" | "price"; label: string; interval: number; usd?: number | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const chartRef = useRef<{ chart: IChartApi; series: ISeriesApi<"Candlestick"> } | null>(null);
  // Candles come in NEAR per token; scale to market cap and to USD (mainnet rate) when known.
  const k = (mode === "mcap" ? TOTAL_SUPPLY : 1) * (usd ?? 1);
  const data = continuous(candles, interval);
  const last = data.at(-1);
  const [hover, setHover] = useState<Candle | null>(null);
  const [bubbles, setBubbles] = useState<{ x: number; y: number; account: string; side: string }[]>([]);
  // pump.fun-style chart controls
  const [kind, setKind] = useState<"candles" | "line">("candles");
  const [scale, setScale] = useState<"normal" | "percent" | "log">("normal");
  const [auto, setAuto] = useState(true);
  const [range, setRange] = useState<number | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const shown = hover ?? last;

  // Build the chart once per mode/interval/type. Data refreshes (every 8s) only call setData below,
  // so the view the user zoomed or scrolled to stays put.
  const cur = useRef("");
  cur.current = usd ? "$" : "";
  const dataRef = useRef(data);
  dataRef.current = data;
  const fitted = useRef(false);
  const extra = useRef<{ line: ISeriesApi<"Area"> | null; vol: ISeriesApi<"Histogram">; marks: ReturnType<typeof createSeriesMarkers<Time>> } | null>(null);
  useEffect(() => {
    if (!el.current) return;
    const chart = createChart(el.current, {
      autoSize: true,
      // TradingView attribution stays on, as the Lightweight Charts license asks.
      layout: { background: { type: ColorType.Solid, color: "#0A0A0A" }, textColor: "#9B9B96", fontFamily: "Departure Mono, monospace", fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: "#141414" }, horzLines: { color: "#141414" } },
      crosshair: { mode: CrosshairMode.Normal, vertLine: { color: "#3B3B38", labelBackgroundColor: "#161616" }, horzLine: { color: "#3B3B38", labelBackgroundColor: "#161616" } },
      timeScale: { timeVisible: true, secondsVisible: false, borderColor: "#3B3B38", barSpacing: 9, minBarSpacing: 3, rightOffset: 8 },
      rightPriceScale: { borderColor: "#3B3B38", scaleMargins: { top: 0.12, bottom: 0.22 } },
      localization: { priceFormatter: (p: number) => cur.current + compact(p) },
    });
    const series = chart.addSeries(CandlestickSeries, {
      upColor: GREEN, downColor: RED, wickUpColor: GREEN, wickDownColor: RED, borderVisible: false, visible: kind === "candles",
      priceFormat: { type: "custom", formatter: (p: number) => cur.current + compact(p), minMove: 1e-12 },
      // Market cap and price can't go below zero; keep the scale from padding into negatives.
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } | null } | null) => {
        const r = original();
        if (r?.priceRange) r.priceRange.minValue = Math.max(0, r.priceRange.minValue);
        return r;
      },
    });
    const line = kind === "line"
      ? chart.addSeries(AreaSeries, { lineColor: GREEN, topColor: "rgba(96,206,139,0.25)", bottomColor: "rgba(96,206,139,0)", lineWidth: 2, priceFormat: { type: "custom", formatter: (p: number) => cur.current + compact(p), minMove: 1e-12 } })
      : null;
    const vol = chart.addSeries(HistogramSeries, { priceScaleId: "vol", priceFormat: { type: "volume" }, lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.subscribeCrosshairMove((p) => {
      const t = p.time as number | undefined;
      setHover(t === undefined ? null : dataRef.current.find((c) => c.time === t) ?? null);
    });
    chartRef.current = { chart, series };
    extra.current = { line, vol, marks: createSeriesMarkers(series, []) };
    fitted.current = false;
    return () => {
      chartRef.current = null;
      extra.current = null;
      chart.remove();
    };
  }, [mode, interval, kind]);

  // Fresh data: replace series contents without touching the visible range.
  useEffect(() => {
    const c = chartRef.current, x = extra.current;
    if (!c || !x) return;
    c.series.setData(data.map((d) => ({ time: d.time as UTCTimestamp, open: d.open * k, high: d.high * k, low: d.low * k, close: d.close * k })));
    x.line?.setData(data.map((d) => ({ time: d.time as UTCTimestamp, value: d.close * k })));
    x.vol.setData(data.map((d) => ({
      time: d.time as UTCTimestamp, value: d.volume,
      color: d.close >= d.open ? "rgba(96,206,139,0.35)" : "rgba(226,88,78,0.35)",
    })));
    const snap = (ts: string) => {
      const t = Math.floor(Date.parse(ts) / 1000);
      return (t - (t % interval)) as UTCTimestamp as Time;
    };
    x.marks.setMarkers(markers
      .map((m): SeriesMarker<Time> | null => {
        const time = snap(m.ts);
        if (m.kind === "post" && m.data.stance === "Bull") return { time, position: "belowBar", shape: "arrowUp", color: GREEN, text: "BULL" };
        if (m.kind === "post" && m.data.stance === "Bear") return { time, position: "aboveBar", shape: "arrowDown", color: RED, text: "BEAR" };
        if (m.kind === "trick_burned") return { time, position: "aboveBar", shape: "circle", color: RED, text: `BURN ${m.data.target}` };
        if (m.kind === "trick_passed") return { time, position: "belowBar", shape: "circle", color: GREEN, text: `TRICK ${m.data.target}` };
        if (m.kind === "graduated") return { time, position: "aboveBar", shape: "square", color: "#F4F4F2", text: "RHEA" };
        return null;
      })
      .filter((m): m is SeriesMarker<Time> => m !== null && data.length > 0)
      .sort((a, b) => Number(a.time) - Number(b.time)));
    // Only the first load after (re)building the chart picks the view; later refreshes keep the user's.
    if (!fitted.current && data.length > 0) {
      fitted.current = true;
      showRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, markers, mode, interval, kind, usd]);

  // Default view: the most recent ~120 intervals scrolled to now; a range button shows that much time.
  const showRange = (sec: number | null) => {
    const c = chartRef.current, n = dataRef.current.length;
    if (!c || n === 0) return;
    const bars = sec ? Math.max(10, Math.ceil(sec / interval)) : 120;
    c.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - bars), to: n + 8 });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (fitted.current) showRange(range); }, [range]);

  useEffect(() => {
    chartRef.current?.chart.priceScale("right").applyOptions({
      autoScale: auto,
      mode: scale === "log" ? PriceScaleMode.Logarithmic : scale === "percent" ? PriceScaleMode.Percentage : PriceScaleMode.Normal,
    });
  }, [scale, auto, mode, interval, kind]);

  // Trader bubbles (pump.fun's avatars on the chart), repositioned when the view moves.
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const place = () => {
      const out: typeof bubbles = [];
      for (const t of trades.slice(0, 60)) {
        if (!t.price) continue;
        const sec = Math.floor(Date.parse(t.ts) / 1000);
        const x = c.chart.timeScale().timeToCoordinate((sec - (sec % interval)) as UTCTimestamp);
        const y = c.series.priceToCoordinate((Number(t.price) / 1e24) * k);
        if (x !== null && y !== null) out.push({ x, y, account: t.account, side: t.side });
      }
      setBubbles(out);
    };
    place();
    c.chart.timeScale().subscribeVisibleLogicalRangeChange(place);
    return () => c.chart.timeScale().unsubscribeVisibleLogicalRangeChange(place);
  }, [trades, candles, mode, interval, k]);

  const f = (v: number) => cur.current + compact(v * k);
  const change = shown ? ((shown.close - shown.open) / (shown.open || 1)) * 100 : 0;
  return (
    <div className="chart-wrap">
      {shown && (
        <div className="legend">
          <div>
            {label} · {interval >= 86400 ? "1D" : interval >= 3600 ? `${interval / 3600}h` : `${interval / 60}m`} · Kennel{" "}
            <span className="muted">O</span><span className={change >= 0 ? "bull" : "bear"}>{f(shown.open)}</span>{" "}
            <span className="muted">H</span><span className={change >= 0 ? "bull" : "bear"}>{f(shown.high)}</span>{" "}
            <span className="muted">L</span><span className={change >= 0 ? "bull" : "bear"}>{f(shown.low)}</span>{" "}
            <span className="muted">C</span><span className={change >= 0 ? "bull" : "bear"}>{f(shown.close)}</span>{" "}
            <span className={change >= 0 ? "bull" : "bear"}>({change >= 0 ? "+" : ""}{change.toFixed(2)}%)</span>
          </div>
          <div><span className="muted">Volume</span> <span className={change >= 0 ? "bull" : "bear"}>{shown.volume.toFixed(3)}</span></div>
        </div>
      )}
      <div className="chart-kind" role="group" aria-label="Chart type">
        <button className={kind === "candles" ? "on" : ""} onClick={() => setKind("candles")} title="Candles">▮▯</button>
        <button className={kind === "line" ? "on" : ""} onClick={() => setKind("line")} title="Line">╱</button>
      </div>
      <div ref={el} className="chart" />
      <div className="chart-foot">
        <div className="chart-bar" style={{ margin: 0 }}>
          {([["1D", 86400], ["5D", 432000], ["1M", 2592000], ["3M", 7776000], ["1Y", 31536000]] as const).map(([l, sec]) => (
            <button key={l} className={range === sec ? "on" : ""} onClick={() => setRange(range === sec ? null : sec)}>{l}</button>
          ))}
        </div>
        <div className="chart-bar" style={{ margin: 0 }}>
          <span className="muted">{now.toISOString().slice(11, 19)} UTC</span>
          <span className="sep" />
          <button className={scale === "percent" ? "on" : ""} onClick={() => setScale(scale === "percent" ? "normal" : "percent")}>%</button>
          <button className={scale === "log" ? "on" : ""} onClick={() => setScale(scale === "log" ? "normal" : "log")}>log</button>
          <button className={auto ? "on" : ""} onClick={() => setAuto(!auto)}>auto</button>
        </div>
      </div>
      <div className="bubbles" aria-hidden>
        {bubbles.map((b, i) => (
          <span key={i} className={`bubble ${b.side === "sell" ? "sell" : "buy"}`} style={{ transform: `translate(${b.x - 9}px, ${b.y - 9}px)` }} title={`${b.account} ${b.side}`}>
            <DotAvatar id={b.account} size={14} />
          </span>
        ))}
      </div>
    </div>
  );
}
