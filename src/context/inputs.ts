import * as fs from 'fs';
import * as path from 'path';
import { ts } from 'ts-morph';

export const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const excluded = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.pnpm-store',
  'dist',
  'build',
  'coverage',
  'venv',
  '.venv',
  '__pycache__',
]);

export function isTypeScriptInput(file: string): boolean {
  return (
    /\.(?:[cm]?[jt]sx?)$/.test(file) &&
    !/\.d\.[cm]?ts$/.test(file) &&
    !path
      .resolve(file)
      .split(path.sep)
      .some((part) => excluded.has(part))
  );
}

export function getTypeScriptInputs(root: string): {
  files: string[];
  options: ts.CompilerOptions;
} {
  const config = path.join(root, 'tsconfig.json');
  if (!fs.existsSync(config)) {
    const files = ts.sys.readDirectory(
      root,
      ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'],
      [...excluded].map((dir) => `**/${dir}/**`),
    );
    return { files: files.filter(isTypeScriptInput), options: { allowJs: true } };
  }
  const read = ts.readConfigFile(config, ts.sys.readFile);
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  const host: ts.ParseConfigHost = {
    ...ts.sys,
    readDirectory: (dir, extensions, excludes, includes, depth) =>
      ts.sys.readDirectory(
        dir,
        extensions,
        [...(excludes ?? []), ...[...excluded].map((name) => `**/${name}/**`)],
        includes,
        depth,
      ),
  };
  const parsed = ts.parseJsonConfigFileContent(read.config, host, root, undefined, config);
  const errors = parsed.errors.filter((error) => error.code !== 18003);
  if (errors.length)
    throw new Error(
      errors.map((error) => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n'),
    );
  return { files: parsed.fileNames.filter(isTypeScriptInput), options: parsed.options };
}

export function sourceDependencies(file: string, options: ts.CompilerOptions): string[] {
  if (fs.statSync(file).size > MAX_SOURCE_BYTES) return [];
  const imports = ts.preProcessFile(fs.readFileSync(file, 'utf8'), true, true).importedFiles;
  return imports.flatMap(({ fileName }) => {
    const resolved = ts.resolveModuleName(fileName, file, options, ts.sys).resolvedModule;
    return resolved &&
      !resolved.isExternalLibraryImport &&
      isTypeScriptInput(resolved.resolvedFileName)
      ? [path.resolve(resolved.resolvedFileName)]
      : [];
  });
}
