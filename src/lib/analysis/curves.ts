// Piecewise-linear scoring curves: every score in the app maps a metric onto
// 0–100 through a handful of (value, score) points, so each number is checkable.

export type Curve = [number, number][];

/** Linear interpolation through (x, score) points; flat beyond the ends. */
export function curve(points: Curve, x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** Same as `curve`, but x positions are compared on a log10 scale (for $ amounts and multiples). */
export const logCurve = (points: Curve, x: number) =>
  curve(
    points.map(([px, py]) => [Math.log10(px), py]),
    Math.log10(Math.max(x, 1e-9)),
  );
