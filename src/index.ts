import * as core from "@actions/core";
import * as github from "@actions/github";

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
};

type Category = {
  key: string;
  title: string;
  icon: string;
  keywords: string[];
};

const categories: Category[] = [
  { key: "feature", title: "Features", icon: "🚀", keywords: ["feat"] },
  {
    key: "bug",
    title: "Bug Fixes",
    icon: "🐛",
    keywords: ["fixes", "fix", "hotfix", "bug"],
  },
  { key: "chore", title: "Chores", icon: "🧹", keywords: ["chore"] },
  { key: "tests", title: "Tests", icon: "🧪", keywords: ["tests", "e2e"] },
  { key: "refactor", title: "Refactors", icon: "♻️", keywords: ["refactor"] },
  { key: "release", title: "Release", icon: "🎯", keywords: ["release"] },
  { key: "docs", title: "Docs", icon: "📚", keywords: ["doc"] },
  {
    key: "ci",
    title: "CI / Workflow",
    icon: "⚙️",
    keywords: ["ci", "workflow"],
  },
  { key: "other", title: "Other", icon: "📦", keywords: [] },
];

function resolveAvatarUrl(rawUrl: string | null | undefined): string {
  if (!rawUrl) return "";
  const separator = rawUrl.includes("?") ? "&" : "?";
  return `${rawUrl}${separator}s=32`;
}

function categorizePR(pr: PullRequest): Category {
  const haystack = `${pr.title} ${pr.head?.ref ?? ""}`.toLowerCase();
  for (const category of categories) {
    if (
      category.keywords.length &&
      category.keywords.some((kw) => haystack.includes(kw))
    ) {
      return category;
    }
  }
  return categories.find((c) => c.key === "other") as Category;
}

export async function runAction() {
  try {
    const token = core.getInput("token", { required: true });
    const branchPatternInput =
      core.getInput("branch_pattern", { required: true }) || "release/.+";
    const postCommentInput = core.getInput("post_comment") || "true";
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
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = repoInfo.data.default_branch;
    const headSha = context.payload.pull_request?.head?.sha ?? context.sha;

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
    for (const commit of commits) {
      const { data: associated } =
        await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
          owner,
          repo,
          commit_sha: commit.sha,
        });

      for (const pr of associated as unknown as PullRequest[]) {
        if (pr.base.ref === defaultBranch && pr.merged_at) {
          prMap.set(pr.number, pr);
        }
      }
    }

    if (!prMap.size) {
      core.info("No merged PRs found in range for default branch");
      core.setOutput("body", "");
      core.setOutput("count", 0);
      return;
    }

    const mergedPrs = Array.from(prMap.values()).sort((a, b) => {
      const aAuthor = a.user?.login ?? "unknown";
      const bAuthor = b.user?.login ?? "unknown";
      if (aAuthor !== bAuthor) {
        return aAuthor.localeCompare(bAuthor);
      }
      const aDate = a.merged_at ? Date.parse(a.merged_at) : 0;
      const bDate = b.merged_at ? Date.parse(b.merged_at) : 0;
      return bDate - aDate;
    });

    type AuthorGroup = {
      login: string;
      avatar: string;
      profileUrl: string;
      categories: Map<string, PullRequest[]>;
    };

    const authors = new Map<string, AuthorGroup>();
    for (const pr of mergedPrs) {
      const login = pr.user?.login ?? "unknown";
      const avatar = resolveAvatarUrl(pr.user?.avatar_url);
      const profileUrl =
        pr.user?.html_url ||
        (pr.user?.login ? `https://github.com/${pr.user.login}` : "");
      const authorGroup = authors.get(login) ?? {
        login,
        avatar,
        profileUrl,
        categories: new Map(),
      };

      const category = categorizePR(pr);
      const list = authorGroup.categories.get(category.key) ?? [];
      list.push(pr);
      authorGroup.categories.set(category.key, list);
      authors.set(login, authorGroup);
    }

    const sortedAuthors = Array.from(authors.values()).sort((a, b) =>
      a.login.localeCompare(b.login),
    );

    let body = `PRs merged into ${defaultBranch} since ${prevTag}:\n\n`;

    for (const author of sortedAuthors) {
      const avatarImg = author.avatar
        ? `<img src="${author.avatar}" width="20" height="20"> `
        : "";
      const authorLink =
        author.login !== "unknown"
          ? `[${author.login}](${author.profileUrl})`
          : "unknown";
      body += `## ${avatarImg}${authorLink}\n\n`;

      for (const category of categories) {
        const prsForCategory = author.categories.get(category.key);
        if (!prsForCategory || !prsForCategory.length) continue;

        const sortedByDate = [...prsForCategory].sort((a, b) => {
          const aDate = a.merged_at ? Date.parse(a.merged_at) : 0;
          const bDate = b.merged_at ? Date.parse(b.merged_at) : 0;
          return bDate - aDate;
        });

        body += `### ${category.icon} ${category.title}\n`;
        body += `| Title | Link |\n| --- | --- |\n`;
        for (const pr of sortedByDate) {
          const title = pr.title.replace(/\|/g, "\\|");
          body += `| ${title} | [#${pr.number}](${pr.html_url}) |\n`;
        }
        body += "\n";
      }
    }

    core.setOutput("body", body);
    core.setOutput("count", prMap.size);

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
