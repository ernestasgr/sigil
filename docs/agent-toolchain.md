# Agent toolchain pins

Agent workflows use immutable toolchain inputs and validate those inputs with
`pnpm workflows:check`. The quality-gates workflow runs the same command, so a
new workflow variant is covered automatically when its filename starts with
`agent-` or it runs OpenCode.

## Node and Electron runtime

The repository supports Node.js `>=24.15.0 <25` to match the Node 24 runtime
embedded by Electron 42. The checked-in [`.node-version`](../.node-version)
file contains the current recommended Node 24 patch, and every CI and agent
workflow that runs Node uses that same version. Run `pnpm check:node` before working; the
repository's `preinstall` hook repeats the check and reports the detected
version plus the corrective action when the runtime is unsupported. Do not
move the workflows to Node 25 or 26 without first changing the Electron
runtime contract.

## Updating OpenCode

Edit `OPENCODE_VERSION` and `OPENCODE_SHA256` together at the top of
`.github/scripts/install-opencode.sh`. The checksum is the `sha256:` digest for
`opencode-linux-x64.tar.gz` in the chosen release's GitHub Releases API
response. The installer downloads that versioned asset, verifies its checksum
before extraction, installs it, and checks the executable's reported version.

Run `pnpm workflows:check` after updating the pins. Do not replace the shared
installer call with a remote install pipe.

## Updating Actions

Each `uses:` reference in `.github/workflows` must use the Action release's
full 40-character commit SHA followed by a readable version comment, for
example:

```yaml
uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
```

Resolve the tag to its commit in the Action's official repository, update every
matching reference, and run `pnpm workflows:check`. Never pin an Action to a
mutable branch or version tag alone.

## GitHub credentials

GitHub tokens and the agent PAT belong only in the `env` or `with` block of the
step that needs them. Agent checkout steps set `persist-credentials: false`;
authenticated pushes use `.github/scripts/push-agent-branch.sh` with a
step-scoped `GH_TOKEN`. Do not add GitHub credentials to workflow- or job-level
environments.
