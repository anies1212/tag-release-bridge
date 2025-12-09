# Tag Release Bridge

Comments release PRs with a table of PRs merged into the default branch since the latest tag.

## Inputs

| Name           | Required | Default               | Description                                                                    |
| -------------- | -------- | --------------------- | ------------------------------------------------------------------------------ |
| `token`        | Yes      | `${{ github.token }}` | GitHub token with repo read access                                             |
| `post_comment` | No       | `true`                | Create/update a PR comment with the generated table                            |
| `from`         | No       | (auto-detect)         | Base commit/tag for comparison. If not specified, auto-detects from latest tag |
| `to`           | No       | (main HEAD)           | Head commit/ref for comparison. Defaults to the default branch HEAD            |

## Outputs

| Name       | Description                                                  |
| ---------- | ------------------------------------------------------------ |
| `body`     | Rendered Markdown table of merged PRs by author and category |
| `prev_tag` | The tag or ref used as the base for comparison               |
| `count`    | Number of merged PRs found                                   |

## Usage

### Basic Usage (auto-detect range)

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
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          # post_comment defaults to true. Set to false if you only want the outputs.
```

### Manual Range Specification

```yaml
- name: Get latest tag
  id: latest_tag
  uses: actions-ecosystem/action-get-latest-tag@v1

- name: Get main SHA
  id: main_sha
  run: echo "sha=$(git rev-parse origin/main)" >> "$GITHUB_OUTPUT"

- uses: anies1212/tag-release-bridge@v1
  with:
    token: ${{ secrets.GITHUB_TOKEN }}
    from: ${{ steps.latest_tag.outputs.tag }}
    to: ${{ steps.main_sha.outputs.sha }}
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
