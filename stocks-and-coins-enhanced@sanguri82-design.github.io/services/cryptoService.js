import { fetch } from '../helpers/fetch.js'
import { QuoteHistorical } from './dto/quoteHistorical.js'
import { QuoteSummary } from './dto/quoteSummary.js'
import { CHART_INTERVALS, CHART_RANGES, FINANCE_PROVIDER, MARKET_STATES } from './meta/generic.js'

const API_ENDPOINTS = {
  [FINANCE_PROVIDER.BINANCE]: 'https://data-api.binance.vision',
  [FINANCE_PROVIDER.COINGECKO]: 'https://api.coingecko.com/api/v3',
  [FINANCE_PROVIDER.COINBASE]: 'https://api.exchange.coinbase.com',
  [FINANCE_PROVIDER.UPBIT]: 'https://api.upbit.com'
}

const errorText = response => `${response.statusText} - ${response.text()}`
const numberOrNull = value => value === null || value === undefined || value === '' ? null : Number(value)

const quoteCurrency = (symbol, provider) => {
  if (provider === FINANCE_PROVIDER.COINBASE) return symbol.split('-').at(-1)
  if (provider === FINANCE_PROVIDER.UPBIT) return symbol.split('-')[0]
  if (provider === FINANCE_PROVIDER.COINGECKO) return 'USD'

  return ['USDT', 'USDC', 'FDUSD', 'BUSD', 'BTC', 'ETH', 'EUR', 'KRW']
      .find(currency => symbol.toUpperCase().endsWith(currency)) || null
}

const rangeInDays = range => {
  if (range === CHART_RANGES.INTRADAY) return 1
  if (range === CHART_RANGES.WEEK) return 5
  if (range === CHART_RANGES.MONTH) return 30
  if (range === CHART_RANGES.HALF_YEAR) return 180
  if (range === CHART_RANGES.YEAR_TO_DATE) {
    return Math.max(1, Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).valueOf()) / 86400000))
  }
  if (range === CHART_RANGES.YEAR) return 365
  if (range === CHART_RANGES.FIVE_YEARS) return 1825
  return 3650
}

const createSummary = ({ symbol, provider, name, close, open, high, low, volume, change, changePercent, timestamp = Date.now(), error = null }) => {
  const summary = new QuoteSummary(symbol, provider, name, error)
  summary.FullName = name
  summary.Timestamp = timestamp
  summary.Close = numberOrNull(close)
  summary.Open = numberOrNull(open)
  summary.PreviousClose = numberOrNull(open)
  summary.High = numberOrNull(high)
  summary.Low = numberOrNull(low)
  summary.Volume = numberOrNull(volume)
  summary.Change = numberOrNull(change) ?? (summary.Close !== null && summary.Open !== null ? summary.Close - summary.Open : null)
  summary.ChangePercent = numberOrNull(changePercent) ?? (summary.Open ? (summary.Close / summary.Open - 1) * 100 : null)
  summary.CurrencyCode = quoteCurrency(symbol, provider)
  summary.CurrencySymbol = summary.CurrencyCode
  summary.ExchangeName = provider[0].toUpperCase() + provider.slice(1)
  summary.MarketState = MARKET_STATES.REGULAR
  return summary
}

const failedSummary = (symbol, provider, response) => createSummary({
  symbol,
  provider,
  name: symbol,
  error: errorText(response)
})

export const getQuoteList = async ({ symbolsWithFallbackName, provider, cancellable = null }) => {
  return Promise.all(symbolsWithFallbackName.map(({ symbol, fallbackName }) =>
    getQuoteSummary({ symbol, provider, fallbackName, cancellable })))
}

export const getQuoteSummary = async ({ symbol, provider, fallbackName, cancellable = null }) => {
  if (provider === FINANCE_PROVIDER.BINANCE) {
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/api/v3/ticker/24hr`,
      queryParameters: { symbol: symbol.toUpperCase() },
      cancellable
    })
    if (!response.ok) return failedSummary(symbol, provider, response)
    const data = response.json()
    return createSummary({
      symbol, provider, name: fallbackName || symbol, close: data.lastPrice, open: data.openPrice,
      high: data.highPrice, low: data.lowPrice, volume: data.volume, change: data.priceChange,
      changePercent: data.priceChangePercent, timestamp: data.closeTime
    })
  }

  if (provider === FINANCE_PROVIDER.COINGECKO) {
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/coins/markets`,
      queryParameters: { vs_currency: 'usd', ids: symbol, price_change_percentage: '24h' },
      cancellable
    })
    if (!response.ok) return failedSummary(symbol, provider, response)
    const data = (response.json() || [])[0]
    if (!data) return createSummary({ symbol, provider, name: fallbackName || symbol, error: 'CoinGecko coin ID not found' })
    return createSummary({
      symbol, provider, name: data.name || fallbackName || symbol, close: data.current_price,
      open: data.current_price - data.price_change_24h, high: data.high_24h, low: data.low_24h,
      volume: data.total_volume, change: data.price_change_24h,
      changePercent: data.price_change_percentage_24h, timestamp: new Date(data.last_updated).valueOf()
    })
  }

  if (provider === FINANCE_PROVIDER.COINBASE) {
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/products/${encodeURIComponent(symbol.toUpperCase())}/stats`,
      cancellable
    })
    if (!response.ok) return failedSummary(symbol, provider, response)
    const data = response.json()
    return createSummary({
      symbol, provider, name: fallbackName || symbol, close: data.last, open: data.open,
      high: data.high, low: data.low, volume: data.volume
    })
  }

  if (provider === FINANCE_PROVIDER.UPBIT) {
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/v1/ticker`,
      queryParameters: { markets: symbol.toUpperCase() },
      cancellable
    })
    if (!response.ok) return failedSummary(symbol, provider, response)
    const data = (response.json() || [])[0]
    if (!data) return createSummary({ symbol, provider, name: fallbackName || symbol, error: 'Upbit market not found' })
    return createSummary({
      symbol, provider, name: fallbackName || symbol, close: data.trade_price, open: data.opening_price,
      high: data.high_price, low: data.low_price, volume: data.acc_trade_volume_24h,
      change: data.signed_change_price, changePercent: data.signed_change_rate * 100, timestamp: data.timestamp
    })
  }

  return createSummary({ symbol, provider, name: fallbackName || symbol, error: 'Invalid crypto provider' })
}

const historicalFromRows = (rows, error = null) => {
  const result = new QuoteHistorical()
  result.Error = error
  result.Data = rows.map(row => [row.timestamp, row.close])
  result.CandleData = rows.map(row => [row.timestamp, row.open, row.high, row.low, row.close])
  result.VolumeData = rows.map(row => [row.timestamp, row.volume])
  result.MarketStart = rows[0]?.timestamp || null
  result.MarketEnd = rows.at(-1)?.timestamp || null
  return result
}

const autoInterval = days => days <= 1 ? CHART_INTERVALS.FIVE_MINUTES
  : days <= 30 ? CHART_INTERVALS.HOUR
    : days <= 365 ? CHART_INTERVALS.DAY
      : CHART_INTERVALS.WEEK

const binanceInterval = interval => ({
  [CHART_INTERVALS.FIVE_MINUTES]: '5m', [CHART_INTERVALS.FIFTEEN_MINUTES]: '15m',
  [CHART_INTERVALS.HOUR]: '1h', [CHART_INTERVALS.DAY]: '1d',
  [CHART_INTERVALS.WEEK]: '1w', [CHART_INTERVALS.MONTH]: '1M'
})[interval]

export const getHistoricalQuotes = async ({ symbol, provider, range = CHART_RANGES.MONTH, interval = CHART_INTERVALS.AUTO, cancellable = null }) => {
  const days = rangeInDays(range)
  const effectiveInterval = interval === CHART_INTERVALS.AUTO ? autoInterval(days) : interval

  if (provider === FINANCE_PROVIDER.BINANCE) {
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/api/v3/klines`,
      queryParameters: {
        symbol: symbol.toUpperCase(), interval: binanceInterval(effectiveInterval),
        startTime: Date.now() - days * 86400000, limit: 1000
      },
      cancellable
    })
    if (!response.ok) return historicalFromRows([], errorText(response))
    return historicalFromRows((response.json() || []).map(row => ({
      timestamp: row[0], open: Number(row[1]), high: Number(row[2]), low: Number(row[3]),
      close: Number(row[4]), volume: Number(row[5])
    })))
  }

  if (provider === FINANCE_PROVIDER.COINGECKO) {
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/coins/${encodeURIComponent(symbol)}/market_chart`,
      queryParameters: { vs_currency: 'usd', days },
      cancellable
    })
    if (!response.ok) return historicalFromRows([], errorText(response))
    const data = response.json() || {}
    let previousClose = null
    return historicalFromRows((data.prices || []).map((price, index) => {
      const close = Number(price[1])
      const open = previousClose ?? close
      previousClose = close
      return {
        timestamp: price[0], open, high: Math.max(open, close), low: Math.min(open, close), close,
        volume: Number((data.total_volumes || [])[index]?.[1] || 0)
      }
    }))
  }

  if (provider === FINANCE_PROVIDER.COINBASE) {
    const requestedSeconds = ({
      [CHART_INTERVALS.FIVE_MINUTES]: 300, [CHART_INTERVALS.FIFTEEN_MINUTES]: 900,
      [CHART_INTERVALS.HOUR]: 3600, [CHART_INTERVALS.DAY]: 86400,
      [CHART_INTERVALS.WEEK]: 86400, [CHART_INTERVALS.MONTH]: 86400
    })[effectiveInterval] || 3600
    const granularities = [60, 300, 900, 3600, 21600, 86400]
    const granularity = granularities.find(value => value >= requestedSeconds && days * 86400 / value <= 300) || 86400
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/products/${encodeURIComponent(symbol.toUpperCase())}/candles`,
      queryParameters: { granularity, start: new Date(Date.now() - Math.min(days * 86400000, granularity * 300000)).toISOString(), end: new Date().toISOString() },
      cancellable
    })
    if (!response.ok) return historicalFromRows([], errorText(response))
    const rows = (response.json() || []).map(row => ({
      timestamp: row[0] * 1000, low: Number(row[1]), high: Number(row[2]), open: Number(row[3]),
      close: Number(row[4]), volume: Number(row[5])
    })).sort((a, b) => a.timestamp - b.timestamp)
    return historicalFromRows(rows)
  }

  if (provider === FINANCE_PROVIDER.UPBIT) {
    const minuteUnit = ({
      [CHART_INTERVALS.FIVE_MINUTES]: 5, [CHART_INTERVALS.FIFTEEN_MINUTES]: 15,
      [CHART_INTERVALS.HOUR]: 60
    })[effectiveInterval]
    let candlePath = minuteUnit ? `minutes/${minuteUnit}` : 'days'
    if (effectiveInterval === CHART_INTERVALS.WEEK) candlePath = 'weeks'
    if (effectiveInterval === CHART_INTERVALS.MONTH) candlePath = 'months'
    const unitDays = minuteUnit ? minuteUnit / 1440 : candlePath === 'weeks' ? 7 : candlePath === 'months' ? 30 : 1
    const response = await fetch({
      url: `${API_ENDPOINTS[provider]}/v1/candles/${candlePath}`,
      queryParameters: { market: symbol.toUpperCase(), count: Math.min(200, Math.max(1, Math.ceil(days / unitDays))) },
      cancellable
    })
    if (!response.ok) return historicalFromRows([], errorText(response))
    const rows = (response.json() || []).map(row => ({
      timestamp: new Date(`${row.candle_date_time_utc}Z`).valueOf(), open: row.opening_price,
      high: row.high_price, low: row.low_price, close: row.trade_price, volume: row.candle_acc_trade_volume
    })).sort((a, b) => a.timestamp - b.timestamp)
    return historicalFromRows(rows)
  }

  return historicalFromRows([], 'Invalid crypto provider')
}

export const getNewsList = async () => []
