import { useEffect, useState } from 'react'

/** Chart colours read from the MetaSwap theme variables, so both themes work (design-tokens.md). */
export interface ChartPalette {
  accent: string
  success: string
  critical: string
  text2: string
  text3: string
  border: string
  surface1: string
  grid: string
  /** Dotted grid colour (subtle, like Uniswap's dot grid). */
  dot: string
}

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function readChartPalette(): ChartPalette {
  return {
    accent: readVar('--ms-accent', '#8b8cff'),
    success: readVar('--ms-success', '#3ddc84'),
    critical: readVar('--ms-critical', '#ff6b6b'),
    text2: readVar('--ms-text-2', '#a4aab9'),
    text3: readVar('--ms-text-3', '#6e7486'),
    border: readVar('--ms-border', '#2a2d38'),
    surface1: readVar('--ms-surface-1', '#13141a'),
    grid: readVar('--ms-skeleton', '#ffffff12'),
    dot: readVar('--ms-border', '#2a2d38'),
  }
}

/**
 * Palette that follows the theme. The App sets `data-theme` on <html> in an effect that runs after
 * children's effects, so a MutationObserver is used rather than the store value alone.
 */
export function useChartPalette(): ChartPalette {
  const [palette, setPalette] = useState<ChartPalette>(() => readChartPalette())
  useEffect(() => {
    const refresh = () => setPalette(readChartPalette())
    refresh()
    const obs = new MutationObserver(refresh)
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
    return () => obs.disconnect()
  }, [])
  return palette
}
