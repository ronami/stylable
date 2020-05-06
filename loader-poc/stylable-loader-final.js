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

function evalModule(source) {
  if (!source) {
      throw new Error('No source is provided to evalModule');
  }
  const _module = {
      exports: {},
  };
  const fn = new Function('module', 'exports', 'require', source);
  fn(_module, _module.exports);
  return _module.exports;
}

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

  const [namespace, mapping] = evalModule(content)

  return callback(
    null,
    `
    const runtime = require("@stylable/runtime")

    module.exports = runtime.create(
      ${JSON.stringify(namespace)},
      ${JSON.stringify(mapping)},
      "",
      -1,
      module.id,
  );
    `
  );
};
