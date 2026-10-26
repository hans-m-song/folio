# Folio branding

The coin design approved on 2026-10-24 uses a navy face, ivory serif F,
gold stepped rim, mint ticks, corrugated edge, and an offset rear coin.

- `public/brand/folio-coin.png`: transparent detailed master for large use.
- `public/brand/folio-mark.svg`: smooth, flat vector header logo, displayed at 32 CSS pixels.
- `public/brand/folio-favicon.svg`: single-coin source for the 16-pixel favicon.
- `public/brand/folio-coin-64.png`: raster export of the smooth header logo.
- `public/favicon-{16,32,48}.png`: raster favicons.
- `public/favicon.ico`: bundled 16, 32 and 48 pixel images.
- `public/apple-touch-icon.png`: 180 pixel touch icon.

Regenerate exports with `node ops/build-favicons.mjs`. The script uses the
canvas dependency already installed through PDF.js. The root document registers
the icons; the application header displays the coin beside Folio.

On 2026-10-25, small-size user review rejected the corrugated rim in both the
favicon and header. These now use smooth vector geometry with no mint ticks or
texture. The 16-pixel export omits the rear coin and enlarges the F; larger
exports retain the paired silhouette. The detailed master remains unchanged.

Actual exported dimensions and small-size appearance were inspected. Type checking,
focused ESLint and whitespace checks passed. The focused header/root test run had
20 passing tests and two failed authentication redirect assertions: tests expect
`to` and `search`, while the implementation uses `href`. Branding edits do not
change authentication logic. Browser acceptance and production activation remain
unverified.

The session could not append to `.agents/log.md` or `.agents/handoff.md` because
those paths are read-only in the workspace sandbox; this document records the
branding checkpoint.

Check-in verification on 26 October 2026 used an isolated staged snapshot with
only branding changes; both header/root suites passed (23 tests). Navigation,
context-pane and authentication changes remained outside that snapshot.
