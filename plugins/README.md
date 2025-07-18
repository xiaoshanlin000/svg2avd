# Bun 内联JSON插件

## 问题背景

在使用Bun打包项目时，如果依赖的库（如css-tree）使用了CommonJS的`require('../data/patch.json')`这种方式导入JSON文件，打包后会出现错误。这是因为Bun在打包时无法正确处理这种导入方式。

## 解决方案

这个插件通过修改JavaScript文件中的`require('*.json')`调用，将JSON文件的内容直接内联到代码中，避免了运行时的文件依赖问题。


### 2. 通过package.json脚本运行

```bash
bun run build:with-plugins
```

## 插件工作原理

1. 插件会拦截所有`.js`,`.cjs`文件的加载
2. 检查文件内容中是否包含`require('*.json')` 等模式
3. 如果找到匹配，会读取对应的JSON文件内容
4. 将JSON内容解析并转换为JavaScript对象字面量
5. 用这个对象字面量替换原来的`require`调用

## 注意事项

- 这个插件主要用于解决css-tree等库在Bun打包时的问题
- 只处理静态路径的JSON导入，不处理动态路径
- 确保JSON文件存在且格式正确，否则会保留原始的require调用

```typescript 
```