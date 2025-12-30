import { convertRect, convertCircle, convertEllipse, convertPolygon } from "./svg_shape_converter";
import { load } from "cheerio";
import { parseColor } from "./parseColor";
import type { Cheerio } from "cheerio";

// CSS样式规则类型
interface StyleRule {
    selector: string;
    properties: Record<string, string>;
}

// Cheerio元素类型
type CheerioElement = Cheerio<any>;

function parseTransform(transform: string | null): Record<string, string> {
  if (!transform) return {};
  const result: Record<string, string> = {};
  const regex = /(\w+)\(([^)]+)\)/g;
  let match;
  while ((match = regex.exec(transform || "")) !== null) {
    const type = match[1].toLowerCase();
    const params = match[2].split(/[ ,]+/).map(s => s.trim()).filter(Boolean);
    if (type === "translate") {
      result["android:translateX"] = params[0] || "0";
      result["android:translateY"] = params[1] || "0";
    } else if (type === "scale") {
      result["android:scaleX"] = params[0] || "1";
      result["android:scaleY"] = params[1] || params[0] || "1";
    } else if (type === "rotate") {
      result["android:rotation"] = params[0] || "0";
      result["android:pivotX"] = params[1] || "0";
      result["android:pivotY"] = params[2] || "0";
    }
  }
  return result;
}

// 解析CSS样式表
function parseStyles($: any): StyleRule[] {
    const rules: StyleRule[] = [];
    $('style').each((i: number, styleElem: any) => {
        const styleText = $(styleElem).text();
        // 简单的CSS解析，支持类选择器（.st0）和基本属性
        const lines = styleText.split('}');
        for (const line of lines) {
            const parts = line.split('{');
            if (parts.length === 2) {
                const selector = parts[0].trim();
                const propertiesText = parts[1].trim();
                if (selector.startsWith('.')) {
                    const properties: Record<string, string> = {};
                    const propLines = propertiesText.split(';');
                    for (const propLine of propLines) {
                        const propParts = propLine.split(':');
                        if (propParts.length === 2) {
                            const key = propParts[0].trim();
                            const value = propParts[1].trim();
                            properties[key] = value;
                        }
                    }
                    rules.push({ selector, properties });
                }
            }
        }
    });
    return rules;
}

// 获取元素应用的CSS样式
function getElementStyles(el: CheerioElement, styleRules: StyleRule[]): Record<string, string> {
    const classAttr = el.attr('class');
    if (!classAttr) return {};
    
    const classes = classAttr.split(/\s+/).filter(c => c);
    const elementStyles: Record<string, string> = {};
    
    // 按顺序应用样式（后面的规则覆盖前面的）
    for (const rule of styleRules) {
        const selectorClass = rule.selector.substring(1); // 去掉开头的.
        if (classes.includes(selectorClass)) {
            Object.assign(elementStyles, rule.properties);
        }
    }
    
    return elementStyles;
}

// @ts-ignore
function getColorAttr(el: CheerioElement, inherited: any = {}, styleRules: StyleRule[] = []) {
  // 获取元素的内联属性
  let fill = el.attr("fill");
  let stroke = el.attr("stroke");
  let strokeWidth = el.attr("stroke-width");
  
  // 获取CSS样式
  const elementStyles = getElementStyles(el, styleRules);
  
  // CSS样式优先级：内联属性 > CSS样式 > 继承属性
  if (!fill && elementStyles.fill) {
    fill = elementStyles.fill;
  }
  if (!stroke && elementStyles.stroke) {
    stroke = elementStyles.stroke;
  }
  if (!strokeWidth && elementStyles['stroke-width']) {
    strokeWidth = elementStyles['stroke-width'];
  }
  
  const fillRaw = fill !== undefined ? fill : inherited.fill;
  const strokeRaw = stroke !== undefined ? stroke : inherited.stroke;
  const strokeWidthRaw = strokeWidth !== undefined ? strokeWidth : inherited.strokeWidth;
  
  fill = parseColor(fillRaw);
  stroke = parseColor(strokeRaw);
  
  return { fill, stroke, fillRaw, strokeRaw, strokeWidth: strokeWidthRaw };
}

// @ts-ignore
function renderNode(el: CheerioElement, inherited: any = {}, styleRules: StyleRule[] = []): string {
  const tag = (el[0]?.tagName || "").toLowerCase();
  const fillAttr = el.attr("fill");
  const strokeAttr = el.attr("stroke");
  const strokeWidthAttr = el.attr("stroke-width");
  function resolveInherited(attr: string | undefined, parentValue: any): any {
    if (attr === undefined) {
      if (parentValue === "none") return undefined;
      return parentValue;
    }
    if (attr === "none") {
      if (parentValue === undefined || parentValue === "none") return undefined;
      return parentValue;
    }
    return attr;
  }
  const nextInherited = {
    fill: fillAttr !== undefined ? resolveInherited(fillAttr, inherited.fill) : inherited.fill,
    stroke: strokeAttr !== undefined ? resolveInherited(strokeAttr, inherited.stroke) : inherited.stroke,
    strokeWidth: strokeWidthAttr !== undefined ? strokeWidthAttr : inherited.strokeWidth
  };
  if (tag === "g") {
    const groupAttrs = parseTransform(el.attr("transform") || null);
    const groupAttrStr = Object.entries(groupAttrs).map(([k,v]) => `${k}="${v}"`).join(" ");
    const children = el.children().filter((i, c) => c.type === "tag").map((i, c) => {
      const $c = el.children().eq(i);
      if (($c[0]?.tagName || '').toLowerCase() === 'g') {
        const childFill = $c.attr('fill');
        const childInherited = {
          ...nextInherited,
          fill: childFill !== undefined ? resolveInherited(childFill, nextInherited.fill) : nextInherited.fill
        };
        return renderNode($c, childInherited, styleRules);
      } else {
        return renderNode($c, nextInherited, styleRules);
      }
    }).get().join("\n");
    return `<group${groupAttrStr ? " " + groupAttrStr : ""}>\n${children}\n</group>`;
  } else if (tag === "path") {
    const d = el.attr("d");
    const pathAttrs = parseTransform(el.attr("transform") || null);
    const pathAttrStr = Object.entries(pathAttrs).map(([k,v]) => `${k}="${v}"`).join(" ");
    const { fill: fillColor, stroke: strokeColor, fillRaw, strokeRaw } = getColorAttr(el, nextInherited, styleRules);
    let colorAttrs = [];
    const opacityAttr = el.attr("opacity");
    const fillOpacityAttr = el.attr("fill-opacity");
    const strokeOpacityAttr = el.attr("stroke-opacity");
    let fillAlpha = 1.0;
    if (fillColor && opacityAttr !== undefined) {
      fillAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) fillAlpha *= parseFloat(opacityAttr);
      if (fillOpacityAttr !== undefined) fillAlpha *= parseFloat(fillOpacityAttr);
    }
    if (fillAlpha < 1.0 && fillColor && (!fillRaw || fillRaw.toLowerCase() !== "none")) colorAttrs.push(`android:fillAlpha=\"${fillAlpha}\"`);
    if (fillColor && (!fillRaw || fillRaw.toLowerCase() !== "none")) colorAttrs.push(`android:fillColor=\"${fillColor}\"`);
    let strokeAlpha = 1.0;
    if (strokeColor && opacityAttr !== undefined) {
      strokeAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) strokeAlpha *= parseFloat(opacityAttr);
      if (strokeOpacityAttr !== undefined) strokeAlpha *= parseFloat(strokeOpacityAttr);
    }
    if (strokeAlpha < 1.0 && strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeAlpha=\"${strokeAlpha}\"`);
    if (strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeColor=\"${strokeColor}\"`);
    if (nextInherited.strokeWidth && nextInherited.strokeWidth !== "none") colorAttrs.push(`android:strokeWidth=\"${nextInherited.strokeWidth}\"`);
    if (d) {
      if (pathAttrStr) {
        return `<group ${pathAttrStr}><path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} /></group>`;
      } else {
        return `<path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
      }
    }
    return "";
  } else if (tag === "rect") {
    const x = el.attr("x") || "0";
    const y = el.attr("y") || "0";
    const w = el.attr("width") || "0";
    const h = el.attr("height") || "0";
    const rx = el.attr("rx");
    const ry = el.attr("ry");
    const d = convertRect(x, y, w, h, rx || undefined, ry || undefined);
    const { fill: fillColor, stroke: strokeColor, fillRaw, strokeRaw } = getColorAttr(el, nextInherited, styleRules);
    let colorAttrs = [];
    const opacityAttr = el.attr("opacity");
    const fillOpacityAttr = el.attr("fill-opacity");
    const strokeOpacityAttr = el.attr("stroke-opacity");
    let fillAlpha = 1.0;
    if (fillColor && opacityAttr !== undefined) {
      fillAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) fillAlpha *= parseFloat(opacityAttr);
      if (fillOpacityAttr !== undefined) fillAlpha *= parseFloat(fillOpacityAttr);
    }
    if (fillAlpha < 1.0 && fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillAlpha=\"${fillAlpha}\"`);
    if (fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillColor=\"${fillColor}\"`);
    let strokeAlpha = 1.0;
    if (strokeColor && opacityAttr !== undefined) {
      strokeAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) strokeAlpha *= parseFloat(opacityAttr);
      if (strokeOpacityAttr !== undefined) strokeAlpha *= parseFloat(strokeOpacityAttr);
    }
    if (strokeAlpha < 1.0 && strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeAlpha=\"${strokeAlpha}\"`);
    if (strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeColor=\"${strokeColor}\"`);
    if (nextInherited.strokeWidth && nextInherited.strokeWidth !== "none") colorAttrs.push(`android:strokeWidth=\"${nextInherited.strokeWidth}\"`);
    return `<path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
  } else if (tag === "circle") {
    const cx = el.attr("cx") || "0";
    const cy = el.attr("cy") || "0";
    const r = el.attr("r") || "0";
    const d = convertCircle(cx, cy, r);
    const { fill: fillColor, stroke: strokeColor, fillRaw, strokeRaw } = getColorAttr(el, nextInherited);
    let colorAttrs = [];
    const opacityAttr = el.attr("opacity");
    const fillOpacityAttr = el.attr("fill-opacity");
    const strokeOpacityAttr = el.attr("stroke-opacity");
    let fillAlpha = 1.0;
    if (fillColor && opacityAttr !== undefined) {
      fillAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) fillAlpha *= parseFloat(opacityAttr);
      if (fillOpacityAttr !== undefined) fillAlpha *= parseFloat(fillOpacityAttr);
    }
    if (fillAlpha < 1.0 && fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillAlpha=\"${fillAlpha}\"`);
    if (fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillColor=\"${fillColor}\"`);
    let strokeAlpha = 1.0;
    if (strokeColor && opacityAttr !== undefined) {
      strokeAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) strokeAlpha *= parseFloat(opacityAttr);
      if (strokeOpacityAttr !== undefined) strokeAlpha *= parseFloat(strokeOpacityAttr);
    }
    if (strokeAlpha < 1.0 && strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeAlpha=\"${strokeAlpha}\"`);
    if (strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeColor=\"${strokeColor}\"`);
    if (nextInherited.strokeWidth && nextInherited.strokeWidth !== "none") colorAttrs.push(`android:strokeWidth=\"${nextInherited.strokeWidth}\"`);
    return `<path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
  } else if (tag === "ellipse") {
    const cx = el.attr("cx") || "0";
    const cy = el.attr("cy") || "0";
    const rx = el.attr("rx") || "0";
    const ry = el.attr("ry") || "0";
    const d = convertEllipse(cx, cy, rx, ry);
    const { fill: fillColor, stroke: strokeColor, fillRaw, strokeRaw } = getColorAttr(el, nextInherited);
    let colorAttrs = [];
    const opacityAttr = el.attr("opacity");
    const fillOpacityAttr = el.attr("fill-opacity");
    const strokeOpacityAttr = el.attr("stroke-opacity");
    let fillAlpha = 1.0;
    if (fillColor && opacityAttr !== undefined) {
      fillAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) fillAlpha *= parseFloat(opacityAttr);
      if (fillOpacityAttr !== undefined) fillAlpha *= parseFloat(fillOpacityAttr);
    }
    if (fillAlpha < 1.0 && fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillAlpha=\"${fillAlpha}\"`);
    if (fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillColor=\"${fillColor}\"`);
    let strokeAlpha = 1.0;
    if (strokeColor && opacityAttr !== undefined) {
      strokeAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) strokeAlpha *= parseFloat(opacityAttr);
      if (strokeOpacityAttr !== undefined) strokeAlpha *= parseFloat(strokeOpacityAttr);
    }
    if (strokeAlpha < 1.0 && strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeAlpha=\"${strokeAlpha}\"`);
    if (strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeColor=\"${strokeColor}\"`);
    if (nextInherited.strokeWidth && nextInherited.strokeWidth !== "none") colorAttrs.push(`android:strokeWidth=\"${nextInherited.strokeWidth}\"`);
    return `<path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
  } else if (tag === "polygon") {
    const points = el.attr("points");
    const d = convertPolygon(points, false);
    const { fill: fillColor, stroke: strokeColor, fillRaw, strokeRaw } = getColorAttr(el, nextInherited);
    let colorAttrs = [];
    const opacityAttr = el.attr("opacity");
    const fillOpacityAttr = el.attr("fill-opacity");
    const strokeOpacityAttr = el.attr("stroke-opacity");
    let fillAlpha = 1.0;
    if (fillColor && opacityAttr !== undefined) {
      fillAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) fillAlpha *= parseFloat(opacityAttr);
      if (fillOpacityAttr !== undefined) fillAlpha *= parseFloat(fillOpacityAttr);
    }
    if (fillAlpha < 1.0 && fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillAlpha=\"${fillAlpha}\"`);
    if (fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillColor=\"${fillColor}\"`);
    let strokeAlpha = 1.0;
    if (strokeColor && opacityAttr !== undefined) {
      strokeAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) strokeAlpha *= parseFloat(opacityAttr);
      if (strokeOpacityAttr !== undefined) strokeAlpha *= parseFloat(strokeOpacityAttr);
    }
    if (strokeAlpha < 1.0 && strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeAlpha=\"${strokeAlpha}\"`);
    if (strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeColor=\"${strokeColor}\"`);
    if (nextInherited.strokeWidth && nextInherited.strokeWidth !== "none") colorAttrs.push(`android:strokeWidth=\"${nextInherited.strokeWidth}\"`);
    if (d) return `<path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
    return "";
  } else if (tag === "polyline") {
    const points = el.attr("points");
    const d = convertPolygon(points, true);
    const { fill: fillColor, stroke: strokeColor, fillRaw, strokeRaw } = getColorAttr(el, nextInherited);
    let colorAttrs = [];
    const opacityAttr = el.attr("opacity");
    const fillOpacityAttr = el.attr("fill-opacity");
    const strokeOpacityAttr = el.attr("stroke-opacity");
    let fillAlpha = 1.0;
    if (fillColor && opacityAttr !== undefined) {
      fillAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) fillAlpha *= parseFloat(opacityAttr);
      if (fillOpacityAttr !== undefined) fillAlpha *= parseFloat(fillOpacityAttr);
    }
    if (fillAlpha < 1.0 && fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillAlpha=\"${fillAlpha}\"`);
    if (fillColor && fillRaw && fillRaw.toLowerCase() !== "none") colorAttrs.push(`android:fillColor=\"${fillColor}\"`);
    let strokeAlpha = 1.0;
    if (strokeColor && opacityAttr !== undefined) {
      strokeAlpha = parseFloat(opacityAttr);
    } else {
      if (opacityAttr !== undefined) strokeAlpha *= parseFloat(opacityAttr);
      if (strokeOpacityAttr !== undefined) strokeAlpha *= parseFloat(strokeOpacityAttr);
    }
    if (strokeAlpha < 1.0 && strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeAlpha=\"${strokeAlpha}\"`);
    if (strokeColor && strokeRaw && strokeRaw.toLowerCase() !== "none") colorAttrs.push(`android:strokeColor=\"${strokeColor}\"`);
    if (nextInherited.strokeWidth && nextInherited.strokeWidth !== "none") colorAttrs.push(`android:strokeWidth=\"${nextInherited.strokeWidth}\"`);
    if (d) return `<path android:pathData=\"${d}\"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
    return "";
  }
  return "";
}

export function svgToAvd(svgContent: string): string {
    const $ = load(svgContent, { xmlMode: true });
    const svg = $("svg");
    if (!svg.length) throw new Error("无效SVG");

    // 解析CSS样式
    const styleRules = parseStyles($);

    // 新增：解析 viewBox，如果没有则使用宽高
    const viewBox = svg.attr("viewBox");
    let viewportWidth, viewportHeight;

    if (viewBox) {
        const viewBoxParts = viewBox.split(/\s+/).filter(part => part !== '');
        if (viewBoxParts.length >= 4) {
            viewportWidth = viewBoxParts[2];
            viewportHeight = viewBoxParts[3];
        }
    }

    // 如果没有 viewBox 或解析失败，则使用 width 和 height
    if (!viewportWidth || !viewportHeight) {
        viewportWidth = svg.attr("width") || "24";
        viewportHeight = svg.attr("height") || "24";
    }

    const width = svg.attr("width") || "24";
    const height = svg.attr("height") || "24";
    const children = svg.children().filter((i, c) => c.type === "tag").map((i, c) => renderNode(svg.children().eq(i), {}, styleRules)).get().join("\n");
    return `<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<vector xmlns:android=\"http://schemas.android.com/apk/res/android\" android:width=\"${width}dp\" android:height=\"${height}dp\" android:viewportWidth=\"${viewportWidth}\" android:viewportHeight=\"${viewportHeight}\">\n${children}\n</vector>`;
}