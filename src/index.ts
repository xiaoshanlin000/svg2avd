import {optimize} from "svgo";
import {mkdir, readdir, readFile, writeFile} from "fs/promises";
import {basename, extname, join} from "path";
import {svgToAvd} from "./svg2avd";

const args = process.argv.slice(2);

// 新增：文件名规范化函数
function normalizeFileName(name: string): string {
    return name
        .toLowerCase() // 全小写
        .replace(/[\s\-_]+/g, '_') // 空格、短横线、下划线等连续非单词字符转为一个下划线
        .replace(/[^a-z0-9_]/g, '') // 移除非小写字母、数字、下划线的字符
        .replace(/^_+|_+$/g, ''); // 去除首尾的下划线
}

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
        // 修改这一行：先获取文件名（不含扩展名），规范化后再拼接前缀和扩展名
        const baseName = basename(file, ".svg");
        const normalizedBaseName = normalizeFileName(baseName);
        const outName = prefix + normalizedBaseName + ".xml";
        await writeFile(join(outDir, outName), avdXml, "utf-8");
        console.log(`已生成: ${outDir}/${outName}`);
    }
}

main().then(r => console.log("完成"));