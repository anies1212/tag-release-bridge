import * as core from "@actions/core";
import * as fs from "fs/promises";
import * as github from "@actions/github";
import path from "path";
import yaml from "js-yaml";

type PullRequest = {
  number: number;
  title: string;
  merged_at: string | null;
  base: { ref: string };
  head?: { ref?: string | null };
  user?: {
    login?: string | null;
    avatar_url?: string | null;
    html_url?: string | null;
  };
  html_url: string;
  labels?: { name?: string | null }[];
};

type CategoryConfig = {
  title: string;
  labels: string[];
};

type RawConfig = {
  template?: string;
  empty_template?: string;
  pr_template?: string;
  categories?: CategoryConfig[];
  ignore_labels?: string[];
};

type ResolvedConfig = {
  template: string;
  emptyTemplate: string;
  prTemplate: string;
  categories: CategoryConfig[];
  ignoreLabels: string[];
  otherTitle: string;
};

const defaultConfig: ResolvedConfig = {
  template: [
    "## 🔖 Release Preview",
    "Changes since $FROM_TAG → $TO_REF",
    "",
    "$CHANGES",
  ].join("\n"),
  emptyTemplate: "_No merged pull requests found in this range._",
  prTemplate: "- $TITLE (#$NUMBER) by @$AUTHOR",
  categories: [
    { title: "🚀 Features", labels: ["feature", "feat", "enhancement"] },
    { title: "🐛 Bug Fixes", labels: ["fix", "bug", "hotfix"] },
    { title: "📚 Docs", labels: ["doc", "docs", "documentation"] },
    { title: "🧪 Tests", labels: ["test", "tests", "qa"] },
    { title: "🧹 Chores", labels: ["chore", "maintenance", "refactor"] },
    { title: "📦 Dependencies", labels: ["deps", "dependencies"] },
  ],
  ignoreLabels: ["skip-changelog", "no-changelog"],
  otherTitle: "Other changes",
};

function toLowerSet(values: (string | undefined | null)[]): Set<string> {
  return new Set(
    values.filter(Boolean).map((v) => (v as string).toLowerCase()),
  );
}

async function loadConfig(configPath: string): Promise<ResolvedConfig> {
  if (!configPath) return defaultConfig;
  const fullPath = path.isAbsolute(configPath)
    ? configPath
    : path.join(process.cwd(), configPath);
  try {
    const raw = await fs.readFile(fullPath, "utf8");
    const parsed =
      (configPath.endsWith(".json")
        ? JSON.parse(raw)
        : (yaml.load(raw) as RawConfig | null)) || {};

    const categories =
      Array.isArray(parsed.categories) && parsed.categories.length
        ? parsed.categories
        : defaultConfig.categories;
    const ignoreLabels =
      parsed.ignore_labels && Array.isArray(parsed.ignore_labels)
        ? parsed.ignore_labels
        : defaultConfig.ignoreLabels;

    return {
      template: parsed.template || defaultConfig.template,
      emptyTemplate: parsed.empty_template || defaultConfig.emptyTemplate,
      prTemplate: parsed.pr_template || defaultConfig.prTemplate,
      categories,
      ignoreLabels,
      otherTitle: defaultConfig.otherTitle,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") {
      core.info(
        `Failed to read configuration at ${configPath}: ${
          err.message || String(err)
        }`,
      );
    } else {
      core.info(`Configuration not found at ${configPath}; using defaults`);
    }
    return defaultConfig;
  }
}

function renderTemplate(
  template: string,
  pr: PullRequest,
  categoryTitle: string,
  fromTag: string,
  toRef: string,
): string {
  const author = pr.user?.login || "unknown";
  const replacements: Record<string, string> = {
    TITLE: pr.title,
    NUMBER: `${pr.number}`,
    URL: pr.html_url,
    AUTHOR: author,
    CATEGORY: categoryTitle,
    FROM_TAG: fromTag,
    TO_REF: toRef,
  };

  let rendered = template;
  for (const [key, value] of Object.entries(replacements)) {
    const placeholder = new RegExp(`\\$\\{\\{?${key}\\}?\\}`, "g");
    const shorthand = new RegExp(`\\$${key}`, "g");
    rendered = rendered.replace(placeholder, value).replace(shorthand, value);
  }
  return rendered;
}

function renderBody(
  config: ResolvedConfig,
  grouped: Map<string, PullRequest[]>,
  fromTag: string,
  toRef: string,
): string {
  if (!grouped.size) {
    return config.template
      .replace(/\$CHANGES/g, config.emptyTemplate)
      .replace(/\$FROM_TAG/g, fromTag)
      .replace(/\$TO_REF/g, toRef);
  }

  const sections: string[] = [];
  const categoryOrder = [
    ...config.categories,
    { title: config.otherTitle, labels: [] },
  ];

  for (const category of categoryOrder) {
    const prs = grouped.get(category.title);
    if (!prs || !prs.length) continue;
    const sorted = [...prs].sort((a, b) => {
      const aDate = a.merged_at ? Date.parse(a.merged_at) : 0;
      const bDate = b.merged_at ? Date.parse(b.merged_at) : 0;
      return bDate - aDate;
    });
    const entries = sorted
      .map((pr) =>
        renderTemplate(config.prTemplate, pr, category.title, fromTag, toRef),
      )
      .join("\n");
    sections.push(`### ${category.title}\n${entries}`);
  }

  const changes = sections.join("\n\n");
  return config.template
    .replace(/\$CHANGES/g, changes)
    .replace(/\$FROM_TAG/g, fromTag)
    .replace(/\$TO_REF/g, toRef);
}

export async function runAction() {
  try {
    const token = core.getInput("token", { required: true });
    const branchPatternInput =
      core.getInput("branch_pattern", { required: true }) || "release/.+";
    const postCommentInput = core.getInput("post_comment") || "true";
    const configurationPath =
      core.getInput("configuration") ||
      ".github/release-changelog-builder-config.yml";
    const postComment = postCommentInput.toLowerCase() === "true";

    const { context } = github;
    const { owner, repo } = context.repo;
    const headRef =
      context.payload.pull_request?.head?.ref ??
      context.ref?.replace("refs/heads/", "") ??
      "";

    let branchPattern: RegExp;
    try {
      branchPattern = new RegExp(branchPatternInput);
    } catch (error) {
      throw new Error(`Invalid branch_pattern regex: ${branchPatternInput}`);
    }

    if (!branchPattern.test(headRef)) {
      core.info(`Ref "${headRef}" does not match branch_pattern; skipping`);
      core.setOutput("body", "");
      core.setOutput("prev_tag", "");
      core.setOutput("count", 0);
      return;
    }

    const octokit = github.getOctokit(token);
    const headSha = context.payload.pull_request?.head?.sha ?? context.sha;
    const toRef = headRef || headSha.slice(0, 7);
    const config = await loadConfig(configurationPath);

    const tags = await octokit.paginate(octokit.rest.repos.listTags, {
      owner,
      repo,
      per_page: 100,
    });
    if (!tags.length) {
      core.info("No tags found; skipping");
      core.setOutput("body", "");
      core.setOutput("prev_tag", "");
      core.setOutput("count", 0);
      return;
    }

    let prevTag: string | undefined;
    for (const tag of tags) {
      const comparison = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base: tag.name,
        head: headSha,
        per_page: 1,
      });

      if (
        comparison.data.status === "ahead" ||
        comparison.data.status === "identical"
      ) {
        prevTag = tag.name;
        break;
      }
    }

    if (!prevTag) {
      core.info(
        `No reachable tag found from head "${headSha}"; skipping comparison`,
      );
      core.setOutput("body", "");
      core.setOutput("prev_tag", "");
      core.setOutput("count", 0);
      return;
    }

    core.setOutput("prev_tag", prevTag);

    const commits = await octokit.paginate(
      octokit.rest.repos.compareCommits,
      {
        owner,
        repo,
        base: prevTag,
        head: headSha,
        per_page: 100,
      },
      (response) => response.data.commits,
    );

    if (!commits.length) {
      core.info(`No commits found between ${prevTag} and ${headSha}`);
      core.setOutput("body", "");
      core.setOutput("count", 0);
      return;
    }

    const prMap = new Map<number, PullRequest>();
    const commitShas = commits.map((c) => c.sha);
    const concurrency = 5;

    for (let i = 0; i < commitShas.length; i += concurrency) {
      const batch = commitShas.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (sha) => {
          const { data: associated } =
            await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
              owner,
              repo,
              commit_sha: sha,
            });
          return associated as unknown as PullRequest[];
        }),
      );

      for (const prs of results) {
        for (const pr of prs) {
          if (pr.merged_at) {
            prMap.set(pr.number, pr);
          }
        }
      }
    }

    if (!prMap.size) {
      core.info("No merged PRs found in range for default branch");
      core.setOutput("body", "");
      core.setOutput("count", 0);
      return;
    }

    const pullNumbers = Array.from(prMap.keys());
    const detailedPrs: PullRequest[] = [];
    for (let i = 0; i < pullNumbers.length; i += concurrency) {
      const batch = pullNumbers.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (number) => {
          const pr = await octokit.rest.pulls.get({
            owner,
            repo,
            pull_number: number,
          });
          return pr.data as unknown as PullRequest;
        }),
      );
      for (const pr of results) {
        detailedPrs.push(pr);
      }
    }

    const ignoreLabels = toLowerSet(config.ignoreLabels);
    const grouped = new Map<string, PullRequest[]>();
    const categories = [...config.categories];

    for (const pr of detailedPrs) {
      const labels = toLowerSet(pr.labels?.map((l) => l.name) || []);
      if (Array.from(labels).some((label) => ignoreLabels.has(label))) {
        continue;
      }
      const matched = categories.find((category) =>
        category.labels.some((label) => labels.has(label.toLowerCase())),
      ) || { title: config.otherTitle, labels: [] };
      const existing = grouped.get(matched.title) || [];
      existing.push(pr);
      grouped.set(matched.title, existing);
    }

    const body = renderBody(config, grouped, prevTag, toRef);

    core.setOutput("body", body);
    core.setOutput(
      "count",
      Array.from(grouped.values()).reduce((sum, list) => sum + list.length, 0),
    );

    if (postComment) {
      const pullNumber = context.payload.pull_request?.number;
      if (!pullNumber) {
        core.info("No pull_request context; skipping comment");
        return;
      }

      const marker = "<!-- tag-release-bridge -->";
      const bodyWithMarker = `${marker}\n${body}`;

      const comments = await octokit.paginate(
        octokit.rest.issues.listComments,
        {
          owner,
          repo,
          issue_number: pullNumber,
          per_page: 100,
        },
      );

      const existing = comments.find(
        (c) => typeof c.body === "string" && c.body.includes(marker),
      );

      if (existing) {
        await octokit.rest.issues.updateComment({
          owner,
          repo,
          comment_id: existing.id,
          body: bodyWithMarker,
        });
        core.info(`Updated existing comment (id: ${existing.id})`);
      } else {
        const created = await octokit.rest.issues.createComment({
          owner,
          repo,
          issue_number: pullNumber,
          body: bodyWithMarker,
        });
        core.info(`Created new comment (id: ${created.data.id})`);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("Unknown error occurred");
    }
  }
}

if (process.env.NODE_ENV !== "test") {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  runAction();
}
