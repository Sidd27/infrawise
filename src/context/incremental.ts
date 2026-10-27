import * as fs from 'fs';
import * as path from 'path';
import type { ExtractedOperation } from '../types.js';
import { scanTypeScriptPaths, detectLanguages } from './index.js';
import { getTypeScriptInputs, sourceDependencies } from './inputs.js';
import { scanPythonRepository } from './python.js';

export class RepositoryScanner {
  private initialized = false;
  private operations = new Map<string, ExtractedOperation[]>();
  private dependents = new Map<string, Set<string>>();
  private dependencies = new Map<string, Set<string>>();
  private inputs?: ReturnType<typeof getTypeScriptInputs>;

  constructor(private readonly repoPath: string) {}

  async scan(changedFiles?: string[]): Promise<ExtractedOperation[]> {
    try {
      return await this.update(changedFiles);
    } catch (err) {
      this.initialized = false;
      throw err;
    }
  }

  private async update(changedFiles?: string[]): Promise<ExtractedOperation[]> {
    if (
      !this.initialized ||
      !changedFiles ||
      changedFiles.some((file) => /^tsconfig.*\.json$/.test(path.basename(file)))
    ) {
      this.inputs = getTypeScriptInputs(this.repoPath);
      const operations = await scanTypeScriptPaths(this.inputs.files);
      if (detectLanguages(this.repoPath).hasPython)
        operations.push(...(await scanPythonRepository(this.repoPath)));
      this.operations.clear();
      this.store(operations);
      this.dependents.clear();
      this.dependencies.clear();
      for (const file of this.inputs.files) this.indexDependencies(file);
      this.initialized = true;
      return operations;
    }

    const changed = changedFiles.map((file) => path.resolve(this.repoPath, file));
    const affected = new Set<string>();
    const visit = (file: string) => {
      const pending = [file];
      while (pending.length) {
        const next = pending.pop();
        if (next === undefined || affected.has(next)) continue;
        affected.add(next);
        pending.push(...(this.dependents.get(next) ?? []));
      }
    };
    for (const file of changed) visit(file);
    if (
      changed.some(
        (file) =>
          fs.existsSync(file) && !this.inputs?.files.includes(file) && !file.endsWith('.py'),
      )
    ) {
      this.inputs = getTypeScriptInputs(this.repoPath);
      for (const file of this.inputs.files) this.indexDependencies(file);
      affected.clear();
      for (const file of changed) visit(file);
    }
    for (const file of changed) {
      if (path.extname(file) !== '.py') continue;
      this.operations.delete(file);
      if (fs.existsSync(file)) this.store(await scanPythonRepository(this.repoPath, [file]));
    }
    const included = new Set(this.inputs?.files);
    const files = [...affected].filter((file) => included.has(file) && fs.existsSync(file));
    for (const file of affected) {
      if (!file.endsWith('.py')) this.operations.delete(file);
      if (!fs.existsSync(file)) this.removeDependencies(file);
    }
    this.store(await scanTypeScriptPaths(files));
    for (const file of files) this.indexDependencies(file);
    return [...this.operations.values()].flat();
  }

  private removeDependencies(file: string): void {
    for (const dependency of this.dependencies.get(file) ?? []) {
      const dependents = this.dependents.get(dependency);
      dependents?.delete(file);
      if (!dependents?.size) this.dependents.delete(dependency);
    }
    this.dependencies.delete(file);
  }

  private indexDependencies(file: string): void {
    this.removeDependencies(file);
    const dependencies = new Set(sourceDependencies(file, this.inputs?.options ?? {}));
    this.dependencies.set(file, dependencies);
    for (const dependency of dependencies) {
      const dependents = this.dependents.get(dependency) ?? new Set<string>();
      dependents.add(file);
      this.dependents.set(dependency, dependents);
    }
  }

  private store(operations: ExtractedOperation[]): void {
    for (const operation of operations) {
      const entries = this.operations.get(operation.filePath) ?? [];
      entries.push(operation);
      this.operations.set(operation.filePath, entries);
    }
  }
}
