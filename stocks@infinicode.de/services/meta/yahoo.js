import { CHART_RANGES } from './generic.js'

// Keep the candle count low enough for OHLC bodies and wicks to remain visible.
export const INTERVAL_MAPPINGS = {
  [CHART_RANGES.INTRADAY]: '5m',
  [CHART_RANGES.WEEK]: '15m',
  [CHART_RANGES.MONTH]: '1h',
  [CHART_RANGES.HALF_YEAR]: '1d',
  [CHART_RANGES.YEAR_TO_DATE]: '1d',
  [CHART_RANGES.YEAR]: '1d',
  [CHART_RANGES.FIVE_YEARS]: '1wk',
  [CHART_RANGES.MAX]: '1mo'
}
