# svg2avd

本项目用于将SVG文件批量转换为Android Vector Drawable（AVD）格式的XML文件。

基于 [Bun](https://bun.sh/) 开发

代码由 [trae.ai](https://www.trae.ai/) + [opencode](https://opencode.ai) + [DeepSeek V4 Flash](https://deepseek.com) 协作智能编写。


## 功能简介
- 支持批量读取SVG文件目录
- 使用 [SVGO](https://github.com/svg/svgo) 对SVG进行优化（路径命令保真，不做有损改写），去除冗余信息，减小体积
- 基于 [svg2android](https://github.com/inloop/svg2android) 的算法，将优化后的SVG转换为Android Vector Drawable XML
- 支持自定义输出目录和文件名前缀
- 输出文件名自动规范化（camelCase 转 snake_case，符号转为下划线），并支持重命名映射
- 支持统一视口尺寸缩放、强制描边宽度、tint 换色

## 快速开始

首次运行请先安装依赖并构建：

```bash
bun update
bun run build:with-plugins
```

## 使用方法

```bash
bun run src/index.ts --svg-dir <SVG目录> --out-dir <输出目录> [选项...]
```

### 参数说明

| 参数 | 必填 | 说明 |
|---|---|---|
| `--svg-dir` | 是 | 输入SVG文件所在目录 |
| `--out-dir` | 是 | 输出Android Vector Drawable XML文件的目录 |
| `--prefix` | 否 | 输出文件名前缀 |
| `--viewport` | 否 | 统一视口尺寸（如 `24`）：内容按比例缩放，viewport/width/height 归一，保持宽高比不拉伸 |
| `--stroke-width` | 否 | 强制所有描边宽度为该值（覆盖源值，不随 viewport 缩放） |
| `--tint` | 否 | tint 模式：所有可见 fill/stroke 颜色替换为该色（如 `#FFFFFF`），透明区域保持透明 |
| `--rename-map` | 否 | 重命名映射JSON文件路径，key 为源文件名（可带或不带 `.svg`），value 为输出名，如 `{"iconHome": "home"}` |

单个文件转换失败不会中断，会打印错误并跳过，继续处理其余文件。

### 编译后可执行文件用法

macOS（Apple Silicon 或 Intel）：
```bash
dist/mac-m1/svg2avd --svg-dir <SVG目录> --out-dir <输出目录> [选项...]
dist/mac-x64/svg2avd --svg-dir <SVG目录> --out-dir <输出目录> [选项...]
```
Windows：
```bash
dist/win/svg2avd.exe --svg-dir <SVG目录> --out-dir <输出目录> [选项...]
```

## 算法说明
1. **SVG优化**：
   - 使用 [SVGO](https://github.com/svg/svgo) 对SVG文件进行优化，移除无用属性、注释、编辑器元数据等，确保SVG结构简洁高效。
   - 关闭 `convertPathData` 的有损改写（`makeArcs`、`convertToQ`、`straightCurves`），保证路径命令与源文件一一对应，图标边缘不失真。
2. **SVG转AVD**：
   - 参考 [svg2android](https://github.com/inloop/svg2android) 的转换算法，将SVG的 path、rect、circle、ellipse、polygon、polyline、line 等基本图形元素转换为Android Vector Drawable支持的XML格式。
   - 支持 `<use>` 引用、`<clip-path>` 裁剪、CSS `<style>` 规则与行内 `style` 属性、`currentColor`/`color` 继承、fill-opacity/stroke-opacity/opacity 透明度叠加、`fill-rule="evenodd"`（映射为 `fillType`）、stroke 的 linecap/linejoin/miterlimit。
   - transform 处理：translate/scale/rotate 映射为 AVD group 属性；skew 和 matrix 变换直接烘焙进路径数据；viewBox 的 min-x/min-y 偏移同样烘焙进路径。
   - 不支持SVG中的text、渐变、pattern等高级特性。

## 构建（编译为平台可执行文件）

```bash
bun run build:win     # Windows → dist/win/svg2avd.exe
bun run build:mac-m1  # macOS Apple Silicon → dist/mac-m1/svg2avd
bun run build:mac-x64 # macOS Intel → dist/mac-x64/svg2avd
bun run build:all     # 一次性构建以上三个平台
```

> 打包前需先运行 `bun run build:with-plugins`（内联JSON插件），解决 css-tree 等库在 Bun 打包时 `require('*.json')` 无法处理的问题。

## 依赖
- [svgo](https://github.com/svg/svgo)
- [cheerio](https://github.com/cheeriojs/cheerio) 

## 参考
- [svgo](https://github.com/svg/svgo)
- [svg2android](https://github.com/inloop/svg2android)

## License

[MIT License](./LICENSE)

---
