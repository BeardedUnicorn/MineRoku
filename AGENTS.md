# Repository Guidelines

See [ARCHITECTURE.md](ARCHITECTURE.md) for the runtime topology, IPC surface, SQLite schema, and Android JNI bridge.

## Project Structure & Module Organization
- Frontend (`src/`): React + TypeScript app. Components in `src/components/`, hooks in `src/hooks/`, Tauri command wrappers in `src/services/rokuClient.ts`, Zustand store in `src/store.ts`, styles in `src/*.css`.
- Backend (`src-tauri/`): Tauri 2 Rust app (`src-tauri/src/{main.rs,lib.rs,commands.rs,background.rs,background_discovery.rs}`), config in `src-tauri/tauri.conf.json`.
- Rust crates (`crates/`): vendored forks. `crates/roku` is the ECP client. `crates/ssdp-client` is the SSDP library used for device discovery: a vendored copy of upstream v2.1.0 carrying Android patches in `src/search.rs` (binds SSDP to `wlan0` to bypass VPNs), so don't swap it for the crates.io release.
- Android (`src-tauri/gen/android/`): Kotlin sources for MediaSession and permissions under `app/src/main/java/com/rokucontroller/remote/`.
- Assets: `public/` (static), `src/assets/` (bundled), icons under `src-tauri/icons/`.
- Tests: colocated as `*.test.tsx` under `src/` with setup in `src/setupTests.ts` and shared helpers in `src/testUtils.tsx`.

## Build, Test, and Development Commands
- Toolchain: Node 26 (`nvm use`, pinned in `.nvmrc`) and pnpm 12 (pinned by `packageManager` in `package.json`).
- `pnpm install` — Install dependencies.
- `pnpm tauri dev` — Run desktop app with hot reload (frontend + Rust backend).
- `pnpm dev` — Run Vite dev server for frontend-only.
- `pnpm build` — Type-check (`tsc`) then build frontend for production.
- `pnpm tauri build` — Build/bundle the desktop app.
- `pnpm test` — Run Vitest with coverage (text + HTML report).
- Rust: `cargo check -p roku-controller` (Tauri crate) and `cargo test -p roku` (ECP XML parsing tests) from `src-tauri/`; `cargo test` from `crates/ssdp-client/` (vendored crate).

## Coding Style & Naming Conventions
- TypeScript strict mode; prefer explicit types at boundaries.
- Indentation: 2 spaces; avoid trailing whitespace.
- React components: PascalCase (`RemoteControl.tsx`), hooks `useX` camelCase.
- Tests: filename `ComponentName.test.tsx`; use Testing Library queries by role/text.
- Rust: snake_case for functions/modules; keep commands in `src-tauri/src/commands.rs` small and async where appropriate.

## Testing Guidelines
- Framework: Vitest + Testing Library (jsdom). Setup in `vite.config.ts` and `src/setupTests.ts`.
- Write user-centric tests (roles/labels, not implementation details).
- Run `pnpm test` locally; ensure coverage does not regress for changed areas.
- Mock Tauri APIs via existing mocks in `src/setupTests.ts`.

## Commit & Pull Request Guidelines
- Commits: short, imperative subject (“Fix test selectors”); scopes optional (e.g., `test:` seen in history). Conventional Commits welcome (`feat:`, `fix:`).
- PRs: include description, linked issues, reproduction steps, and screenshots/gifs for UI changes.
- Requirements: all tests pass (`pnpm test`), app runs (`pnpm tauri dev`), and relevant docs updated (README/this file).
- After finishing your assigned work, commit your changes to git before you sign off.

## Security & Configuration Tips
- Do not commit secrets. Roku ECP typically uses port 8060; SSDP uses UDP 1900.
- For remote dev, `TAURI_DEV_HOST` in `vite.config.ts` can enable HMR over network.
- Android build prerequisites: see `setup-env.sh` for installing pnpm/SDK/NDK/JDK 17.
