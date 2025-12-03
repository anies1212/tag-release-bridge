# Tag Release Bridge

Comments release PRs with a changelog of PRs merged since the latest tag.  
Content discovery and grouping follow the same idea as
[`release-changelog-builder-action`](https://github.com/mikepenz/release-changelog-builder-action)
(labels → categories, ignore labels, templates). Only the rendered comment style is different.

## Inputs

- `token` (required): GitHub token with repo read access. Defaults to `${{ github.token }}`.
- `branch_pattern` (required): Regex the PR head ref must match. Default: `release/.+`.
- `post_comment` (optional): `true` to create/update a PR comment automatically (default).
- `configuration` (optional): Path to a release-changelog-builder style config
  (YAML or JSON). Default: `.github/release-changelog-builder-config.yml`.

## Outputs

- `body`: Markdown changelog of merged PRs.
- `prev_tag`: Latest tag discovered.
- `count`: Number of merged PRs included.

## Usage

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  release-notes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: anies1212/tag-release-bridge@v1
        id: notes
        with:
          branch_pattern: release/.+
          # post_comment defaults to true. Set to false if you only want the outputs.
          # configuration: .github/release-changelog-builder-config.yml
```

## Output example

Rendered comment body looks like:

```
## 🔖 Release Preview
Changes since v1.2.3 → release/v1.3.0

### 🚀 Features
- feat: add retry config (#123) by @alice

### 🐛 Bug Fixes
- fix: handle 500 errors (#121) by @bob

### 🧹 Chores
- chore: bump deps (#120) by @bob
```

## Development

```sh
npm install
npm run prepare
```

Commit the generated `dist/` directory when publishing the action.
