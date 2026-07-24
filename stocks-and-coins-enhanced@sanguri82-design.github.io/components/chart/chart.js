import Cairo from 'cairo'
import Clutter from 'gi://Clutter'
import GObject from 'gi://GObject'
import St from 'gi://St'

import { closest, fallbackIfNaN, formatNumber, isNullOrEmpty, isNullOrUndefined } from '../../helpers/data.js'

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
const ZOOM_STEP = 1.25
const MIN_VISIBLE_ITEMS = 5
const TOOLTIP_FONT_SIZE = 12
const TOOLTIP_LINE_HEIGHT = 17
const TOOLTIP_PADDING_X = 10
const TOOLTIP_PADDING_Y = 8
const TOOLTIP_MARGIN = 8
const TOOLTIP_CORNER_RADIUS = 7

export const Chart = GObject.registerClass({
  GTypeName: 'StocksCoinsEnhanced_Chart',
  Signals: {
    'chart-hover': {
      param_types: [GObject.TYPE_DOUBLE, GObject.TYPE_DOUBLE]
    }
  }
}, class Chart extends St.DrawingArea {
  _init ({ data, candleData, x1, x2, barData, onDraw, additionalYData, maxGapSize, volumeUnit }) {
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
    this.x2 = isNullOrUndefined(x2) ? null : x2 - totalTimeShiftMillis
    const xValues = this.data?.map(item => item[0]) || []
    this._fullX1 = this.x1 ?? Math.min(...xValues)
    this._fullX2 = this.x2 ?? Math.max(...xValues)
    this._viewX1 = this._fullX1
    this._viewX2 = this._fullX2
    this._minimumViewSpan = this._getMinimumViewSpan()

    this._selectedX = null
    this._selectedY = null
    this._selectedPoint = null
    this._hoverTooltip = null
    this._surfaceWidth = 500
    this._surfaceHeight = 300
    this._onDraw = onDraw
    this._additionalYData = additionalYData || []
    this._volumeUnit = volumeUnit || 'units'
    this._userLines = []

    this.connect('repaint', this._draw.bind(this))
    this.connect('button-press-event', this._onClick.bind(this))
    this.connect('motion-event', this._onHover.bind(this))
    this.connect('leave-event', this._onLeave.bind(this))
    this.connect('scroll-event', this._onScroll.bind(this))
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

    this._draw_hover_tooltip(baseParams)

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
    const visibleCandleData = this._getVisibleData(this.candleData)
    if (isNullOrEmpty(visibleCandleData)) {
      return
    }

    const [minValueX, maxValueX] = this.getXRange()
    const bodyWidth = Math.max(1, Math.min(18, (width / visibleCandleData.length) * 0.68))
    const positiveColor = this._getColor(CHART_COLORS.positive)
    const negativeColor = this._getColor(CHART_COLORS.negative)
    const neutralColor = this._getColor(CHART_COLORS.neutral)

    visibleCandleData.forEach(([timestamp, rawOpen, rawHigh, rawLow, rawClose]) => {
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
    const visibleBarData = this._getVisibleData(this.barData)
    if (isNullOrEmpty(visibleBarData)) {
      return
    }

    const volumeBarsHeight = height * 0.16
    const seriesData = this._transformSeriesData(visibleBarData, width, volumeBarsHeight)

    const barWidth = Math.max(1, Math.min(12, (width / seriesData.length) * 0.65))
    const positiveColor = this._getColor(CHART_COLORS.volumePositive)
    const negativeColor = this._getColor(CHART_COLORS.volumeNegative)
    const neutralColor = this._getColor(CHART_COLORS.volumeNeutral)
    const candlesByTimestamp = new Map(this.candleData.map(candle => [candle[0], candle]))

    seriesData.forEach(([valueX, valueY], index) => {
      if (isNullOrUndefined(valueX) || isNullOrUndefined(fallbackIfNaN(valueY, null))) {
        return
      }

      const timestamp = visibleBarData[index]?.[0]
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

  _draw_hover_tooltip ({ width, height, cairoContext, secondaryColor }) {
    if (!this._hoverTooltip) {
      return
    }

    const { anchorX, anchorY, lines, placeAbove } = this._hoverTooltip

    cairoContext.save()
    cairoContext.selectFontFace('Sans', Cairo.FontSlant.NORMAL, Cairo.FontWeight.NORMAL)
    cairoContext.setFontSize(TOOLTIP_FONT_SIZE)

    const textWidth = Math.max(...lines.map(line => cairoContext.textExtents(line).width))
    const bubbleWidth = Math.ceil(textWidth + (TOOLTIP_PADDING_X * 2))
    const bubbleHeight = (lines.length * TOOLTIP_LINE_HEIGHT) + (TOOLTIP_PADDING_Y * 2)

    let bubbleX = anchorX + TOOLTIP_MARGIN
    if (bubbleX + bubbleWidth > width - TOOLTIP_MARGIN) {
      bubbleX = anchorX - bubbleWidth - TOOLTIP_MARGIN
    }
    bubbleX = Math.max(TOOLTIP_MARGIN, Math.min(width - bubbleWidth - TOOLTIP_MARGIN, bubbleX))

    let bubbleY = placeAbove
        ? anchorY - bubbleHeight - TOOLTIP_MARGIN
        : anchorY - (bubbleHeight / 2)
    bubbleY = Math.max(TOOLTIP_MARGIN, Math.min(height - bubbleHeight - TOOLTIP_MARGIN, bubbleY))

    this._roundedRectangle(
        cairoContext,
        bubbleX,
        bubbleY,
        bubbleWidth,
        bubbleHeight,
        TOOLTIP_CORNER_RADIUS
    )
    cairoContext.setSourceRGBA(0.08, 0.09, 0.12, 0.94)
    cairoContext.fillPreserve()
    cairoContext.setSourceRGBA(secondaryColor.red, secondaryColor.green, secondaryColor.blue, 0.9)
    cairoContext.setLineWidth(1)
    cairoContext.stroke()

    cairoContext.setSourceRGBA(1, 1, 1, 1)
    lines.forEach((line, index) => {
      const baselineY = bubbleY + TOOLTIP_PADDING_Y + TOOLTIP_FONT_SIZE +
          (index * TOOLTIP_LINE_HEIGHT)
      cairoContext.moveTo(bubbleX + TOOLTIP_PADDING_X, baselineY)
      cairoContext.showText(line)
    })

    cairoContext.restore()
  }

  _roundedRectangle (cairoContext, x, y, width, height, radius) {
    const right = x + width
    const bottom = y + height

    cairoContext.newSubPath()
    cairoContext.arc(right - radius, y + radius, radius, -Math.PI / 2, 0)
    cairoContext.arc(right - radius, bottom - radius, radius, 0, Math.PI / 2)
    cairoContext.arc(x + radius, bottom - radius, radius, Math.PI / 2, Math.PI)
    cairoContext.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5)
    cairoContext.closePath()
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

    const [minValueX, maxValueX] = this.getXRange()
    const [minValueY, maxValueY] = this._createValueRange(data.map(item => item[1]))

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
    const visibleData = this._getVisibleData(this.data).filter(data => data[1] !== null)
    if (isNullOrEmpty(visibleData)) {
      return
    }

    const originalValueX = closest(visibleData.map(data => data[0]), hoveredValueX)
    const tsItem = visibleData.find(data => data[0] === originalValueX)
    this.emit('chart-hover', tsItem[2] || tsItem[0], tsItem[1])

    const selectedX = this.encodeValue(tsItem[0], minValueX, maxValueX, 0, this._surfaceWidth)
    const selectedY = this.getPriceY(tsItem[1], this._surfaceHeight)

    this._selectedX = selectedX
    this._selectedY = selectedY
    this._selectedPoint = { x: selectedX, y: selectedY }
    this._updateHoverTooltip(chartX, chartY)

    this.queue_repaint()
  }

  _updateHoverTooltip (chartX, chartY) {
    this._hoverTooltip = null

    const visibleBarData = this._getVisibleData(this.barData)
    const volumeAreaHeight = this._surfaceHeight * 0.16
    const volumeSeriesData = this._transformSeriesData(
        visibleBarData,
        this._surfaceWidth,
        volumeAreaHeight
    )

    if (!isNullOrEmpty(volumeSeriesData)) {
      const barWidth = Math.max(1, Math.min(12, (this._surfaceWidth / volumeSeriesData.length) * 0.65))
      const closestBarIndex = this._getClosestPointIndex(volumeSeriesData, chartX)
      const [barX, barHeight] = volumeSeriesData[closestBarIndex]
      const barTop = this._surfaceHeight - barHeight
      const hitWidth = Math.max(5, barWidth / 2)

      if (Math.abs(chartX - barX) <= hitWidth &&
          chartY >= barTop &&
          chartY <= this._surfaceHeight) {
        this._hoverTooltip = {
          anchorX: barX,
          anchorY: barTop,
          lines: [`${formatNumber(visibleBarData[closestBarIndex][1])} ${this._volumeUnit}`],
          placeAbove: true
        }
        return
      }
    }

    const visibleCandleData = this._getVisibleData(this.candleData)
    if (isNullOrEmpty(visibleCandleData)) {
      return
    }

    const [minValueX, maxValueX] = this.getXRange()
    const candleWidth = Math.max(1, Math.min(18, (this._surfaceWidth / visibleCandleData.length) * 0.68))
    const candlePoints = visibleCandleData.map(candle => [
      this.encodeValue(candle[0], minValueX, maxValueX, 0, this._surfaceWidth),
      candle
    ])
    const closestCandleIndex = this._getClosestPointIndex(candlePoints, chartX)
    const [candleX, candle] = candlePoints[closestCandleIndex]
    const [, open, high, low, close] = candle.map(Number)
    const highY = this.getPriceY(high, this._surfaceHeight)
    const lowY = this.getPriceY(low, this._surfaceHeight)
    const hitWidth = Math.max(5, candleWidth / 2)

    if ([open, high, low, close].some(value => isNaN(value)) ||
        Math.abs(chartX - candleX) > hitWidth ||
        chartY < highY - 4 ||
        chartY > lowY + 4) {
      return
    }

    this._hoverTooltip = {
      anchorX: candleX,
      anchorY: highY,
      lines: [
        `High: ${formatNumber(high)}`,
        `Low: ${formatNumber(low)}`,
        `Open: ${formatNumber(open)}`,
        `Close: ${formatNumber(close)}`
      ],
      placeAbove: false
    }
  }

  _getClosestPointIndex (points, targetX) {
    let closestIndex = 0
    let closestDistance = Infinity

    points.forEach((point, index) => {
      const distance = Math.abs(point[0] - targetX)
      if (distance < closestDistance) {
        closestIndex = index
        closestDistance = distance
      }
    })

    return closestIndex
  }

  _onScroll (item, event) {
    if (isNullOrEmpty(this.data) || this._surfaceWidth <= 0) {
      return Clutter.EVENT_PROPAGATE
    }

    const direction = event.get_scroll_direction()
    let zoomAmount

    if (direction === Clutter.ScrollDirection.UP) {
      zoomAmount = -1
    } else if (direction === Clutter.ScrollDirection.DOWN) {
      zoomAmount = 1
    } else if (direction === Clutter.ScrollDirection.SMOOTH) {
      const [, deltaY] = event.get_scroll_delta()
      if (deltaY === 0) {
        return Clutter.EVENT_PROPAGATE
      }
      zoomAmount = deltaY
    } else {
      return Clutter.EVENT_PROPAGATE
    }

    const [coordX] = event.get_coords()
    const [positionX] = item.get_transformed_position()
    const pointerRatio = Math.max(0, Math.min(1, (coordX - positionX) / this._surfaceWidth))
    const currentSpan = this._viewX2 - this._viewX1
    const fullSpan = this._fullX2 - this._fullX1
    const nextSpan = Math.max(
        this._minimumViewSpan,
        Math.min(fullSpan, currentSpan * Math.pow(ZOOM_STEP, zoomAmount))
    )

    if (Math.abs(nextSpan - currentSpan) < 1) {
      return Clutter.EVENT_STOP
    }

    const anchorX = this._viewX1 + (currentSpan * pointerRatio)
    let nextX1 = anchorX - (nextSpan * pointerRatio)
    let nextX2 = nextX1 + nextSpan

    if (nextX1 < this._fullX1) {
      nextX1 = this._fullX1
      nextX2 = nextX1 + nextSpan
    }
    if (nextX2 > this._fullX2) {
      nextX2 = this._fullX2
      nextX1 = nextX2 - nextSpan
    }

    this._viewX1 = nextX1
    this._viewX2 = nextX2
    this._onHover(item, event)
    this.queue_repaint()

    return Clutter.EVENT_STOP
  }

  _onLeave () {
    this._selectedX = null
    this._selectedY = null
    this._selectedPoint = null
    this._hoverTooltip = null

    this.emit('chart-hover', null, null)

    this.queue_repaint()
  }

  getXRange (data) {
    data = data || this.data

    if (!data) {
      return
    }

    return [this._viewX1, this._viewX2]
  }

  getYRange (data) {
    if (!data && !isNullOrEmpty(this.candleData)) {
      const visibleCandleData = this._getVisibleData(this.candleData)
      const candleValues = visibleCandleData.flatMap(item => [item[2], item[3]])
      return this._createValueRange([...this._additionalYData, ...candleValues])
    }

    data = this._getVisibleData(data || this.data)
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

  _getVisibleData (data) {
    if (isNullOrEmpty(data)) {
      return []
    }

    return data.filter(item => item[0] >= this._viewX1 && item[0] <= this._viewX2)
  }

  _getMinimumViewSpan () {
    const data = !isNullOrEmpty(this.candleData) ? this.candleData : this.data
    const fullSpan = this._fullX2 - this._fullX1

    if (isNullOrEmpty(data) || data.length < 2 || fullSpan <= 0) {
      return fullSpan
    }

    const intervals = data
        .slice(1)
        .map((item, index) => item[0] - data[index][0])
        .filter(interval => interval > 0)
        .sort((a, b) => a - b)

    if (isNullOrEmpty(intervals)) {
      return fullSpan
    }

    const medianInterval = intervals[Math.floor(intervals.length / 2)]
    return Math.min(fullSpan, medianInterval * (MIN_VISIBLE_ITEMS - 1))
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
