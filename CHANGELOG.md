# Changelog

## 0.1.5

- Merge upstream AGY bridge 0.1.69 while retaining local continuation and usage customizations.

## 0.1.4

- Update the vendored AGY bridge to upstream 0.1.64 (`2ede7d5`), including first-turn client system-prompt placement, `400` fail-fast on turned-away system prompts, isolated `--gemini-dir` execution, multi-model opening concurrency, `run_command` `toolSummary` collision fix, and startup/sign-in diagnostics.
- Preserve transcript-based model-step usage, independent ACP input/cache counters, and the local tool-result plus assistant-prefill continuation extension.

## 0.1.3

- Update the vendored AGY bridge to upstream 0.1.49, including the November 14 system-prompt compatibility fixes and fail-fast handling of refused turns.
- Invalidate parked sessions when the instructions actually sent to AGY change, so an old session cannot retain a newly rejected identity line.
- Include upstream tool-schema expansion, catalog budgeting, sign-in diagnostics, and MCP commit handling.
- Preserve transcript-based usage accounting, independent ACP input/cache counters, and the local tool-result plus assistant-prefill continuation extension.
- Verify completed tool results through their actual delivery path: committed MCP responses stay in the live session, while fresh sessions receive the replayed results.

## 0.1.2

- Bring the previously deployed 0.1.19-based session and cache fixes into the public repository.
- Port upstream 0.1.21 notice compatibility and 0.1.22 ACP output/thinking correction, while preserving assistant prefills and parallel tool-result safety.
- Port Windows launcher fixes through upstream 0.1.25.
- Retain our transcript model-step accounting: upstream 0.1.20 SQLite accounting and its 0.1.23 follow-up are not integrated.

## 0.1.1

- Preserve the boundary between OpenAI tool results and following user instructions.
- Resume requests containing completed tool results plus inline instructions,
  a follow-up user message, or an assistant prefill. Retire the pending ACP
  turn and replay the completed results with the new instruction once.
- Keep ordinary tool-result continuations on the existing session and reject
  incomplete parallel tool batches without abandoning their pending owner.
- Add regressions against the actual ACP bridge for streaming, JSON, restored
  histories and compaction with tools removed. The isolated AGY fixture executes
  no real model requests.

## 0.1.0

- First public release of the AGY ACP to CLIProxyAPI HTTP adapter.
- Chat Completions and Anthropic Messages, streaming and tool round-trips.
- Client cancellation, SSE keepalive, request limits and private API key checks.
- Two-session launch defaults, portable MCP launcher and advanced Compose template.
- Deterministic CPA integration fixture and protocol tests.
- Preserved upstream MIT bridge licenses, patch notes and file checksums.
