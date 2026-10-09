# Browser files, file explorer and app top bar — design

Date: 2026-10-09. Status: approved in conversation, awaiting written-spec review.

## Goal

Work stays in the browser instead of bouncing through downloads and uploads. Every app gets a top bar to
switch apps, open a file explorer and go fullscreen. Apps open and save documents in browser storage
through that explorer, and their own AutoSave keeps those files current, like desktop Office does with a
document on disk.

What the user asked for:

- Save, Save As and AutoSave to a browser-storage path, plus downloads when wanted.
- A file explorer to browse that storage and download from it, opened from the dashboard and from every
  app.
- An app's Open always opens the explorer, with an **Open** button. Its Save As asks first whether to keep
  the file in browser storage or download it to the device.
- AutoSave is each app's own feature (e.g. Word's and Excel's AutoSave toggle), not a separate timer of ours.
- A top bar in every app, modeled on ArtCraft One's: an app switcher, the Files popup, fullscreen.
- Patch rules carry enough context for Claude's repairs to keep, move or retire them as upstream changes.

## Decomposition

This is four sub-projects, each with its own spec, plan and build. This spec covers **sub-project 1** in
full. The others are listed so that its contract fits them.

1. **Foundation + Office** (this spec): the store, the explorer (popup, dialogs, Files page), the top bar in
   all 12 apps, and full Save / Save As / Open / AutoSave in Word, Excel and PowerPoint.
2. **Photoshop, Illustrator, InDesign, Acrobat**: the same download + `rfd` + inbox pattern. Photoshop's
   dialogs are already async (`FileDialogReply`). Illustrator's web Save As is an in-app egui dialog.
   InDesign's web "Save a Copy" currently does nothing.
3. **After Effects, Premiere, Lightroom**: these already have their own browser storage and JS APIs
   (`window.effectcraft.saveToBrowser`, `window.filmcraft`, `globalThis.lightcraft.command`). The work is
   pointing them at the shared store and dialogs. Lightroom has no documents: only photo imports, exports
   and backups.
4. **AutoCAD, Pro Tools**: there is no working file I/O in the browser yet. AutoCAD's web Save marks the
   drawing saved and drops the bytes. Pro Tools projects are a `.scraft` JSON file plus `Audio Files/*.wav`
   sidecars.

Until a sub-project lands, its apps keep today's behavior for Open and Save. The top bar and Files popup
still work in them.

## Architecture

Three parts:

1. **Shell** (JavaScript and CSS, written once, in the repo's `shell/` folder). It contains the file store,
   the explorer component, the Open/Save dialogs and the top bar.
   - `make fetch` copies it into the site as shared files (`/shell/…`), so it is cached once for all apps.
   - fetch.mjs's existing `patch()` adds it to each installed app's `index.html`, next to the current
     `playground-prelude` script.
   - fetch.mjs also writes `/shell/apps.json` from tools.yaml plus the installed builds' stamps: groups,
     names, blurbs, icons, release and latest-commit paths and labels.
   - The dashboard gets a Vite page, `/files/`, that uses the same explorer.
2. **App patches** (Rust, per app, in `patches/<slug>.yaml`). They connect each app's file hooks to the
   shell's API.
3. **Patch comments and the repair prompt.** Rules explain themselves so that Claude's repairs keep their
   intent.

## The store

- **Backend:** OPFS (`navigator.storage.getDirectory()`), under a `playground-files/` folder. That keeps it
  apart from Lightroom's library and After Effects' store, which use OPFS on the same origin.
- **Persistence:** call `navigator.storage.persist()` on the first save. The explorer footer states that
  clearing site data deletes the files.
- **Unavailable storage** (e.g. some browsers' private windows block OPFS): the dialogs say "Browser storage
  isn't available in this window" and offer Download only. The explorer shows the same message.
- **App-facing paths:** `browser:/Reports/budget.xlsx`.
  - The `browser:` prefix lets a patch tell store paths from anything else.
  - `Path::file_name` / `extension` still give `budget.xlsx` / `xlsx`, so app titles and format detection
    work unchanged.
- **Writes:** `write(path, bytes)` returns immediately, because app write hooks are synchronous. Writes are
  queued per path, applied in order through `createWritable()`, and parent folders are created as needed.
- **Write failure** (quota, etc.): a toast "Couldn't save budget.xlsx to browser storage" with **Download
  instead**, which holds the bytes. It is also logged to the console.
- **Leaving the page:** `beforeunload` warns while queued writes are pending.
- **Other tabs:** a `BroadcastChannel` tells open explorers in other tabs to refresh. There is no locking:
  the last write wins. That only matters when one file is edited in two tabs at once.

## Shell API (`globalThis.playgroundFiles`)

| Call | Result |
|---|---|
| `open({ types, multiple })` | Explorer in Open mode. Resolves to `[{ path, name, bytes }]`, or `null` on cancel. "From computer…" resolves the same way with `path: null`. |
| `saveAs({ name, types })` | Asks **Keep in browser storage** or **Download to device**. Keep → explorer in Save mode → `{ path }`. Download → `{ download: true }`. Cancel → `null`. |
| `write(path, bytes)` | Queues a store write (see above). |
| `read(path)` | Promise of the file's bytes, for Recent documents and for `?open=`. |
| `download(name, bytes)` | A regular browser download. |
| `onOpen(callback)` | Registered once by an integrated app. The shell calls it with `{ path, name, bytes }` for the page's `?open=browser:/…` (once, at startup) and for **Open in app** on one of this app's files from the Files popup. In an app that hasn't registered (sub-projects 2–4), the shell instead drops the file onto the app's canvas as a synthetic drop, as the existing image-paste fix does; most apps open dropped files. |
| `setUnsaved(unsaved)` | The app's own unsaved state, reported from its frame loop. Once an app reports, the leave warning follows it instead of the input heuristic. |

`types` are extensions without dots, e.g. `['xlsx', 'xlsm', 'csv']`.

## User interface

The shell's interface uses the dashboard's tokens (Geist and Geist Mono, its colors and radii) and follows
the browser's light/dark preference.

### Top bar (all 12 apps)

```
[◐ Playground] [Ps Photoshop ▾]  v0.3.0                          [Files] [⛶]
```

- **Height and layout:** about 36 px. The app's canvas is moved below the bar with injected CSS (`top` and
  `height`). This must be checked per app, because eframe apps size the canvas from its CSS box.
- **Playground** links to the dashboard.
- **App switcher:**
  - Grouped like the dashboard; each entry has the official icon, name, blurb, and a tick on the current
    app.
  - It links to the app's latest-commit build when "Use latest commits" is on (the dashboard's
    `localStorage` key `channel`) and that app has one; otherwise to the release.
  - It navigates in the same tab. Ctrl-click and middle-click open a new tab, because the entries are
    plain links.
- **Leave warning:** if there has been keyboard or pointer input on the app since the last
  `write()`/`open()`, `beforeunload` warns before leaving. This is a heuristic, because the shell can't see
  the app's own unsaved state. Apps that report their own unsaved state (`setUnsaved`, the Office apps) warn
  exactly when they have unsaved changes.
- **Version:** the release label, or `main@abc1234 · 2 hours ago` with an amber dot in latest-commit mode.
- **Files** opens the explorer popup in Browse mode.
- **⛶** toggles `document.documentElement.requestFullscreen()`.

### Explorer

One component, used in three places: the popup in apps, the apps' Open and Save dialogs, and the full-page
`/files/`.

- **Header:** a breadcrumb (`Files › Reports`), **New folder**, **Upload**.
- **Rows:**
  - Folders first, then files: name, size, modified time.
  - Each file shows the icon of the app that opens its type. The extension map comes from apps.json (the
    tools.yaml `opens:` list per app).
- **File actions** (from a row menu, right-click or the keyboard): Open in app, Download, Rename, Delete
  (with a confirmation), and Move (drag a row onto a folder or a breadcrumb segment).
- **Uploads:** drop files from the computer anywhere in the explorer.
- **Keyboard:** Enter opens, Backspace goes up a folder, Delete deletes, Esc closes. Focus stays inside the
  dialog while it is open.
- **Footer by mode:**
  - **Browse:** storage used, plus the "stays until you clear this site's data" note.
  - **Open:**
    - Shows only the app's types, with an "All files" switch.
    - Buttons: **From computer…**, **Cancel**, **Open**.
    - Double-clicking a file opens it.
  - **Save:**
    - Step 1 is the Keep / Download choice.
    - Step 2 is the explorer with **Name**, **Cancel** and **Save**.
    - Saving over an existing file asks "Replace budget.xlsx?".
- **Open in app:** navigates to `/<slug>/?open=browser:/…` (or `/head/<slug>/…` in latest-commit mode).
  Inside an app, a file of that same app is handed to the running app through `onOpen` instead, so other
  documents in Excel or PowerPoint stay open.

### Files page

`/files/` is the explorer full-page in Browse mode, linked as **Files** from the dashboard's top bar.

## Office patches (sub-project 1)

### Behavior in all three apps

- **Save As**, and **Save** on a document without a `browser:` path, show the shell's `saveAs`.
  - Keep → the app saves through its own code with the chosen path, so it serializes, sets the document's
    path and title, and clears the unsaved state, as on desktop.
  - Download → today's download. The document stays without a path, so its next Save asks again and
    AutoSave stays off.
- **Save** on a `browser:` document writes silently to that path through the engine.
- **Open** uses the shell's `open`. The document remembers its `browser:` path (per document in Excel and
  PowerPoint). A "From computer…" file opens as today, without a path.
- **Exports** (PDF, PNG, CSV and the like) stay plain downloads.

### Mechanism

- **Startup block** (in each app's web startup code, `apps/<app>-web/src/web.rs`): creates an mpsc channel
  and wires the app's dormant control receiver (`with_control(rx)`, or `control_rx = Some(rx)`) to it.
- **Save As:**
  - The startup block replaces the app's web Save As / download branch: it calls `playgroundFiles.saveAs`
    via `js_sys` and `wasm_bindgen_futures`.
  - The promise's continuation sends a control request that runs `file.saveAs { path }` (or the app's
    equivalent) through the app's normal dispatcher, then requests a repaint.
- **Engine writes:** the engine's wasm write stub (today an `Err`) calls a hook,
  `static WEB_WRITE: OnceLock<fn(&str, &[u8]) -> Result<(), String>>`, set by the startup block to
  `playgroundFiles.write` for `browser:` paths. Other paths keep returning the existing error. This keeps
  engine crates free of new dependencies.
- **Open:** the app's `open_async` service calls `playgroundFiles.open` instead of `rfd` and pushes
  `(path or name, bytes)` into the app's inbox.
  - For Excel and PowerPoint, the inbox → open path is patched to keep a `browser:` name as the
    document's path. Today both drop it: gridcraft `cmd/file.rs` base64 open, and deckcraft `open_bytes`
    passes `None`.
- **`onOpen`:** the startup block registers a callback that pushes `(path, bytes)` into the inbox. That covers
  `?open=` and Open in app from the popup.

### Per-app patch points

From the survey of upstream at gridcraft fb82389, wordcraft 7584b9b and deckcraft d0e57d7. Line numbers will
drift; the plan re-verifies them.

| | Word (wordcraft) | Excel (gridcraft) | PowerPoint (deckcraft) |
|---|---|---|---|
| Web save branch | `ui-egui/src/lib.rs` `WordApp::run`, the `services.download` branch for `file.save`/`file.saveAs` | `ui-egui/src/lib.rs` `open_dialog("saveAs")` web branch (`services.download` + `file.saveBytes`) | `ui-egui/src/lib.rs` `save_as_dialog` web branch (`services.download`) |
| Engine write stub | `engine/src/io.rs` `save_path` (wasm) | `engine/src/io.rs` `write_file` (wasm) | `engine/src/cmd/file.rs` `write_file` (wasm) |
| Open keeps path | already (`file.open {path: name, data}` sets `s.path`) | `engine/src/cmd/file.rs` `file.open` base64 branch | `engine/src/cmd/file.rs` `open_bytes` → `add_opened(.., None, ..)` |
| Control wiring | `WordApp::with_control(rx)`; `engine.execute` → `app.run` | `app.control_rx = Some(rx)`; `engine.execute` → `app.run` | `with_control(rx)`; `engine.execute` → `app.run` |
| Documents | one | several (`Session.docs`) | several (`Session.docs`) |

### AutoSave

- **Word:**
  - Fix the wasm `now_ms()`, which returns `0.0` in `ui-egui/src/lib.rs`, so the AutoSave timer never fires
    in the browser.
  - Remove the web build's `app.autosave = false`, restoring the desktop default (on).
  - AutoSave calls the engine's `file.save` on the document's path, which reaches the write hook. Only
    `browser:` paths succeed; others fail quietly as today.
- **Excel:** the same `now_ms()` fix. Its AutoSave toggle keeps its default (off).
- **PowerPoint:** has no AutoSave; nothing is added. Its AutoRecover stays off in the browser.

### Recent documents (Word)

A Recent entry with a `browser:` path reopens through `playgroundFiles.read` and the inbox. Other entries keep
today's behavior.

## Patch comments and repairs

- **Each file-storage rule starts with a comment block covering:**
  - its purpose, in user terms;
  - the shell contract it relies on (the call and what the app must do with the result);
  - how to verify it (what to try in the app);
  - what to do if upstream moves the code, or implements the behavior natively. For example: if the app
    already writes `browser:` paths itself, delete this rule.
- **Repair prompt** (`.github/workflows/build.yml`) gains: "Each rule's comment states its purpose and
  contract. Keep that purpose working. If upstream now provides it natively, remove the rule instead of
  forcing it to match."
- **Shared file:** the theme rules and the file rules live in the same `patches/<slug>.yaml`. A repair must
  keep both working on both channels (already required).
- **Failure:** a rule that no longer matches fails the app's build as today. The site keeps that app's last
  good build until Claude or a person repairs it.

## Testing

All in a real browser (Playwright on the local dev server, Chromium with the WebGPU flags already in use),
plus `node scripts/build.mjs check` on both channels.

1. **Save As:** new document, type something, Save As, Keep, pick a folder and name. Then check:
   - the file appears in the explorer with a plausible size;
   - the app title shows the name;
   - the unsaved marker clears.
2. **Save:** edit, press Ctrl+S, and check the stored file changes with no dialog.
3. **AutoSave:** in Word (default on) and Excel (toggle on), edit, wait, and check the stored file updates.
4. **Open:** reload, Open, pick the stored file. Check the contents load and that Save writes back to the
   same path. In Excel and PowerPoint, check this with two documents open.
5. **Download:** Save As → Download produces a download, and the document stays without a path.
6. **`?open=`:** "Open in app" from the Files page opens the file.
7. **Explorer:** upload, download, rename, move, delete, new folder; a second tab refreshes after a change.
8. **Top bar:** in all 12 apps (release and latest-commit builds):
   - the switcher reaches every app;
   - fullscreen enters and exits;
   - the canvas fits below the bar;
   - the theme still follows the browser.
9. **Errors:**
   - a simulated quota failure shows **Download instead**;
   - leaving with a pending write warns;
   - a context without OPFS shows the "isn't available" message with Download only.
10. **Builds:** `check` passes for word, excel and powerpoint on release and head.

## Out of scope for sub-project 1

- Sub-projects 2–4 (the other nine apps' Open/Save integration).
- Exports into browser storage.
- Locking between tabs.
- A trash or undo for deletes.
- Real-disk folders via the File System Access API.
