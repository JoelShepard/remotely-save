---
name: remotely-save-maintenance
description: "Project maintenance workflow for Remotely Save Obsidian plugin. Covers updating AGENTS.md, refreshing docs/, running tests/format, and committing+pushing changes."
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, Task
---

# Remotely Save Maintenance

> Workflow for maintaining AGENTS.md, docs/, and committing changes for the Remotely Save Obsidian plugin.

## When to Use This Skill

Use this skill when the user asks you to:

- Update AGENTS.md with new files, architecture changes, or updated conventions
- Refresh project documentation in `docs/`
- Run the full update, test, format, commit, and push cycle
- Sync the project state (source tree, configs, dependencies) back into AGENTS.md

---

## 1. Update AGENTS.md

AGENTS.md is the project's AI assistant guide. It must reflect the current state of the codebase.

### 1.1 Audit the Codebase

Run an exploration task to compare AGENTS.md against the actual codebase:

```text
- List all files in src/ and its subdirectories (settings/, langs/, sections/)
- List root-level config files (webpack.config.js, esbuild.config.mjs, tsconfig.json, biome.json, etc.)
- List docs/ structure
- List tests/ structure
- Check package.json for new dependencies or scripts
- Note the line count of major source files
- Check for new directories like assets/, .github/, etc.
```

### 1.2 Update Sections

| Section | What to Update |
|---------|----------------|
| Tech Stack | New language features, build tools, runtime changes |
| Key Dependencies | New packages in `dependencies` (not devDependencies) |
| Commands | New npm scripts |
| Key Conventions | New project-wide decisions |
| Architecture → Source Files | New, renamed, or removed files |
| Architecture → Root-level Files | New config files or build artifacts |
| Largest Source Files | Re-rank if line counts changed significantly |
| Guidelines | New rules learned from conventions |

### 1.3 Conventions to Preserve

When updating AGENTS.md, keep these existing conventions:

- `misc.ts` must not depend on any other written code (lowest-level utility)
- Each storage adapter (`fs*.ts`) must not depend on `syncEngine.ts`
- Folders are always represented by a string ending with `/`
- No PRO features — only open-source (free) version
- `src/` is for all source code
- `tests/` is for test files
- `docs/` is for documentation

---

## 2. Refresh docs/

### 2.1 Check for Outdated Content

Look for these common staleness patterns:

- **Stale version numbers**: e.g., "as of Mar 2022", "version >= 0.3.29" — update or remove
- **Wrong file references**: e.g., `sync.ts` instead of `syncEngine.ts`
- **Outdated status claims**: e.g., "mobile still in insider" — this is no longer true
- **Deprecated instructions**: e.g., workarounds for very old Obsidian versions
- **Minimum version references**: The current `minAppVersion` in `manifest.json` is 0.13.21; most users are above old thresholds

### 2.2 Fix Patterns

1. **Version-conditional advice**: If a doc says "for version < X, do Y" and X is several major versions behind, simplify to "all current versions support Z" or remove the fallback.
2. **Date references**: Replace "as of <old date>" with current information or remove the date.
3. **File references**: Ensure all `*.ts` file references match actual file names in `src/`.

### 2.3 Priority of Fixes

| Priority | When to Fix |
|----------|-------------|
| HIGH | Wrong file references, stale factual claims |
| MEDIUM | Old version numbers, outdated workarounds |
| LOW | Cosmetic date references, still-correct statements with old version numbers |

---

## 3. Run Tests and Format

Before committing, always run these commands:

```bash
npm run test        # Run mocha tests
npm run format      # Run biome format check + write
```

If tests fail, fix them. If format produces changes, review and accept them.

---

## 4. Commit and Push

### 4.1 Pre-Commit Checks

```bash
git status          # Check what files have changed
git diff            # Review all unstaged changes
git log --oneline -10  # Review recent commit style
```

### 4.2 Commit Guidelines

- **Never commit unless explicitly asked**
- When asked to commit, follow the project's commit message style (brief, descriptive)
- Group related changes: AGENTS.md + docs updates together
- Do NOT commit build artifacts (`main.js`, `927.main.js`, `node_modules/`)
- Do NOT commit secrets or credentials

### 4.3 Push Guidelines

- Only push if the user explicitly asks
- Check that the branch tracks a remote before pushing
- Use `git push` (not `--force` unless explicitly requested)

---

## 5. Creating This Skill (itself)

If the maintenance skill itself needs updating:

1. Edit `.agents/skills/remotely-save-maintenance/SKILL.md`
2. Update the frontmatter (name, description, allowed-tools) if needed
3. Update any workflow steps that have changed
4. Follow the commit workflow (section 4) to save changes
