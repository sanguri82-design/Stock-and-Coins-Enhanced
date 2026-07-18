import GObject from 'gi://GObject'
import St from 'gi://St'

import { closest, fallbackIfNaN, isNullOrEmpty, isNullOrUndefined } from '../../helpers/data.js'

const CHART_COLORS = {
  positive: '#ef4444ff',
  negative: '#3b82f6ff',
  neutral: '#000000ff',
  volumePositive: '#ef4444ff',
  volumeNegative: '#3b82f6ff',
  volumeNeutral: '#000000ff',
  accent: '#a78bfaff'
}

const PRICE_AREA_HEIGHT_RATIO = 0.76
const PRICE_AREA_TOP_PADDING = 8

export const Chart = GObject.registerClass({
  GTypeName: 'StocksCoinsEnhanced_Chart',
  Signals: {
    'chart-hover': {
      param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE]
    }
  }
}, class Chart extends St.DrawingArea {
  _init ({ data, candleData, x1, x2, barData, onDraw, additionalYData, maxGapSize }) {
    super._init({
      style_class: 'chart',
      reactive: true,
      width: 500,
      height: 300
    })

    // time series data, [[x, y]]; x = timestamp , y = value
    // removeTimeGaps probably alter original x value but adds the original to end [[xModified, yOriginal, xOriginal]]
    const [cleanedData, totalTimeShiftMillis] = this.removeTimeGaps(data, maxGapSize)
    this.data = cleanedData

    const [cleanedBarData] = this.removeTimeGaps(barData, maxGapSize)
    this.barData = cleanedBarData

    const [cleanedCandleData] = this.removeTimeGaps(candleData, maxGapSize)
    this.candleData = cleanedCandleData

    this.x1 = x1
    this.x2 = x2 - totalTimeShiftMillis

    this._selectedX = null
    this._selectedY = null
    this._selectedPoint = null
    this._surfaceWidth = 500
    this._surfaceHeight = 300
    this._onDraw = onDraw
    this._additionalYData = additionalYData || []
    this._userLines = []

    this.connect('repaint', this._draw.bind(this))
    this.connect('button-press-event', this._onClick.bind(this))
    this.connect('motion-event', this._onHover.bind(this))
    this.connect('leave-event', this._onLeave.bind(this))
    this.connect('notify::mapped', () => {
      if (this.mapped) {
        this.queue_repaint()
      }
    })
  }

  _draw () {
    if (isNullOrEmpty(this.data)) {
      // TODO: show empty content hint
      return
    }

    const cairoContext = this.get_context()
    const [width, height] = this.get_surface_size()

    // During the popup animation the actor can temporarily have no drawable
    // surface. Do not rely on get_stage()/get_width() here because doing so can
    // leave the newly-created surface blank without another repaint.
    if (width <= 0 || height <= 0) {
      cairoContext.$dispose()
      return
    }

    // Keep the drawable surface dimensions separate from Clutter.Actor's
    // width/height properties. Assigning the content size back to the actor
    // would subtract the CSS border again on every repaint and progressively
    // shrink the chart to zero.
    this._surfaceWidth = width
    this._surfaceHeight = height

    // get primary color from themes
    const themeNode = this.get_theme_node()

    const fgColor = themeNode.get_foreground_color()
    const secondaryColor = this._getColor(CHART_COLORS.accent)

    const baseParams = {
      cairoContext,
      width,
      height,
      primaryColor: fgColor,
      secondaryColor
    }

    this._draw_grid(baseParams)
    this._draw_candlesticks(baseParams)
    this._draw_volume_bars(baseParams)
    this._draw_crosshair(baseParams)
    this._draw_user_lines(baseParams)

    if (this._onDraw) {
      this._onDraw(baseParams)
    }

    // dispose cairo stuff
    cairoContext.$dispose()
  }

  _draw_grid ({ width, height, cairoContext, primaryColor }) {
    cairoContext.setSourceRGBA(
        this._normalizeColorComponent(primaryColor.red),
        this._normalizeColorComponent(primaryColor.green),
        this._normalizeColorComponent(primaryColor.blue),
        0.10
    )
    cairoContext.setLineWidth(0.5)

    for (let index = 1; index < 5; index++) {
      const y = Math.round((height / 5) * index) + 0.5
      cairoContext.moveTo(0, y)
      cairoContext.lineTo(width, y)
    }

    for (let index = 1; index < 6; index++) {
      const x = Math.round((width / 6) * index) + 0.5
      cairoContext.moveTo(x, 0)
      cairoContext.lineTo(x, height)
    }

    cairoContext.stroke()
  }

  _draw_candlesticks ({ width, height, cairoContext }) {
    if (isNullOrEmpty(this.candleData)) {
      return
    }

    const [minValueX, maxValueX] = this.getXRange(this.candleData)
    const bodyWidth = Math.max(1, Math.min(8, (width / this.candleData.length) * 0.68))
    const positiveColor = this._getColor(CHART_COLORS.positive)
    const negativeColor = this._getColor(CHART_COLORS.negative)
    const neutralColor = this._getColor(CHART_COLORS.neutral)

    this.candleData.forEach(([timestamp, rawOpen, rawHigh, rawLow, rawClose]) => {
      const open = Number(rawOpen)
      const high = Number(rawHigh)
      const low = Number(rawLow)
      const close = Number(rawClose)

      if ([timestamp, open, high, low, close].some(value => isNaN(value))) {
        return
      }

      const x = this.encodeValue(timestamp, minValueX, maxValueX, 0, width)
      const highY = this.getPriceY(high, height)
      const lowY = this.getPriceY(low, height)
      const openY = this.getPriceY(open, height)
      const closeY = this.getPriceY(close, height)
      const color = close > open
          ? positiveColor
          : close < open
              ? negativeColor
              : neutralColor

      // High-low wick.
      cairoContext.setSourceRGBA(color.red, color.green, color.blue, 0.95)
      cairoContext.setLineWidth(Math.max(1, bodyWidth * 0.18))
      cairoContext.moveTo(x, highY)
      cairoContext.lineTo(x, lowY)
      cairoContext.stroke()

      // Open-close body. A minimum height keeps doji candles visible.
      const bodyTop = Math.min(openY, closeY)
      const bodyHeight = Math.max(2, Math.abs(closeY - openY))
      cairoContext.setSourceRGBA(color.red, color.green, color.blue, 0.90)
      cairoContext.rectangle(x - (bodyWidth / 2), bodyTop, bodyWidth, bodyHeight)
      cairoContext.fill()
    })
  }

  _draw_volume_bars ({ width, height, cairoContext }) {
    if (isNullOrEmpty(this.barData)) {
      return
    }

    const volumeBarsHeight = height * 0.16
    const seriesData = this._transformSeriesData(this.barData, width, volumeBarsHeight)

    const barWidth = Math.max(1, Math.min(5, (width / seriesData.length) * 0.65))
    const positiveColor = this._getColor(CHART_COLORS.volumePositive)
    const negativeColor = this._getColor(CHART_COLORS.volumeNegative)
    const neutralColor = this._getColor(CHART_COLORS.volumeNeutral)
    const candlesByTimestamp = new Map(this.candleData.map(candle => [candle[0], candle]))

    seriesData.forEach(([valueX, valueY], index) => {
      if (isNullOrUndefined(valueX) || isNullOrUndefined(fallbackIfNaN(valueY, null))) {
        return
      }

      const timestamp = this.barData[index]?.[0]
      const candle = candlesByTimestamp.get(timestamp)
      const open = Number(candle?.[1])
      const close = Number(candle?.[4])
      const color = !candle || isNaN(open) || isNaN(close) || close === open
          ? neutralColor
          : close > open
              ? positiveColor
              : negativeColor

      cairoContext.setSourceRGBA(color.red, color.green, color.blue, 0.36)
      cairoContext.rectangle(valueX - (barWidth / 2), height - valueY, barWidth, valueY)
      cairoContext.fill()
    })
  }

  _draw_crosshair ({ width, height, cairoContext, secondaryColor }) {
    if (!isNullOrUndefined(this._selectedX)) {
      this.draw_line({
        y1: 0,
        y2: height,
        x1: this._selectedX,
        x2: this._selectedX,
        cairoContext,
        color: secondaryColor
      })
    }

    if (!isNullOrUndefined(this._selectedY)) {
      this.draw_line({
        x1: 0,
        x2: width,
        y1: this._selectedY,
        y2: this._selectedY,
        cairoContext,
        color: secondaryColor
      })
    }

    if (this._selectedPoint) {
      cairoContext.arc(this._selectedPoint.x, this._selectedPoint.y, 4, 0, Math.PI * 2)
      cairoContext.setSourceRGBA(secondaryColor.red, secondaryColor.green, secondaryColor.blue, 1)
      cairoContext.fill()

      cairoContext.arc(this._selectedPoint.x, this._selectedPoint.y, 7, 0, Math.PI * 2)
      cairoContext.setSourceRGBA(secondaryColor.red, secondaryColor.green, secondaryColor.blue, 0.28)
      cairoContext.fill()
    }
  }

  _draw_user_lines ({ width, height, cairoContext, secondaryColor }) {
    this._userLines.forEach(userLine => {
      let { x1, x2, y1, y2 } = userLine

      x2 = isNullOrUndefined(x2) ? this._selectedX : x2
      y2 = isNullOrUndefined(y2) ? this._selectedY : y2

      if (!x2 || !y2) {
        return
      }

      this.draw_line({
        x1,
        x2,
        y1,
        y2,
        cairoContext,
        color: this._getColor(CHART_COLORS.accent),
        lineWidth: 1.5
      })
    })
  }

  draw_line ({ x1, x2, y1, y2, cairoContext, color, dashed, lineWidth = 0.5 }) {
    cairoContext.save()
    cairoContext.setSourceRGBA(color.red, color.green, color.blue, 1);
    cairoContext.setLineWidth(lineWidth)

    if (dashed) {
      cairoContext.setDash([10, 5], 0)
    }

    cairoContext.moveTo(x1, y1)
    cairoContext.lineTo(x2, y2)
    cairoContext.stroke()
    cairoContext.restore()
  }

  _transformSeriesData (data, width, height) {
    if (isNullOrEmpty(data)) {
      return []
    }

    const [minValueX, maxValueX] = this.getXRange(data)
    const [minValueY, maxValueY] = this.getYRange(data)

    return data.map(([x, y]) => [
      this.encodeValue(x, minValueX, maxValueX, 0, width),
      isNullOrUndefined(y) ? null : this.encodeValue(y, minValueY, maxValueY, 0, height)
    ])
  }

  _onClick (item, event) {
    if (isNullOrEmpty(this.data)) {
      return
    }

    // Check if the actor has been allocated before getting position
    if (!this.get_stage() || this.get_width() === 0 || this.get_height() === 0) {
      return
    }

    // first get position then
    // check if there is an open userline otherwise open one

    const [coordX, coordY] = event.get_coords()
    const [positionX, positionY] = item.get_transformed_position()

    const chartX = coordX - positionX
    const chartY = coordY - positionY

    const userLine = this._userLines.find(item => isNullOrUndefined(item.x2))

    if (userLine) {
      userLine.x2 = chartX
      userLine.y2 = chartY
    } else {
      this._userLines.push({
        x1: chartX,
        y1: chartY
      })
    }

    this.queue_repaint()
  }

  _onHover (item, event) {
    if (isNullOrEmpty(this.data)) {
      return
    }

    // Check if the actor has been allocated before getting position
    if (!this.get_stage() || this.get_width() === 0 || this.get_height() === 0) {
      return
    }

    // first get position
    // then convert the position data back to original x value (timestamp)
    // find by this timestamp the closest item in series data

    const [coordX, coordY] = event.get_coords()
    const [positionX, positionY] = item.get_transformed_position()

    const chartX = coordX - positionX
    const chartY = coordY - positionY

    const [minValueX, maxValueX] = this.getXRange()

    const hoveredValueX = this.decodeValue(chartX, minValueX, maxValueX, 0, this._surfaceWidth)
    const originalValueX = closest(this.data.filter(data => data[1] !== null).map(data => data[0]), hoveredValueX)

    const tsItem = this.data.find(data => data[0] === originalValueX)
    this.emit('chart-hover', tsItem[2] || tsItem[0], tsItem[1])

    const selectedX = this.encodeValue(tsItem[0], minValueX, maxValueX, 0, this._surfaceWidth)
    const selectedY = this.getPriceY(tsItem[1], this._surfaceHeight)

    this._selectedX = selectedX
    this._selectedY = selectedY
    this._selectedPoint = { x: selectedX, y: selectedY }

    this.queue_repaint()
  }

  _onLeave () {
    this._selectedX = null
    this._selectedY = null
    this._selectedPoint = null

    this.emit('chart-hover', null, null)

    this.queue_repaint()
  }

  getXRange (data) {
    data = data || this.data

    if (!data) {
      return
    }

    const minValueX = this.x1 || data[0][0]
    const maxValueX = this.x2 || data[data.length - 1][0]

    return [minValueX, maxValueX]
  }

  getYRange (data) {
    if (!data && !isNullOrEmpty(this.candleData)) {
      const candleValues = this.candleData.flatMap(item => [item[2], item[3]])
      return this._createValueRange([...this._additionalYData, ...candleValues])
    }

    data = data || this.data
    if (!data) {
      return
    }

    return this._createValueRange([...this._additionalYData, ...data.map(item => item[1])])
  }

  getPriceY (value, height = this._surfaceHeight) {
    const [minValueY, maxValueY] = this.getYRange()
    const priceAreaHeight = height * PRICE_AREA_HEIGHT_RATIO

    return PRICE_AREA_TOP_PADDING + priceAreaHeight -
        this.encodeValue(value, minValueY, maxValueY, 0, priceAreaHeight)
  }

  _createValueRange (values) {
    const yValues = values
        .map(Number)
        .filter(item => !isNaN(item))

    if (isNullOrEmpty(yValues)) {
      return [0, 1]
    }

    let minValueY = Math.min(...yValues)
    let maxValueY = Math.max(...yValues)

    // add small buffer
    const buffer = (maxValueY - minValueY) * 0.125
    minValueY -= buffer
    maxValueY += buffer

    return [minValueY, maxValueY]
  }

  removeTimeGaps (data, maxGapInMillis) {
    let totalTimeShiftMillis = 0

    if (!data || !maxGapInMillis) {
      return [data, totalTimeShiftMillis]
    }

    data = data.filter(item => !isNullOrUndefined(item[1]))

    let previousOriginalX = null

    const gapCleanedData = data.map(item => {
      const originalX = item[0]

      if (previousOriginalX !== null) {
        const gapInMillis = originalX - previousOriginalX
        if (gapInMillis >= maxGapInMillis) {
          totalTimeShiftMillis += gapInMillis
        }
      }

      const newItem = [originalX - totalTimeShiftMillis, ...item.slice(1), originalX]
      previousOriginalX = originalX

      return newItem
    })

    return [gapCleanedData, totalTimeShiftMillis]
  }

  // thx: https://stackoverflow.com/a/5732390/3828502
  encodeValue (value, minValue, maxValue, encodeMin, encodeMax) {
    if (minValue === maxValue) {
      return (encodeMin + encodeMax) / 2
    }

    return encodeMin + ((encodeMax - encodeMin) / (maxValue - minValue)) * (value - minValue)
  }

  decodeValue (value, minValue, maxValue, encodeMin, encodeMax) {
    if (encodeMin === encodeMax) {
      return minValue
    }

    return minValue + ((maxValue - minValue) / (encodeMax - encodeMin)) * (value - encodeMin)
  }

  _getColor (colorString) {
    const hex = colorString.replace('#', '').slice(0, 6)

    return {
      red: parseInt(hex.slice(0, 2), 16) / 255,
      green: parseInt(hex.slice(2, 4), 16) / 255,
      blue: parseInt(hex.slice(4, 6), 16) / 255
    }
  }

  _normalizeColorComponent (component) {
    return component > 1 ? component / 255 : component
  }

})
