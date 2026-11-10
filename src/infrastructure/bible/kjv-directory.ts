import type { SourceSnapshot } from "./kjv-parser.ts";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { ImportIssue } from "../../application/bible-import.ts";

export async function readKjvDirectory(root: string): Promise<SourceSnapshot> {
  const files = new Map<string, string>();
  const directories: string[] = [];
  const readErrors: ImportIssue[] = [];
  const paths: string[] = [];
  const issue = (code: string, path: string, message: string) =>
    readErrors.push({ code, path, message });
  async function walk(relative: string) {
    try {
      for (const entry of await readdir(join(root, relative), {
        withFileTypes: true,
      })) {
        const path = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink())
          issue("unsafe_path", path, "Source symlinks are not followed.");
        else if (entry.name === ".DS_Store" && entry.isFile()) continue;
        else if (entry.isDirectory()) {
          directories.push(path);
          await walk(path);
        } else if (entry.isFile() && entry.name.endsWith(".json"))
          paths.push(path);
        else
          issue("unexpected_path", path, "Unexpected non-JSON source entry.");
      }
    } catch {
      issue(
        "read_error",
        relative || ".",
        "Unable to enumerate source directory.",
      );
    }
  }
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink())
      issue("unsafe_path", ".", "Source root must be a real directory.");
    else await walk("");
  } catch {
    issue("read_error", ".", "Unable to read source root.");
  }
  // Bounded file descriptors rather than opening the entire corpus at once.
  paths.sort();
  for (let offset = 0; offset < paths.length; offset += 32) {
    await Promise.all(
      paths.slice(offset, offset + 32).map(async (path) => {
        try {
          const handle = await open(
            join(root, path),
            constants.O_RDONLY | constants.O_NOFOLLOW,
          );
          try {
            const bytes = await handle.readFile();
            try {
              files.set(
                path,
                new TextDecoder("utf-8", { fatal: true }).decode(bytes),
              );
            } catch {
              issue("invalid_encoding", path, "Source is not valid UTF-8.");
            }
          } finally {
            await handle.close();
          }
        } catch {
          issue("read_error", path, "Unable to read source file.");
        }
      }),
    );
  }
  return { files, directories: directories.sort(), readErrors };
}
