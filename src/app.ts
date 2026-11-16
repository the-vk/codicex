import { Liquid } from "liquidjs";
import { marked } from "marked";
import type { Document, Manifest } from "./types";

const root = new URL("../", import.meta.url);
const app = document.querySelector<HTMLElement>("#app")!;
const engine = new Liquid();
const cache = new Map<string, Promise<string>>();
let manifest: Manifest;
let generation = 0;

engine.registerFilter("local_url", (value: string) => new URL(value.replace(/^\//, ""), root).pathname);

function fetchText(path: string): Promise<string> {
  let result = cache.get(path);
  if (!result) {
    result = fetch(new URL(path, root)).then(response => {
      if (!response.ok) throw new Error(`Could not load ${path} (${response.status})`);
      return response.text();
    });
    cache.set(path, result);
    result.catch(() => cache.delete(path));
  }
  return result;
}

function body(source: string): string {
  return source.replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, "");
}

function displayDate(date?: string): string {
  if (!date) return "";
  const calendarDate = date.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const parsed = new Date(calendarDate ? `${calendarDate}T00:00:00Z` : date);
  return Number.isNaN(parsed.valueOf()) ? date : new Intl.DateTimeFormat("en-US", {
    year: "numeric", month: "long", day: "numeric", timeZone: "UTC"
  }).format(parsed);
}

function currentRoute(): string | null {
  if (!location.pathname.startsWith(root.pathname)) return null;
  const path = location.pathname.slice(root.pathname.length);
  return `/${path}`;
}

function localizeLinks(container: HTMLElement) {
  for (const element of container.querySelectorAll<HTMLAnchorElement | HTMLImageElement>("a[href], img[src]")) {
    const attribute = element instanceof HTMLAnchorElement ? "href" : "src";
    const value = element.getAttribute(attribute);
    if (value?.startsWith("/") && !value.startsWith("//")) {
      element.setAttribute(attribute, new URL(value.slice(1), root).pathname);
    }
  }
}

function groups(posts: Document[], field: "year" | "categories" | "tags") {
  const map = new Map<string, Document[]>();
  for (const post of posts) {
    const values = field === "year" ? [post.year ?? ""] : post[field];
    for (const name of values) {
      if (!name) continue;
      const entries = map.get(name) ?? [];
      entries.push(post);
      map.set(name, entries);
    }
  }
  return [...map].sort(([a], [b]) => field === "year" ? b.localeCompare(a) : a.localeCompare(b))
    .map(([name, entries]) => ({ name, posts: entries }));
}

async function render() {
  const sequence = ++generation;
  const route = currentRoute();
  const page = [...manifest.pages, ...manifest.posts].find(item => item.url === route);
  if (!page) {
    app.textContent = "Page not found.";
    document.title = `Page not found | ${manifest.site.title}`;
    return;
  }
  try {
    const [source, layout, shell] = await Promise.all([
      fetchText(page.source), fetchText(manifest.templates[page.layout]), fetchText(manifest.templates.default)
    ]);
    const postList = manifest.posts.map(post => ({ ...post, display_date: displayDate(post.date) }));
    const content = page.layout === "single" ? await marked.parse(body(source)) : "";
    const posts = page.layout === "home" ? await Promise.all(postList.map(async post => ({
      ...post, excerpt: await marked.parse(body(await fetchText(post.source)).split("<!--more-->")[0])
    }))) : postList;
    const context = {
      site: manifest.site, navigation: manifest.navigation, page: { ...page, display_date: displayDate(page.date) },
      posts, pages: manifest.pages.filter(item => item.url !== "/"), content,
      groups: groups(postList, page.layout === "posts" ? "year" : page.layout === "tags" ? "tags" : "categories")
    };
    const rendered = await engine.parseAndRender(layout, context);
    const html = await engine.parseAndRender(shell, { ...context, content: rendered });
    if (sequence !== generation) return;
    app.innerHTML = html;
    // Theme links have already been resolved; only root-relative Markdown links need rebasing.
    for (const article of app.querySelectorAll<HTMLElement>("[data-markdown]")) localizeLinks(article);
    document.title = `${page.title} | ${manifest.site.title}`;
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView();
    else window.scrollTo(0, 0);
  } catch (error) {
    if (sequence !== generation) return;
    app.textContent = `Unable to render this page: ${error instanceof Error ? error.message : String(error)}`;
  }
}

document.addEventListener("click", event => {
  if (!manifest || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(target instanceof HTMLAnchorElement) || target.hasAttribute("download") ||
      (target.target && target.target !== "_self")) return;
  const url = new URL(target.href, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith(root.pathname)) return;
  const route = `/${url.pathname.slice(root.pathname.length)}`;
  if (![...manifest.pages, ...manifest.posts].some(item => item.url === route)) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
  event.preventDefault();
  history.pushState(null, "", url);
  void render();
});
window.addEventListener("popstate", () => void render());

try {
  const response = await fetch(new URL("manifest.json", root));
  if (!response.ok) throw new Error(`Manifest request failed (${response.status})`);
  manifest = await response.json() as Manifest;
  await render();
} catch (error) {
  app.textContent = `Unable to load the blog: ${error instanceof Error ? error.message : String(error)}`;
}
