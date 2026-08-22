const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');

/** @type {import('esbuild').BuildOptions} */
const shared = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  sourcemap: !production,
  minify: production,
  sourcesContent: false,
  logLevel: 'warning',
  external: ['vscode', 'mocha'],
};

async function main() {
  if (test) {
    const testDir = path.join(__dirname, 'test');
    const entryPoints = fs
      .readdirSync(testDir)
      .filter((f) => f.endsWith('.test.ts'))
      .map((f) => path.join(testDir, f));
    await esbuild.build({
      ...shared,
      entryPoints,
      outdir: 'out-test',
    });
    console.log(`built ${entryPoints.length} test file(s) -> out-test/`);
    return;
  }

  const ctx = await esbuild.context({
    ...shared,
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
  });
  if (watch) {
    await ctx.watch();
    console.log('watching...');
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
