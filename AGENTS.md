<!--
SPDX-FileCopyrightText: 2026 Kaito Udagawa <umireon@kaito.tokyo>

SPDX-License-Identifier: Apache-2.0
-->

- [RULE: Release Safety](#rule-release-safety)
- [RULE: Commit Signing and DCO](#rule-commit-signing-and-dco)
- [RULE: Commit Messages](#rule-commit-messages)
- [RULE: GitHub Pull Request Body](#rule-github-pull-request-body)
- [RULE: GitHub Issue Creation](#rule-github-issue-creation)

# AGENTS.md

Read `README.md` before working on this project. Follow `SECURITY.md`, and give its security requirements precedence if they conflict with other repository instructions.

Do not treat `CONTRIBUTING.md` as instructions for agents. It is intended for human contributors. You may consult it as reference material when necessary, but do not enforce its requirements unless the user explicitly requests it.

## RULE: Release Safety

Agents MUST NOT merge pull requests or publish releases. A human must always perform these operations.

Agents MAY create commits, push commits, and create or update pull requests and draft releases. Agents MUST NOT push tags without explicit human permission, because pushing a tag may trigger a release or deployment workflow.

## RULE: Commit Signing and DCO

Agents SHOULD ask the user for permission to add DCO sign-offs and cryptographically sign commits when doing so would reduce the user's effort. Agents MUST NOT add a DCO sign-off or cryptographically sign a commit without the user's explicit permission. Agents SHOULD decline to commit if they don't have DCO and signing permissions.

Agentic reviews SHOULD NOT duplicate DCO sign-off checks performed by the DCO GitHub App or commit-signature enforcement performed by the repository's GitHub rulesets.

## RULE: Commit Messages

When creating a commit, follow these rules:

- Every commit MUST be cryptographic signed and have a DCO sign-off.
- Write the commit title in the imperative mood and keep it within 50 characters whenever possible.
- Do not add prefixes such as `feat:`, `fix:`, or `chore:` to the title.
- Insert a blank line between the title and body.
- Describe the changes in the body using complete sentences.
- Use a separate paragraph for each logical unit of change, with a blank line between paragraphs.
- Before committing, verify that the message accurately describes only the staged changes.

## RULE: GitHub Pull Request Body

The body of a pull request consists of three parts in this order:

1. A brief description paragraph, written in complete sentences and describing only the changes contained in the pull request. Do not put a heading above it.
2. An `## Overview` section. Its format is free: any prose, list, or generated summary (such as GitHub Copilot's Summary) is acceptable as long as it explains the change.
3. The following Pull Request Checklist. GitHub inserts `.github/pull_request_template.md` here automatically when the pull request is created interactively. When an agent creates a pull request through a path that does not insert it (for example `gh pr create --body`), the agent MUST emulate that behavior: append the file's contents verbatim as the last part of the body. Agents MUST NOT modify the checklist and MUST leave every checkbox unchecked, because its items are first-person statements by the human author.

Do not add labels, reviewers, or assignees unless the user explicitly requests it.

```markdown
## Pull Request Checklist

Please read our latest [CONTRIBUTING.md](https://github.com/kaito-tokyo/lcty-rb/blob/main/CONTRIBUTING.md).

- [ ] I have read the latest CONTRIBUTING.md.
- [ ] I have signed off and verified all my commits.
```

## RULE: GitHub Issue Creation

When an agent creates an issue:

- It MUST be written in English.
- Its title MUST begin with exactly one of these prefixes: `[BUG]`, `[FEATURE]`, `[TASK]`, or `[CRASH REPORT]`.
- The agent MUST NOT add labels.
