/**
 * Compute SVG polyline points for a sparkline chart.
 *
 * Returns a space-separated string of "x,y" coordinate pairs suitable for
 * an SVG `<polyline points="...">` attribute. Returns empty string when
 * fewer than 2 values are provided (a single point cannot form a trend line).
 *
 * Pure function — no side effects, no imports.
 *
 * @param values      Chronological numeric data points
 * @param viewBoxW    SVG viewBox width  (default 100)
 * @param viewBoxH    SVG viewBox height (default 40)
 */
export function computeSparklinePoints(
  values: readonly number[],
  viewBoxW = 100,
  viewBoxH = 40,
): string {
  if (values.length < 2) return '';

  const padding = 2;
  const effectiveH = viewBoxH - padding * 2;
  const step = viewBoxW / (values.length - 1);
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  const range = maxVal - minVal || 1;

  return values
    .map((v, i) => {
      const x = Math.round(i * step * 10) / 10;
      const y =
        Math.round(
          (padding + effectiveH - ((v - minVal) / range) * effectiveH) * 10,
        ) / 10;
      return `${x},${y}`;
    })
    .join(' ');
}
