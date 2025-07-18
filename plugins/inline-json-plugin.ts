import {readFileSync, writeFileSync} from 'fs';
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

// 递归查找 node_modules 下所有 js 文件
function findJsFiles(dir) {
    const {readdirSync, statSync} = require('fs');
    let results = [];
    for (const file of readdirSync(dir)) {
        const fullPath = resolve(dir, file);
        if (statSync(fullPath).isDirectory()) {
            results = results.concat(findJsFiles(fullPath));
        } else if (file.endsWith('.js')) {
            results.push(fullPath);
        } else if (file.endsWith('.cjs')) {
            results.push(fullPath);
        }
    }
    return results;
}

function resolveJsonPath(basePath, jsonPath) {
    const abs1 = resolve(basePath, jsonPath);
    if (require('fs').existsSync(abs1)) return abs1;
    // 兼容 node_modules/xxx/xxx.json 绝对路径
    const abs2 = resolve(process.cwd(), 'node_modules', jsonPath);
    if (require('fs').existsSync(abs2)) return abs2;
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
    let fileContent = readFileSync(filePath, 'utf8');
    let modified = false;
    let newContent = fileContent;
    // 依次调用所有替换函数
    const replacedConst = replaceConstRequireJson(newContent, filePath);
    if (replacedConst !== newContent) { modified = true; newContent = replacedConst; }
    const replacedRequire = replaceRequireJson(newContent, filePath);
    if (replacedRequire !== newContent) { modified = true; newContent = replacedRequire; }
    const replacedImport = replaceImportJson(newContent, filePath);
    if (replacedImport !== newContent) { modified = true; newContent = replacedImport; }
    const replacedImportNamed = replaceImportNamedJson(newContent, filePath);
    if (replacedImportNamed !== newContent) { modified = true; newContent = replacedImportNamed; }
    if (modified) {
        writeFileSync(filePath, newContent, 'utf8');
        console.log('已修改:', filePath);
    }
}

function main() {
    const base = resolve(process.cwd(), 'node_modules');
    const files = findJsFiles(base);
    files.forEach(processFile);
}

if (require.main === module) {
    main();
}