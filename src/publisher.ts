import { build } from "esbuild";
import matter from "gray-matter";
import { parse as parseYaml } from "yaml";
import { cp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Document, Manifest } from "./types";

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdown = /\.(md|markdown)$/i;

async function files(dir: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "_site" || entry.name === "vendor") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(full));
    else if (entry.isFile() && markdown.test(entry.name)) result.push(full);
  }
  return result.sort();
}

function words(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  return typeof value === "string" ? value.split(/\s+/).filter(Boolean) : [];
}

function safeRoute(route: string): string {
  if (!route.startsWith("/") || route.includes("\\") || route.includes("?") || route.includes("#") ||
      route.split("/").some(part => part === "." || part === "..") || route.startsWith("//")) {
    throw new Error(`Invalid permalink: ${route}`);
  }
  return route;
}

export async function publish(sourceDirectory: string, output: string) {
  if (!path.isAbsolute(output)) throw new Error("Output directory must be an absolute path");
  const source = path.resolve(sourceDirectory);
  const resolvedOutput = await realpath(output).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return output;
    throw error;
  });
  for (const protectedDirectory of [source, project, process.cwd()]) {
    const relative = path.relative(resolvedOutput, await realpath(protectedDirectory));
    if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new Error(`Output directory cannot contain the source, package, or working directory: ${output}`);
    }
  }
  const config = parseYaml(await readFile(path.join(source, "_config.yml"), "utf8")) ?? {};
  const nav = parseYaml(await readFile(path.join(source, "_data/navigation.yml"), "utf8")) ?? {};
  const posts: Document[] = [];
  const pages: Document[] = [];
  const allFiles = await files(source);
  const home = matter(await readFile(path.join(source, "index.html"), "utf8"));
  pages.push({
    title: String(home.data.title ?? config.title ?? "Home"), url: "/", source: "content/index.html",
    layout: String(home.data.layout ?? "home"), categories: [], tags: []
  });
  for (const file of allFiles) {
    const relative = path.relative(source, file).split(path.sep).join("/");
    const parsed = matter(await readFile(file, "utf8"));
    const meta = parsed.data;
    if (meta.published === false) continue;
    const isPost = relative.startsWith("_posts/");
    const categories = words(meta.categories);
    const tags = words(meta.tags);
    const name = path.basename(file).replace(markdown, "");
    const match = name.match(/^(\d{4})-(\d{2})-(\d{2})-(.+)$/);
    if (isPost && !match) throw new Error(`Post filename must start with YYYY-MM-DD: ${relative}`);
    const defaultUrl = isPost && match
      ? `/${[...categories, match[1], match[2], match[3], `${match[4]}.html`].map(encodeURIComponent).join("/")}`
      : `/${name}/`;
    const date = isPost ? String(meta.date instanceof Date ? meta.date.toISOString() : (meta.date ?? `${match![1]}-${match![2]}-${match![3]}`)) : undefined;
    const doc: Document = {
      title: String(meta.title ?? name), url: safeRoute(String(meta.permalink ?? defaultUrl)),
      source: `content/${relative}`, layout: String(meta.layout ?? (isPost ? "single" : "archive")),
      date, year: isPost ? match![1] : undefined, categories, tags
    };
    (isPost ? posts : pages).push(doc);
  }
  posts.sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
  const routes = new Set<string>();
  for (const doc of [...posts, ...pages]) {
    if (routes.has(doc.url)) throw new Error(`Duplicate route: ${doc.url}`);
    routes.add(doc.url);
  }
  const templateNames = ["default", "home", "single", "posts", "categories", "tags", "archive"];
  for (const doc of [...posts, ...pages]) {
    if (!templateNames.includes(doc.layout)) throw new Error(`Unsupported layout "${doc.layout}" in ${doc.source}`);
  }
  const manifest: Manifest = {
    site: {
      title: String(config.title ?? "Blog"), description: String(config.description ?? ""),
      author: { name: String(config.author?.name ?? ""), bio: String(config.author?.bio ?? ""),
        location: String(config.author?.location ?? ""), links: config.author?.links ?? [] }
    },
    navigation: nav.main ?? [], posts, pages,
    templates: Object.fromEntries(templateNames.map(name => [name, `theme/${name}.liquid`]))
  };

  await rm(output, { recursive: true, force: true });
  await mkdir(path.join(output, "assets"), { recursive: true });
  await cp(path.join(project, "theme"), path.join(output, "theme"), { recursive: true });
  await cp(path.join(source, "assets"), path.join(output, "assets"), { recursive: true, force: true });
  await cp(path.join(source, "favicon.png"), path.join(output, "favicon.png"));
  for (const doc of [...posts, ...pages]) {
    const original = doc.url === "/" ? path.join(source, "index.html") : path.join(source, doc.source.slice("content/".length));
    const destination = path.join(output, doc.source);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(original, destination);
  }
  await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  await cp(path.join(project, "src/style.css"), path.join(output, "assets/style.css"));
  await build({ entryPoints: [path.join(project, "src/app.ts")], outfile: path.join(output, "assets/app.js"),
    bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true });
  for (const route of routes) {
    const destination = path.join(output, route === "/" ? "index.html" : route.endsWith("/") ? `${route.slice(1)}index.html` : route.slice(1));
    const prefix = path.relative(path.dirname(destination), output).split(path.sep).join("/") || ".";
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${manifest.site.title.replace(/[&<>"']/g, "")}</title><link rel="icon" href="${prefix}/favicon.png">
<link rel="stylesheet" href="${prefix}/assets/style.css"></head>
<body><div id="app" aria-live="polite">Loading blog...</div><script type="module" src="${prefix}/assets/app.js"></script></body></html>\n`);
  }
  console.log(`Built ${posts.length} posts and ${pages.length} pages into ${output}`);
}
