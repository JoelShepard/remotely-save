# PDR — Settings Dashboard Rework

> **Product Definition Requirement**
> Date: 2026-05-20
> Status: Draft
> Author: AI-assisted analysis

---

## 1. Executive Summary

The current settings dashboard is a flat list of sections under a single `PluginSettingTab`. As the plugin has grown, the number of settings has proliferated without a coherent organizational structure. Users (especially less technical ones) find it overwhelming, while power users have to scroll through irrelevant sections to find the one toggle they need. This PRD proposes a redesigned settings dashboard that groups settings by user intent, provides inline guidance, and uses modern UI patterns (collapsible groups, contextual help, search) to make configuration intuitive.

---

## 2. Current State Analysis

### Current Settings Structure

```
RemotelySaveSettingTab
├── Service Selector (S3 / WebDAV) — visual cards
├── Basic settings (auto-sync, on-save, status bar, etc.)
├── Advanced settings (concurrency, skip size, ignore/allow paths, etc.)
├── Encryption settings (password, method)
├── S3-specific settings (bucket, region, endpoint, credentials, etc.)
├── WebDAV-specific settings (URL, auth, etc.)
├── Import/Export (QR code, config files)
├── Debug (log level, export, reset)
└── Logs (in-app log viewer)
```

### Key Pain Points

1. **No information hierarchy** — All settings have equal visual weight. Critical settings (service type, password) look the same as rarely-used toggles (obfuscate setting file, reset cache).
2. **Service-specific vs general confusion** — S3 and WebDAV sections are always visible, even when the other service type is selected. Users can accidentally configure the wrong backend.
3. **Hidden developer options** — The debug section's developer-only features are gated by `showDeveloperOptions`, which itself is hidden unless the user knows to enable it via the console.
4. **No contextual help** — Settings have `setName()` and `setDesc()`, but there's no way to get richer documentation (example values, troubleshooting links).
5. **No search** — Users must scroll through all sections to find a specific setting. With ~50 individual settings, this is cumbersome.
6. **No validation feedback** — When a user enters an invalid S3 endpoint URL or a misspelled bucket name, the error only surfaces during sync, not at configuration time.
7. **No visual grouping** — `SettingGroup` is used in the code but the visual result is still a flat list of rows with no visual hierarchy beyond heading text.
8. **Password management UX** — The password field uses a custom eye-toggle, but there's no "confirm password" or "password strength" indicator.
9. **Mobile experience** — The settings page is not optimized for mobile screens; cards and dropdowns can overflow.
10. **No service testing** — After configuring S3 or WebDAV, there's no "Test connection" button. Users must start a sync to verify their configuration.

---

## 3. Proposed Solutions

### 3.1 Solution A — Tab-Based Navigation

**Goal:** Replace the single scrolling page with a tabbed interface that logically groups settings by user intent.

**Proposed tab structure:**

```
┌─────────────────────────────────────────────────────┐
│ 🔌 Connection  │ 🔄 Sync  │ 🔒 Security  │ ⚙️ Advanced │
└─────────────────────────────────────────────────────┘
```

**Tab contents:**

| Tab | Sections | Target audience |
|-----|----------|-----------------|
| **Connection** | Service selector (S3/WebDAV cards), service-specific config (dynamic), Test connection button | All users — first setup |
| **Sync** | Auto-sync timer, sync on save, sync direction, conflict action, ignore/allow paths, skip files larger than, sync config dir/bookmarks | All users — day-to-day tuning |
| **Security** | Password, encryption method, obfuscate setting file, encryption migration info | Users who need encryption |
| **Advanced** | Concurrency, log level, debug tools (export sync plans, reset prevSync, reset cache), profiler, logs viewer, import/export config, status bar customization | Power users, debugging |

**Implementation details:**

- Use Obsidian's built-in `SettingTab` with sub-tabs — either via a custom tab bar at the top, or by collapsing/expanding sections based on a tab-like selector.
- Each tab saves its state (which tab was active) so the user returns to the same view after closing/reopening settings.
- A URL-like hash in the settings state could enable direct linking (e.g., `settings://connection`).

**Estimated effort:** 6–8 hours
**Risk:** Medium — significant UI refactor, but the underlying settings model stays the same.

### 3.2 Solution B — Dynamic Service-Specific Sections

**Goal:** Only show the configuration section for the currently selected service type, reducing visual clutter.

**Implementation:**

- When `serviceType === "s3"`, hide the entire WebDAV config section and vice versa.
- When switching service type, show a brief animated transition and a confirmation if there are unsaved changes.
- Add a small "Switch to [other service]" link at the bottom of the active config section for power users who need to reconfigure the other backend.

**Current behavior:** Both S3 and WebDAV sections are rendered. The `display()` method rebuilds the entire settings page on each call. This means both sections are in the DOM.

**New behavior:** In `display()`, check `serviceType` and only build the relevant section. The inactive service config is not rendered, which also speeds up the `display()` call.

**Estimated effort:** 2 hours
**Risk:** Low — pure UI conditional rendering.

### 3.3 Solution C — Inline Validation & Connection Test

**Goal:** Validate configuration at input time and allow users to test connectivity before running a full sync.

**Implementation:**

1. **S3 validation rules:**
   - `s3Endpoint` — must be a valid URL (http/https). Add `inputEl.setCustomValidity()` on blur.
   - `s3BucketName` — must match DNS naming rules (lowercase, no underscores, 3-63 chars).
   - `s3AccessKeyId` / `s3SecretAccessKey` — must be non-empty. Optionally validate format (Access Key: 20 alphanumeric chars).
   - `s3Region` — must be a valid AWS region format or custom value.

2. **WebDAV validation rules:**
   - `webdavUrl` — must be a valid URL. Check for trailing slash consistency.
   - Auth fields — must be non-empty if Basic/Digest auth is selected.

3. **Connection test:**
   - Add a "Test Connection" button in each service config section.
   - On click, create a lightweight `FakeFsS3` / `FakeFsWebdav` instance and attempt:
     - S3: `HeadBucketCommand` or `ListObjectsV2` with max-keys=1
     - WebDAV: `getDirectoryContents` on the remote base dir
   - Show a success/failure notice with details:
     - ✅ Connection successful (ping: 45ms)
     - ❌ Connection failed: Bucket does not exist
     - ❌ Connection failed: Invalid credentials (HTTP 403)
     - ❌ Connection failed: Endpoint unreachable (ECONNREFUSED)
   - Cache the test result until the next config change.

4. **Password confirmation:**
   - Add a "Confirm password" field for the encryption password
   - Show inline mismatch warning before the user leaves the field
   - This prevents accidental lockouts due to typos

**Estimated effort:** 4–5 hours
**Risk:** Low — self-contained validation logic, no sync engine changes.

### 3.4 Solution D — Settings Search

**Goal:** Let users find any setting by keyword, regardless of which tab or section it's in.

**Implementation:**

1. Add a search input at the top of the settings page (inspired by Obsidian's own Settings search).
2. When the user types, filter visible settings to only those whose `setName()` or `setDesc()` matches the query (case-insensitive).
3. Highlight matching text in the results.
4. If using tabs (Solution A), search across all tabs and show results with a tab indicator.

**Implementation in existing code:** The `display()` method currently rebuilds all settings every time. A search filter would either:
   - Rebuild with only matching settings, or
   - Hide non-matching DOM elements via CSS (`display: none`)

The CSS approach is simpler and preserves scroll position.

**Estimated effort:** 2–3 hours
**Risk:** Low

### 3.5 Solution E — Collapsible Setting Groups

**Goal:** Allow users to collapse/expand sections to reduce visual noise.

**Implementation:**

- Wrap each `SettingGroup` in a collapsible container with a clickable header.
- Use `setting.setHeading()` for the header, with an added collapse toggle icon (chevron).
- Persist collapsed state per-group in `plugin.settings` (a `collapsedGroups: Record<string, boolean>` map).
- Default: all groups expanded. Users collapse the ones they don't use frequently.

**Estimated effort:** 2 hours
**Risk:** Low — pure UI change.

### 3.6 Solution F — Mobile-Responsive Layout

**Goal:** Ensure the settings dashboard works well on small screens.

**Implementation:**

- Review and fix CSS in `styles.css` for the settings tab:
  - Service selector cards should stack vertically on narrow screens
  - Long dropdowns should not overflow
  - Text inputs should use full width
  - Button labels should truncate gracefully
- Test on iOS and Android (Obsidian mobile)
- Add media queries if needed

**Estimated effort:** 1–2 hours
**Risk:** Low — CSS only.

---

## 4. Implementation Roadmap

### Phase 1 — Foundation (next release)

| # | Task | Effort | Risk |
|---|------|--------|------|
| 1B | Dynamic service-specific sections (hide irrelevant config) | 2h | Low |
| 1C | Inline validation for S3 and WebDAV fields | 3h | Low |
| 1F | Mobile-responsive CSS fixes | 1h | Low |
| 1E | Collapsible setting groups | 2h | Low |

### Phase 2 — UX improvements (next + 1 release)

| # | Task | Effort | Risk |
|---|------|--------|------|
| 2A | Tab-based navigation | 8h | Medium |
| 2D | Settings search | 3h | Low |
| 2C | Connection test button + modal | 4h | Low |
| 2C | Password confirmation field | 1h | Low |

### Phase 3 — Polish

| # | Task | Effort | Risk |
|---|------|--------|------|
| 3A | Tab state persistence (remember active tab) | 1h | Low |
| 3C | Validation error suggestions ("Did you mean...?") | 2h | Low |
| 3E | Settings search across tabs with tab-hopping | 2h | Low |

---

## 5. Risks & Considerations

| Risk | Mitigation |
|------|------------|
| **Tab-based navigation breaks muscle memory** — Existing users know where settings are. | Keep tab labels short and descriptive. Add a "Classic view" toggle in Advanced that restores the flat layout. |
| **Connection test could be abused** — Frequent test clicks could hit rate limits on S3. | Debounce: only allow one test per 10 seconds. Cache result for 60 seconds. |
| **Validation rules may be too strict** — Some S3-compatible providers use non-standard formats. | Make all validation a warning, not a blocker. Show yellow warning icon, not red error. Allow user to proceed. |
| **Mobile performance** — Adding tabs + search + collapsible groups could slow down initial render on mobile. | Lazy-render sections that are not visible. Use `requestAnimationFrame` for heavy DOM updates. |

---

## 6. Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Time to configure a new S3 connection | ~3 min (scrolling, guesswork) | ~1 min (guided, testable) |
| Password typo incidents | Unknown (user reports of lockouts) | Zero (confirmation field catches mismatches) |
| Setting discovery (can user find "ignore paths"?) | ~30 sec scan | ~5 sec (search or logical tab) |
| Mobile settings usability | Some fields overflow | All fields fit viewport without zoom |
| Accidental WebDAV config when using S3 | Possible (both visible) | Impossible (only active service shown) |

---

## 7. Open Questions

1. **Should tabs be native Obsidian `SettingTab` sub-tabs or custom HTML?** Custom HTML gives more flexibility but may break with Obsidian theme updates. Native approach is more maintainable. Investigate if Obsidian supports sub-tabs natively (or if there's a community convention).

2. **Should the connection test be synchronous or async in the UI?** Async with a loading spinner and a progress indicator ("Testing S3 connection..."). The button should be disabled during the test.

3. **Should we pre-fill common defaults for S3 providers?** For popular providers (Backblaze B2, Cloudflare R2, MinIO), we could offer a dropdown of presets that fill in the endpoint, region, and service type. This would be a future enhancement.

4. **Should settings search index custom labels from i18n?** Yes — the search should match translated strings, not just the English setting names. This requires the search to work against the i18n keys or the rendered text content.
