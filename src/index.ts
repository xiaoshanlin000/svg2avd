import {optimize} from "svgo";
import {mkdir, readdir, readFile, writeFile} from "fs/promises";
import {basename, extname, join} from "path";
import {svgToAvd} from "./svg2avd";

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

async function main() {
    const {"svg-dir": svgDir, "out-dir": outDir, prefix = ""} = parseArgs();
    if (!svgDir || !outDir) {
        console.error("参数缺失: --svg-dir 输入SVG目录, --out-dir 输出目录, --prefix 输出文件前缀(可选)");
        process.exit(1);
    }
    await mkdir(outDir, {recursive: true});
    const files = (await readdir(svgDir)).filter(f => extname(f).toLowerCase() === ".svg");
    for (const file of files) {
        const svgPath = join(svgDir, file);
        const svgContent = await readFile(svgPath, "utf-8");
        const {data: optimizedSvg} = optimize(svgContent, {multipass: true});
        let avdXml = "";
        try {
            avdXml = svgToAvd(optimizedSvg);
        } catch (e) {
            console.error(`转换失败: ${file} - ${(e as Error).message}`);
            continue;
        }
        const outName = prefix + basename(file, ".svg") + ".xml";
        await writeFile(join(outDir, outName), avdXml, "utf-8");
        console.log(`已生成: ${outDir}/${outName}`);
    }
}

main().then(r => console.log("完成"));