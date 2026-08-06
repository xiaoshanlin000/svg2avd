export function transformPoint(x: number, y: number, m: number[]): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

export function mulMat(a: number[], b: number[]): number[] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export const IDENTITY: number[] = [1, 0, 0, 1, 0, 0];

export function funcToMatrix(type: string, params: number[]): number[] {
  switch (type) {
    case "translate": {
      const tx = params[0] || 0;
      const ty = params[1] || 0;
      return [1, 0, 0, 1, tx, ty];
    }
    case "scale": {
      const sx = params[0] || 1;
      const sy = params[1] || params[0] || 1;
      return [sx, 0, 0, sy, 0, 0];
    }
    case "rotate": {
      const angle = (params[0] || 0) * Math.PI / 180;
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const cx = params[1] || 0;
      const cy = params[2] || 0;
      return [
        cosA, sinA,
        -sinA, cosA,
        cx * (1 - cosA) + cy * sinA,
        -cx * sinA + cy * (1 - cosA),
      ];
    }
    case "matrix": {
      return params.length >= 6
        ? [params[0], params[1], params[2], params[3], params[4], params[5]]
        : IDENTITY;
    }
    case "skewX": {
      const angle = (params[0] || 0) * Math.PI / 180;
      return [1, 0, Math.tan(angle), 1, 0, 0];
    }
    case "skewY": {
      const angle = (params[0] || 0) * Math.PI / 180;
      return [1, Math.tan(angle), 0, 1, 0, 0];
    }
    default:
      return IDENTITY;
  }
}

export function decomposeMatrix(m: number[]): {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
} | null {
  const [a, b, c, d, e, f] = m;

  if (Math.abs(a * c + b * d) > 1e-10) return null;

  const sx = Math.sqrt(a * a + b * b);
  if (sx < 1e-12) return null;

  const det = a * d - b * c;
  const sy = det / sx;

  const theta = Math.atan2(b, a);
  const rot = theta * 180 / Math.PI;

  return { translateX: e, translateY: f, scaleX: sx, scaleY: sy, rotation: rot };
}

export function fmt(n: number): string {
  return parseFloat(n.toPrecision(12)).toString();
}

/**
 * 按 SVG 数字语法切分字符串中的数字。
 * SVG 语法允许符号（+/-）、小数点、指数作为隐式分隔符，
 * 例如 "2.25-2.267" 是合法的两个数（2.25 和 -2.267），
 * svgo 优化输出大量使用这种紧凑写法。若仅按空格/逗号切分，
 * "2.25-2.267" 会被 Number() 解析为 NaN。
 */
const SVG_NUMBER_RE = /[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g;

export function tokenizeNumbers(s: string): number[] {
  return (s.match(SVG_NUMBER_RE) || []).map(Number);
}

// SVG 1.1 (F.6.5 / F.6.6) elliptical arc to cubic Bezier segments.
// Returns a flat array [cx1, cy1, cx2, cy2, x, y, ...] (6 numbers per segment).
// Degenerate cases (coincident endpoints, or rx/ry <= 0) are treated as a
// straight line and return no segments (caller falls back to "L").
export function arcToCubic(
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArcFlag: number,
  sweepFlag: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number[] {
  if (x1 === x2 && y1 === y2) return [];
  if (rx <= 0 || ry <= 0) return [];

  // F.6.5.1: transform endpoints into the unrotated coordinate system
  const phi = xAxisRotation * Math.PI / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // F.6.6: correct radii if they are too small to span the endpoints
  const lambda = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx = rx * s;
    ry = ry * s;
  }

  // F.6.5.2: compute the center (cx, cy)
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const x1p2 = x1p * x1p;
  const y1p2 = y1p * y1p;
  const num = rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2;
  const den = rx2 * y1p2 + ry2 * x1p2;
  const coef = (largeArcFlag === sweepFlag ? -1 : 1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * (rx * y1p / ry);
  const cyp = coef * (-ry * x1p / rx);
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // F.6.5.3: compute start angle theta1 and sweep deltaTheta
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = Math.atan2(uy, ux);
  let deltaTheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  if (!sweepFlag && deltaTheta > 0) deltaTheta -= 2 * Math.PI;
  if (sweepFlag && deltaTheta < 0) deltaTheta += 2 * Math.PI;

  // Split into sub-arcs of at most PI/2 (90 degrees) each
  const segments = Math.max(1, Math.ceil(Math.abs(deltaTheta) / (Math.PI / 2)));
  const delta = deltaTheta / segments;
  const k = 4 / 3 * Math.tan(delta / 4);

  // Cubic approximation: C1 = P1 + k * T1, C2 = P2 - k * T2
  // where P(t) is the point on the (rotated) ellipse at angle t and T(t) is
  // its derivative with respect to t.
  const result: number[] = [];
  let theta = theta1;
  for (let i = 0; i < segments; i++) {
    const theta2 = theta + delta;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const cosT2 = Math.cos(theta2);
    const sinT2 = Math.sin(theta2);

    const p1x = cx + rx * cosT * cosPhi - ry * sinT * sinPhi;
    const p1y = cy + rx * cosT * sinPhi + ry * sinT * cosPhi;
    const p2x = cx + rx * cosT2 * cosPhi - ry * sinT2 * sinPhi;
    const p2y = cy + rx * cosT2 * sinPhi + ry * sinT2 * cosPhi;

    const t1x = -rx * sinT * cosPhi - ry * cosT * sinPhi;
    const t1y = -rx * sinT * sinPhi + ry * cosT * cosPhi;
    const t2x = -rx * sinT2 * cosPhi - ry * cosT2 * sinPhi;
    const t2y = -rx * sinT2 * sinPhi + ry * cosT2 * cosPhi;

    const c1x = p1x + k * t1x;
    const c1y = p1y + k * t1y;
    const c2x = p2x - k * t2x;
    const c2y = p2y - k * t2y;

    result.push(c1x, c1y, c2x, c2y, p2x, p2y);
    theta = theta2;
  }
  return result;
}

export function applyMatrixToPath(d: string, matrix: number[]): string {
  const parts = d.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g);
  if (!parts) return d;

  let result = "";
  let cx = 0, cy = 0;

  // A cubic Bezier is affine-invariant, so whenever the matrix is not a pure
  // axis-aligned scale+translate (b or c nonzero) or flips an axis (negative
  // scale), each arc is converted to cubic segments first and the control
  // points are transformed exactly. Otherwise the arc endpoint is transformed
  // directly and the radii are scaled by the axis scale factors.
  const arcNeedsExpansion =
    Math.abs(matrix[1]) > 1e-9 || Math.abs(matrix[2]) > 1e-9 || matrix[0] < 0 || matrix[3] < 0;

  for (const part of parts) {
    const cmd = part[0];
    const numsStr = part.slice(1).trim();
    const nums = numsStr ? tokenizeNumbers(numsStr) : [];
    const isAbs = cmd === cmd.toUpperCase();
    const c = cmd.toUpperCase();

    if (c === "Z") {
      result += "Z";
      continue;
    }

    if (c === "M" || c === "L") {
      // 只有 M 段的首点输出 M；L/l 段（含 M 后的隐式 L 与相对线段）首点必须是 L，
      // 否则路径会被错误断开成两个子路径
      let first = c === "M";
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i], y = nums[i + 1];
        const absX = isAbs ? x : cx + x;
        const absY = isAbs ? y : cy + y;
        const [tx, ty] = transformPoint(absX, absY, matrix);
        result += (first ? "M" : "L") + fmt(tx) + " " + fmt(ty);
        cx = absX; cy = absY;
        first = false;
      }
    } else if (c === "H") {
      for (const x of nums) {
        const absX = isAbs ? x : cx + x;
        const [tx, ty] = transformPoint(absX, cy, matrix);
        result += "L" + fmt(tx) + " " + fmt(ty);
        cx = absX;
      }
    } else if (c === "V") {
      for (const y of nums) {
        const absY = isAbs ? y : cy + y;
        const [tx, ty] = transformPoint(cx, absY, matrix);
        result += "L" + fmt(tx) + " " + fmt(ty);
        cy = absY;
      }
    } else if (c === "C") {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const p = isAbs
          ? [nums[i], nums[i + 1], nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5]]
          : [cx + nums[i], cy + nums[i + 1], cx + nums[i + 2], cy + nums[i + 3], cx + nums[i + 4], cy + nums[i + 5]];
        const [x1, y1] = transformPoint(p[0], p[1], matrix);
        const [x2, y2] = transformPoint(p[2], p[3], matrix);
        const [x, y] = transformPoint(p[4], p[5], matrix);
        result += "C" + fmt(x1) + " " + fmt(y1) + " " + fmt(x2) + " " + fmt(y2) + " " + fmt(x) + " " + fmt(y);
        cx = p[4]; cy = p[5];
      }
    } else if (c === "S") {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const p = isAbs
          ? [nums[i], nums[i + 1], nums[i + 2], nums[i + 3]]
          : [cx + nums[i], cy + nums[i + 1], cx + nums[i + 2], cy + nums[i + 3]];
        const [x2, y2] = transformPoint(p[0], p[1], matrix);
        const [x, y] = transformPoint(p[2], p[3], matrix);
        result += "S" + fmt(x2) + " " + fmt(y2) + " " + fmt(x) + " " + fmt(y);
        cx = p[2]; cy = p[3];
      }
    } else if (c === "Q") {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const p = isAbs
          ? [nums[i], nums[i + 1], nums[i + 2], nums[i + 3]]
          : [cx + nums[i], cy + nums[i + 1], cx + nums[i + 2], cy + nums[i + 3]];
        const [x1, y1] = transformPoint(p[0], p[1], matrix);
        const [x, y] = transformPoint(p[2], p[3], matrix);
        result += "Q" + fmt(x1) + " " + fmt(y1) + " " + fmt(x) + " " + fmt(y);
        cx = p[2]; cy = p[3];
      }
    } else if (c === "T") {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = nums[i], y = nums[i + 1];
        const absX = isAbs ? x : cx + x;
        const absY = isAbs ? y : cy + y;
        const [tx, ty] = transformPoint(absX, absY, matrix);
        result += "T" + fmt(tx) + " " + fmt(ty);
        cx = absX; cy = absY;
      }
    } else if (c === "A") {
      for (let i = 0; i + 6 < nums.length; i += 7) {
        const rx = nums[i], ry = nums[i + 1], xRot = nums[i + 2];
        const laf = nums[i + 3], sf = nums[i + 4];
        const endX = isAbs ? nums[i + 5] : cx + nums[i + 5];
        const endY = isAbs ? nums[i + 6] : cy + nums[i + 6];
        if (arcNeedsExpansion) {
          const segs = arcToCubic(rx, ry, xRot, laf, sf, cx, cy, endX, endY);
          if (segs.length === 0) {
            const [tx, ty] = transformPoint(endX, endY, matrix);
            result += "L" + fmt(tx) + " " + fmt(ty);
          } else {
            for (let j = 0; j < segs.length; j += 6) {
              const [x1, y1] = transformPoint(segs[j], segs[j + 1], matrix);
              const [x2, y2] = transformPoint(segs[j + 2], segs[j + 3], matrix);
              const [x, y] = transformPoint(segs[j + 4], segs[j + 5], matrix);
              result += "C" + fmt(x1) + " " + fmt(y1) + " " + fmt(x2) + " " + fmt(y2) + " " + fmt(x) + " " + fmt(y);
            }
          }
        } else {
          const [tx, ty] = transformPoint(endX, endY, matrix);
          const rxx = Math.abs(matrix[0]) * rx;
          const ryy = Math.abs(matrix[3]) * ry;
          result += "A" + fmt(rxx) + " " + fmt(ryy) + " " + fmt(xRot) + " " + laf + " " + sf + " " + fmt(tx) + " " + fmt(ty);
        }
        cx = endX; cy = endY;
      }
    }
  }

  return result;
}
