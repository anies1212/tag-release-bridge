import fs from "fs";
import os from "os";
import path from "path";
import { runAction } from "../src/index";

type MockPR = {
  number: number;
  title: string;
  merged_at: string | null;
  base: { ref: string };
  head: { ref: string };
  user: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  html_url: string;
  labels?: { name: string }[];
};

jest.mock("@actions/core", () => {
  const inputs: Record<string, string> = {};
  return {
    getInput: jest.fn((name: string) => inputs[name]),
    setOutput: jest.fn(),
    setFailed: jest.fn(),
    info: jest.fn(),
    __inputs: inputs,
  };
});

const mockState = {
  tags: [{ name: "v2.0.0" }, { name: "v1.0.0" }],
  commits: [{ sha: "c1" }, { sha: "c2" }],
  compareStatusByBase: new Map<string, string>([
    ["v2.0.0", "behind"],
    ["v1.0.0", "ahead"],
  ]),
  prByCommit: new Map<string, MockPR[]>([
    [
      "c1",
      [
        {
          number: 123,
          title: "feat: add feature",
          merged_at: "2024-12-01T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "feature/new" },
          user: {
            login: "alice",
            avatar_url: "https://avatars.githubusercontent.com/u/1",
            html_url: "https://github.com/alice",
          },
          html_url: "https://github.com/acme/demo/pull/123",
          labels: [{ name: "feature" }],
        },
      ],
    ],
    [
      "c2",
      [
        {
          number: 124,
          title: "fix: critical bug",
          merged_at: "2024-12-02T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "bug/critical" },
          user: {
            login: "bob",
            avatar_url: "https://avatars.githubusercontent.com/u/2",
            html_url: "https://github.com/bob",
          },
          html_url: "https://github.com/acme/demo/pull/124",
          labels: [{ name: "bug" }],
        },
      ],
    ],
  ]),
  pullDetails: new Map<number, MockPR>(),
};

function resetMockState() {
  mockState.tags = [{ name: "v2.0.0" }, { name: "v1.0.0" }];
  mockState.commits = [{ sha: "c1" }, { sha: "c2" }];
  mockState.compareStatusByBase = new Map<string, string>([
    ["v2.0.0", "behind"],
    ["v1.0.0", "ahead"],
  ]);
  mockState.prByCommit = new Map<string, MockPR[]>([
    [
      "c1",
      [
        {
          number: 123,
          title: "feat: add feature",
          merged_at: "2024-12-01T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "feature/new" },
          user: {
            login: "alice",
            avatar_url: "https://avatars.githubusercontent.com/u/1",
            html_url: "https://github.com/alice",
          },
          html_url: "https://github.com/acme/demo/pull/123",
          labels: [{ name: "feature" }],
        },
      ],
    ],
    [
      "c2",
      [
        {
          number: 124,
          title: "fix: critical bug",
          merged_at: "2024-12-02T00:00:00Z",
          base: { ref: "main" },
          head: { ref: "bug/critical" },
          user: {
            login: "bob",
            avatar_url: "https://avatars.githubusercontent.com/u/2",
            html_url: "https://github.com/bob",
          },
          html_url: "https://github.com/acme/demo/pull/124",
          labels: [{ name: "bug" }],
        },
      ],
    ],
  ]);
  mockState.pullDetails = new Map<number, MockPR>();
  for (const prs of mockState.prByCommit.values()) {
    for (const pr of prs) {
      mockState.pullDetails.set(pr.number, pr);
    }
  }
}

resetMockState();

jest.mock("@actions/github", () => {
  const listTagsMock = jest.fn(() => Promise.resolve({ data: mockState.tags }));
  const compareCommitsMock = jest.fn(({ base }: { base: string }) => {
    const status = mockState.compareStatusByBase.get(base) || "ahead";
    return Promise.resolve({ data: { status, commits: mockState.commits } });
  });
  const listPullRequestsAssociatedWithCommitMock = jest.fn(
    ({ commit_sha }: { commit_sha: string }) => {
      return Promise.resolve({
        data: mockState.prByCommit.get(commit_sha) || [],
      });
    },
  );
  const pullsGetMock = jest.fn(({ pull_number }: { pull_number: number }) => {
    const pr = mockState.pullDetails.get(pull_number);
    if (!pr) {
      throw new Error(`Missing mock PR for #${pull_number}`);
    }
    return Promise.resolve({ data: pr });
  });

  return {
    context: {
      repo: { owner: "acme", repo: "demo" },
      payload: {
        pull_request: {
          number: 42,
          head: { ref: "release/v1", sha: "headsha" },
        },
      },
      ref: "refs/heads/release/v1",
      sha: "headsha",
    },
    getOctokit: jest.fn(() => {
      return {
        rest: {
          repos: {
            get: jest.fn().mockResolvedValue({
              data: { default_branch: "main" },
            }),
            listTags: listTagsMock,
            compareCommits: compareCommitsMock,
            listPullRequestsAssociatedWithCommit:
              listPullRequestsAssociatedWithCommitMock,
          },
          issues: {
            listComments: jest.fn().mockResolvedValue({ data: [] }),
            updateComment: jest.fn(),
            createComment: jest.fn().mockResolvedValue({ data: { id: 999 } }),
          },
          pulls: { get: pullsGetMock },
        },
        paginate: jest.fn((fn: any, _opts: any, mapFn?: (r: any) => any[]) => {
          if (fn === listTagsMock) {
            return mapFn ? mapFn({ data: mockState.tags }) : mockState.tags;
          }
          // simulate mapper over compareCommits response
          return mapFn
            ? mapFn({ data: { commits: mockState.commits } })
            : mockState.commits;
        }),
      };
    }),
  };
});

describe("runAction", () => {
  let tempDirs: string[] = [];

  beforeEach(() => {
    resetMockState();
    jest.clearAllMocks();
    const core = require("@actions/core");
    for (const key of Object.keys(core.__inputs)) {
      delete core.__inputs[key];
    }
    tempDirs = [];
  });

  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a changelog using release-changelog-builder style categories", async () => {
    const core = require("@actions/core");
    core.__inputs["token"] = "fake";
    core.__inputs["branch_pattern"] = "release/.+";
    core.__inputs["post_comment"] = "false";

    await runAction();

    const setOutput = core.setOutput as jest.Mock;
    const bodyCall = setOutput.mock.calls.find((c: any[]) => c[0] === "body");
    expect(bodyCall).toBeTruthy();
    const body = bodyCall[1] as string;

    expect(body).toContain("Release Preview");
    expect(body).toContain("since v1.0.0");
    expect(body).toContain("### 🚀 Features");
    expect(body).toContain("| feat: add feature | @alice |");
    expect(body).toContain("### 🐛 Bug Fixes");
    expect(body).toContain("| fix: critical bug | @bob |");

    const countCall = setOutput.mock.calls.find((c: any[]) => c[0] === "count");
    expect(countCall?.[1]).toBe(2);

    const prevTagCall = setOutput.mock.calls.find(
      (c: any[]) => c[0] === "prev_tag",
    );
    expect(prevTagCall?.[1]).toBe("v1.0.0");
  });

  it("ignores configured labels and groups unmatched labels under Other changes", async () => {
    const core = require("@actions/core");
    core.__inputs["token"] = "fake";
    core.__inputs["branch_pattern"] = "release/.+";
    core.__inputs["post_comment"] = "false";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trb-ignore-"));
    tempDirs.push(tmpDir);
    core.__inputs["configuration"] = path.join(tmpDir, "config.yml");

    // add a third commit/PR that should be ignored
    mockState.commits.push({ sha: "c3" });
    mockState.prByCommit.set("c3", [
      {
        number: 125,
        title: "chore: skip me",
        merged_at: "2024-12-03T00:00:00Z",
        base: { ref: "main" },
        head: { ref: "chore/skip" },
        user: {
          login: "carol",
          avatar_url: "https://avatars.githubusercontent.com/u/3",
          html_url: "https://github.com/carol",
        },
        html_url: "https://github.com/acme/demo/pull/125",
        labels: [{ name: "skip-changelog" }],
      },
    ]);
    mockState.pullDetails.set(125, mockState.prByCommit.get("c3")![0]);

    // mark one PR with an unmapped label to fall into Other changes
    const pr124 = mockState.pullDetails.get(124)!;
    pr124.labels = [{ name: "infra" }];

    fs.writeFileSync(
      core.__inputs["configuration"],
      "ignore_labels:\n  - skip-changelog\n",
    );

    await runAction();

    const coreMock = require("@actions/core");
    const setOutput = coreMock.setOutput as jest.Mock;
    const body = setOutput.mock.calls.find((c: any[]) => c[0] === "body")?.[1];

    expect(body).toContain("Other changes");
    expect(body).toContain("| fix: critical bug | @bob |");
    expect(body).not.toContain("#125");

    const countCall = setOutput.mock.calls.find((c: any[]) => c[0] === "count");
    expect(countCall?.[1]).toBe(2);
  });

  it("applies templates from configuration", async () => {
    const core = require("@actions/core");
    core.__inputs["token"] = "fake";
    core.__inputs["branch_pattern"] = "release/.+";
    core.__inputs["post_comment"] = "false";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "trb-tpl-"));
    tempDirs.push(tmpDir);
    core.__inputs["configuration"] = path.join(tmpDir, "config.json");

    const config = {
      template: "Hello $FROM_TAG -> $TO_REF\n\n$CHANGES",
      pr_template: "- [$CATEGORY] $TITLE by $AUTHOR",
      categories: [{ title: "Features", labels: ["feature"] }],
    };
    fs.writeFileSync(core.__inputs["configuration"], JSON.stringify(config));

    await runAction();

    const coreMock = require("@actions/core");
    const setOutput = coreMock.setOutput as jest.Mock;
    const body = setOutput.mock.calls.find((c: any[]) => c[0] === "body")?.[1];

    expect(body).toContain("Hello v1.0.0 -> release/v1");
    expect(body).toContain("- [Features] feat: add feature by alice");
  });
});
