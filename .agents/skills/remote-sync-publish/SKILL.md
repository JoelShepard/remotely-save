---
name: remote-sync-publish
description: "Workflow for publishing a new version of the Remote Sync Obsidian plugin. Covers version bumping, pre-publish checks, building, tagging, and creating a GitHub release."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Remote Sync Publishing

> Workflow for releasing new versions of the Remote Sync Obsidian plugin.

## When to Use This Skill

Use this skill when the user asks you to:

- Prepare a new release
- Bump the plugin version
- Build the production artifacts and tag a release
- Create a new GitHub release

---

## 1. Version Bumping

Update the version string in the following files to the new `X.Y.Z` version:

- `package.json`
- `manifest.json`
- `manifest-beta.json` (used by BRAT beta channel)

*Note: The tag MUST follow the `X.Y.Z` format (e.g., `0.7.0`), no leading `v`.*
*Note: Update `versions.json` by adding the new version and its corresponding minimum Obsidian version (usually the current `minAppVersion`).*

---

## 2. Pre-publish Checklist

Before building, verify the project state:

1. `npm run test` — Ensure all tests pass.
2. `npm run format` — Ensure code is formatted with Biome.
3. `npx tsc --noEmit --skipLibCheck` — Verify TypeScript compilation.
4. `node esbuild.config.mjs production` — Verify build succeeds.
5. `rg -i webdis src/ tests/ styles.css` — Check for unwanted leftovers (e.g., if removing features).

---

## 3. Build Production Artifacts

Run the production build:

```bash
npm run build2
```

---

## 4. Commit and Tag

Add all changes, commit the version bump, and create a git tag. The tag MUST NOT start with `v`.

```bash
git add -A
git commit -m "bump to X.Y.Z"
git tag -a X.Y.Z -m "X.Y.Z"
```

---

## 5. Push and Release

### 5.1 Push to Remote

```bash
git push origin master --tags
```

### 5.2 Create GitHub Release

Use the `gh` CLI to create the release and attach the required assets (`main.js`, `manifest.json`, and `styles.css` if applicable).

```bash
gh release create X.Y.Z main.js manifest.json styles.css --title "X.Y.Z" --notes "Release notes"
```
