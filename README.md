# pi-modal-motion

A [pi](https://pi.dev) extension package for experimenting with Vim-inspired modal editing and richer motion ergonomics in pi's input editor.

This scaffold starts from pi's `modal-editor.ts` example and turns it into a package-shaped extension so the idea can grow with tests, CI, release packaging, and a clearer module layout.

## Install

Install from npm:

```bash
pi install npm:pi-modal-motion
```

Install directly from GitHub:

```bash
pi install git:github.com/phongndo/pi-modal-motion
```

Install a pinned GitHub release/tag:

```bash
pi install git:github.com/phongndo/pi-modal-motion@v0.1.0
```

Try without installing from this checkout:

```bash
pi -e .
```

When loaded in interactive pi, the extension replaces the prompt editor with the Modal Motion editor.

## Modal input behavior

- `Escape`: insert mode → normal mode; cancels autocomplete first when it is open
- `i` / `a` / `I` / `A`: enter insert mode before/after cursor or at line start/end
- `o` / `O`: use pi's native newline handling to open a prompt line below/above and enter insert mode
- `h` / `j` / `k` / `l`, arrow keys, `0`, `^`, `$`, `gg`, `G`: normal-mode navigation
- `w` / `W` / `b` / `B` / `e` / `E` / `ge` / `gE`: word motions
- `f` / `t` / `F` / `T`, `;`, `,`: same-line character search motions and repeats
- counts such as `3w`, `10j`, `2dd`, and `d3w`
- operators: `dd`, `dw`, `d$`, `cc`, `cw`, `yy`, plus `D`, `C`, `Y`
- register paste with `p` / `P` for characterwise and linewise yanks/deletes
- `x` / `X`: delete character forward/backward in normal mode
- printable unmapped keys and bracketed paste are ignored in normal/operator mode
- normal/operator mode blocks pi's native destructive text-editing shortcuts so edits stay under modal/register control
- large pi paste markers are treated as atomic cells so modal edits do not corrupt hidden paste payloads
- app-level shortcuts such as `ctrl+c`, empty-editor `ctrl+d`, Enter submit, model/thinking shortcuts, image paste, and extension shortcuts still pass through
- the bottom editor border stays minimal, shows `INSERT` or `NORMAL`, and preserves pi's scroll indicators when prompt content is hidden

## What is included

- TypeScript-based pi extension package layout
- strict TypeScript config for editor/LSP-friendly checks
- ESLint + Prettier setup
- **Vitest** test suite with coverage support
- GitHub Actions for CI and release packaging
- package manifest with a `pi.extensions` entry that loads `./src/index.ts`
- editor module ready for future modal motion experiments

## Repo layout

```text
.
├── .github/workflows/   # CI + release automation
├── docs/                # planning notes and future docs
├── src/
│   ├── config/          # placeholder for future configuration modules
│   ├── editor/          # Modal Motion editor implementation
│   ├── motion/          # prompt-buffer motion/operator helpers
│   ├── runtime/         # placeholder for future extension orchestration
│   └── index.ts         # pi extension entrypoint
└── test/
    └── fixtures/        # placeholder golden/regression fixtures
```

## Local development

```bash
npm install
npm run check
```

### Load it in pi

```bash
npm run dev:pi
```

Then use pi normally. The prompt editor should show an `INSERT`/`NORMAL` indicator in the bottom border.

## Scripts

- `npm run format` — format the repo
- `npm run format:check` — verify formatting
- `npm run lint` — run type-aware linting
- `npm run typecheck` — run TypeScript no-emit checks
- `npm run test` — run the Vitest suite
- `npm run test:coverage` — run Vitest with coverage
- `npm run check` — run formatting, lint, type, and test checks
- `npm run pack:check` — verify the package can be packed cleanly
- `npm run ci` — local CI-equivalent pipeline
- `npm run dev:pi` — load the package directly into pi

## CI/CD

### CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
It installs dependencies, runs the full quality pipeline, and verifies that `npm pack` succeeds.

### CD

`.github/workflows/release.yml` runs on `v*` tags and on manual dispatch.
It re-validates the package, publishes tagged releases to npm through trusted publishing, builds a package tarball, uploads it as a workflow artifact, and attaches it to a GitHub release when triggered by a tag. npm must have a trusted publisher configured for `phongndo/pi-modal-motion` and `release.yml`.

## Next steps

Next work should add user configuration for default mode/colors/keymaps, broaden edit commands and text objects, and keep adding integration tests around pi editor invariants.
