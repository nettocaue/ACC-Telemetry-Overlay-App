import { rules } from './webpack.rules.mjs';

export default {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/main.js',
  module: {
    rules,
  },
  externals: {
    // koffi resolves its native binary with import.meta.dirname internally;
    // webpack can't statically bundle that, so load it via plain require()
    // from node_modules at runtime instead (unpacked from asar automatically
    // by @electron-forge/plugin-auto-unpack-natives).
    koffi: 'commonjs koffi',
  },
};
