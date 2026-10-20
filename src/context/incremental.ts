import * as fs from 'fs';
import * as path from 'path';
import type { Project, SourceFile } from 'ts-morph';
import type { ExtractedOperation } from '../types.js';
import { createTypeScriptProject, scanTypeScriptFiles, detectLanguages } from './index.js';
import { scanPythonRepository } from './python.js';

export class RepositoryScanner {
  private project?: Project;
  private operations = new Map<string, ExtractedOperation[]>();
  private dependents = new Map<string, Set<string>>();
  private dependencies = new Map<string, Set<string>>();

  constructor(private readonly repoPath: string) {}

  async scan(changedFiles?: string[]): Promise<ExtractedOperation[]> {
    try {
      return await this.update(changedFiles);
    } catch (err) {
      this.project = undefined;
      throw err;
    }
  }

  private async update(changedFiles?: string[]): Promise<ExtractedOperation[]> {
    if (
      !this.project ||
      !changedFiles ||
      changedFiles.some((file) => /^tsconfig.*\.json$/.test(path.basename(file)))
    ) {
      this.project = createTypeScriptProject(this.repoPath);
      const operations = scanTypeScriptFiles(this.project.getSourceFiles());
      if (detectLanguages(this.repoPath).hasPython)
        operations.push(...(await scanPythonRepository(this.repoPath)));
      this.operations.clear();
      this.store(operations);
      this.dependents.clear();
      this.dependencies.clear();
      for (const source of this.project.getSourceFiles()) this.indexDependencies(source);
      return operations;
    }

    const affected = new Set<SourceFile>();
    const visit = (source: SourceFile) => {
      if (affected.has(source)) return;
      affected.add(source);
      for (const file of this.dependents.get(source.getFilePath()) ?? []) {
        const dependent = this.project?.getSourceFile(file);
        if (dependent) visit(dependent);
      }
    };
    const changed = changedFiles.map((file) => path.resolve(this.repoPath, file));
    for (const file of changed) {
      const source = this.project.getSourceFile(file);
      if (source) visit(source);
    }
    for (const file of changed) {
      this.operations.delete(file);
      if (path.extname(file) === '.py') {
        if (fs.existsSync(file)) this.store(await scanPythonRepository(this.repoPath, [file]));
        continue;
      }
      const source = this.project.getSourceFile(file);
      if (!fs.existsSync(file)) {
        if (source) {
          affected.delete(source);
          for (const dependency of this.dependencies.get(file) ?? []) {
            this.dependents.get(dependency)?.delete(file);
          }
          this.dependencies.delete(file);
          this.dependents.delete(file);
          this.project.removeSourceFile(source);
        }
      } else if (source) {
        source.refreshFromFileSystemSync();
      } else {
        const tsconfig = path.join(this.repoPath, 'tsconfig.json');
        if (fs.existsSync(tsconfig)) this.project.addSourceFilesFromTsConfig(tsconfig);
        const added = fs.existsSync(tsconfig)
          ? this.project.getSourceFile(file)
          : this.project.addSourceFileAtPath(file);
        if (!added) continue;
        visit(added);
        for (const dependent of added.getReferencingSourceFiles()) visit(dependent);
      }
    }
    for (const source of affected) this.operations.delete(source.getFilePath());
    this.store(scanTypeScriptFiles([...affected]));
    for (const source of affected) this.indexDependencies(source);
    return [...this.operations.values()].flat();
  }

  private indexDependencies(source: SourceFile): void {
    const file = source.getFilePath();
    for (const dependency of this.dependencies.get(file) ?? []) {
      this.dependents.get(dependency)?.delete(file);
    }
    const dependencies = new Set(
      source
        .getReferencedSourceFiles()
        .filter((ref) => !ref.wasForgotten())
        .map((ref) => ref.getFilePath()),
    );
    this.dependencies.set(file, dependencies);
    for (const dependency of dependencies) {
      const dependents = this.dependents.get(dependency) ?? new Set<string>();
      dependents.add(file);
      this.dependents.set(dependency, dependents);
    }
  }

  private store(operations: ExtractedOperation[]): void {
    for (const operation of operations) {
      const file = operation.filePath;
      const entries = this.operations.get(file) ?? [];
      entries.push(operation);
      this.operations.set(file, entries);
    }
  }
}
