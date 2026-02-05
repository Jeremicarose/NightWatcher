# Nightwatch

A self-healing CI/CD agent that autonomously detects failed GitHub Actions builds, diagnoses root causes with Gemini, reproduces failures in Docker sandboxes, generates regression tests, proposes fixes, and opens pull requests — all without human intervention.

**Track:** The Architect (Agent Coding) — Self-Healing Systems & DevOps
**Hackathon:** AGENTIC 3.0 by Vetrox

---

## What is Nightwatch

Nightwatch is an autonomous CI/CD repair agent. It listens for GitHub Actions workflow failures via webhooks, fetches and analyzes the build logs using Gemini, clones the repository at the exact failing commit, reproduces the failure inside an isolated Docker container, and then enters a fix loop: generate a patch, apply it, run the test suite, and verify. If the fix passes, Nightwatch opens a pull request with both the patch and a new regression test. If three attempts fail, it opens a detailed escalation issue for a human to pick up. The entire pipeline runs end-to-end with zero manual interaction.

The core philosophy is **fix forward, don't roll back**. Most CI recovery strategies involve reverting the offending commit and triaging later. Nightwatch takes the opposite approach: it treats every failure as a chance to improve the codebase. A successful Nightwatch run leaves the repository in a strictly better state than before the failure occurred, because every fix is accompanied by a regression test that did not previously exist. The codebase gains coverage as a direct side effect of breaking.

Nightwatch is not a monitoring dashboard or an alerting tool. It is an agent that performs the same sequence of actions a senior engineer would — read the logs, form a hypothesis, reproduce locally, write a test, fix the code, verify, and submit a PR — but it does so in minutes, at any hour, without context-switching overhead.

## Philosophy of Design

### Fix forward, don't roll back

Rollback is a concession. It restores availability, but it abandons information. The failure happened for a reason, and that reason is still encoded in the commit that was reverted. Someone still has to debug it later, and by then the context is cold. Nightwatch treats the failure as a live signal and acts on it immediately. The result is a forward-moving fix: a patch that addresses the root cause while the stack trace is still warm and the failing commit is still the HEAD.

### Leave artifacts

Every Nightwatch fix ships with a regression test. This is a deliberate design constraint, not a convenience feature. The test is generated before the fix is attempted, and the fix loop verifies against it. This means the codebase gains a new test case for every bug that Nightwatch resolves. Entropy is reversed: the same failure cannot recur silently. Over time, the test suite becomes a historical record of every production-path edge case the system has encountered.

### Know your limits

Nightwatch operates with bounded autonomy. It attempts a fix up to three times. Each iteration receives the full context of all previous failed attempts, so Gemini can try a different approach rather than repeating the same mistake. If all three attempts fail, Nightwatch stops, opens a GitHub issue with its complete analysis (error type, stack trace, file location, and a summary of what it tried), and escalates to a human. It also escalates immediately when its analysis confidence is below 30%. This is not a fallback — it is a first-class behavior. An agent that does not know when to stop is more dangerous than one that never starts.

### Gemini as a reasoning engine, not a chatbot

Nightwatch uses Gemini at three distinct points in the pipeline: log analysis, test generation, and fix generation. In each case, Gemini receives a tightly scoped prompt with structured output requirements (JSON schema for analysis, raw Python for tests, JSON with exact code spans for fixes). The temperature is set to 0.1-0.2 to prioritize consistency over creativity. There is no conversational context, no memory across calls, and no open-ended generation. Gemini is treated as a deterministic reasoning function: structured input in, structured output out.

### No UI — invisible architecture

Nightwatch has a lightweight dashboard for observability, but its primary interface is a webhook endpoint and the pull requests it creates. The design assumption is that the best CI agent is one that engineers never have to think about. It installs as a GitHub App, receives events passively, and surfaces its work through the artifacts developers already review: PRs and issues. There is no CLI to invoke, no button to click, no approval flow to manage.

### Assumptions questioned

The central assumption Nightwatch challenges is that **CI failures require human debugging**. The conventional workflow is: CI fails, a developer gets notified, they read the logs, reproduce locally, write a fix, push, and wait for CI again. This loop takes 30 minutes to several hours depending on the developer's availability and the complexity of the failure. For a large class of common errors — missing null checks, incorrect imports, type mismatches, off-by-one errors — the diagnosis-to-fix path is mechanical and predictable. Nightwatch automates exactly that class.

A second assumption questioned is that **automated fixes are unsafe**. Nightwatch mitigates this through three mechanisms: Docker sandbox isolation (the fix is verified in a clean environment before any PR is created), regression test generation (the fix must pass a test that the original code fails), and bounded attempts (the agent cannot iterate indefinitely). The PR still requires human review before merge. Nightwatch does not deploy — it proposes.

## How It Works

Nightwatch runs a six-stage pipeline for every CI failure:

```
GitHub Actions
  CI fails on push
       |
       v
  [1] Webhook Received
       Nightwatch receives workflow_run.completed event
       Filters: only action=completed, conclusion=failure
       |
       v
  [2] Fetch & Analyze Logs
       Downloads the Actions log archive (zip)
       Scores jobs by error density to find the failing job
       Sends truncated logs to Gemini for structured analysis
       Output: error type, file path, line number, stack trace, confidence
       |
       v
  [3] Reproduce in Docker
       Clones repo at the exact failing SHA
       Spins up a python:3.11-slim container
       Installs dependencies, runs pytest
       Confirms the failure reproduces (exit code != 0)
       |
       v
  [4] Generate Regression Test
       Reads the source file and any existing tests
       Gemini generates a minimal pytest function
       Test is inserted into the test suite before fixing
       |
       v
  [5] Fix Loop (max 3 attempts)
       Gemini proposes a minimal code patch (JSON with exact spans)
       Patch is applied via string replacement
       Tests run in a fresh Docker container
       If tests pass -> proceed to PR
       If tests fail -> revert patch, feed error back to Gemini, retry
       |
       v
  [6] Create PR or Escalate
       Success: opens PR with fix + regression test + explanation
       Failure: opens GitHub issue with full analysis and attempt history
```

## Architecture

```
src/
  index.ts                  Express server, API endpoints, health check
  types.ts                  TypeScript interfaces for the entire pipeline

  webhook/
    handler.ts              Receives GitHub webhook, filters for failed runs
    validator.ts            HMAC signature validation

  agents/
    analyzer.ts             Gemini-powered log analysis -> structured FailureAnalysis
    test-generator.ts       Gemini-powered regression test generation
    fixer.ts                Gemini-powered fix generation, apply/revert logic

  sandbox/
    runner.ts               Clone repo, reproduce failure, run tests in Docker
    docker.ts               Dockerode wrapper (create/exec/remove containers)
    cleanup.ts              Container and temp directory cleanup

  fix-loop/
    orchestrator.ts         Main pipeline: steps 1-6, state transitions, error handling

  github/
    logs.ts                 Fetch and parse Actions log archives (zip -> text)
    pr.ts                   Create fix PRs and escalation issues via Octokit
    app-auth.ts             GitHub App JWT auth with installation token caching

  db/
    schema.sql              SQLite schema: failures, fix_attempts, generated_tests
    client.ts               Database operations (create, update, query)

  utils/
    logger.ts               Structured logging with component tags
```

## Tech Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20 | Server and orchestration |
| Language | TypeScript | Type safety across the pipeline |
| Web Framework | Express 5 | Webhook endpoint and API |
| AI Model | Gemini 2.5 Flash | Log analysis, test generation, fix generation |
| Container Engine | Docker (Dockerode) | Isolated test reproduction and verification |
| GitHub Integration | Octokit | REST API, webhook validation, PR/issue creation |
| GitHub Auth | @octokit/auth-app | GitHub App JWT + installation tokens |
| Database | SQLite (better-sqlite3) | Failure tracking, fix attempt history |
| Git Operations | simple-git | Clone repos at specific SHAs |
| Log Parsing | adm-zip | Extract GitHub Actions log archives |

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (must be running)
- A Gemini API key
- A GitHub personal access token or GitHub App credentials

### Installation

```bash
git clone https://github.com/Jeremicarose/NightWatcher.git
cd NightWatcher
npm install
```

### Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

Required variables:

```env
GEMINI_API_KEY=your_gemini_api_key
GITHUB_TOKEN=your_github_token
```

Optional variables:

```env
WEBHOOK_SECRET=your_webhook_secret      # Recommended for production
PORT=3000                                # Default: 3000
LOG_LEVEL=info                           # debug | info | warn | error
GITHUB_APP_ID=your_app_id               # Alternative to GITHUB_TOKEN
GITHUB_PRIVATE_KEY_PATH=./private-key.pem
```

### Run

```bash
# Development (hot reload)
npm run dev

# Production
npm run build
npm start

# Docker
docker compose up -d
```

### Register the Webhook

1. Go to your GitHub repository Settings > Webhooks
2. Set the Payload URL to `https://your-server.com/webhook`
3. Set Content type to `application/json`
4. Set the secret to match your `WEBHOOK_SECRET`
5. Select the **Workflow runs** event
6. Save

Alternatively, register Nightwatch as a GitHub App with `workflow_run` event permissions.

## Demo

The repository includes a `demo-repo/` directory containing an intentionally buggy Python project. The `user_service.py` module has a missing null check in `send_notification()` that causes a `TypeError` when called with a non-existent user ID. The test suite includes test cases that expose this bug.

To test Nightwatch end-to-end:

1. Fork this repository (or push the `demo-repo/` contents to a separate repo with GitHub Actions enabled)
2. Ensure the CI workflow (`.github/workflows/ci.yml`) is active
3. Point the webhook at your running Nightwatch instance
4. Push a commit to trigger CI — the tests will fail
5. Nightwatch will detect the failure, analyze it, generate a regression test, fix the null check, and open a PR

The expected fix adds a guard clause to `send_notification()` that returns `False` when `user` is `None`, and the generated regression test verifies this behavior.

## Track Alignment

Nightwatch is built for **The Architect** track: Self-Healing Systems & DevOps.

The track brief describes:

> "An agent that monitors a GitHub repository, identifies a bug from a log file, reproduces it, writes a test case, fixes the code, and deploys the patch — all without human input."

Here is how each requirement maps to the implementation:

| Track Requirement | Nightwatch Implementation |
|---|---|
| Monitors a GitHub repository | Webhook listener filters `workflow_run` events with `conclusion: failure` |
| Identifies a bug from a log file | `analyzer.ts` sends CI logs to Gemini, extracts structured `FailureAnalysis` (error type, file, line, stack trace) |
| Reproduces it | `runner.ts` clones the repo at the failing SHA, runs `pytest` in a `python:3.11-slim` Docker container |
| Writes a test case | `test-generator.ts` generates a minimal pytest regression test via Gemini, inserts it into the test suite |
| Fixes the code | `fixer.ts` generates a minimal patch via Gemini, `orchestrator.ts` runs a verify loop (up to 3 attempts) |
| Deploys the patch | `pr.ts` creates a GitHub PR with the fix, regression test, and full explanation (deployment is left to the repository's existing CI/CD) |
| All without human input | The entire pipeline is triggered by webhook and runs autonomously; human review happens at the PR stage |

## What Nightwatch Handles

### Supported Error Types

- `TypeError` — null/undefined access, wrong argument types
- `ImportError` / `ModuleNotFoundError` — missing or misnamed imports
- `AttributeError` — accessing non-existent attributes
- `AssertionError` — test assertion failures
- `SyntaxError` — basic syntax issues
- `NameError` — undefined variable references
- `ValueError` — incorrect value handling
- `KeyError` — missing dictionary keys

### Current Scope

- **Language:** Python (pytest)
- **CI Platform:** GitHub Actions
- **Fix Strategy:** Minimal single-file patches (string replacement)
- **Auth:** GitHub personal access tokens or GitHub App installation tokens

### Out of Scope (currently)

- Multi-file fixes
- Build/infrastructure failures (e.g., Docker image pull errors)
- Flaky tests (non-deterministic passes/failures)
- Languages other than Python

## Roadmap

- **Multi-language support** — extend to JavaScript/TypeScript (Jest), Go, and Rust
- **Flaky test detection** — identify non-deterministic failures and skip the fix loop
- **Multi-file fixes** — support patches that span multiple source files
- **GitLab and Bitbucket** — webhook adapters for other CI platforms
- **Security patching** — detect and fix known CVEs in dependencies
- **Configurable fix policies** — per-repo settings for max attempts, auto-merge rules, and scope constraints
- **Metrics and reporting** — track fix success rates, mean time to repair, and coverage delta over time

## License

MIT
