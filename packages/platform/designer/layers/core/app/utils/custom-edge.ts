// AAAA! AI GENERATED FILE!

export function calculateAllLinePoints(
  points: number[][],
  lineWidth: number,
  numLines: number,
): string[][] {
  // Инициализация массива для хранения точек всех параллельных линий
  const allLinePoints: string[][] = Array.from({ length: numLines }, () => [])
  // Шаг смещения между параллельными линиями
  const lineOffsetStep = lineWidth
  // Общая ширина всех линий
  const totalOffsetWidth = lineOffsetStep * (numLines - 1)
  // Начальное смещение для центрирования на исходной линии
  const startOffset = -totalOffsetWidth / 2
  // Массив значений смещений для каждой линии
  const offsets = Array.from({ length: numLines }, (_, i) => startOffset + i * lineOffsetStep)

  // Массив перпендикулярных векторов для каждого сегмента исходной линии
  const segmentPerpendicularVectors: { x: number; y: number }[] = []

  // Вычисление перпендикулярных векторов для каждого сегмента
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i]
    const p2 = points[i + 1]

    const dx = p2[0] - p1[0]
    const dy = p2[1] - p1[1]

    // Нормализация перпендикулярного вектора
    const segmentLength = Math.sqrt(dx * dx + dy * dy)
    let perpX = -dy
    let perpY = dx
    if (segmentLength !== 0) {
      perpX /= segmentLength
      perpY /= segmentLength
    }
    segmentPerpendicularVectors.push({ x: perpX, y: perpY })
  }

  /**
   * Функция для нахождения точки пересечения двух отрезков прямых.
   * @param p1 - начало первого отрезка
   * @param p2 - конец первого отрезка
   * @param p3 - начало второго отрезка
   * @param p4 - конец второго отрезка
   * @returns {number[] | null} - точка пересечения или null, если отрезки параллельны
   */
  function lineIntersection(
    p1: number[],
    p2: number[],
    p3: number[],
    p4: number[],
  ): number[] | null {
    const x1 = p1[0],
      y1 = p1[1],
      x2 = p2[0],
      y2 = p2[1]
    const x3 = p3[0],
      y3 = p3[1],
      x4 = p4[0],
      y4 = p4[1]

    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
    if (denominator === 0) {
      return null // Линии параллельны
    }

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denominator
    // const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denominator;  // Не нужен для пересечения отрезков

    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
  }

  // Расчет точек для каждой параллельной линии
  for (let lineIndex = 0; lineIndex < numLines; lineIndex++) {
    for (let i = 0; i < points.length; i++) {
      const p = points[i]
      let offsetX = 0
      let offsetY = 0

      if (i === 0) {
        // Первая точка - используем перпендикулярный вектор первого сегмента
        offsetX = segmentPerpendicularVectors[0].x * offsets[lineIndex]
        offsetY = segmentPerpendicularVectors[0].y * offsets[lineIndex]
      } else if (i === points.length - 1) {
        // Последняя точка - используем перпендикулярный вектор последнего сегмента
        offsetX =
          segmentPerpendicularVectors[segmentPerpendicularVectors.length - 1].x * offsets[lineIndex]
        offsetY =
          segmentPerpendicularVectors[segmentPerpendicularVectors.length - 1].y * offsets[lineIndex]
      } else {
        // Точка соединения сегментов - ищем пересечение для плавного соединения
        const prevPerp = segmentPerpendicularVectors[i - 1]
        const nextPerp = segmentPerpendicularVectors[i]
        const prevPoint = points[i - 1]
        const nextPoint = points[i + 1]

        // Вспомогательные точки для расчета пересечения
        const p1_prev = [
          prevPoint[0] + prevPerp.x * offsets[lineIndex],
          prevPoint[1] + prevPerp.y * offsets[lineIndex],
        ]
        const p2_prev = [
          p[0] + prevPerp.x * offsets[lineIndex],
          p[1] + prevPerp.y * offsets[lineIndex],
        ]
        const p3_next = [
          p[0] + nextPerp.x * offsets[lineIndex],
          p[1] + nextPerp.y * offsets[lineIndex],
        ]
        const p4_next = [
          nextPoint[0] + nextPerp.x * offsets[lineIndex],
          nextPoint[1] + nextPerp.y * offsets[lineIndex],
        ]

        const intersectionPoint = lineIntersection(p1_prev, p2_prev, p3_next, p4_next)

        if (intersectionPoint) {
          // Если есть точка пересечения, используем её для смещения
          offsetX = intersectionPoint[0] - p[0]
          offsetY = intersectionPoint[1] - p[1]
        } else {
          // Fallback: Если нет пересечения (параллельные линии), используем средний вектор
          // для предотвращения резких скачков в смещении.
          offsetX = ((prevPerp.x + nextPerp.x) / 2) * offsets[lineIndex]
          offsetY = ((prevPerp.y + nextPerp.y) / 2) * offsets[lineIndex]
        }
      }
      allLinePoints[lineIndex].push(`${p[0] + offsetX},${p[1] + offsetY}`)
    }
  }

  return allLinePoints
}
