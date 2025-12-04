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

## Behavior (logic)

- Finds the latest reachable tag from the PR head commit.
- Collects all commits between that tag and the head, then gathers _all_ merged PRs associated with those commits.
- Groups PRs by label categories (release-changelog-builder compatible), with ignored labels filtered out.
- Renders a Markdown changelog using templates (configurable).

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

## Configuration

- Supports the same shape as release-changelog-builder:
  - `template`, `empty_template`, `pr_template`
  - `categories` (title + labels[])
  - `ignore_labels`
  - `other_title` (optional)
- Placeholders you can use inside templates: `$TITLE`, `$NUMBER`, `$URL`, `$AUTHOR`, `$CATEGORY`, `$FROM_TAG`, `$TO_REF`.
- Defaults (when no config file is found):
  - Template:

    ```
    ## 🔖 Release Preview
    Changes since $FROM_TAG → $TO_REF

    $CHANGES
    ```

  - PR template: `| $TITLE | @$AUTHOR | [#$NUMBER]($URL) |`
  - Categories: Features, Bug Fixes, Docs, Tests, Chores, Dependencies
  - Ignore labels: `skip-changelog`, `no-changelog`

## Output example

Rendered comment body looks like:

```
## 🔖 Release Preview
Changes since v1.2.3 → release/v1.3.0

### 🚀 Features
| Title | Author | Link |
| --- | --- | --- |
| feat: add retry config | @alice | [#123](https://github.com/your-org/your-repo/pull/123) |

### 🐛 Bug Fixes
| Title | Author | Link |
| --- | --- | --- |
| fix: handle 500 errors | @bob | [#121](https://github.com/your-org/your-repo/pull/121) |

### 🧹 Chores
| Title | Author | Link |
| --- | --- | --- |
| chore: bump deps | @bob | [#120](https://github.com/your-org/your-repo/pull/120) |
```

## Development

```sh
npm install
npm run prepare
```

Commit the generated `dist/` directory when publishing the action.
