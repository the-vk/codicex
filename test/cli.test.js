import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { tsImport } from "tsx/esm/api";

const exec = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the executable shows usage and publishes a source directory", async t => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "codicex-test-"));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const packageDir = path.join(temp, "package");
  const source = path.join(temp, "blog");
  await mkdir(packageDir);
  for (const entry of ["bin", "src", "theme", "package.json"]) {
    await cp(path.join(root, entry), path.join(packageDir, entry), { recursive: true });
  }
  await symlink(path.join(root, "node_modules"), path.join(packageDir, "node_modules"), "dir");
  const cli = path.join(packageDir, "bin/codicex");

  const help = await exec(cli, [], { cwd: temp });
  assert.match(help.stdout, /Usage: codicex <source-directory> \[--output <directory>\]/);
  await assert.rejects(stat(path.join(temp, "dist")), { code: "ENOENT" });

  await mkdir(path.join(source, "_data"), { recursive: true });
  await mkdir(path.join(source, "_posts"));
  await mkdir(path.join(source, "assets"));
  await writeFile(path.join(source, "_config.yml"), "title: Test Blog\n");
  await writeFile(path.join(source, "_data/navigation.yml"), "main: []\n");
  await writeFile(path.join(source, "index.html"), "---\nlayout: home\n---\n");
  await writeFile(path.join(source, "favicon.png"), "favicon");
  await writeFile(path.join(source, "_posts/2026-01-02-example.md"), "---\ntitle: Example\n---\nHello\n");

  const result = await exec(cli, [source], { cwd: temp });
  assert.match(result.stdout, /Built 1 posts and 1 pages/);
  const manifest = JSON.parse(await readFile(path.join(temp, "dist/manifest.json"), "utf8"));
  assert.equal(manifest.site.title, "Test Blog");
  assert.equal(manifest.posts[0].url, "/2026/01/02/example.html");
  assert.match(await readFile(path.join(temp, "dist/2026/01/02/example.html"), "utf8"), /assets\/app\.js/);
  await stat(path.join(temp, "dist/assets/app.js"));
  await assert.rejects(stat(path.join(packageDir, "dist")), { code: "ENOENT" });

  const customOutput = path.join(temp, "custom-output");
  await mkdir(customOutput);
  await writeFile(path.join(customOutput, "old-file"), "old");
  const custom = await exec(cli, ["--output", "custom-output", source], { cwd: temp });
  assert.ok(custom.stdout.includes(customOutput));
  assert.equal(JSON.parse(await readFile(path.join(customOutput, "manifest.json"), "utf8")).site.title, "Test Blog");
  await assert.rejects(stat(path.join(customOutput, "old-file")), { code: "ENOENT" });
  await stat(path.join(temp, "dist/manifest.json"));

  const absoluteOutput = path.join(temp, "absolute-output");
  await exec(cli, [source, `--output=${absoluteOutput}`], { cwd: temp });
  await stat(path.join(absoluteOutput, "manifest.json"));

  const sourceLink = path.join(temp, "source-link");
  await symlink(source, sourceLink, "dir");
  for (const args of [
    [source, "--output"], [source, "--output="], [source, "--output", source],
    [source, "--output", sourceLink], [source, "--output", packageDir], [source, "--output", "."]
  ]) {
    await assert.rejects(exec(cli, args, { cwd: temp }), { code: 1 });
  }
  await stat(path.join(source, "_config.yml"));

  await assert.rejects(exec(cli, [path.join(temp, "missing")], { cwd: temp }), error => {
    assert.equal(error.code, 1);
    assert.match(error.stderr, /ENOENT/);
    return true;
  });

  const { publish } = await tsImport("../src/publisher.ts", import.meta.url);
  await assert.rejects(publish(source, "relative-output"), /Output directory must be an absolute path/);

  await writeFile(path.join(packageDir, "src/publisher.ts"),
    "export async function publish(source, output) { console.log(JSON.stringify({ source, output })); }\n");
  const cwd = await realpath(temp);
  for (const [args, expectedOutput] of [
    [[source], path.join(cwd, "dist")],
    [[source, "--output", "another-output"], path.join(cwd, "another-output")],
    [[source, "--output", absoluteOutput], absoluteOutput]
  ]) {
    const invocation = JSON.parse((await exec(cli, args, { cwd: temp })).stdout);
    assert.deepEqual(invocation, { source, output: expectedOutput });
  }
});
