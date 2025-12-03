import { runAction } from "../src/index";

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

jest.mock("@actions/github", () => {
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
      const commits = [{ sha: "c1" }, { sha: "c2" }];
      const tags = [{ name: "v2.0.0" }, { name: "v1.0.0" }];

      const listTagsMock = jest.fn().mockResolvedValue({ data: tags });

      return {
        rest: {
          repos: {
            get: jest.fn().mockResolvedValue({
              data: { default_branch: "main" },
            }),
            listTags: listTagsMock,
            compareCommits: jest
              .fn()
              .mockImplementation(({ base }: { base: string }) => {
                const status = base === "v2.0.0" ? "behind" : "ahead";
                return Promise.resolve({ data: { status, commits } });
              }),
            listPullRequestsAssociatedWithCommit: jest
              .fn()
              .mockImplementation(({ commit_sha }: { commit_sha: string }) => {
                if (commit_sha === "c1") {
                  return Promise.resolve({
                    data: [
                      {
                        number: 123,
                        title: "feat: add feature",
                        merged_at: "2024-12-01T00:00:00Z",
                        base: { ref: "main" },
                        head: { ref: "feature/new" },
                        user: {
                          login: "alice",
                          avatar_url:
                            "https://avatars.githubusercontent.com/u/1",
                          html_url: "https://github.com/alice",
                        },
                        html_url: "https://github.com/acme/demo/pull/123",
                      },
                    ],
                  });
                }
                return Promise.resolve({
                  data: [
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
                    },
                  ],
                });
              }),
          },
          issues: {
            listComments: jest.fn().mockResolvedValue({ data: [] }),
            updateComment: jest.fn(),
            createComment: jest.fn().mockResolvedValue({ data: { id: 999 } }),
          },
        },
        paginate: jest.fn((fn: any, _opts: any, mapFn?: (r: any) => any[]) => {
          if (fn === listTagsMock) {
            return mapFn ? mapFn({ data: tags }) : tags;
          }
          // simulate mapper over compareCommits response
          return mapFn ? mapFn({ data: { commits } }) : commits;
        }),
      };
    }),
  };
});

describe("runAction", () => {
  it("groups PRs by author and category and outputs body", async () => {
    const core = require("@actions/core");
    core.__inputs["token"] = "fake";
    core.__inputs["branch_pattern"] = "release/.+";
    core.__inputs["default_branch"] = "main";
    core.__inputs["post_comment"] = "false";

    await runAction();

    const setOutput = core.setOutput as jest.Mock;
    const bodyCall = setOutput.mock.calls.find((c: any[]) => c[0] === "body");
    expect(bodyCall).toBeTruthy();
    const body = bodyCall[1] as string;

    expect(body).toContain("PRs merged into main since v1.0.0");
    expect(body).toContain(
      '## <img src="https://avatars.githubusercontent.com/u/1?s=32" width="20" height="20"> [alice](https://github.com/alice)',
    );
    expect(body).toContain("### 🚀 Features");
    expect(body).toContain(
      "| feat: add feature | [#123](https://github.com/acme/demo/pull/123) |",
    );
    expect(body).toContain(
      '## <img src="https://avatars.githubusercontent.com/u/2?s=32" width="20" height="20"> [bob](https://github.com/bob)',
    );
    expect(body).toContain("### 🐛 Bug Fixes");
    expect(body).toContain(
      "| fix: critical bug | [#124](https://github.com/acme/demo/pull/124) |",
    );

    const countCall = setOutput.mock.calls.find((c: any[]) => c[0] === "count");
    expect(countCall?.[1]).toBe(2);
  });
});
