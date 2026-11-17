import * as path from 'path';

// TypeScript's config parser, ts-morph and the file watcher each report paths in
// their own separator convention, and the incremental scanner keys its maps on
// the path. One convention wins: forward slashes, which Windows file APIs accept
// and which ts-morph already returns (`filePath.includes('/dist/')`).
export function toPosixPath(file: string): string {
  return file.split(path.sep).join('/');
}
