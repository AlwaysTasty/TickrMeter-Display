// When Netlify bundles an ES-module function with esbuild, CommonJS code inside the
// bundle calls `require('node:crypto')` through a shim that only works if a
// `require` function exists. Import this module first to provide one.
import { createRequire } from 'node:module';

if (typeof globalThis.require === 'undefined') globalThis.require = createRequire(import.meta.url);
