import {optimizeSvg} from "./svgOptimize";
import {mkdir, readdir, readFile, writeFile} from "fs/promises";
import {basename, extname, join} from "path";
import {svgToAvd} from "./svg2avd";
import type {SvgToAvdOptions} from "./svg2avd";

const args = process.argv.slice(2);

function parseArgs() {
    const params: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
        if (args[i].startsWith("--")) {
            const key = args[i].slice(2);
            params[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : "";
        }
    }
    return params;
}

function toSnakeCase(name: string): string {
    return name
        .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
        .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
        .replace(/[\p{P}\p{Z}\p{S}]+/gu, "_")
        .toLowerCase();
}

function num(v: string | undefined, fallback?: number): number | undefined {
    if (v === undefined || v === "") return fallback;
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
}

async function main() {
    const {
        "svg-dir": svgDir,
        "out-dir": outDir,
        prefix = "",
        viewport,
        "stroke-width": strokeWidth,
        tint,
        "rename-map": renameMapPath,
    } = parseArgs();
    if (!svgDir || !outDir) {
        console.error("参数缺失: --svg-dir 输入SVG目录, --out-dir 输出目录, --prefix 输出文件前缀(可选), --viewport 统一视口尺寸(可选), --stroke-width 强制描边宽度(可选), --tint 替换颜色(可选), --rename-map 重命名映射JSON(可选)");
        process.exit(1);
    }
    let renameMap: Record<string, string> = {};
    if (renameMapPath) {
        renameMap = JSON.parse(await readFile(renameMapPath, "utf-8"));
    }
    const options: SvgToAvdOptions = {
        viewport: num(viewport),
        strokeWidth: num(strokeWidth),
        tint: tint || undefined,
    };
    await mkdir(outDir, {recursive: true});
    const files = (await readdir(svgDir)).filter(f => extname(f).toLowerCase() === ".svg");
    for (const file of files) {
        const svgPath = join(svgDir, file);
        const svgContent = await readFile(svgPath, "utf-8");
        const optimizedSvg = optimizeSvg(svgContent);
        let avdXml = "";
        try {
            avdXml = svgToAvd(optimizedSvg, options);
        } catch (e) {
            console.error(`转换失败: ${file} - ${(e as Error).message}`);
            continue;
        }
        const base = basename(file, ".svg");
        const mapped = renameMap[base] ?? renameMap[file];
        const outName = prefix + toSnakeCase(mapped ?? base) + ".xml";
        await writeFile(join(outDir, outName), avdXml, "utf-8");
        console.log(`已生成: ${outDir}/${outName}`);
    }
}

main().then(r => console.log("完成"));
