# Home Assistant Add-on Repository Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the project as a valid Home Assistant custom Add-on repository that can be added by its GitHub URL.

**Architecture:** Add `repository.yaml` at the Git repository root and move the existing single Add-on into `whole_house_status/`. The Add-on keeps its current internal structure; all Node commands execute from that directory. A repository-layout regression test validates the manifest and required Add-on entrypoint files.

**Tech Stack:** Home Assistant repository metadata, YAML, Node.js `node:test`, Git file moves, Docker.

---

### Task 1: Migrate To A Repository Layout

**Files:**
- Create: `repository.yaml`
- Create: `whole_house_status/test/repositoryLayout.test.js`
- Move: `config.yaml`, `Dockerfile`, `package.json`, `package-lock.json`, `src/`, `public/`, `test/` to `whole_house_status/`
- Modify: `whole_house_status/config.yaml`
- Modify: `README.md`

- [ ] **Step 1: Write the failing repository-layout test**

Create `test/repositoryLayout.test.js`. It must walk from the test file to the first ancestor containing `repository.yaml`, then assert that the metadata has `name: Whole House Status`, the published GitHub URL, and that `whole_house_status/config.yaml`, `whole_house_status/Dockerfile`, and `whole_house_status/package.json` exist.

- [ ] **Step 2: Run the test and verify RED**

Run `node --test test/repositoryLayout.test.js`.

Expected: FAIL because `repository.yaml` and `whole_house_status/` do not exist.

- [ ] **Step 3: Add metadata and move the Add-on**

Create root `repository.yaml` with:

```yaml
name: Whole House Status
url: https://github.com/to21github/whole-house-status
maintainer: to21github
```

Move all Add-on runtime and test files into `whole_house_status/`. Update the nested `config.yaml` `url` to the published GitHub repository URL. Keep `docs/`, root `.gitignore`, and root `README.md` at the repository root.

- [ ] **Step 4: Update the README for GitHub repository installation**

Document the Add-on Store workflow: add `https://github.com/to21github/whole-house-status` as a custom repository, save, install `Whole House Status`, configure options, restart, and open the sidebar panel. Update local development and Docker commands to run from `whole_house_status/`.

- [ ] **Step 5: Verify GREEN and complete behavior**

Run from `whole_house_status/`: `npm test`, `npm run verify`, and `docker build -t whole-house-status-addon:repository .`. Also run `node --test test/repositoryLayout.test.js` and `git status --short` from the repository root.

Expected: all tests pass, Docker builds, and only intended migration files are changed.

- [ ] **Step 6: Commit**

Commit the metadata, README, and migrated Add-on with message `feat: package addon as custom repository`.

### Task 2: Publish And Verify The Repository

**Files:**
- Modify: none

- [ ] **Step 1: Push the migrated branch to GitHub `main`**

Push without force. Confirm the remote `main` SHA equals local `HEAD`.

- [ ] **Step 2: Verify repository metadata remotely**

Confirm `repository.yaml` and `whole_house_status/config.yaml` are present in remote `main`.

- [ ] **Step 3: Confirm clean working tree**

Run `git status --short`.

Expected: no output.

## Self-Review

- Spec coverage: Root metadata, standalone Add-on folder, GitHub installation instructions, regression test, Docker build, and remote verification are covered.
- Placeholder scan: no TODO/TBD placeholders.
- Type consistency: commands run in `whole_house_status/`; the layout test discovers the repository root from its eventual nested location.
