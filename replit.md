# Arm Agent Lab

A private-development robot-arm agent demo for AI engineering and robotics software interviews. See README.md for architecture, commands and evaluation results.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm test` — Vitest tests
- `pnpm eval --mode mock` — headless 16-case evaluation
- No database or login is used. Do not provision a database.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- Simulator: pure TypeScript, shared by server, browser and headless evaluation
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

See README.md for the source map. OpenAPI contracts live in lib/api-spec/openapi.yaml; run codegen after changing them.

## Architecture decisions

Keep the core simulator free of browser and Node dependencies so headless tests, evaluation and the canvas use the same model.

## Product

Live Canvas 2D tabletop arm, server-validated tools, SSE trace, mock/Claude planners, deterministic fault recovery, safety refusals and evaluation UI.

## User preferences

- Do not publish or deploy publicly.
- Do not ask for, request, create or set an API key. Read ANTHROPIC_API_KEY only when already present.
- Use only the official Anthropic SDK and direct API; no Replit AI integrations or managed/proxy AI services.
- Default model must be claude-opus-5-5; adaptive thinking, medium effort, auto tool choice.
- Do not use em dashes in README.md or UI copy.

## Gotchas

Claude results must come from actual Claude runs. Do not fabricate reports or silently label mock results as Claude.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
