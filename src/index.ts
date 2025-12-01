import * as core from '@actions/core';
import * as github from '@actions/github';

type PullRequest = {
  number: number;
  title: string;
  merged_at: string | null;
  base: { ref: string };
  user?: { login?: string | null; avatar_url?: string | null };
  html_url: string;
};

async function run() {
  try {
    const token = core.getInput('token', { required: true });
    const branchPatternInput = core.getInput('branch_pattern', { required: true }) || 'release/.+';
    const defaultBranchInput = core.getInput('default_branch');

    const { context } = github;
    const { owner, repo } = context.repo;
    const headRef =
      context.payload.pull_request?.head?.ref ?? context.ref?.replace('refs/heads/', '') ?? '';
    const headSha = context.payload.pull_request?.head?.sha ?? context.sha;

    let branchPattern: RegExp;
    try {
      branchPattern = new RegExp(branchPatternInput);
    } catch (error) {
      throw new Error(`Invalid branch_pattern regex: ${branchPatternInput}`);
    }

    if (!branchPattern.test(headRef)) {
      core.info(`Ref "${headRef}" does not match branch_pattern; skipping`);
      core.setOutput('body', '');
      core.setOutput('prev_tag', '');
      core.setOutput('count', 0);
      return;
    }

    const octokit = github.getOctokit(token);
    const repoInfo = await octokit.rest.repos.get({ owner, repo });
    const defaultBranch = defaultBranchInput || repoInfo.data.default_branch;

    const tags = await octokit.rest.repos.listTags({ owner, repo, per_page: 1 });
    if (!tags.data.length) {
      core.info('No tags found; skipping');
      core.setOutput('body', '');
      core.setOutput('prev_tag', '');
      core.setOutput('count', 0);
      return;
    }

    const prevTag = tags.data[0].name;
    core.setOutput('prev_tag', prevTag);

    const commits = await octokit.paginate(octokit.rest.repos.compareCommits, {
      owner,
      repo,
      base: prevTag,
      head: headSha,
      per_page: 100,
    }, (response) => response.data.commits);

    if (!commits.length) {
      core.info(`No commits found between ${prevTag} and ${headSha}`);
      core.setOutput('body', '');
      core.setOutput('count', 0);
      return;
    }

    const prMap = new Map<number, PullRequest>();
    for (const commit of commits) {
      const { data: associated } = await octokit.rest.repos.listPullRequestsAssociatedWithCommit({
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
      core.info('No merged PRs found in range for default branch');
      core.setOutput('body', '');
      core.setOutput('count', 0);
      return;
    }

    const mergedPrs = Array.from(prMap.values()).sort((a, b) => {
      const aDate = a.merged_at ? Date.parse(a.merged_at) : 0;
      const bDate = b.merged_at ? Date.parse(b.merged_at) : 0;
      return bDate - aDate;
    });

    let rows = '';
    for (const pr of mergedPrs) {
      const title = pr.title.replace(/\|/g, '\\|');
      const author = pr.user?.login ? `@${pr.user.login}` : 'unknown';
      const prLink = `[ #${pr.number} ](${pr.html_url})`;
      const avatarUrl = pr.user?.avatar_url ? `${pr.user.avatar_url}&s=32` : '';
      const authorCell = avatarUrl ? `![avatar](${avatarUrl}) ${author}` : author;
      rows += `| ${prLink} | ${title} | ${authorCell} | ${pr.merged_at ?? ''} |\n`;
    }

    const body =
      `PRs merged into ${defaultBranch} since ${prevTag}:\n\n` +
      `| PR | Title | Author | Merged at |\n` +
      `| --- | --- | --- | --- |\n` +
      rows;

    core.setOutput('body', body);
    core.setOutput('count', prMap.size);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

run();
