import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import St from 'gi://St'

import { ButtonGroup } from '../../buttons/buttonGroup.js'
import { Chart } from '../../chart/chart.js'
import { StockDetails } from '../../stocks/stockDetails.js'
import { SearchBar } from '../../searchBar/searchBar.js'

import { clearCache, formatCurrency, formatNumber, getStockColorStyleClass, toLocalDateFormat } from '../../../helpers/data.js'
import { Translations } from '../../../helpers/translations.js'

import { CHART_INTERVALS, CHART_INTERVALS_BY_RANGE, CHART_INTERVALS_MAX_GAP, CHART_RANGES, CHART_RANGES_MAX_GAP, FINANCE_PROVIDER } from '../../../services/meta/generic.js'
import * as FinanceService from '../../../services/financeService.js'

export const StockDetailsScreen = GObject.registerClass({
  GTypeName: 'StocksCoinsEnhanced_StockDetailsScreen'
}, class StockDetailsScreen extends St.BoxLayout {
  _init ({ portfolioId, quoteSummary, mainEventHandler, settings }) {
    super._init({
      style_class: 'screen stock-details-screen',
      vertical: true
    })

    this._mainEventHandler = mainEventHandler
    this._settings = settings

    this._passedQuoteSummary = quoteSummary
    this._portfolioId = portfolioId
    this._selectedChartRange = CHART_RANGES.INTRADAY
    this._selectedChartInterval = CHART_INTERVALS.AUTO
    this._quoteSummary = null

    this._sync().catch(e => console.error(e))
  }

  async _sync () {
    const [quoteSummary, quoteHistorical] = await Promise.all([
      FinanceService.getQuoteSummary({
        symbol: this._passedQuoteSummary.Symbol,
        provider: this._passedQuoteSummary.Provider,
        fallbackName: this._passedQuoteSummary.FullName,
        settings: this._settings
      }),
      FinanceService.getHistoricalQuotes({
        symbol: this._passedQuoteSummary.Symbol,
        provider: this._passedQuoteSummary.Provider,
        range: this._selectedChartRange,
        interval: this._selectedChartInterval,
        settings: this._settings
      })
    ])

    this._isIntrayDayChart = CHART_RANGES.INTRADAY === this._selectedChartRange

    this._quoteSummary = quoteSummary

    this.destroy_all_children()

    const searchBar = new SearchBar({
      back_screen_name: 'overview',
      showFilterInputBox: false,
      mainEventHandler: this._mainEventHandler
    })

    searchBar.connect('refresh', () => {
      clearCache()
      this._sync().catch(e => console.error(e))
    })

    const stockDetailsTabButtonGroup = new ButtonGroup({
      style_class: 'stock-details-tab-button-group',
      enableScrollbar: false,
      y_expand: false,
      buttons: ['KeyData', 'Transactions', 'NewsList'].map(tabKey => ({
        label: tabKey,
        value: tabKey,
        selected: tabKey === 'KeyData'
      }))
    })

    stockDetailsTabButtonGroup.connect('clicked', (_, stButton) => {
      const selectedTab = stButton.buttonData.value

      let screen

      if (selectedTab === 'KeyData') {
        screen = 'stock-details'
      } else if (selectedTab === 'Transactions') {
        screen = 'stock-transactions'
      } else {
        screen = 'stock-news-list'
      }

      this._mainEventHandler.emit('show-screen', {
        screen,
        additionalData: {
          portfolioId: this._portfolioId,
          item: this._passedQuoteSummary
        }
      })
    })

    const stockDetails = new StockDetails({ quoteSummary })

    const chartRangeButtonGroup = new ButtonGroup({
      y_expand: false,
      buttons: Object.keys(CHART_RANGES).map(range => ({
        label: Translations.CHART.RANGES[range],
        value: CHART_RANGES[range],
        selected: CHART_RANGES[range] === this._selectedChartRange
      }))
    })

    chartRangeButtonGroup.connect('clicked', (_, stButton) => {
      this._selectedChartRange = stButton.buttonData.value

      if (!CHART_INTERVALS_BY_RANGE[this._selectedChartRange].includes(this._selectedChartInterval)) {
        this._selectedChartInterval = CHART_INTERVALS.AUTO
      }

      this._sync().catch(e => console.error(e))
    })

    const chartIntervalButtonGroup = new ButtonGroup({
      style_class: 'chart-interval-button-group',
      enableScrollbar: false,
      y_expand: false,
      buttons: Object.keys(CHART_INTERVALS)
          .filter(key => CHART_INTERVALS_BY_RANGE[this._selectedChartRange].includes(CHART_INTERVALS[key]))
          .map(key => ({
            label: Translations.CHART.INTERVALS[key],
            value: CHART_INTERVALS[key],
            selected: CHART_INTERVALS[key] === this._selectedChartInterval
          }))
    })

    chartIntervalButtonGroup.connect('clicked', (_, stButton) => {
      this._selectedChartInterval = stButton.buttonData.value
      this._sync().catch(e => console.error(e))
    })

    this._chart = new Chart({
      data: quoteHistorical.Data,
      candleData: quoteHistorical.CandleData,
      x1: quoteHistorical.MarketStart,
      x2: quoteHistorical.MarketEnd,
      barData: quoteHistorical.VolumeData,
      volumeUnit: this._getVolumeUnit(),
      additionalYData: this._isIntrayDayChart ? [this._quoteSummary.PreviousClose] : [],
      maxGapSize: this._selectedChartInterval === CHART_INTERVALS.AUTO
          ? CHART_RANGES_MAX_GAP[this._selectedChartRange]
          : CHART_INTERVALS_MAX_GAP[this._selectedChartInterval],
      onDraw: this._onChartDraw.bind(this)
    })

    const chartValueHoverBox = new St.BoxLayout({
      style_class: 'chart-hover-box',
      x_align: Clutter.ActorAlign.CENTER
    })

    const chartValueLabel = new St.Label({ style_class: 'chart-hover-label', text: `` })
    const chartValueChangeLabel = new St.Label({ style_class: 'chart-hover-change-label', text: `` })

    chartValueHoverBox.add_child(chartValueLabel)
    chartValueHoverBox.add_child(chartValueChangeLabel)

    // TODO: figure out how we can determine if chart lost focus
    this._chart.connect('chart-hover', (item, x, y) => {
      if (!x) {
        chartValueLabel.text = ''
        chartValueChangeLabel.text = ''
        return
      }

      const currencyCode = this._quoteSummary.CurrencyCode || this._quoteSummary.CurrencySymbol
      const changeAbsolute = formatCurrency(this._quoteSummary.Close - y, currencyCode)
      const changePercentage = formatNumber((this._quoteSummary.Close / y * 100) - 100)

      const changeColorStyleClass = getStockColorStyleClass(changePercentage)

      chartValueLabel.text = `${toLocalDateFormat(x, Translations.FORMATS.DEFAULT_DATE_TIME)} ${formatCurrency(y, currencyCode)}`
      chartValueChangeLabel.text = `(${changeAbsolute} / ${changePercentage} %)`
      chartValueChangeLabel.style_class = `chart-hover-change-label ${changeColorStyleClass}`
    })

    this.add_child(searchBar)

    this.add_child(stockDetailsTabButtonGroup)
    this.add_child(stockDetails)

    this.add_child(chartRangeButtonGroup)
    this.add_child(chartIntervalButtonGroup)
    this.add_child(this._chart)
    this.add_child(chartValueHoverBox)
  }

  _onChartDraw ({ width, height, cairoContext, secondaryColor }) {
    if (this._isIntrayDayChart && this._quoteSummary && this._quoteSummary.PreviousClose) {
      const previousCloseY = this._chart.getPriceY(this._quoteSummary.PreviousClose, height)

      this._chart.draw_line({
        x1: 0,
        x2: width,
        y1: previousCloseY,
        y2: previousCloseY,
        color: secondaryColor,
        lineWidth: 1,
        dashed: true,
        cairoContext
      })
    }
  }

  _getVolumeUnit () {
    const provider = this._passedQuoteSummary.Provider
    const symbol = String(this._passedQuoteSummary.Symbol || '').toUpperCase()
    const currencyCode = String(this._quoteSummary.CurrencyCode || '').toUpperCase()

    if (provider === FINANCE_PROVIDER.YAHOO || provider === FINANCE_PROVIDER.EAST_MONEY) {
      return 'shares'
    }

    if (provider === FINANCE_PROVIDER.COINGECKO) {
      return currencyCode || 'USD'
    }

    if (provider === FINANCE_PROVIDER.COINBASE) {
      return symbol.split('-')[0] || 'units'
    }

    if (provider === FINANCE_PROVIDER.UPBIT) {
      return symbol.split('-').at(-1) || 'units'
    }

    if (provider === FINANCE_PROVIDER.BINANCE && currencyCode && symbol.endsWith(currencyCode)) {
      return symbol.slice(0, -currencyCode.length) || 'units'
    }

    return 'units'
  }
})
