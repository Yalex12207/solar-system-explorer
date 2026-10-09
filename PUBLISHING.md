# Publishing to GitHub

This project is **ready to publish but has not been pushed**. The steps below are everything
that remains. They take about two minutes on a machine that can reach `github.com`.

## Why it was not done automatically

Three measured blockers, in order of severity:

| Check | Result |
| --- | --- |
| `git` installed | **No** — not on PATH, no install found, no `gh` CLI, no `~/.gitconfig`, no SSH key |
| `github.com:443` reachable | **No** — TCP connect fails after 8 s. DNS resolves to `20.205.243.166` correctly, so this is a network block, not a configuration error |
| GitHub credentials present | **No** — nothing to authenticate with |

`api.github.com` *does* work, which is why a repository can still be **created** through the
API even though a **push** cannot be delivered from here. `gitee.com`, `bitbucket.org` and
`codeberg.org` are all reachable, so the block is specific to `github.com`.

Installing Git also failed for the same reason: `winget install Git.Git` resolves the package
but the download comes from `github.com/git-for-windows/...`, which is blocked.

**The repository is already prepared** so that publishing is a three-command job:

- `.gitignore` has been corrected and verified — it now covers `verify-shots*` (the build
  screenshot set was previously missed) and `.gl-probe-*` (Playwright browser profiles). Both
  would otherwise have committed roughly **230 MB** of disposable files.
- A clean archive is staged at **`../solar-system-explorer-v2.5.zip`** — 73 files, 11.4 MB
  compressed / 26.5 MB expanded. Most of that is the vendored MediaPipe runtime in `public/`,
  which is required because the app never contacts a CDN at runtime.

## Option A — push from a machine that can reach github.com

Copy the project folder (or extract the zip), then:

```bash
cd solar-system-explorer
git init -b main
git config user.name  "Your Name"
git config user.email "you@example.com"

git add -A
git commit -m "Solar System Explorer V1-V2.5"

# Create the empty repo first, on github.com or with:
#   curl -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/user/repos \
#        -d '{"name":"solar-system-explorer","private":false}'

git remote add origin https://github.com/<you>/solar-system-explorer.git
git push -u origin main
```

Sanity-check the staged set before committing — it should report **73 files**:

```bash
git add -A && git diff --cached --name-only | wc -l
```

If that number is in the hundreds, `.gitignore` is not being picked up. See the note below.

## Option B — upload through the GitHub web UI

1. Extract `../solar-system-explorer-v2.5.zip`.
2. On github.com: **New repository** → name it → **Create**.
3. **Add file → Upload files**, drag in the *contents* of the extracted folder (not the
   folder itself), and commit.

The web UI has a 100-file limit per upload, so this needs two passes: upload everything
except `public/mediapipe/wasm/`, commit, then upload that folder. `node_modules/` and `dist/`
are absent from the archive on purpose — restore them with `npm install` and `npm run build`.

## Option C — if you connect through a VPN or proxy later

Re-run the same commands as Option A. If Git needs a proxy:

```bash
git config --global http.proxy  http://host:port
git config --global https.proxy http://host:port
```

## What gets committed, and what does not

Included — 73 files, 26.5 MB:

| Path | Files | Notes |
| --- | --- | --- |
| `src/` | 44 | application source |
| `tools/` | 18 | the eight verification suites and the capture scripts |
| `public/mediapipe/` | 4 | the Hand Landmarker model and wasm runtime, ~26 MB |
| root | 7 | `index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `README.md`, `.gitignore` |

Excluded by `.gitignore`:

- `node_modules/`, `dist/` — restore with `npm install` and `npm run build`
- `.verify-profile*`, `.gl-probe-*` — Playwright browser profiles, ~19 MB each
- `verify-shots*` — captured screenshots, ~91 MB
- `.npm-cache/`, `.esbuild-tmp/` — local scratch
- `*.local`, `.env`, editor and OS files

### Note on the screenshots

`verify-shots/` is ignored, but `README.md` embeds images from it. If you want the README to
render images on GitHub, either commit the handful it references:

```bash
git add -f verify-shots/04-system-wide.png verify-shots/review/c-system.png
git add -f verify-shots/focus/focus-desktop.png verify-shots/gesture/04-point-select.png
git add -f verify-shots/v25/08-milky-way.png verify-shots/v25/05-finale.png
git add -f verify-shots/v25/07-oort-cloud.png verify-shots/v24/07-voyage-card.png
git add -f verify-shots/bodies/earth.png verify-shots/rings/c-anti-sun.png
```

or regenerate them with `node tools/review.mjs`, `node tools/capture-cosmic.mjs` and friends.

## Verifying the archive

To confirm the archive is complete and self-contained:

```bash
unzip -q solar-system-explorer-v2.5.zip -d /tmp/check
cd /tmp/check/solar-system-explorer
npm install
npm run build     # should succeed and report ~95 kB CSS / ~463 kB JS
npm run dev       # then open http://localhost:4321
```
