import { useEffect, useRef } from "react";
import { createChart, ColorType, LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle, Cluster } from "../lib/engine";

interface Props {
  candles: Candle[];
  clusters: Cluster[];
  spot: number;
}

export function PriceChart({ candles, clusters, spot }: Props) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);

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
    });
    chartRef.current = chart;
    seriesRef.current = series;
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      linesRef.current = [];
    };
  }, []);

  const lenRef = useRef(0);
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
    if (lenRef.current !== candles.length) {
      lenRef.current = candles.length;
      chartRef.current?.timeScale().fitContent();
    }
  }, [candles]);

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
  }, [clusters, spot]);

  return <div ref={elRef} className="h-[340px] w-full sm:h-[400px]" />;
}
