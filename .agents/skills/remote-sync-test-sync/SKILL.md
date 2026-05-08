---
name: remote-sync-test-sync
description: "Sync the built plugin to the local test vault at ~/Documenti/TestVault."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# Remote Sync Test Vault Sync

> Workflow for building the Remote Sync plugin and syncing it to a local Obsidian test vault for immediate testing.

## When to Use This Skill

Use this skill when the user asks you to:

- Sync the latest changes to their test vault
- Deploy the plugin for local testing in Obsidian
- "Update the test vault" or "Sync to TestVault"

---

## 1. Build the Plugin

Before syncing, ensure you have the latest build artifacts.

```bash
npm run build       # Webpack production build
```

Alternatively, if the user is in a development cycle and prefers `esbuild`:

```bash
npm run build2      # Esbuild production build
```

Verify that `main.js` has been updated in the root directory.

---

## 2. Prepare the Destination

Ensure the target directory in the test vault exists. The default path is:
`~/Documenti/TestVault/.obsidian/plugins/remote-sync/`

```bash
mkdir -p ~/Documenti/TestVault/.obsidian/plugins/remote-sync/
```

---

## 3. Sync Artifacts

Copy the required files to the test vault.

```bash
cp main.js manifest.json styles.css ~/Documenti/TestVault/.obsidian/plugins/remote-sync/
```

*Note: If `styles.css` is not modified or doesn't exist in a build, `main.js` and `manifest.json` are the bare minimum.*

---

## 4. Verification

Confirm the files were copied successfully and show their timestamps to the user.

```bash
ls -lh ~/Documenti/TestVault/.obsidian/plugins/remote-sync/
```

---

## 5. Troubleshooting

- **Permissions**: If copying fails, check write permissions on the `~/Documenti` directory.
- **Missing Build**: If `main.js` is missing, ensure `npm install` was run and the build command succeeded.
- **Obsidain Detection**: Remind the user they may need to toggle the plugin off and on (or restart Obsidian) for changes to take effect.
