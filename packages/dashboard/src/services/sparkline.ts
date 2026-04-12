/**
 * Compute SVG polyline points for a sparkline chart.
 *
 * Returns a space-separated string of "x,y" coordinate pairs suitable for
 * an SVG `<polyline points="...">` attribute. Returns empty string when
 * fewer than 2 non-gap values are provided (a single point cannot form a trend line).
 *
 * Pure function — no side effects, no imports.
 *
 * @param values      Chronological numeric data points
 * @param viewBoxW    SVG viewBox width  (default 100)
 * @param viewBoxH    SVG viewBox height (default 40)
 * @param gaps        Optional set of indices to skip (produce visual breaks)
 */
export function computeSparklinePoints(
  values: readonly number[],
  viewBoxW = 100,
  viewBoxH = 40,
  gaps?: ReadonlySet<number>,
): string {
  const effectiveGaps = gaps ?? new Set<number>();

  // Collect non-gap entries with their original indices
  const entries: Array<{ readonly origIndex: number; readonly value: number }> = [];
  for (let i = 0; i < values.length; i++) {
    if (!effectiveGaps.has(i)) {
      entries.push({ origIndex: i, value: values[i] });
    }
  }

  if (entries.length < 2) return '';

  const padding = 2;
  const effectiveH = viewBoxH - padding * 2;
  const step = values.length > 1 ? viewBoxW / (values.length - 1) : 0;

  const nonGapValues = entries.map(e => e.value);
  const minVal = Math.min(...nonGapValues);
  const maxVal = Math.max(...nonGapValues);
  const range = maxVal - minVal || 1;

  return entries
    .map(({ origIndex, value }) => {
      const x = Math.round(origIndex * step * 10) / 10;
      const y =
        Math.round(
          (padding + effectiveH - ((value - minVal) / range) * effectiveH) * 10,
        ) / 10;
      return `${x},${y}`;
    })
    .join(' ');
}

/**
 * Compute the y-coordinate for a horizontal target line on a sparkline.
 *
 * Uses the same padding/effectiveH/min/max/range logic as computeSparklinePoints
 * so the target line aligns perfectly with data points.
 *
 * @param target    The target score value
 * @param values    The same chronological data points used for the sparkline
 * @param viewBoxH  SVG viewBox height (default 40)
 * @returns y-coordinate rounded to 1 decimal, or -1 if insufficient data
 */
export function computeTargetY(
  target: number,
  values: readonly number[],
  viewBoxH = 40,
): number {
  if (values.length < 2) return -1;

  const padding = 2;
  const effectiveH = viewBoxH - padding * 2;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  return Math.round(
    (padding + effectiveH - ((target - minVal) / range) * effectiveH) * 10,
  ) / 10;
}
