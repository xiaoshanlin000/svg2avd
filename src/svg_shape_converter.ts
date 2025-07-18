export const KAPPA = 0.5522847498307935;

function s(number: number): number {
  return parseFloat(number.toPrecision(12));
}

export function convertLine(x1: string, y1: string, x2: string, y2: string): string {
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

export function convertRect(x: string, y: string, w: string, h: string, rx?: string, ry?: string): string {
  const _x = parseFloat(x || "0");
  const _y = parseFloat(y || "0");
  const _w = parseFloat(w || "0");
  const _h = parseFloat(h || "0");
  let _rx = parseFloat(rx || "0");
  let _ry = parseFloat(ry || "0");
  const r = s(_x + _w);
  const b = s(_y + _h);
  if (_ry === 0) _ry = _rx;
  else if (_rx === 0) _rx = _ry;
  if (_rx === 0 && _ry === 0) {
    return `M ${_x} ${_y} H ${s(_x+_w)} V ${s(_y+_h)} H ${_x} V ${_y} Z`;
  } else {
    return `M ${s(_x+_rx)} ${_y} L ${s(r-_rx)} ${_y} Q ${r} ${_y} ${r} ${s(_y+_ry)} L ${r} ${s(_y+_h-_ry)} Q ${r} ${b} ${s(r-_rx)} ${b} L ${s(_x+_rx)} ${b} Q ${_x} ${b} ${_x} ${s(b-_ry)} L ${_x} ${s(_y+_ry)} Q ${_x} ${_y} ${s(_x+_rx)} ${_y} Z`;
  }
}

export function convertCircle(cx: string, cy: string, r: string): string {
  const _cx = parseFloat(cx || "0");
  const _cy = parseFloat(cy || "0");
  const _r = parseFloat(r || "0");
  const controlDistance = _r * KAPPA;
  let output = `M ${_cx} ${s(_cy-_r)} `;
  output += `C ${s(_cx+controlDistance)} ${s(_cy-_r)} ${s(_cx+_r)} ${s(_cy-controlDistance)} ${s(_cx+_r)} ${_cy} `;
  output += `C ${s(_cx+_r)} ${s(_cy+controlDistance)} ${s(_cx+controlDistance)} ${s(_cy+_r)} ${_cx} ${s(_cy+_r)} `;
  output += `C ${s(_cx-controlDistance)} ${s(_cy+_r)} ${s(_cx-_r)} ${s(_cy+controlDistance)} ${s(_cx-_r)} ${_cy} `;
  output += `C ${s(_cx-_r)} ${s(_cy-controlDistance)} ${s(_cx-controlDistance)} ${s(_cy-_r)} ${_cx} ${s(_cy-_r)} Z`;
  return output;
}

export function convertEllipse(cx: string, cy: string, rx: string, ry: string): string {
  const _cx = parseFloat(cx || "0");
  const _cy = parseFloat(cy || "0");
  const _rx = parseFloat(rx || "0");
  const _ry = parseFloat(ry || "0");
  const controlDistanceX = _rx * KAPPA;
  const controlDistanceY = _ry * KAPPA;
  let output = `M ${_cx} ${s(_cy-_ry)} `;
  output += `C ${s(_cx+controlDistanceX)} ${s(_cy-_ry)} ${s(_cx+_rx)} ${s(_cy-controlDistanceY)} ${s(_cx+_rx)} ${_cy} `;
  output += `C ${s(_cx+_rx)} ${s(_cy+controlDistanceY)} ${s(_cx+controlDistanceX)} ${s(_cy+_ry)} ${_cx} ${s(_cy+_ry)} `;
  output += `C ${s(_cx-controlDistanceX)} ${s(_cy+_ry)} ${s(_cx-_rx)} ${s(_cy+controlDistanceY)} ${s(_cx-_rx)} ${_cy} `;
  output += `C ${s(_cx-_rx)} ${s(_cy-controlDistanceY)} ${s(_cx-controlDistanceX)} ${s(_cy-_ry)} ${_cx} ${s(_cy-_ry)} Z`;
  return output;
}

export function convertPolygon(points: string | undefined, isPolyline = false): string | null {
  if (!points) return null;
  const pointsArrayRaw = points.split(",");
  const pointsArray: string[] = [];
  for (let i = 0; i < pointsArrayRaw.length; i++) {
    const splitted = pointsArrayRaw[i].split(" ");
    for (let j = 0; j < splitted.length; j++) {
      if (splitted[j].length > 0) {
        pointsArray.push(splitted[j]);
      }
    }
  }
  if (pointsArray.length % 2 === 0) {
    let output = "";
    for (let i = 0; i < pointsArray.length; i += 2) {
      output += (i === 0 ? "M " : "L ");
      output += `${pointsArray[i]} ${pointsArray[i+1]} `;
    }
    if (!isPolyline) output += "Z";
    return output;
  } else {
    return null;
  }
}