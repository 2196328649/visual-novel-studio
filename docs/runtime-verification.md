# Ren'Py 8.5.3 Runtime Verification

This document records interfaces checked against the local SDK documentation and
source on 2026-09-07, with application verification on 2026-09-08 and 2026-09-09 local
time. Actual run logs and screenshots are retained under `artifacts`; the small
example fixture below remains a test recipe. The Ren'Py CLI is explicitly not a
stable API between releases, so the application pins and records SDK version 8.5.3.

## Application Verification Results

Run commands from the `visual-novel-studio` directory:

```powershell
pnpm exec tsx scripts/verify-runtime.ts
pnpm exec tsx scripts/verify-save-compatibility.ts
```

Both scripts use the application-owned `resources/runtime`, not the original SDK
installation. They create independent timestamped reports and preserve failed
attempts for inspection.

Runtime run `2026-09-08T15-53-54-316Z` passed compile, lint, 5 gameplay/player-screen
testcases with 43 assertions, development event inspection, release compile,
Windows distribution, package-content checks, and a second 5-testcase/43-assertion
run launched directly through the unpacked package's own EXE. Its report is
`artifacts/runtime-verification/verification/2026-09-08T15-53-54-316Z/report.json`.
The stable latest report is `artifacts/runtime-verification/verification-report.json`.

The exported game is
`artifacts/runtime-distributions/project_rainy_day-1.0.0-win.zip`. Test drivers are
excluded from this ZIP and injected only into disposable unpacked copies under
`artifacts/runtime-unpacked`. Required assets, Chinese font, credits, and SDK
notices are checked; test screenshots, verification logs, and player saves must
not be present in the package. An existing export can be rechecked with
`pnpm exec tsx scripts/verify-runtime.ts --export-only`.

Every editor export now writes `SAMPLE-CREDITS.md` beside `LICENSE-RenPy.txt`.
The file describes the bundled demo media only; it does not claim attribution for
creator-supplied assets. The runtime verification checks this production output.

Save compatibility run `2026-09-08T15-31-29-055Z` passed 24 runtime assertions over
two separate release-mode builds of the example extended with a call/return
fixture. Version 1.0.0 creates two real player saves. Version 1.0.1 rewrites each
saved dialogue line and inserts a line before and after it, retaining all existing
IDs. The new build loads both old saves, displays the revised dialogue, advances
to the new following line, preserves variables, restores the active call stack,
returns from that call, reaches both expected endings, and returns to the menu.

Its report is
`artifacts/save-compatibility/2026-09-08T15-31-29-055Z/report.json`, also copied to
`artifacts/save-compatibility/verification-report.json`. SHA-256 checks prove that
the v1 compiled baseline and both old save files were retained unchanged during
the v2 test. This establishes the tested text-edit and insertion behavior with
stable IDs and Ren'Py 8.5.3. It does not establish compatibility after deleting
IDs, changing variable types, arbitrary graph rewrites, or changing runtime versions.

Development builds emit one UTF-8 stdout line beginning with `VNS_EVENT:` whenever
the current node, line, or variables change at an interaction. The JSON fields are
`nodeId`, `lineId`, and `variables`; the main menu uses null node/line values.
The cache is a function attribute outside rollback-managed store state. The actual
runtime test verifies the sequence affection 1 -> 2 -> 1 -> 0 across native
FileLoad and Rollback. Release builds omit this callback and emit no such events.

## CLI on Windows

Use the SDK's Python executable. `projectRoot` is the directory containing the
`game` directory, not `game` itself. `distribute` is a launcher command; `compile`,
`lint`, `run`, and `test` are project commands.

```powershell
$sdkRoot = 'E:\Tools\renpy-8.5.3-sdk\visual-novel-studio\resources\runtime'
$sdkPython = Join-Path $sdkRoot 'lib\py3-windows-x86_64\python.exe'
$sdkEntry = Join-Path $sdkRoot 'renpy.py'
$projectRoot = 'E:\Tools\renpy-8.5.3-sdk\visual-novel-studio\artifacts\sample'
$testSaves = Join-Path $projectRoot 'tests\saves'

& $sdkPython $sdkEntry $projectRoot compile
if ($LASTEXITCODE -ne 0) { throw 'RenPy compile failed' }
& $sdkPython $sdkEntry $projectRoot lint
if ($LASTEXITCODE -ne 0) { throw 'RenPy lint failed' }
& $sdkPython $sdkEntry --savedir $testSaves $projectRoot test --report-detailed
if ($LASTEXITCODE -ne 0) { throw 'RenPy runtime tests failed' }
```

`--savedir` redirects the user save location, including persistent data, but the
desktop runtime ALSO scans `<projectRoot>/game/saves` (verified in
`renpy/savelocation.py:700`). Use distinct generated project directories for
preview and release. Complete session isolation requires separate game directories
as well as separate `--savedir` values. The verification script archives its own
previous local save directory before testing; it must not touch user projects.

Run one testcase or suite by inserting its name after `test`. Without a name the
`global` suite runs. Useful exact flags are `--enable-all`, `--report-detailed`,
`--report-skipped`, `--hide-execution hooks`, and `--overwrite-screenshots`.
The last flag is for accepting a new image baseline, not normal regression runs.

The local SDK example is `the_question/game/testcases.rpy`. To avoid modifying
the SDK while trying it, copy the example project to an application-owned test
directory first. Ren'Py creates compiled scripts/cache in the project it runs.

These tests run inside the actual game and require a functioning graphics/session
environment. Do not equate a TypeScript compiler test or a successful `lint`
command with a successful runtime test. The test runner returns status 1 when its
reporter records a failure, otherwise 0; also retain the summary and verify that
the intended testcases ran. An empty/skipped suite is not acceptance evidence.

## Minimal Branch, Save/Load, and Rollback Fixture

Place an equivalent fixture in the generated test project. These labels and
variables deliberately avoid depending on the editor's internal runtime model.
The project must provide the ordinary main menu, say, and choice screens.

```renpy
default qa_score = 0

label qa_start:
    "Checkpoint A."
    menu:
        "Accept":
            $ qa_score = 1
            jump qa_accepted
        "Decline":
            jump qa_declined

label qa_accepted:
    "Branch accepted."
    $ qa_score = 2
    "After increment."
    return

label qa_declined:
    "Branch declined."
    return

testsuite global:
    before testcase:
        $ _test.timeout = 5.0
        $ _test.transition_timeout = 0.05
        if not screen "main_menu":
            run MainMenu(confirm=False)

    teardown:
        exit

testcase qa_save_load_rollback:
    run Start("qa_start")
    advance until screen "choice"
    click "Accept"
    assert "Branch accepted."
    assert eval (qa_score == 1)
    screenshot "accepted.png"
    run FileSave("qa_state", confirm=False, slot=True)
    assert eval renpy.can_load("qa_state")
    advance until "After increment."
    assert eval (qa_score == 2)
    run FileLoad("qa_state", confirm=False, slot=True)
    assert "Branch accepted."
    assert eval (qa_score == 1)
    run Rollback() until screen "choice"
    assert eval (qa_score == 0)
    click "Decline"
    assert "Branch declined."
    assert eval (qa_score == 0)
    advance until screen "main_menu"

testcase qa_decline:
    run Start("qa_start")
    advance until screen "choice"
    click "Decline"
    assert "Branch declined."
    assert eval (qa_score == 0)
    advance until screen "main_menu"
```

`run` accepts a screen-language Action or list of Actions. `FileSave` and
`FileLoad` accept `slot=True`, which makes the supplied name the full slot name
and avoids dependence on the current save page. `confirm=False` prevents an
overwrite/load dialog. `Rollback()` only acts when rollback is possible, so the
test must first reach a checkpoint; test variables must use Ren'Py `default`.

`advance` dismisses dialogue; `advance until screen "choice"` waits for a menu.
`click "Accept"` selects matching visible text. Text selectors are case-insensitive
and may match a substring. Prefer a stable `id` selector for application controls
where practical. `assert eval (...)` checks Python/store state; `assert "..."`
checks displayed text. `assert label ...` detects a label reached since the last
test statement, not a persistent current-node value.

For the real generated story, select BOTH sides of each branch and assert its
generated variables, dialogue, and ending. A test that changes the variable itself
only proves the assertion plumbing, not the generated assignment node. Add a
separate UI test that opens the actual save/load screens, clicks a slot, and
returns; direct Actions validate runtime semantics but not button wiring.

## Screenshots

`screenshot "accepted.png"` uses
`<projectRoot>/tests/screenshots/accepted.png` by default. `_test.screenshot_directory`
can change the directory. Paths are relative to the project root plus that
setting. Only PNG is supported.

The first run saves an image. Later runs compare it with an existing baseline.
`max_pixel_difference 100` tolerates 100 differing pixels; `0.01` tolerates a 1%
fraction of image pixels. Exact equality is the default. A crop uses integer
`(x, y, width, height)` coordinates. Revision-aware runs can append `@<hash>` to
filenames. A failed comparison saves the new image and a difference image.

```renpy
screenshot "dialogue.png" crop (0, 500, 1280, 220)
screenshot "stage.png" max_pixel_difference 0.01
```

Make output deterministic: fixed resolution/fonts, no moving caret or animation,
known test state, and a completed transition. A first-run screenshot is an
artifact, not a verified visual baseline. Review it before treating later pixel
comparisons as evidence.

## Windows Distribution

```powershell
$outputRoot = Join-Path $projectRoot 'distributions'
& $sdkPython $sdkEntry launcher distribute $projectRoot --package win --destination $outputRoot
if ($LASTEXITCODE -ne 0) { throw 'Windows distribution failed' }
```

`win` is the built-in Windows ZIP package. `pc` includes Windows AND Linux; it is
not the Windows-only target. `--package` can repeat. `--format` overrides the
archive format, and `--packagedest` sets the output basename when exactly one
package is selected. Prefer the default ZIP format for this target.

The 8.5.3 launcher enumerates some files from other platforms before selecting the
requested package. A reduced Windows SDK must still retain
`lib/py3-linux-x86_64/renpy`, `lib/py3-mac-universal/renpy`, and
`launcher/icon.icns`, or even `--package win` fails. These are build inputs, not a
requirement to ship the complete Linux/macOS runtime in the Windows game.

Preserve generated assets/fonts, SDK notices, and the released `.rpyc` files.
Prior-release `.rpyc` files belong in the matching `old-game` structure for the
next release, for example `v2/old-game/story.rpyc` beside `v2/game/story.rpy`.
Do not add another `game` directory under `old-game`. Stable node IDs alone do
not establish save compatibility.
Generate explicit stable `from` labels on `call` statements. The CLI `add_from`
command modifies scripts, so deterministic generation should emit those labels
directly instead of changing authored data after compilation.

Distribution acceptance includes unzipping the result and starting its EXE from
a directory outside the source project, ideally on a clean Windows environment.
Verify text/font rendering, branching, music, save/load, and return to the main
menu. A ZIP existing on disk is not proof of a runnable export.

## Local Sample Assets and Notices

The SDK root `LICENSE.txt` supplies the Ren'Py runtime terms. The runtime also
contains dependencies with other licenses; retain its supplied notices in game
packages.

The current editor sample uses user-provided 《哀鸿》 media copied by
`scripts/create-sample.ts`; the generated project keeps only project-relative
copies under `resources/example/assets`.

| Role | Source path in provided 《哀鸿》 assets | Attribution evidence |
| --- | --- | --- |
| Backgrounds | 《哀鸿》 `Resources/starveling/texture/bg/东关街忆晴.png`, `茶舍忆昼.png`, `郊外晴.png` | User-provided source tree; see `resources/example/CREDITS.md` |
| Character demonstration images | 《哀鸿》 `Resources/screenshot.png`, `Resources/starveling/texture/thumbnail/琼华离去.png` | User-provided source tree; these are demonstration images, not claimed to be isolated portrait layers |
| Music | 《哀鸿》 `Resources/starveling/sound/BGM/哀鸿_葬花埋香.ogg` | User-provided source tree; see `resources/example/CREDITS.md` |

The 《哀鸿》 assets do not have their licensing terms asserted by this repository.
Keep the supplied source terms and the project credits when redistributing them;
do not relabel them as CC0 or invent a Creative Commons license. The bundled
`LICENSE-RenPy.txt` covers the Ren'Py runtime, not the 《哀鸿》 media.


## Checked Sources

- `doc/cli.html:265`: CLI status/version; `:367`: save directory; `:677`: test;
  `:783`: distribute; `:826`: package selection; `:757`: preserve `.rpyc`.
- `doc/testcases.html:392`: CLI; `:1133`: run Action; `:1385`: eval;
  `:1543`: assert; `:1625`: screenshots; `:1669`: until.
- `the_question/game/testcases.rpy:1`: suite hooks, branches, and screen checks.
- `doc/screen_actions.html:889`: FileLoad; `:958`: FileSave; `:1388`: Rollback.
- `renpy/test/testexecution.py:159`: process exit result.
- `renpy/test/testsettings.py:68`: screenshot directory default.
- `renpy/test/testast.py:1471`: screenshot paths/comparison/difference output.
- `renpy/common/00build.rpy:423`: pc package; `:426`: win package.
- `doc/build.html:461`: old-game and statement identity.
