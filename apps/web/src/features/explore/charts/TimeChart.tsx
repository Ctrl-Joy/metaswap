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
function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1]!, 16)
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${alpha})`
}

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
    grid: {
      vertLines: { visible: false },
      horzLines: { color: p.grid, style: LineStyle.Dotted },
    },
    rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
    timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false, fixLeftEdge: true, fixRightEdge: true },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: { color: p.text3, style: LineStyle.Dashed, width: 1 as const, labelVisible: false },
      horzLine: { color: p.text3, style: LineStyle.Dashed, width: 1 as const, labelVisible: true },
    },
    handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    handleScale: false,
    localization: { priceFormatter: formatValue },
  } as const
}

/**
 * The one lightweight-charts wrapper for explore (line/area, bars, candles). It follows the theme
 * palette, resizes with its container (autoSize), and reports the crosshair as a value/date readout.
 */
export function TimeChart(props: Props) {
  const { className, formatValue, onHover, testId, ariaLabel, kind } = props
  const data = props.data
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<AnySeries | null>(null)
  const hoverRef = useRef(onHover)
  const fmtRef = useRef(formatValue)
  const volumeByTime = useMemo(() => {
    const m = new Map<number, number>()
    if (kind === 'candles') for (const c of data as CandlePoint[]) m.set(c.time, c.volumeUsd)
    return m
  }, [data, kind])
  const volumeRef = useRef(volumeByTime)
  const palette = useChartPalette()

  useEffect(() => {
    hoverRef.current = onHover
    fmtRef.current = formatValue
    volumeRef.current = volumeByTime
  })

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
      series = chart.addSeries(LineSeries, { color: palette.accent, lineWidth: 2, priceFormat, crosshairMarkerRadius: 4 })
    } else {
      series = chart.addSeries(AreaSeries, {
        lineColor: palette.accent,
        topColor: withAlpha(palette.accent, 0.32),
        bottomColor: withAlpha(palette.accent, 0),
        lineWidth: 2,
        priceFormat,
        crosshairMarkerRadius: 4,
      })
    }
    seriesRef.current = series

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      const cb = hoverRef.current
      if (!cb) return
      const s = seriesRef.current
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
        cb({ time, value: (d as LineData<Time>).value ?? null })
      }
    })

    return () => {
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
    // data is applied by the effect below; the chart itself only changes with kind or theme.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, palette])

  // Apply data to the current series and fit the time scale.
  useEffect(() => {
    const s = seriesRef.current
    const chart = chartRef.current
    if (!s || !chart) return
    if (props.kind === 'candles') {
      ;(s as ISeriesApi<'Candlestick'>).setData(
        props.data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })),
      )
    } else if (props.kind === 'bar') {
      ;(s as ISeriesApi<'Histogram'>).setData(props.data.map((p): HistogramData<Time> => ({ time: p.time as UTCTimestamp, value: p.value, color: withAlpha(palette.accent, 0.85) })))
    } else {
      ;(s as ISeriesApi<'Line'> | ISeriesApi<'Area'>).setData(props.data.map((p): LineData<Time> => ({ time: p.time as UTCTimestamp, value: p.value })))
    }
    chart.timeScale().fitContent()
    // `data` identity drives updates; `props` is read for the discriminant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, kind, palette])

  return <div ref={hostRef} data-testid={testId} aria-label={ariaLabel} role="img" className={cn('relative w-full', className)} />
}
