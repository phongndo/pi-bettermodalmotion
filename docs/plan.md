# pi-modal-motion plan

## Current state

- Package root mirrors a production pi extension scaffold: TypeScript, ESLint, Prettier, Vitest, CI, release workflow, and a `pi.extensions` manifest.
- `src/index.ts` registers the custom prompt editor on `session_start` and clears it on `session_shutdown`.
- `src/editor/modal-motion-editor.ts` provides the pi-facing modal prompt editor.
- `src/motion/text-buffer.ts` contains headless prompt-buffer helpers for ranges, word motions, line edits, register operations, and pi paste-marker atomicity.

## Modal input behavior

- Start in insert mode.
- `Escape` switches insert mode to normal mode, but first lets pi cancel autocomplete when autocomplete is visible, including fast legacy escape-plus-key input.
- Normal mode has improved cursor semantics: entering normal mode backs up onto the previous character instead of staying past the last character.
- `o` and `O` use pi's native newline handling so cursor placement, undo, and editor rendering stay aligned with the base editor.
- Normal motions include `h`/`j`/`k`/`l`, arrow keys, `0`, `^`, `$`, `w`, `W`, `b`, `B`, `e`, `E`, `ge`, `gE`, `gg`, `G`, and same-line `f`/`t`/`F`/`T` searches with `;`/`,` repeats.
- Counts are supported for motions and operators, including forms like `3w`, `10j`, `2dd`, and `d3w`.
- Operators include `d`, `c`, and `y` with doubled line operations (`dd`, `cc`, `yy`) and common motions (`dw`, `cw`, `d$`, etc.).
- Line/character registers support `p` and `P` paste.
- `x`, `X`, `D`, `C`, `S`, and `Y` provide common normal-mode editing shortcuts.
- Printable unmapped keys and bracketed paste are ignored in normal/operator mode.
- Normal/operator mode blocks pi's native destructive text-editing shortcuts so modal edits remain the only mutation path outside insert mode.
- Pi app shortcuts still pass through explicitly: extension shortcuts, image paste, empty-editor exit, interrupt, registered app actions, and Enter submit.
- Large pi paste markers are treated as atomic cells/ranges so modal motion and delete/change/yank operations cannot split a marker and lose the hidden paste payload.
- The bottom editor border stays minimal, only shows `INSERT` or `NORMAL`, preserves `↓ N more` scroll detail, and intentionally hides operator-pending state.

## Design constraints

- Keep this focused on the prompt input box for now.
- Do not mirror pi's chat scrollback state or implement a fake transcript pane.
- The motion helpers are headless and testable, but the package should not split a standalone library until the adapter boundary proves stable.
- The editor currently uses a guarded compatibility shim to set the underlying pi editor cursor because pi's public editor API exposes `getCursor()` but not `setCursor()`/range editing yet. Supported pi peer versions are pinned to the tested `0.70.x` API line until that boundary is public.

## Future work

1. Harden prompt-buffer operators against more real multiline pi usage.
2. Add more motions and edits: `%`, `r`, `.`, text objects, and search within the prompt.
3. Add user-facing configuration for default mode, status colors, enabled mappings, and reserved keys.
4. Add more regression tests for counts, operators, registers, rendering, undo, paste markers, and autocomplete/escape behavior.
5. Replace the cursor compatibility shim if/when pi exposes native editor range/cursor APIs.
6. Revisit chat visual mode only if pi exposes native scrollback cursor/selection hooks.
