# TODO

## Publishing

### npm

- [ ] Create an npm account / org if needed
- [ ] Add `NPM_TOKEN` secret to the GitHub repo (Settings → Secrets → Actions)
  - Generate at npmjs.com → Account → Access Tokens → Granular Access Token

### Homebrew tap

- [ ] Create the tap repo: `github.com/impressiver/homebrew-suited`
  - Must be named `homebrew-suited` for `brew tap impressiver/suited` to work
  - Initialize with a `Formula/` directory (can be empty to start)
- [ ] Add a `TAP_TOKEN` secret to the **main** repo (Settings → Secrets → Actions)
  - Generate a GitHub PAT (fine-grained) with **Contents: Read and Write** scoped to `homebrew-suited`
  - This lets the release workflow push formula updates to the tap repo

Once both secrets are in place, use the versioning script to bump, tag, and publish in one step:

```bash
pnpm version:bump --push
```

This detects the bump level from commit messages (patch/minor/major), updates `package.json`, commits, tags, and pushes. GitHub Actions then builds the binaries, publishes to npm, creates the GitHub release, and updates the Homebrew formula automatically.

To preview without making changes:

```bash
pnpm version:bump --dry-run
```
