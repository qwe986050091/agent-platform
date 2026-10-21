// Expo/Metro 在 pnpm monorepo 下的解析配置：
// - watchFolders 覆盖仓库根，工作区包（packages/*）源码变动可触发热更新；
// - nodeModulesPaths 同时指向 app 与仓库根的 node_modules（pnpm 软链布局）；
// - 仅排除项目内 pnpm store，绝不能排除 node_modules/.pnpm（真实文件在那里）。
const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const workspaceRoot = path.resolve(__dirname, '../..')
const config = getDefaultConfig(__dirname)

config.watchFolders = [workspaceRoot]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]
config.resolver.blockList = [/\.pnpm-store[\\/].*/]

module.exports = config
