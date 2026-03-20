# NPM Publish Workflow

How to publish `@pally-agent/*` packages to npm.

---

## Packages

| Package | npm Name | Current Version |
|---------|----------|-----------------|
| `packages/core` | `@pally-agent/core` | See `packages/core/package.json` |
| `packages/compliance` | `@pally-agent/compliance` | See `packages/compliance/package.json` |
| `packages/dashboard` | `@pally-agent/dashboard` | See `packages/dashboard/package.json` |
| `packages/monitor` | `@pally-agent/monitor` | See `packages/monitor/package.json` |

---

## Dry-Run Workflow

The `scripts/publish.sh` script performs a full dry-run before publishing:

```bash
./scripts/publish.sh
```

This script:

1. Runs the full test suite (`npm run test`).
2. Builds all packages (`npm run build`).
3. Runs `npm pack --dry-run` for each package, showing what files would be included in the tarball.

Review the output to verify:
- Tests pass.
- Builds succeed.
- Only intended files appear in each package tarball (no test fixtures, secrets, or build artifacts).

---

## Publishing

After a successful dry-run, publish each package:

```bash
# Login to npm (one-time)
npm login

# Publish each package
for pkg in core compliance dashboard monitor; do
  cd packages/$pkg && npm publish && cd ../..
done
```

To publish with public access (required for scoped packages on first publish):

```bash
for pkg in core compliance dashboard monitor; do
  cd packages/$pkg && npm publish --access public && cd ../..
done
```

---

## Version Management

Versions are managed in each package's `package.json`. All packages currently share the same version number.

To bump versions before publishing:

```bash
# Bump all packages to the same version
for pkg in core compliance dashboard monitor; do
  cd packages/$pkg && npm version <patch|minor|major> --no-git-tag-version && cd ../..
done
```

After bumping, commit the version changes:

```bash
git add packages/*/package.json
git commit -m "chore: bump version to x.y.z"
```

---

## Pre-Publish Checklist

Before publishing a new version:

- [ ] All tests pass (`npm run test`).
- [ ] Build succeeds (`npm run build`).
- [ ] Dry-run reviewed (`./scripts/publish.sh`).
- [ ] Version numbers updated in all `package.json` files.
- [ ] CHANGELOG updated with new version entry.
- [ ] No secrets or credentials in source files.
- [ ] Changes committed and pushed to `master` (via `develop` PR).
- [ ] Git tag created for the release (`git tag v0.x.y`).
