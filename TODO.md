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

Once both secrets are in place, pushing a version tag triggers the full release pipeline:

```bash
git tag v1.0.1 && git push origin v1.0.1
```

This will build the binaries, publish to npm, create the GitHub release, and update the Homebrew formula automatically.
