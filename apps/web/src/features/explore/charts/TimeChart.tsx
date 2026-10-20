import { useEffect, useMemo, useRef } from 'react'
import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from 'lightweight-charts'
import { cn } from '@/lib/cn'
import type { CandlePoint, SeriesPoint } from '../types'
import { useChartPalette, type ChartPalette } from './useChartPalette'

/** Hover readout reported to the parent (headline + date). `null` means the pointer left the chart. */
export interface HoverInfo {
  time: number
  value: number | null
  open?: number
  high?: number
  low?: number
  close?: number
  volumeUsd?: number
}

type Props = {
  className?: string
  formatValue: (v: number) => string
  onHover?: (h: HoverInfo | null) => void
  testId?: string
  ariaLabel?: string
} & (
  | { kind: 'area' | 'line' | 'bar'; data: SeriesPoint[] }
  | { kind: 'candles'; data: CandlePoint[] }
)

type AnySeries = ISeriesApi<'Area'> | ISeriesApi<'Line'> | ISeriesApi<'Histogram'> | ISeriesApi<'Candlestick'>

/** #rrggbb to rgba(); other colour formats pass through unchanged. */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1]!, 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`
}

/**
 * Period trend colour, as Uniswap draws it: success green when the period ended at or above where it
 * started, critical red when it fell. Fewer than two points falls back to the accent colour.
 */
export function trendColor(data: ReadonlyArray<{ value: number }>, palette: ChartPalette): string {
  if (data.length < 2) return palette.accent
  return data[data.length - 1]!.value >= data[0]!.value ? palette.success : palette.critical
}

/**
 * lightweight-charts requires strictly ascending, unique times and rejects the whole update
 * otherwise (leaving stale data on screen). Callers often append a live "now" point that can
 * collide with the last bucket, so sort and keep the last value per timestamp.
 */
export function normalizeSeries<T extends { time: number }>(data: ReadonlyArray<T>): T[] {
  const byTime = new Map<number, T>()
  for (const p of data) if (Number.isFinite(p.time)) byTime.set(p.time, p)
  return [...byTime.values()].sort((a, b) => a.time - b.time)
}

const DOT_GRID = (color: string): React.CSSProperties => ({
  backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1.4px)`,
  backgroundSize: '18px 18px',
  backgroundPosition: '0 0',
})

function chartOptions(p: ChartPalette, formatValue: (v: number) => string) {
  return {
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: 'transparent' },
      textColor: p.text3,
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontSize: 12,
      attributionLogo: false,
    },
    // No line grid: the plot sits on a CSS dot matrix (see DOT_GRID), like Uniswap's charts.
    grid: {
      vertLines: { visible: false },
      horzLines: { visible: false },
    },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: p.text3, style: LineStyle.Dashed, width: 1 as const, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: false,
    localization: { priceFormatter: formatValue },
  } as const
}

/**
 * The one lightweight-charts wrapper for every chart in MetaSwap (explore, token, pool, portfolio and
 * launches). Line and area charts take the period trend colour with a gradient fill, the grid is dotted,
 * the last point pulses, and the crosshair reports a value and date readout to the parent. Candles use
 * green and red bodies, and bars highlight the hovered bar. It follows the theme and resizes with its
 * container (autoSize).
 */
export function TimeChart(props: Props) {
  const { className, formatValue, onHover, testId, ariaLabel, kind } = props
  const data = props.data
  const hostRef = useRef<HTMLDivElement>(null)
  const dotRef = useRef<HTMLSpanElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<AnySeries | null>(null)
  const hoverRef = useRef(onHover)
  const fmtRef = useRef(formatValue)
  const palette = useChartPalette()
  const trend = trendColor(data as ReadonlyArray<{ value: number }>, palette)

  const volumeByTime = useMemo(() => {
    const m = new Map<number, number>()
    if (kind === 'candles') for (const c of data as CandlePoint[]) m.set(c.time, c.volumeUsd)
    return m
  }, [data, kind])
  const volumeRef = useRef(volumeByTime)
  const barValues = useRef(new Map<number, number>())
  const barHover = useRef<number | null>(null)
  const lastPoint = useRef<{ time: number; value: number } | null>(null)
  const kindRef = useRef(kind)

  useEffect(() => {
    hoverRef.current = onHover
    fmtRef.current = formatValue
    volumeRef.current = volumeByTime
    kindRef.current = kind
  })

  /** Position the pulsing dot on the last data point (DOM update, no re-render). */
  const placeDot = () => {
    const dot = dotRef.current
    const chart = chartRef.current
    const s = seriesRef.current
    const last = lastPoint.current
    if (!dot) return
    if (!chart || !s || !last || (kindRef.current !== 'area' && kindRef.current !== 'line')) {
      dot.style.display = 'none'
      return
    }
    const x = chart.timeScale().timeToCoordinate(last.time as UTCTimestamp)
    const y = s.priceToCoordinate(last.value)
    if (x === null || y === null) {
      dot.style.display = 'none'
      return
    }
    dot.style.display = 'block'
    dot.style.left = `${x}px`
    dot.style.top = `${y}px`
  }

  /** Bars: the hovered bar is drawn at full accent, the others stay at reduced opacity. */
  const highlightBar = (time: number | null, p: ChartPalette) => {
    const s = seriesRef.current as ISeriesApi<'Histogram'> | null
    if (!s || kindRef.current !== 'bar') return
    const prev = barHover.current
    if (prev === time) return
    if (prev !== null && barValues.current.has(prev)) {
      s.update({ time: prev as UTCTimestamp, value: barValues.current.get(prev)!, color: withAlpha(p.accent, 0.4) })
    }
    if (time !== null && barValues.current.has(time)) {
      s.update({ time: time as UTCTimestamp, value: barValues.current.get(time)!, color: p.accent })
    }
    barHover.current = time
  }

  // Create (or re-create on kind/theme change) the chart and its series.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const chart = createChart(host, chartOptions(palette, (v: number) => fmtRef.current(v)))
    chartRef.current = chart
    const priceFormat = { type: 'custom' as const, formatter: (v: number) => fmtRef.current(v) }
    let series: AnySeries
    if (kind === 'candles') {
      series = chart.addSeries(CandlestickSeries, {
        upColor: palette.success,
        downColor: palette.critical,
        wickUpColor: palette.success,
        wickDownColor: palette.critical,
        borderVisible: false,
        priceFormat,
      })
    } else if (kind === 'bar') {
      series = chart.addSeries(HistogramSeries, { color: palette.accent, priceFormat, priceLineVisible: false, lastValueVisible: false })
    } else if (kind === 'line') {
      series = chart.addSeries(LineSeries, { color: palette.accent, lineWidth: 2, priceFormat, crosshairMarkerRadius: 4, priceLineVisible: false, lastValueVisible: false })
    } else {
      series = chart.addSeries(AreaSeries, {
        lineColor: palette.accent,
        topColor: withAlpha(palette.accent, 0.25),
        bottomColor: withAlpha(palette.accent, 0),
        lineWidth: 2,
        priceFormat,
        crosshairMarkerRadius: 4,
        priceLineVisible: false,
        lastValueVisible: false,
      })
    }
    seriesRef.current = series
    // Re-place the dot whenever the plot's geometry changes. Our ResizeObserver fires before the
    // chart's own autoSize resize, so defer a frame; the chart's size-change event covers the rest.
    const placeDotSoon = () => requestAnimationFrame(placeDot)
    chart.timeScale().subscribeVisibleLogicalRangeChange(placeDotSoon)
    chart.timeScale().subscribeSizeChange(placeDotSoon)
    const ro = new ResizeObserver(placeDotSoon)
    ro.observe(host)

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const cb = hoverRef.current
      const s = seriesRef.current
      if (kindRef.current === 'bar') highlightBar(param.time && param.point ? Number(param.time) : null, palette)
      if (!cb) return
      if (!param.time || !param.point || !s) {
        cb(null)
        return
      }
      const d = param.seriesData.get(s)
      if (!d) {
        cb(null)
        return
      }
      const time = Number(param.time)
      if ('open' in d) {
        const c = d as CandlestickData<Time>
        cb({ time, value: c.close, open: c.open, high: c.high, low: c.low, close: c.close, volumeUsd: volumeRef.current.get(time) })
      } else {
        cb({ time, value: (d as LineData<Time> | HistogramData<Time>).value ?? null })
      }
    })

    return () => {
      ro.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      barHover.current = null
    }
    // Data is applied by the effect below; the chart itself only changes with kind or theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, palette])

  // Apply data to the current series (colour follows the period trend) and fit the time scale.
  useEffect(() => {
    const s = seriesRef.current
    const chart = chartRef.current
    if (!s || !chart) return
    barHover.current = null
    if (props.kind === 'candles') {
      const candles = normalizeSeries(props.data)
      ;(s as ISeriesApi<'Candlestick'>).setData(
        candles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
      )
      lastPoint.current = null
    } else if (props.kind === 'bar') {
      const bars = normalizeSeries(props.data)
      barValues.current = new Map(bars.map((p) => [p.time, p.value]))
      ;(s as ISeriesApi<'Histogram'>).setData(bars.map((p): HistogramData<Time> => ({ time: p.time as UTCTimestamp, value: p.value, color: palette.accent })))
      lastPoint.current = null
    } else {
      // Drop interior points that barely move from the last kept point (forward-filled buckets, or
      // tiny drifts such as continuously accruing yield) so lines connect real changes instead of
      // drawing a staircase, as on Uniswap. "Barely" = under 0.2% of the visible value range.
      const all = normalizeSeries(props.data)
      const values = all.map((p) => p.value)
      const eps = (Math.max(...values) - Math.min(...values)) * 0.002
      const points: SeriesPoint[] = []
      for (let i = 0; i < all.length; i++) {
        const p = all[i]!
        const prev = points[points.length - 1]
        if (i === 0 || i === all.length - 1 || !prev || Math.abs(p.value - prev.value) > eps) points.push(p)
      }
      const tc = trendColor(points, palette)
      ;(s as ISeriesApi<'Line'> | ISeriesApi<'Area'>).applyOptions(
        props.kind === 'area'
          ? { lineColor: tc, topColor: withAlpha(tc, 0.25), bottomColor: withAlpha(tc, 0) }
          : { color: tc },
      )
      ;(s as ISeriesApi<'Line'> | ISeriesApi<'Area'>).setData(points.map((p): LineData<Time> => ({ time: p.time as UTCTimestamp, value: p.value })))
      lastPoint.current = points.length ? points[points.length - 1]! : null
    }
    chart.timeScale().fitContent()
    // the price scale autoscales a frame or two after setData; place the dot once it has settled
    requestAnimationFrame(placeDot)
    const settle = [setTimeout(placeDot, 60), setTimeout(placeDot, 300)]
    return () => settle.forEach(clearTimeout)
    // `data` identity drives updates; `props` is read for the discriminant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, kind, palette])

  return (
    <div className={cn('relative w-full', className)}>
      {/* Uniswap-style dot matrix behind the plot area (right edge leaves room for the price axis). */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 right-16" style={DOT_GRID(palette.dot)} />
      <div ref={hostRef} data-testid={testId} aria-label={ariaLabel} role="img" className="relative size-full" />
      {(kind === 'area' || kind === 'line') && (
        <>
          <style>{'@media (prefers-reduced-motion: no-preference) { @keyframes ms-chart-pulse { 0% { transform: scale(1); opacity: 0.55 } 80%, 100% { transform: scale(3.2); opacity: 0 } } }'}</style>
          <span ref={dotRef} aria-hidden data-testid="chart-last-dot" className="pointer-events-none absolute z-[1] hidden size-2.5 -translate-x-1/2 -translate-y-1/2" style={{ display: 'none' }}>
            <span className="absolute inset-0 rounded-full motion-reduce:hidden" style={{ background: trend, animation: 'ms-chart-pulse 1.8s ease-out infinite' }} />
            <span className="absolute inset-0 rounded-full ring-2 ring-surface-1" style={{ background: trend }} />
          </span>
        </>
      )}
    </div>
  )
}
