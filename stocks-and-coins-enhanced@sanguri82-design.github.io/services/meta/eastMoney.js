import { CHART_INTERVALS, CHART_RANGES } from './generic.js'

// Keep the candle count low enough for OHLC bodies and wicks to remain visible.
export const AUTO_INTERVAL_MAPPINGS = {
  [CHART_RANGES.INTRADAY]: '1',
  [CHART_RANGES.WEEK]: '15',
  [CHART_RANGES.MONTH]: '60',
  [CHART_RANGES.HALF_YEAR]: '101',
  [CHART_RANGES.YEAR_TO_DATE]: '101',
  [CHART_RANGES.YEAR]: '101',
  [CHART_RANGES.FIVE_YEARS]: '102',
  [CHART_RANGES.MAX]: '103'
}

export const INTERVAL_MAPPINGS = {
  [CHART_INTERVALS.FIVE_MINUTES]: '5',
  [CHART_INTERVALS.FIFTEEN_MINUTES]: '15',
  [CHART_INTERVALS.HOUR]: '60',
  [CHART_INTERVALS.DAY]: '101',
  [CHART_INTERVALS.WEEK]: '102',
  [CHART_INTERVALS.MONTH]: '103'
}

export const MARKETS = {
  0: 'ShenZhen',
  1: 'ShangHai',
  100: 'HangSeng',
  156: 'HongKong'
}
