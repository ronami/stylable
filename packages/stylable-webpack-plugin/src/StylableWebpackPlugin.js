const { RawSource } = require("webpack-sources");
const { Stylable } = require("stylable");
const findConfig = require("find-config");
const { connectChunkAndModule } = require("webpack/lib/GraphHelpers");
const { getCSSDepthAndDeps, isImportedByNonStylable } = require("./utils");
const { StylableBootstrapModule } = require("./StylableBootstrapModule");
const { cssRuntimeRendererRequest } = require("./runtime-dependencies");
const StylableParser = require("./StylableParser");
const StylableGenerator = require("./StylableGenerator");
const {
  StylableImportDependency,
  StylableAssetDependency
} = require("./StylableDependencies");

class StylableWebpackPlugin {
  constructor(options) {
    this.options = this.normalizeOptions(options);
  }
  overrideOptionsWithLocalConfig(context) {
    let fullOptions = this.options;
    const localConfig = this.loadLocalStylableConfig(context);
    if (localConfig && localConfig.options) {
      fullOptions = localConfig.options(fullOptions);
    }
    this.options = fullOptions;
  }
  loadLocalStylableConfig(dir) {
    let localConfigOverride;
    try {
      localConfigOverride = findConfig.require("stylable.config", { cwd: dir });
    } catch (e) {
      /* no op */
    }
    return localConfigOverride;
  }
  normalizeOptions(options = {}) {
    const defaults = {
      requireModule: id => {
        delete require.cache[id];
        return require(id);
      },
      transformHooks: undefined,
      rootScope: true,
      createRuntimeChunk: false,
      filename: "[name].bundle.css",
      outputCSS: false,
      includeCSSInJS: true,
      optimize: {
        removeUnusedComponents: true,
        removeComments: false,
        removeStylableDirectives: true,
        classNameOptimizations: false,
        shortNamespaces: false
      },
      plugins: []
    };
    return {
      ...defaults,
      ...options
    };
  }
  createStylable(compiler) {
    const nsProvider = function() {
      let index = 0;
      const namespaceMapping = {};
      const getNamespace = meta =>
        namespaceMapping[meta.source] ||
        (namespaceMapping[meta.source] = "o" + index++);
      return getNamespace;
    };

    const getNS = nsProvider();
    const stylable = new Stylable(
      compiler.context,
      compiler.inputFileSystem,
      this.options.requireModule,
      "--",
      meta => {
        if (this.options.optimize.shortNamespaces) {
          meta.namespace = getNS(meta);
        }
        return meta;
      },
      undefined,
      this.options.transformHooks,
      this.options.rootScope,
      compiler.options.resolve
    );
    return stylable;
  }
  apply(compiler) {
    this.overrideOptionsWithLocalConfig(compiler.context);
    this.stylable = this.createStylable(compiler);
    this.injectStylableModuleRuleSet(compiler);
    this.injectStylableCompilation(compiler);
    this.injectStylableRuntimeInfo(compiler);
    this.injectStylableRuntimeChunk(compiler);
    this.injectPlugins(compiler);
  }
  injectPlugins(compiler) {
    this.options.plugins.forEach(plugin => plugin.apply(compiler, this));
  }
  injectStylableRuntimeInfo(compiler) {
    compiler.hooks.compilation.tap(StylableWebpackPlugin.name, compilation => {
      compilation.hooks.optimizeModules.tap(
        StylableWebpackPlugin.name,
        modules => {
          modules.forEach(module => {
            if (module.type === "stylable") {
              module.buildInfo.runtimeInfo = getCSSDepthAndDeps(module);
              module.buildInfo.isImportedByNonStylable = isImportedByNonStylable(
                module
              );
            }
          });
        }
      );
    });
    this.injectStylableCSSOptimizer(compiler);
  }
  injectStylableCSSOptimizer(compiler) {
    const used = [];
    compiler.hooks.compilation.tap(StylableWebpackPlugin.name, compilation => {
      compilation.hooks.optimizeModules.tap(
        StylableWebpackPlugin.name,
        modules => {
          modules.forEach(module => {
            if (module.type === "stylable") {
              module.buildInfo.optimize = this.options.optimize;
              module.buildInfo.usedStylableModules = used;
              if (module.buildInfo.isImportedByNonStylable) {
                used.push(module.resource);
              }
            }
          });
        }
      );
    });
  }
  injectStylableRuntimeChunk(compiler) {
    compiler.hooks.thisCompilation.tap(
      StylableWebpackPlugin.name,
      (compilation, data) => {
        compilation.hooks.optimizeChunks.tap(
          StylableWebpackPlugin.name,
          chunks => {
            const runtimeRendererModule = compilation.getModule(
              cssRuntimeRendererRequest
            );

            if (!runtimeRendererModule) {
              return;
            }

            const createRuntimeChunk = this.options.createRuntimeChunk;

            const chunksBootstraps = [];
            chunks.forEach(chunk => {
              // if (chunk.containsModule(runtimeRendererModule)) {
              const bootstrap = new StylableBootstrapModule(
                compiler.context,
                runtimeRendererModule
              );

              for (const module of chunk.modulesIterable) {
                if (module.type === "stylable") {
                  bootstrap.addStylableModuleDependency(module);
                }
              }

              if (bootstrap.dependencies.length) {
                chunksBootstraps.push([chunk, bootstrap]);
              }
              // if (bootstrap.dependencies.length && chunk.entryModule) {
              // chunksBootstraps.push([chunk, bootstrap]);
              // }
              // }
            });

            if (chunksBootstraps.length === 0) {
              return;
            }

            if (createRuntimeChunk) {
              const extractedStylableChunk = compilation.addChunk(
                "stylable-css-runtime"
              );

              const extractedBootstrap = new StylableBootstrapModule(
                compiler.context,
                runtimeRendererModule
              );

              chunksBootstraps.forEach(([chunk, bootstrap]) => {
                chunk.split(extractedStylableChunk);
                bootstrap.dependencies.forEach(dep => {
                  extractedBootstrap.dependencies.push(dep);
                  chunk.moveModule(dep.module, extractedStylableChunk);
                });
              });

              compilation.addModule(extractedBootstrap);
              connectChunkAndModule(extractedStylableChunk, extractedBootstrap);
              extractedStylableChunk.entryModule = extractedBootstrap;
            } else {
              chunksBootstraps.forEach(([chunk, bootstrap]) => {
                // this is here for metadata to generate assets
                chunk.stylableBootstrap = bootstrap;
                if (chunk.entryModule) {
                  compilation.addModule(bootstrap);
                  connectChunkAndModule(chunk, bootstrap);
                  bootstrap.addStylableModuleDependency(chunk.entryModule);
                  bootstrap.setEntryReplacement(chunk.entryModule);
                  chunk.entryModule = bootstrap;
                }
              });
            }
          }
        );

        if (this.options.outputCSS) {
          compilation.hooks.additionalChunkAssets.tap(
            StylableWebpackPlugin.name,
            chunks => {
              chunks.forEach(chunk => {
                const bootstrap =
                  chunk.entryModule instanceof StylableBootstrapModule
                    ? chunk.entryModule
                    : chunk.stylableBootstrap;

                if (bootstrap) {
                  const cssSources = bootstrap.renderStaticCSS(
                    compilation.mainTemplate,
                    compilation.hash
                  );

                  const cssBundleFilename = compilation.getPath(
                    this.options.filename,
                    { chunk, hash: compilation.hash }
                  );

                  compilation.assets[cssBundleFilename] = new RawSource(
                    cssSources.join("\n\n\n")
                  );

                  chunk.files.push(cssBundleFilename);
                }
              });
            }
          );
        }
      }
    );
  }
  injectStylableCompilation(compiler) {
    compiler.hooks.compilation.tap(
      StylableWebpackPlugin.name,
      (compilation, { normalModuleFactory }) => {
        compilation.dependencyFactories.set(
          StylableImportDependency,
          normalModuleFactory
        );
        compilation.dependencyFactories.set(
          StylableAssetDependency,
          normalModuleFactory
        );
        normalModuleFactory.hooks.createParser
          .for("stylable")
          .tap(StylableWebpackPlugin.name, () => {
            return new StylableParser(this.stylable);
          });
        normalModuleFactory.hooks.createGenerator
          .for("stylable")
          .tap(StylableWebpackPlugin.name, () => {
            return new StylableGenerator(this.stylable, compilation, {
              includeCSSInJS: this.options.includeCSSInJS
            });
          });
      }
    );
  }
  injectStylableModuleRuleSet(compiler) {
    compiler.hooks.normalModuleFactory.tap(
      StylableWebpackPlugin.name,
      factory => {
        factory.ruleSet.rules.push(
          factory.ruleSet.constructor.normalizeRule(
            {
              test: /\.st\.css$/i,
              type: "stylable",
              resolve: {
                // mainFields: ["stylable"]
              }
            },
            factory.ruleSet.references,
            ""
          )
        );
      }
    );
  }
}

module.exports = StylableWebpackPlugin;
