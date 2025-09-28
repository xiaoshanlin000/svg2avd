import {readFileSync, writeFileSync, readdirSync, statSync, existsSync} from 'fs';
import {resolve, dirname} from 'path';

/**
 * 独立脚本：批量扫描并直接修改 node_modules 里的目标 js 文件，将 require('../data/patch.json') 等 JSON 文件引用内联为对象字面量。
 * 用法：bun run plugins/inline-json-plugin.ts
 */

// 匹配 require('../data/patch.json') 这样的模式
const requireJsonRegex = /require\(['"]([^'"\n]+\.json)['"]\)/g;
// 匹配 import xxx from '../data/patch.json' 这样的模式
const importJsonRegex = /import\s+([\w{}*,\s]+)\s+from\s+['"]([^'"\n]+\.json)['"];?/g;
// 匹配 import {foo} from '../data/patch.json' 这样的命名导入
const importNamedJsonRegex = /import\s+\{([\w\s,]+)\}\s+from\s+['"]([^'"\n]+\.json)['"];?/g;
// 匹配 const foo = require('xxx.json') 这种写法
const constRequireJsonRegex = /const\s+([\w$]+)\s*=\s*require\(['"]([^'"\n]+\.json)['"]\);?/g;

// 递归遍历并处理 js 文件
function processJsFiles(dir) {
    let processedCount = 0;

    function traverseAndProcess(currentDir) {
        for (const file of readdirSync(currentDir)) {
            const fullPath = resolve(currentDir, file);
            const stats = statSync(fullPath);

            if (stats.isDirectory()) {
                traverseAndProcess(fullPath);
            } else if (file.endsWith('.js') || file.endsWith('.cjs')) {
                processFile(fullPath);
                processedCount++;
            }
        }
    }

    traverseAndProcess(dir);
    return processedCount;
}

function resolveJsonPath(basePath, jsonPath) {
    const abs1 = resolve(basePath, jsonPath);
    if (existsSync(abs1)) return abs1;
    // 兼容 node_modules/xxx/xxx.json 绝对路径
    const abs2 = resolve(process.cwd(), 'node_modules', jsonPath);
    if (existsSync(abs2)) return abs2;
    return abs1;
}

function replaceConstRequireJson(fileContent, filePath) {
    return fileContent.replace(constRequireJsonRegex, (match, varName, jsonPath) => {
        const basePath = dirname(filePath);
        const absoluteJsonPath = resolveJsonPath(basePath, jsonPath);
        try {
            const jsonContent = readFileSync(absoluteJsonPath, 'utf8');
            const jsonObject = JSON.parse(jsonContent);
            return `const ${varName} = ${JSON.stringify(jsonObject)};`;
        } catch {
            return match;
        }
    });
}

function replaceRequireJson(fileContent, filePath) {
    return fileContent.replace(requireJsonRegex, (match, jsonPath) => {
        const basePath = dirname(filePath);
        const absoluteJsonPath = resolveJsonPath(basePath, jsonPath);
        try {
            const jsonContent = readFileSync(absoluteJsonPath, 'utf8');
            const jsonObject = JSON.parse(jsonContent);
            return `(${JSON.stringify(jsonObject)})`;
        } catch {
            return match;
        }
    });
}

function replaceImportJson(fileContent, filePath) {
    return fileContent.replace(importJsonRegex, (match, importVars, jsonPath) => {
        const basePath = dirname(filePath);
        const absoluteJsonPath = resolveJsonPath(basePath, jsonPath);
        try {
            const jsonContent = readFileSync(absoluteJsonPath, 'utf8');
            const jsonObject = JSON.parse(jsonContent);
            return `const ${importVars.trim()} = ${JSON.stringify(jsonObject)};`;
        } catch {
            return match;
        }
    });
}

function replaceImportNamedJson(fileContent, filePath) {
    return fileContent.replace(importNamedJsonRegex, (match, importNames, jsonPath) => {
        const basePath = dirname(filePath);
        const absoluteJsonPath = resolveJsonPath(basePath, jsonPath);
        try {
            const jsonContent = readFileSync(absoluteJsonPath, 'utf8');
            const jsonObject = JSON.parse(jsonContent);
            return importNames.split(',').map(name => {
                const key = name.trim();
                return `const ${key} = ${JSON.stringify(jsonObject[key])};`;
            }).join(' ');
        } catch {
            return match;
        }
    });
}

function processFile(filePath) {
    try {
        let fileContent = readFileSync(filePath, 'utf8');
        let modified = false;

        // 依次调用所有替换函数
        const replacedConst = replaceConstRequireJson(fileContent, filePath);
        if (replacedConst !== fileContent) { modified = true; fileContent = replacedConst; }

        const replacedRequire = replaceRequireJson(fileContent, filePath);
        if (replacedRequire !== fileContent) { modified = true; fileContent = replacedRequire; }

        const replacedImport = replaceImportJson(fileContent, filePath);
        if (replacedImport !== fileContent) { modified = true; fileContent = replacedImport; }

        const replacedImportNamed = replaceImportNamedJson(fileContent, filePath);
        if (replacedImportNamed !== fileContent) { modified = true; fileContent = replacedImportNamed; }

        if (modified) {
            writeFileSync(filePath, fileContent, 'utf8');
            console.log('已修改:', filePath);
            return true;
        }
        return false;
    } catch (error) {
        console.error('处理文件时出错:', filePath, error.message);
        return false;
    }
}

function main() {
    const base = resolve(process.cwd(), 'node_modules');
    console.log('开始扫描和处理 node_modules 中的 js 文件...');

    const startTime = Date.now();
    const processedCount = processJsFiles(base);
    const endTime = Date.now();

    console.log(`处理完成！共处理 ${processedCount} 个文件，耗时 ${endTime - startTime}ms`);
}

if (require.main === module) {
    main();
}