import { convertRect, convertCircle, convertEllipse, convertPolygon, convertLine } from "./svg_shape_converter";
import { IDENTITY, applyMatrixToPath, decomposeMatrix, fmt, funcToMatrix, mulMat, tokenizeNumbers } from "./path_transform";
import { parseStyleAttr, parseStyleSheet, isStylePropertySupported } from "./parseStyle";
import type { ParsedStyleRule } from "./parseStyle";
import { parseColor } from "./parseColor";
import { load } from "cheerio";
import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";

const NONE = Symbol("svg-none");
type ColorResolved = string | undefined | typeof NONE;

export interface SvgToAvdOptions {
  /** 统一目标视口尺寸（如 24）：内容按比例缩放，viewport/width/height 归一 */
  viewport?: number;
  /** 强制所有描边宽度（覆盖源值，不随 viewport 缩放） */
  strokeWidth?: number;
  /** tint 模式：所有可见 fill/stroke 颜色替换为该色（如 #FFFFFF）；透明区域保持透明 */
  tint?: string;
}

interface RenderContext {
  /** 文档中所有带 id 的元素（含 defs 内部），用于 use/clip-path 引用解析 */
  ids: Map<string, Cheerio<Element>>;
  /** <style> 元素解析出的 CSS 规则 → 元素属性覆盖 */
  cssProps: WeakMap<Element, Record<string, string>>;
  /** 行内 style="..." 属性（优先级高于 CSS 规则） */
  inlineProps: WeakMap<Element, Record<string, string>>;
  options: SvgToAvdOptions;
  /** viewport 缩放系数（无缩放时 1） */
  scale: number;
  /** tint 颜色解析结果（无 tint 时 null） */
  tintHex: string | null;
}

interface InheritedStyle {
  /** 已解析填充颜色：undefined=未指定(默认黑) / NONE=无填充 / 颜色字符串 */
  fill: ColorResolved;
  /** 已解析描边颜色：undefined 或 NONE=无描边 / 颜色字符串 */
  stroke: ColorResolved;
  strokeWidth: string | undefined;
  fillRule: string | undefined;
  strokeLinecap: string | undefined;
  strokeLinejoin: string | undefined;
  strokeMiterlimit: string | undefined;
  fillOpacity: number | undefined;
  strokeOpacity: number | undefined;
  /** 组级 opacity 累积因子（opacity 非继承属性，此处近似传给子元素） */
  opacity: number | undefined;
  /** currentColor 的基准颜色（color 属性，可继承） */
  color: string | undefined;
  /** 累积变换矩阵（烘焙用） */
  matrix: number[] | null;
}

/** 需要从 use 元素传递到被引用元素的样式属性 */
const USE_STYLE_PROPS = [
  "fill", "stroke", "stroke-width", "fill-opacity", "stroke-opacity", "fill-rule",
  "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity", "color",
  "display", "visibility", "clip-path",
];

function elNode(el: Cheerio<Element>): Element | undefined {
  return el[0];
}

function resolveColorValue(val: string | undefined, el: Cheerio<Element>, ctx: RenderContext, inheritedColor: string | undefined): ColorResolved {
  if (val === undefined) return undefined;
  const v = val.trim();
  const lower = v.toLowerCase();
  if (lower === "none") return NONE;
  if (lower === "currentcolor") {
    const color = effectiveStrAttr(el, ctx, "color", inheritedColor);
    if (color && color.trim().toLowerCase() !== "currentcolor") return color.trim();
    return "#000000";
  }
  return val;
}

/** 取值优先级：直接属性 > 行内 style > CSS 规则 > 继承值 */
function effectiveStrAttr(el: Cheerio<Element>, ctx: RenderContext, attrName: string, inheritedValue: string | undefined): string | undefined {
  const direct = el.attr(attrName);
  if (direct !== undefined) return direct;
  const node = elNode(el);
  if (node) {
    const inline = ctx.inlineProps.get(node)?.[attrName.toLowerCase()];
    if (inline !== undefined) return inline;
    const css = ctx.cssProps.get(node)?.[attrName.toLowerCase()];
    if (css !== undefined) return css;
  }
  return inheritedValue;
}

function effectiveColor(el: Cheerio<Element>, ctx: RenderContext, attrName: string, inheritedValue: ColorResolved, inheritedColor: string | undefined): ColorResolved {
  const direct = el.attr(attrName);
  if (direct !== undefined) return resolveColorValue(direct, el, ctx, inheritedColor);
  const node = elNode(el);
  if (node) {
    const inline = ctx.inlineProps.get(node)?.[attrName.toLowerCase()];
    if (inline !== undefined) return resolveColorValue(inline, el, ctx, inheritedColor);
    const css = ctx.cssProps.get(node)?.[attrName.toLowerCase()];
    if (css !== undefined) return resolveColorValue(css, el, ctx, inheritedColor);
  }
  return inheritedValue;
}

function effectiveNumberAttr(el: Cheerio<Element>, ctx: RenderContext, attrName: string, inheritedValue: number | undefined): number | undefined {
  const raw = effectiveStrAttr(el, ctx, attrName, inheritedValue !== undefined ? String(inheritedValue) : undefined);
  if (raw === undefined) return undefined;
  const v = parseFloat(raw);
  return isNaN(v) ? undefined : v;
}

function ownOpacity(el: Cheerio<Element>, ctx: RenderContext): number | undefined {
  return effectiveNumberAttr(el, ctx, "opacity", undefined);
}

function isHidden(el: Cheerio<Element>, ctx: RenderContext): boolean {
  const display = effectiveStrAttr(el, ctx, "display", undefined);
  if (display && display.trim().toLowerCase() === "none") return true;
  const visibility = effectiveStrAttr(el, ctx, "visibility", undefined);
  if (visibility) {
    const v = visibility.trim().toLowerCase();
    if (v === "hidden" || v === "collapse") return true;
  }
  return false;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function computeCumulativeMatrix(transform: string | null): {
  fullMatrix: number[];
  hasMatrixFn: boolean;
} {
  if (!transform) return { fullMatrix: IDENTITY, hasMatrixFn: false };
  const regex = /(\w+)\(([^)]+)\)/g;
  let match;
  let hasMatrixFn = false;
  let cum = IDENTITY;
  while ((match = regex.exec(transform)) !== null) {
    const type = match[1].toLowerCase();
    const params = tokenizeNumbers(match[2]);
    if (type === "matrix") hasMatrixFn = true;
    cum = mulMat(cum, funcToMatrix(type, params));
  }
  return { fullMatrix: cum, hasMatrixFn: hasMatrixFn };
}

function parseTransform(transform: string | null): {
  attrs: Record<string, string>;
  rawMatrix: number[] | null;
} {
  if (!transform) return { attrs: {}, rawMatrix: null };
  const { fullMatrix, hasMatrixFn } = computeCumulativeMatrix(transform);
  const attrs: Record<string, string> = {};

  if (!hasMatrixFn) {
    const regex = /(\w+)\(([^)]+)\)/g;
    let match;
    let hasSkew = false;
    while ((match = regex.exec(transform)) !== null) {
      const type = match[1].toLowerCase();
      const params = tokenizeNumbers(match[2]);
      if (type === "skewx" || type === "skewy") {
        // skew 无法用 AVD group 属性表达，必须整体烘焙
        hasSkew = true;
      } else if (type === "translate") {
        attrs["android:translateX"] = params[0] != null ? String(params[0]) : "0";
        attrs["android:translateY"] = params[1] != null ? String(params[1]) : "0";
      } else if (type === "scale") {
        attrs["android:scaleX"] = params[0] != null ? String(params[0]) : "1";
        attrs["android:scaleY"] = params[1] != null ? String(params[1]) : String(params[0] ?? 1);
      } else if (type === "rotate") {
        attrs["android:rotation"] = params[0] != null ? String(params[0]) : "0";
        attrs["android:pivotX"] = params[1] != null ? String(params[1]) : "0";
        attrs["android:pivotY"] = params[2] != null ? String(params[2]) : "0";
      }
    }
    if (hasSkew) return { attrs: {}, rawMatrix: fullMatrix };
    return { attrs, rawMatrix: null };
  }

  const trs = decomposeMatrix(fullMatrix);
  if (trs) {
    if (trs.translateX !== 0 || trs.translateY !== 0) {
      attrs["android:translateX"] = fmt(trs.translateX);
      attrs["android:translateY"] = fmt(trs.translateY);
    }
    if (trs.scaleX !== 1 || trs.scaleY !== 1) {
      attrs["android:scaleX"] = fmt(trs.scaleX);
      attrs["android:scaleY"] = fmt(trs.scaleY);
    }
    if (trs.rotation !== 0) {
      attrs["android:rotation"] = fmt(trs.rotation);
    }
    return { attrs, rawMatrix: null };
  }

  return { attrs, rawMatrix: fullMatrix };
}

function pickTransformAttrs(t: string | null): { attrs: Record<string, string>; ownMatrix: number[] } {
  const result = parseTransform(t);
  if (result.rawMatrix) return { attrs: result.attrs, ownMatrix: result.rawMatrix };
  const { fullMatrix } = computeCumulativeMatrix(t);
  if (fullMatrix === IDENTITY) return { attrs: result.attrs, ownMatrix: IDENTITY };
  return { attrs: result.attrs, ownMatrix: fullMatrix };
}

function buildColorAttrs(el: Cheerio<Element>, ctx: RenderContext, s: InheritedStyle): string[] {
  const colorAttrs: string[] = [];
  const elemOpacity = ownOpacity(el, ctx);
  const opacityFactor = (elemOpacity ?? 1) * (s.opacity ?? 1);
  const tintHex = ctx.tintHex;

  const fillVal = s.fill;
  if (fillVal !== NONE) {
    const { hex, alpha: colorAlpha } = parseColor(fillVal);
    let fillAlpha = colorAlpha * (s.fillOpacity ?? 1) * opacityFactor;
    fillAlpha = clamp01(fillAlpha);
    if (fillAlpha < 1) colorAttrs.push(`android:fillAlpha="${fmt(fillAlpha)}"`);
    colorAttrs.push(`android:fillColor="${tintHex ?? hex}"`);
  }

  const strokeVal = s.stroke;
  if (strokeVal !== NONE && strokeVal !== undefined) {
    const { hex, alpha: colorAlpha } = parseColor(strokeVal);
    let strokeAlpha = colorAlpha * (s.strokeOpacity ?? 1) * opacityFactor;
    strokeAlpha = clamp01(strokeAlpha);
    if (strokeAlpha < 1) colorAttrs.push(`android:strokeAlpha="${fmt(strokeAlpha)}"`);
    colorAttrs.push(`android:strokeColor="${tintHex ?? hex}"`);
    let sw: string | null = s.strokeWidth ? s.strokeWidth : null;
    if (sw) {
      if (ctx.options.strokeWidth !== undefined) {
        sw = String(ctx.options.strokeWidth);
      } else if (ctx.scale !== 1) {
        sw = fmt(parseFloat(sw) * ctx.scale);
      }
      colorAttrs.push(`android:strokeWidth="${sw}"`);
    }
    if (s.strokeLinecap && s.strokeLinecap !== "butt") colorAttrs.push(`android:strokeLineCap="${s.strokeLinecap}"`);
    if (s.strokeLinejoin && s.strokeLinejoin !== "miter") colorAttrs.push(`android:strokeLineJoin="${s.strokeLinejoin}"`);
    if (s.strokeMiterlimit) colorAttrs.push(`android:strokeMiterLimit="${s.strokeMiterlimit}"`);
  }

  if (s.fillRule && s.fillRule.toLowerCase() === "evenodd") colorAttrs.push('android:fillType="evenOdd"');

  return colorAttrs;
}

function emitPath(pathData: string, colorAttrs: string[], clipPaths: string[], elAttrStr: string, effMatrix: number[] | null): string {
  const hasVisibleColor = colorAttrs.some(a => a.startsWith("android:fillColor=") || a.startsWith("android:strokeColor="));
  if (!hasVisibleColor) return "";
  const finalD = effMatrix ? applyMatrixToPath(pathData, effMatrix) : pathData;
  if (!finalD) return "";
  const pathStr = `<path android:pathData="${finalD}"${colorAttrs.length ? " " + colorAttrs.join(" ") : ""} />`;
  if (clipPaths.length > 0) {
    const clipStr = clipPaths.join("\n");
    if (elAttrStr && !effMatrix) {
      return `<group ${elAttrStr}>\n${clipStr}\n${pathStr}\n</group>`;
    }
    return `<group>\n${clipStr}\n${pathStr}\n</group>`;
  }
  if (elAttrStr && !effMatrix) {
    return `<group ${elAttrStr}>${pathStr}</group>`;
  }
  return pathStr;
}

/** 提取 clipPath 引用指向的内容，渲染为 AVD <clip-path> 元素列表；outer 为元素最终变换矩阵（视口归一化+元素变换），clip 内容与之同坐标空间 */
function renderClipPath(clipRef: string, ctx: RenderContext, outer: number[] | null): string[] {
  const m = clipRef.trim().match(/^url\(\s*#([^)\s]+)\s*\)$/i);
  if (!m) return [];
  const target = ctx.ids.get(m[1]);
  if (!target) return [];
  if ((target[0]?.tagName || "").toLowerCase() !== "clippath") return [];
  if (target.attr("clipPathUnits") === "objectBoundingBox") return [];
  const { ownMatrix: clipOwn } = pickTransformAttrs(target.attr("transform") || null);
  let clipMtx = outer;
  if (clipOwn !== IDENTITY) clipMtx = clipMtx ? mulMat(clipMtx, clipOwn) : clipOwn;
  const parts: string[] = [];
  target.children().filter((i, c) => c.type === "tag").each((i, c) => {
    const d = getClipPathData(target.children().eq(i), ctx, clipMtx, 0);
    if (d) parts.push(`<clip-path android:pathData="${d}" />`);
  });
  return parts;
}

/** 提取 clipPath 内部元素的 pathData（支持 use 引用展开），outer 为外部矩阵 */
function getClipPathData(el: Cheerio<Element>, ctx: RenderContext, outer: number[] | null, depth: number): string | null {
  if (depth > 16) return null;
  const tag = (el[0]?.tagName || "").toLowerCase();
  let d: string | null = null;

  if (tag === "path") {
    d = el.attr("d") || null;
  } else if (tag === "rect") {
    d = convertRect(el.attr("x") || "0", el.attr("y") || "0", el.attr("width") || "0", el.attr("height") || "0", el.attr("rx") || undefined, el.attr("ry") || undefined);
  } else if (tag === "circle") {
    d = convertCircle(el.attr("cx") || "0", el.attr("cy") || "0", el.attr("r") || "0");
  } else if (tag === "ellipse") {
    d = convertEllipse(el.attr("cx") || "0", el.attr("cy") || "0", el.attr("rx") || "0", el.attr("ry") || "0");
  } else if (tag === "polygon") {
    d = convertPolygon(el.attr("points"), false);
  } else if (tag === "polyline") {
    d = convertPolygon(el.attr("points"), true);
  } else if (tag === "line") {
    d = convertLine(el.attr("x1") || "0", el.attr("y1") || "0", el.attr("x2") || "0", el.attr("y2") || "0");
  } else if (tag === "use") {
    const href = el.attr("href") || el.attr("xlink:href") || "";
    const target = href.startsWith("#") ? ctx.ids.get(href.slice(1)) : undefined;
    if (target) {
      const x = parseFloat(el.attr("x") || "0");
      const y = parseFloat(el.attr("y") || "0");
      const { ownMatrix } = pickTransformAttrs(el.attr("transform") || null);
      let um = ownMatrix;
      if (x !== 0 || y !== 0) um = mulMat(um, [1, 0, 0, 1, x, y]);
      return getClipPathData(target, ctx, um, depth + 1);
    }
  }
  if (d === null) return null;

  const { ownMatrix } = pickTransformAttrs(el.attr("transform") || null);
  let eff = ownMatrix;
  if (outer) eff = mulMat(outer, eff);
  if (eff !== IDENTITY) return applyMatrixToPath(d, eff);
  return d;
}

function renderNode(el: Cheerio<Element>, ctx: RenderContext, inherited: InheritedStyle, useDepth = 0): string {
  const tag = (el[0]?.tagName || "").toLowerCase();
  if (!tag || isHidden(el, ctx)) return "";

  const nextInherited: InheritedStyle = {
    fill: effectiveColor(el, ctx, "fill", inherited.fill, inherited.color),
    stroke: effectiveColor(el, ctx, "stroke", inherited.stroke, inherited.color),
    strokeWidth: effectiveStrAttr(el, ctx, "stroke-width", inherited.strokeWidth),
    fillRule: effectiveStrAttr(el, ctx, "fill-rule", inherited.fillRule),
    strokeLinecap: effectiveStrAttr(el, ctx, "stroke-linecap", inherited.strokeLinecap),
    strokeLinejoin: effectiveStrAttr(el, ctx, "stroke-linejoin", inherited.strokeLinejoin),
    strokeMiterlimit: effectiveStrAttr(el, ctx, "stroke-miterlimit", inherited.strokeMiterlimit),
    fillOpacity: effectiveNumberAttr(el, ctx, "fill-opacity", inherited.fillOpacity),
    strokeOpacity: effectiveNumberAttr(el, ctx, "stroke-opacity", inherited.strokeOpacity),
    opacity: inherited.opacity,
    color: effectiveStrAttr(el, ctx, "color", inherited.color),
    matrix: inherited.matrix,
  };

  if (tag === "g" || tag === "symbol") {
    const { attrs: groupAttrs, ownMatrix } = pickTransformAttrs(el.attr("transform") || null);
    const groupAttrStr = Object.entries(groupAttrs).map(([k, v]) => `${k}="${v}"`).join(" ");
    const { rawMatrix: groupRawMatrix } = parseTransform(el.attr("transform") || null);

    let childMatrix = nextInherited.matrix;
    if (inherited.matrix) {
      childMatrix = mulMat(inherited.matrix, ownMatrix);
    } else if (groupRawMatrix) {
      childMatrix = groupRawMatrix;
    }

    const elemOpacity = ownOpacity(el, ctx);
    const childInherited: InheritedStyle = {
      ...nextInherited,
      matrix: childMatrix,
      opacity: elemOpacity !== undefined ? (nextInherited.opacity ?? 1) * elemOpacity : nextInherited.opacity,
    };

    const children = el.children().filter((i, c) => c.type === "tag")
      .map((i, c) => renderNode(el.children().eq(i), ctx, childInherited, useDepth)).get().join("\n");

    if (inherited.matrix || groupRawMatrix) return children;
    return `<group${groupAttrStr ? " " + groupAttrStr : ""}>\n${children}\n</group>`;
  }

  const { attrs: elAttrs, ownMatrix } = pickTransformAttrs(el.attr("transform") || null);
  const elAttrStr = Object.entries(elAttrs).map(([k, v]) => `${k}="${v}"`).join(" ");
  const { rawMatrix: elRawMatrix } = parseTransform(el.attr("transform") || null);
  let effMatrix: number[] | null = null;
  if (inherited.matrix) {
    effMatrix = mulMat(inherited.matrix, ownMatrix);
  } else if (elRawMatrix) {
    effMatrix = elRawMatrix;
  }

  if (tag === "use") {
    if (useDepth > 16) return "";
    const href = el.attr("href") || el.attr("xlink:href") || "";
    if (!href.startsWith("#")) return "";
    const target = ctx.ids.get(href.slice(1));
    if (!target) return "";
    const targetTag = (target[0]?.tagName || "").toLowerCase();
    if (["defs", "clippath", "style", "title", "desc", "metadata"].includes(targetTag)) return "";
    const x = parseFloat(el.attr("x") || "0");
    const y = parseFloat(el.attr("y") || "0");
    const { ownMatrix: useOwn } = pickTransformAttrs(el.attr("transform") || null);
    let useMtx = useOwn;
    if (x !== 0 || y !== 0) useMtx = mulMat(useMtx, [1, 0, 0, 1, x, y]);

    const clone = target.clone();
    const tOwn = clone.attr("transform") || null;
    if (useMtx !== IDENTITY) {
      clone.attr("transform", `matrix(${useMtx.map(fmt).join(" ")})${tOwn ? " " + tOwn : ""}`);
    }
    // use 的样式属性在 target 未显式设置时生效
    for (const prop of USE_STYLE_PROPS) {
      if (clone.attr(prop) === undefined) {
        const uv = el.attr(prop);
        if (uv !== undefined) clone.attr(prop, uv);
      }
    }
    const tStyle = parseStyleAttr(clone.attr("style"));
    const uStyle = parseStyleAttr(el.attr("style"));
    for (const [k, v] of Object.entries(uStyle)) {
      if (!(k in tStyle)) tStyle[k] = v;
    }
    if (Object.keys(tStyle).length > 0) {
      clone.attr("style", Object.entries(tStyle).map(([k, v]) => `${k}:${v}`).join(";"));
    }

    return renderNode(clone, ctx, nextInherited, useDepth + 1);
  }

  let d: string | null = null;
  if (tag === "path") {
    d = el.attr("d") || null;
  } else if (tag === "rect") {
    d = convertRect(el.attr("x") || "0", el.attr("y") || "0", el.attr("width") || "0", el.attr("height") || "0", el.attr("rx") || undefined, el.attr("ry") || undefined);
  } else if (tag === "circle") {
    d = convertCircle(el.attr("cx") || "0", el.attr("cy") || "0", el.attr("r") || "0");
  } else if (tag === "ellipse") {
    d = convertEllipse(el.attr("cx") || "0", el.attr("cy") || "0", el.attr("rx") || "0", el.attr("ry") || "0");
  } else if (tag === "polygon") {
    d = convertPolygon(el.attr("points"), false);
  } else if (tag === "polyline") {
    d = convertPolygon(el.attr("points"), true);
  } else if (tag === "line") {
    d = convertLine(el.attr("x1") || "0", el.attr("y1") || "0", el.attr("x2") || "0", el.attr("y2") || "0");
  } else {
    // defs/symbol/clipPath/style/title/desc 等不直接渲染
    return "";
  }
  if (d === null || d === "") return "";

  const clipRef = effectiveStrAttr(el, ctx, "clip-path", undefined);
  const clipPaths = clipRef ? renderClipPath(clipRef, ctx, effMatrix) : [];

  return emitPath(d, buildColorAttrs(el, ctx, nextInherited), clipPaths, elAttrStr, effMatrix);
}

function compareRules(a: ParsedStyleRule, b: ParsedStyleRule): number {
  for (let i = 0; i < 3; i++) {
    if (a.specificity[i] !== b.specificity[i]) return a.specificity[i] - b.specificity[i];
  }
  return a.order - b.order;
}

export function svgToAvd(svgContent: string, options: SvgToAvdOptions = {}): string {
  const $ = load(svgContent, { xmlMode: true });
  const svg = $("svg");
  if (!svg.length) throw new Error("无效SVG");

  const ctx: RenderContext = {
    ids: new Map(),
    cssProps: new WeakMap(),
    inlineProps: new WeakMap(),
    options,
    scale: 1,
    tintHex: options.tint ? parseColor(options.tint).hex : null,
  };

  // 收集所有带 id 的元素（含 defs 内部），用于 use/clip-path 引用解析
  $("[id]").each((_, el) => {
    ctx.ids.set($(el).attr("id")!, $(el));
  });

  // 行内 style 属性预处理
  $("[style]").each((_, el) => {
    const raw = $(el).attr("style");
    if (raw && raw.trim()) ctx.inlineProps.set(el, parseStyleAttr(raw));
  });

  // <style> 元素 CSS 规则：按 (specificity, order) 升序应用，后写覆盖先写
  const rules: ParsedStyleRule[] = [];
  $("style").each((_, styleEl) => {
    const text = $(styleEl).text();
    if (text.trim()) rules.push(...parseStyleSheet(text));
  });
  rules.sort(compareRules);
  for (const rule of rules) {
    let matched;
    try {
      matched = $(rule.selector);
    } catch {
      continue; // 非法 selector 跳过
    }
    matched.each((_, m) => {
      let props = ctx.cssProps.get(m);
      if (!props) {
        props = {};
        ctx.cssProps.set(m, props);
      }
      for (const [k, v] of Object.entries(rule.declarations)) {
        if (isStylePropertySupported(k)) props[k.toLowerCase()] = v;
      }
    });
  }

  // viewBox：min-x/min-y 偏移通过初始平移矩阵烘焙进所有路径
  const viewBoxStr = svg.attr("viewBox") || "";
  const viewBox = tokenizeNumbers(viewBoxStr);
  const minX = viewBox.length === 4 ? viewBox[0] ?? 0 : 0;
  const minY = viewBox.length === 4 ? viewBox[1] ?? 0 : 0;
  let vw = parseFloat(svg.attr("width") || "24");
  let vh = parseFloat(svg.attr("height") || "24");
  if (viewBox.length === 4) {
    vw = viewBox[2];
    vh = viewBox[3];
  }

  // viewport 统一缩放（如 48→24）：内容按比例烘焙缩放，保持宽高比不拉伸
  let scale = 1;
  if (options.viewport !== undefined && viewBox.length === 4 && vw > 0) {
    scale = options.viewport / vw;
  }
  ctx.scale = scale;

  const vwOut = fmt(vw * scale);
  const vhOut = fmt(vh * scale);

  // width/height 防御：若含非纯数字（如未清理的 px），退回数值解析
  const widthRaw = svg.attr("width") || "24";
  const heightRaw = svg.attr("height") || "24";
  const widthOut = scale !== 1
    ? vwOut
    : /^[\d.]+$/.test(widthRaw) ? widthRaw : String(parseFloat(widthRaw) || Math.max(vw, 24));
  const heightOut = scale !== 1
    ? vhOut
    : /^[\d.]+$/.test(heightRaw) ? heightRaw : String(parseFloat(heightRaw) || Math.max(vh, 24));

  const rootColor = effectiveStrAttr(svg, ctx, "color", undefined);
  let initMatrix: number[] | null = null;
  if (minX !== 0 || minY !== 0) initMatrix = [1, 0, 0, 1, -minX, -minY];
  if (scale !== 1) {
    const scaleM = [scale, 0, 0, scale, 0, 0];
    initMatrix = initMatrix ? mulMat(scaleM, initMatrix) : scaleM;
  }
  const initialInherited: InheritedStyle = {
    fill: effectiveColor(svg, ctx, "fill", undefined, rootColor),
    stroke: effectiveColor(svg, ctx, "stroke", undefined, rootColor),
    strokeWidth: effectiveStrAttr(svg, ctx, "stroke-width", undefined),
    fillRule: effectiveStrAttr(svg, ctx, "fill-rule", undefined),
    strokeLinecap: effectiveStrAttr(svg, ctx, "stroke-linecap", undefined),
    strokeLinejoin: effectiveStrAttr(svg, ctx, "stroke-linejoin", undefined),
    strokeMiterlimit: effectiveStrAttr(svg, ctx, "stroke-miterlimit", undefined),
    fillOpacity: effectiveNumberAttr(svg, ctx, "fill-opacity", undefined),
    strokeOpacity: effectiveNumberAttr(svg, ctx, "stroke-opacity", undefined),
    opacity: ownOpacity(svg, ctx),
    color: rootColor,
    matrix: initMatrix,
  };

  const children = svg.children().filter((i, c) => c.type === "tag").map((i, c) => renderNode(svg.children().eq(i), ctx, initialInherited)).get().join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>\n<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="${widthOut}dp" android:height="${heightOut}dp" android:viewportWidth="${vwOut}" android:viewportHeight="${vhOut}">\n${children}\n</vector>`;
}
