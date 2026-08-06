import { optimize } from "svgo";

/**
 * SVGO 优化（路径命令保真版）
 *
 * 默认 preset 的 convertPathData 会改写路径命令结构：
 * - makeArcs: 把贝塞尔曲线拟合成圆弧（有损近似，误差可达 ~0.5 单位，图标边缘可见）
 * - convertToQ: 把三次贝塞尔降阶为二次（数学等价，但改变命令结构）
 * - straightCurves: 把近似直线的曲线转直线（有损）
 *
 * 这些改写违反"路径一一对应"原则，全部禁用。
 * 保留其余无损优化：属性清理、数字压缩、形状转 path、S/T 简写等。
 */
export function optimizeSvg(svgContent: string): string {
  const { data } = optimize(svgContent, {
    multipass: true,
    plugins: [
      {
        name: "preset-default",
        params: {
          overrides: {
            convertPathData: {
              makeArcs: false,
              convertToQ: false,
              straightCurves: false,
            },
          },
        },
      },
    ],
  });
  return data;
}
