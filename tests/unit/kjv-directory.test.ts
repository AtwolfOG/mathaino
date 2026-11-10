import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { readKjvDirectory } from "@/infrastructure/bible/kjv-directory";
import { fixtureFiles } from "../helpers/kjv-fixture";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});

async function fixture() {
  await mkdir(".test-tmp", { recursive: true });
  const temp = await mkdtemp(".test-tmp/kjv-");
  roots.push(temp);
  const root = join(temp, "source");
  for (const [path, content] of fixtureFiles()) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  return { root, temp };
}

test("directory reads preserve raw files and ignore only operating-system metadata", async () => {
  const { root } = await fixture();
  await writeFile(join(root, ".DS_Store"), "ignored");
  const result = await readKjvDirectory(root);
  expect(result.readErrors).toEqual([]);
  expect([...result.files].sort()).toEqual([...fixtureFiles()].sort());
  expect(await readFile(join(root, "en-kjv.json"), "utf8")).toBe(
    fixtureFiles().get("en-kjv.json"),
  );
});

test("directory traversal never follows source symlinks", async () => {
  const { root, temp } = await fixture();
  const outside = join(process.cwd(), temp, "outside.json");
  await writeFile(outside, "private fixture");
  await symlink(outside, join(root, "linked.json"));
  const result = await readKjvDirectory(root);
  expect(result.readErrors).toContainEqual(
    expect.objectContaining({ code: "unsafe_path", path: "linked.json" }),
  );
  expect(result.files.has("linked.json")).toBe(false);
});

test("malformed UTF-8 is rejected without replacement characters", async () => {
  const { root } = await fixture();
  await writeFile(join(root, "en-kjv.json"), new Uint8Array([0xc3, 0x28]));
  const result = await readKjvDirectory(root);
  expect(result.readErrors).toContainEqual(
    expect.objectContaining({ code: "invalid_encoding", path: "en-kjv.json" }),
  );
});

test("unreadable or missing source roots produce a clear read failure", async () => {
  const { root } = await fixture();
  const result = await readKjvDirectory(join(root, "missing"));
  expect(result.readErrors).toContainEqual(
    expect.objectContaining({ code: "read_error" }),
  );
});
