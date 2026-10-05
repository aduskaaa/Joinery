# Locally bundled geometry library

`polygon-clipping.umd.js` is the unmodified UMD build of
[polygon-clipping v0.15.7](https://github.com/mfogel/polygon-clipping/tree/v0.15.7).
Downloaded from the official repository's tagged `dist/polygon-clipping.umd.js`.
Its SHA-256 is
`de2bdc061b61d537f7d12f6519f46e35113f0f246b6a06293a08b615454946cf`.
The library runs entirely in the browser without a package
manager or remote requests.

The upstream MIT notice is in `polygon-clipping.LICENSE.md`. Its bundled
splaytree code retains its author and MIT notices in the JavaScript. Microsoft
TypeScript helper code retains its Apache 2.0 notice in the JavaScript;
`Apache-2.0.LICENSE.txt` supplies the full license text.

Load this script before `../Boolean.js` using ordinary script tags to support
both `file://` and static HTTP hosting.
