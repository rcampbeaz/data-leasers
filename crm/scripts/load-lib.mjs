// Loads a dependency-free module from lib/ into a check script, with no build step.
//
// The module is transpiled with the TypeScript already in devDependencies and imported from a temp
// directory. That only works while it stands alone: a relative import in it would have nothing to
// resolve against from there, so the assumption is asserted rather than hoped for, and an edit that
// gives the module a dependency fails with a sentence that names the line and says what to do.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEPENDENCY =
  /^\s*import\s*[\s{*'"]|^\s*export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s*['"]|\bimport\s*\(|\brequire\s*\(/m;

export async function loadLib(name, check) {
  const file = resolve(HERE, '..', 'lib', name);
  const source = readFileSync(file, 'utf8');

  const dependency = source.match(DEPENDENCY);
  if (dependency) {
    const line = source.slice(0, dependency.index).split('\n').length;
    console.error(`lib/${name} is no longer standalone, so ${check} cannot load it.\n`);
    console.error(`  lib/${name}:${line}  ${source.split('\n')[line - 1].trim()}`);
    console.error('');
    console.error(`${check} transpiles the module into a temp directory and imports the copy from there,`);
    console.error('so a module it imports — a relative file, a type re-export, a require — has nothing to');
    console.error('resolve against. Keep this module the leaf the rest of lib/ builds on, or change how the');
    console.error('check loads it (the copy has to sit where its imports resolve, e.g. transpiled into the');
    console.error('project with the rest of lib/ instead of into a temp directory).');
    process.exit(1);
  }

  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const scratch = mkdtempSync(join(tmpdir(), 'lib-check-'));
  const copy = join(scratch, name.replace(/\.ts$/, '.mjs'));
  writeFileSync(copy, outputText);

  let loaded;
  let loadError = null;
  try {
    loaded = await import(pathToFileURL(copy).href);
  } catch (error) {
    loadError = error;
  }
  rmSync(scratch, { recursive: true, force: true });

  if (loadError) {
    console.error(`${check} could not load its copy of lib/${name}.\n`);
    console.error('The copy is imported from a temp directory, so anything the module needs at load time —');
    console.error('an import, a package, an environment variable read while it initialises — is not there.');
    console.error(`Fix the module or this check's loader. The loader reported:\n\n  ${loadError.message}\n`);
    process.exit(1);
  }

  return loaded;
}
