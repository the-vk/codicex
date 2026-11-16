# Local blog

A small TypeScript publisher and browser-side renderer for a blog. It uses Liquid templates and Markdown in the browser.

## Build

Install [mise](https://mise.jdx.dev/), then:

```sh
cd codicex
mise trust
mise install
mise exec -- npm ci
mise exec -- npm run build -- /path/to/blog
```

The installed package also provides `codicex /path/to/blog`. Running `codicex` without arguments displays usage. By default, the build writes to `dist` in the current working directory; use `codicex /path/to/blog --output /path/to/output` to choose another directory. Relative output paths are resolved from the current working directory. **The output directory is replaced on each build.** Publish the entire output directory to a static HTTP server. For a local preview, run `cd dist && python3 -m http.server 8000` and open `http://localhost:8000/`. Browsers cannot fetch the files using `file://`.

The compiler reads front matter and configuration, creates `manifest.json`, copies Markdown, images, and the Liquid templates, and bundles the app. It creates an HTML entry point for every known route, so direct links and refreshes work on ordinary static hosts, including under a subdirectory. Rebuild after changing source files or templates.

## Scope

The templates in `theme/` are a lightweight, independently implemented theme for this blog. The supported layouts are `home`, `single`, `posts`, `categories`, `tags`, and `archive`. The compiler supports the blog's current post filenames, front matter, navigation, default category/date post URLs, and page permalinks. Markdown is rendered with Marked; templates are rendered with LiquidJS. 

## Security

Source Markdown and templates must be trusted, since their HTML is rendered without sanitization.

## Verify

```sh
mise exec -- npm run typecheck
mise exec -- npm test
```

The browser test builds the shared test fixture in a temporary directory and uses Google Chrome at its macOS default path; set `CHROME_PATH` to a Chromium executable elsewhere. It skips if no executable is available.
