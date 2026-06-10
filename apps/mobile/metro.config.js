// Metro config for the Expo app inside an npm-workspaces monorepo.
// Lets Metro resolve @shomee/core (workspace symlink) and read source from
// the repo root. See https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch the whole monorepo so changes in packages/core trigger HMR.
config.watchFolders = [workspaceRoot]

// 2. Resolve modules from the app first, then the hoisted root node_modules.
//    Hierarchical lookup stays enabled (npm nests some transitive deps such
//    as expo-router's @expo/metro-runtime, which default resolution finds).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

module.exports = config
