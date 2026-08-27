import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle, Cluster } from "../lib/engine";
import type { OIPoint } from "../lib/binance";

interface Props {
  candles: Candle[];
  clusters: Cluster[];
  spot: number;
  oiHistory?: OIPoint[];
  levels?: { price: number; label: string }[];
}

export function PriceChart({ candles, clusters, spot, oiHistory, levels }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const oiRef = useRef<ISeriesApi<"Line"> | null>(null);
  const cdRef = useRef<ISeriesApi<"Line"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const lenRef = useRef(0);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = createChart(elRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#5d7099",
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(93,112,153,0.09)" },
        horzLines: { color: "rgba(93,112,153,0.09)" },
      },
      rightPriceScale: { borderColor: "rgba(27,44,74,0.9)" },
      timeScale: { borderColor: "rgba(27,44,74,0.9)", timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: "rgba(63,182,255,0.4)", labelBackgroundColor: "#0d1a30" },
        horzLine: { color: "rgba(63,182,255,0.4)", labelBackgroundColor: "#0d1a30" },
      },
    });

    const series = chart.addCandlestickSeries({
      upColor: "#2fd6a5",
      downColor: "#ff4d6d",
      wickUpColor: "rgba(47,214,165,0.75)",
      wickDownColor: "rgba(255,77,109,0.75)",
      borderVisible: false,
      priceScaleId: "right",
    });
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.06, bottom: 0.26 } });

    // footprint: delta (compra − venta agresiva) por vela, abajo
    const vol = chart.addHistogramSeries({
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 }, visible: false });

    // delta acumulado (quién controla el flujo) sobre la banda del footprint
    const cd = chart.addLineSeries({
      color: "#e9f1ff",
      lineWidth: 1,
      priceScaleId: "cd",
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("cd").applyOptions({ scaleMargins: { top: 0.78, bottom: 0 }, visible: false });

    // interés abierto superpuesto (línea azul)
    const oi = chart.addLineSeries({
      color: "#3fb6ff",
      lineWidth: 2,
      priceScaleId: "oi",
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("oi").applyOptions({ scaleMargins: { top: 0.02, bottom: 0.55 }, visible: false });

    chartRef.current = chart;
    seriesRef.current = series;
    volRef.current = vol;
    oiRef.current = oi;
    cdRef.current = cd;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      oiRef.current = null;
      cdRef.current = null;
      linesRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current || candles.length === 0) return;
    seriesRef.current.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );
    const deltas = candles.map((c) => {
      const buy = c.takerBuyQuote ?? c.quoteVolume * (c.close >= c.open ? 0.56 : 0.44);
      return 2 * buy - c.quoteVolume;
    });
    const maxAbs = Math.max(...deltas.map((d) => Math.abs(d)), 1);
    let acc = 0;
    const cdData: { time: UTCTimestamp; value: number }[] = [];
    volRef.current?.setData(
      candles.map((c, i) => {
        const d = deltas[i];
        const a = 0.22 + 0.6 * (Math.abs(d) / maxAbs);
        acc += d;
        cdData.push({ time: c.time as UTCTimestamp, value: acc });
        return {
          time: c.time as UTCTimestamp,
          value: d,
          color: d >= 0 ? `rgba(47,214,165,${a.toFixed(2)})` : `rgba(255,77,109,${a.toFixed(2)})`,
        };
      })
    );
    cdRef.current?.setData(cdData);
    if (oiRef.current && oiHistory && oiHistory.length > 1) {
      oiRef.current.setData(oiHistory.map((o) => ({ time: o.time as UTCTimestamp, value: o.oi })));
    }
    if (lenRef.current !== candles.length) {
      lenRef.current = candles.length;
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles, oiHistory]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    linesRef.current.forEach((l) => series.removePriceLine(l));
    linesRef.current = [];

    const spotLine = series.createPriceLine({
      price: spot,
      color: "#ffb547",
      lineWidth: 1,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: "SPOT",
    });
    linesRef.current.push(spotLine);

    clusters.slice(0, 5).forEach((c) => {
      const line = series.createPriceLine({
        price: c.price,
        color: c.side === "long" ? "rgba(47,214,165,0.85)" : "rgba(255,77,109,0.85)",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `${c.tag} ${c.side === "long" ? "liq longs" : "liq shorts"}`,
      });
      linesRef.current.push(line);
    });

    // niveles clave de estructura (puntos, cian tenue)
    (levels ?? []).slice(0, 4).forEach((lv) => {
      const line = series.createPriceLine({
        price: lv.price,
        color: "rgba(63,182,255,0.55)",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: lv.label,
      });
      linesRef.current.push(line);
    });
  }, [clusters, spot, levels]);

  return <div ref={elRef} className="h-[380px] w-full sm:h-[440px]" />;
}
