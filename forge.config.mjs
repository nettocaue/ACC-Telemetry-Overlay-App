import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config = {
  packagerConfig: {
    // Native .node binaries (koffi) can't be dlopen'd from inside the asar
    // archive, so they must stay unpacked on disk alongside it.
    asar: {
      unpack: '**/*.node',
    },
    // electron-packager's default pruning walks the dependency graph and
    // decides per-module whether to keep it, bypassing `ignore` entirely for
    // module-root paths — so it drops koffi before our custom ignore below
    // ever gets a say. Disabling it is safe here: `ignore` is already a
    // strict allowlist (.webpack + koffi + @koromix only).
    prune: false,
    // @electron-forge/plugin-webpack's default `ignore` excludes everything
    // outside .webpack, assuming webpack bundled all dependencies. koffi is
    // marked `external` (its native loader can't be bundled), so it and its
    // platform-specific binary package must be explicitly let through here
    // or the packaged app silently fails with "Cannot find module 'koffi'".
    ignore: (file) => {
      if (!file) return false;
      if (/^[/\\]\.webpack($|[/\\])/.test(file)) return false;
      // The walker prunes a directory's whole subtree the moment it's
      // ignored, without ever looking inside — so the bare node_modules
      // directory itself must be let through (to be entered) even though
      // almost everything directly inside it still gets dropped below.
      if (/^[/\\]node_modules$/.test(file)) return false;
      if (/^[/\\]node_modules[/\\](koffi|@koromix)($|[/\\])/.test(file)) return false;
      if (/^[/\\]node_modules[/\\]/.test(file)) return true;
      return true;
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig: './webpack.main.config.mjs',
      renderer: {
        config: './webpack.renderer.config.mjs',
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.js',
            name: 'main_window',
            preload: {
              js: './src/preload.js',
            },
          },
          {
            html: './src/overlay.html',
            js: './src/overlay.js',
            name: 'overlay_window',
            preload: {
              js: './src/preload.js',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
