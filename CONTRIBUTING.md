# Contributing

Thanks for helping. This guide covers setup, conventions and what a pull request needs.

## Setup

See [Quick start](README.md#quick-start). In short: `uv sync` in `backend/` and
`photogrammetry-lib/`, `npm ci` in `viewer/`, then run the API and `npm run dev`.

## Branches and pull requests

- Weekly work: `Wxx-Name` (for example `W05-Ali`); features: a short descriptive name.
- Keep pull requests focused. Describe what changed, why, and how you tested it; add a
  screenshot for UI changes.
- One approving review before merging into `main`.
- CI must be green: API tests, pipeline tests, viewer type check, unit tests, build, and the
  end-to-end suite.

## Before you push

```bash
cd backend && uv run pytest
cd photogrammetry-lib && uv run pytest
cd viewer && npm run check && npm run e2e
```

Python follows the repository `ruff.toml` (`uvx ruff check . && uvx ruff format .`).

## Conventions

- **Viewer API.** The web app talks to the viewer only through `viewer/src/types.ts`. Do not
  import `three` in pages or components; add a method to the viewer instead and document it in
  `viewer/README.md`.
- **Units.** 1 unit = 1 metre (glTF). Pins and measurements are stored in model space.
- **User text** is plain text. Never render it with `dangerouslySetInnerHTML`.
- **Design tokens.** Colours, spacing and radii come from the variables at the top of
  `viewer/src/styles.css`; do not hard-code new colours in components.
- **Accessibility.** Every control needs a visible label or an `aria-label`, a visible focus ring,
  and at least a 44 × 44 px target. Respect `prefers-reduced-motion`.
- **Tests.** New logic comes with a test: pytest for Python, `node --test` for pure TypeScript
  helpers (keep them free of three and React so Node can run them), Playwright for user flows.
- **Commits.** Imperative subject line under 72 characters, body explaining why.
