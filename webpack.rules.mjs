export const rules = [
  {
    // `import text from './file.html?raw'` — inlines a file as a string.
    // Used for the phone dash page, which the main process serves itself.
    resourceQuery: /raw/,
    type: 'asset/source',
  },
  {
    test: /\.(png|jpe?g|gif|ico)$/i,
    type: 'asset/resource',
  },
  {
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
];
