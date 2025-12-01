# Tag Release Bridge

Comments release PRs with a table of PRs merged into the default branch since the latest tag.

## Inputs

- `token` (required): GitHub token with repo read access. Defaults to `${{ github.token }}`.
- `branch_pattern` (required): Regex the PR head ref must match. Default: `release/.+`.
- `default_branch` (optional): Default branch name to inspect. Fallbacks to the repo default.

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

      - uses: your-org/tag-release-bridge@v1
        id: notes
        with:
          branch_pattern: release/.+
          default_branch: main

      - if: steps.notes.outputs.count != '0'
        uses: peter-evans/create-or-update-comment@v5
        with:
          issue-number: ${{ github.event.pull_request.number }}
          body: ${{ steps.notes.outputs.body }}
```

## Development

```sh
npm install
npm run prepare
```

Commit the generated `dist/` directory when publishing the action.
