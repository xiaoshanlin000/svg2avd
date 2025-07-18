# svg2avd

本项目用于将SVG文件批量转换为Android Vector Drawable（AVD）格式的XML文件。

基于 [Bun](https://bun.sh/) 开发

代码由 [trae.ai](https://www.trae.ai/) 协作智能编写。


## 功能简介
- 支持批量读取SVG文件目录
- 使用 [SVGO](https://github.com/svg/svgo) 对SVG进行优化，去除冗余信息，减小体积
- 基于 [svg2android](https://github.com/inloop/svg2android) 的算法，将优化后的SVG转换为Android Vector Drawable XML
- 支持自定义输出目录和文件名前缀

## 快速开始

首次运行请先安装依赖并构建：

```bash
bun update
bun run build:with-plugins
```

## 使用方法

```bash
bun run src/index.ts --svg-dir <SVG目录> --out-dir <输出目录> [--prefix <文件名前缀>]
```

- `--svg-dir`：输入SVG文件所在目录
- `--out-dir`：输出Android Vector Drawable XML文件的目录
- `--prefix`：可选，输出文件名前缀

### 编译后可执行文件用法

macOS（Apple Silicon 或 Intel）：
```bash
dist/mac-m1/svg2avd --svg-dir <SVG目录> --out-dir <输出目录> [--prefix <文件名前缀>]
dist/mac-x64/svg2avd --svg-dir <SVG目录> --out-dir <输出目录> [--prefix <文件名前缀>]
```
Windows：
```bash
dist/win/svg2avd.exe --svg-dir <SVG目录> --out-dir <输出目录> [--prefix <文件名前缀>]
```

## 算法说明
1. **SVG优化**：
   - 使用 [SVGO](https://github.com/svg/svgo) 对SVG文件进行优化，移除无用属性、注释、编辑器元数据等，确保SVG结构简洁高效。
2. **SVG转AVD**：
   - 参考 [svg2android](https://github.com/inloop/svg2android) 的转换算法，将SVG的path、rect、circle等基本图形元素转换为Android Vector Drawable支持的XML格式。
   - 不支持SVG中的text、渐变、pattern等高级特性。

## 依赖
- [svgo](https://github.com/svg/svgo)
- [cheerio](https://github.com/cheeriojs/cheerio) 

## 参考
- [svgo](https://github.com/svg/svgo)
- [svg2android](https://github.com/inloop/svg2android)

## License

[MIT License](https://opensource.org/licenses/MIT)

---

