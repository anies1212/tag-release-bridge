# Tag Release Bridge

Comments release PRs with a table of PRs merged into the default branch since the latest tag.

## Inputs

- `token` (required): GitHub token with repo read access. Defaults to `${{ github.token }}`.
- `branch_pattern` (required): Regex the PR head ref must match. Default: `release/.+`.
- `post_comment` (optional): `true` to create/update a PR comment automatically (default).

## Outputs

- `body`: Markdown table of merged PRs.
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
```

## Output example

Rendered comment body looks like:

```
PRs merged into main since v1.2.3:

## <img src="https://avatars.githubusercontent.com/u/1234567?s=32" width="20" height="20"> [alice](https://github.com/alice)

### 🚀 Features
| Title | Link |
| --- | --- |
| feat: add retry config | [#123](https://github.com/your-org/your-repo/pull/123) |

### 🐛 Bug Fixes
| Title | Link |
| --- | --- |
| fix: handle 500 errors | [#121](https://github.com/your-org/your-repo/pull/121) |

## <img src="https://avatars.githubusercontent.com/u/222333?s=32" width="20" height="20"> [bob](https://github.com/bob)

### 🧹 Chores
| Title | Link |
| --- | --- |
| chore: bump deps | [#120](https://github.com/your-org/your-repo/pull/120) |
```

## Development

```sh
npm install
npm run prepare
```

Commit the generated `dist/` directory when publishing the action.
