const MiniCssExtractPlugin = require("mini-css-extract-plugin");

module.exports = {
  mode: "development",
  entry: "./foo.js",
  plugins: [new MiniCssExtractPlugin()],
  module: {
    rules: [
      {
        test: /\.(png|jpg|gif)$/i,
        use: [
          {
            loader: 'url-loader',
            options: {
              limit: 8192,
            },
          },
        ],
      },
      {
        test: /\.css$/i,
        exclude: /\.st\.css$/,
        use: [
          MiniCssExtractPlugin.loader,
          { loader: "css-loader", options: { modules: true, esModule: true } },
        ],
      },
      {
        test: /\.st\.css$/i,
        use: [
          {
            loader: require.resolve("./stylable-loader-final"),
          },
          MiniCssExtractPlugin.loader,
          {
            loader: require.resolve("./stylable-loader"),
          },
        ],
      },
    ],
  },
};
