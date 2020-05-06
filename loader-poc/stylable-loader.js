const { Stylable } = require("@stylable/core");
const { getOptions, isUrlRequest, stringifyRequest } = require("loader-utils");
const postcss = require("postcss");
const postcssPkg = require("postcss/package.json");
const validateOptions = require("schema-utils");
const { satisfies } = require("semver");
const Warning = require("css-loader/dist/Warning");
const {
  icssParser,
  importParser,
  urlParser,
} = require("css-loader/dist/plugins");
const {
  getPreRequester,
  getExportCode,
  getFilter,
  getImportCode,
  getModuleCode,
  normalizeSourceMap,
} = require("css-loader/dist/utils");

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

  const sourceMap = options.sourceMap || false;
  const plugins = [];

  const exportType = options.onlyLocals ? "locals" : "full";
  const preRequester = getPreRequester(this);
  const urlHandler = (url) =>
    stringifyRequest(this, preRequester(options.importLoaders) + url);

  plugins.push(icssParser({ urlHandler }));

  if (options.import !== false && exportType === "full") {
    plugins.push(
      importParser({
        filter: getFilter(options.import, this.resourcePath),
        urlHandler,
      })
    );
  }

  if (options.url !== false && exportType === "full") {
    plugins.push(
      urlParser({
        filter: getFilter(options.url, this.resourcePath, (value) =>
          isUrlRequest(value)
        ),
        urlHandler: (url) => stringifyRequest(this, url),
      })
    );
  }

  // Reuse CSS AST (PostCSS AST e.g 'postcss-loader') to avoid reparsing
  if (meta) {
    const { ast } = meta;

    if (
      ast &&
      ast.type === "postcss" &&
      satisfies(ast.version, `^${postcssPkg.version}`)
    ) {
      // eslint-disable-next-line no-param-reassign
      content = ast.root;
    }
  }

  postcss(plugins)
    .process(css, {
      from: this.resourcePath,
      to: this.resourcePath,
      map: options.sourceMap
        ? {
            // Some loaders (example `"postcss-loader": "1.x.x"`) always generates source map, we should remove it
            prev: sourceMap && map ? normalizeSourceMap(map) : null,
            inline: false,
            annotation: false,
          }
        : false,
    })
    .then((result) => {
      for (const warning of result.warnings()) {
        this.emitWarning(new Warning(warning));
      }

      const imports = [];
      const apiImports = [];
      const urlReplacements = [];
      const icssReplacements = [];
      const exports = [];

      for (const message of result.messages) {
        // eslint-disable-next-line default-case
        switch (message.type) {
          case "import":
            imports.push(message.value);
            break;
          case "api-import":
            apiImports.push(message.value);
            break;
          case "url-replacement":
            urlReplacements.push(message.value);
            break;
          case "icss-replacement":
            icssReplacements.push(message.value);
            break;
          case "export":
            exports.push(message.value);
            break;
        }
      }

      const { localsConvention } = options;
      const esModule =
        typeof options.esModule !== "undefined" ? options.esModule : false;

      const importCode = getImportCode(this, exportType, imports, esModule);
      const moduleCode = getModuleCode(
        result,
        exportType,
        sourceMap,
        apiImports,
        urlReplacements,
        icssReplacements,
        esModule
      );
      const exportCode = getExportCode(
        exports,
        exportType,
        localsConvention,
        icssReplacements,
        esModule
      );

      return callback(
        null,
        `
        ${importCode}
        ${moduleCode}

        // Patch exports with custom stylable API
        exports.locals = ${JSON.stringify([res.meta.namespace, res.exports])}

        ${exportCode}
      `
      );
    });
};
