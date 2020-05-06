const path = require("path");
const { getOptions } = require("loader-utils");
const { createModuleSource } = require("@stylable/module-utils");
const {
  Stylable,
  createDefaultResolver,
  isAsset,
  makeAbsolute,
  processDeclarationUrls,
  OnUrlCallback,
} = require("@stylable/core");
const { resolveNamespace } = require("@stylable/node");
const { StylableOptimizer } = require("@stylable/optimizer");
// const {
//   getPreRequester,
//   getExportCode,
//   getFilter,
//   getImportCode,
//   getModuleCode,
//   getModulesPlugins,
//   normalizeSourceMap,
//   shouldUseModulesPlugins,
// } = require('./utils');

let stylable;

module.exports = function loader(content, map, meta) {
  stylable =
    stylable ||
    Stylable.create({
      projectRoot: this.rootContext,
      fileSystem: this.fs,
    });

  const options = getOptions(this) || {};
  const callback = this.async();

  const res = stylable.transform(content, this.resourcePath);
  const css = res.meta.outputAst.toString();

  return callback(
    null,
    `

  // Imports
import ___CSS_LOADER_API_IMPORT___ from './node_modules/css-loader/dist/runtime/api.js'

var exports = ___CSS_LOADER_API_IMPORT___(false)

// Module
exports.push([module.id, ${JSON.stringify(css)}, ''])
// Exports
exports.locals = ${JSON.stringify([res.meta.namespace, res.exports])}

export default exports

  `
  );
};
