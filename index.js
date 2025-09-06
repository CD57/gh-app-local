import http from "http";
import fs from "fs";
import "dotenv/config";
import { App as OctoApp } from "@octokit/app";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";

const {
  APP_ID,
  WEBHOOK_SECRET,
  PRIVATE_KEY_PATH,
  PORT = 3000,
} = process.env;

if (!APP_ID || !WEBHOOK_SECRET || !PRIVATE_KEY_PATH) {
  console.error("Missing env. Set APP_ID, WEBHOOK_SECRET, PRIVATE_KEY_PATH in .env");
  process.exit(1);
}

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

async function getInstallationOctokit(installationId) {
  const app = new OctoApp({ appId: Number(APP_ID), privateKey });
  return app.getInstallationOctokit(Number(installationId));
}

const webhooks = new Webhooks({ secret: WEBHOOK_SECRET });

async function fileExists(octokit, { owner, repo, path, ref }) {
  try {
    await octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
      owner,
      repo,
      path,
      ref,
      headers: { Accept: "application/vnd.github+json" },
    });
    return true;
  } catch (e) {
    if (e.status === 404) return false;
    throw e;
  }
}

function renderTable(rows) {
  const body = rows.map(r => `| ${r.name} | ${r.pass ? "✅ Present" : "❌ Missing"} | ${r.notes || ""} |`).join("\n");
  return `| Check | Result | Notes |\n|---|---|---|\n${body}`;
}

function renderComment(rows) {
  const missing = rows.filter(r => !r.pass).map(r => r.name);
  const header = missing.length === 0
    ? "✅ **Compliance PASSED** — All required files are present."
    : `❌ **Compliance FAILED** — Missing: ${missing.join(", ")}`;
  return `${header}\n\n${renderTable(rows)}`;
}

webhooks.on("pull_request", async ({ payload, id, name }) => {
  const action = payload.action;
  if (!["opened", "reopened", "synchronize"].includes(action)) return;

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const headSha = payload.pull_request?.head?.sha;
  const prNumber = payload.number;
  const headRef = payload.pull_request?.head?.ref;

  console.log("PR event", { delivery: id, name, action, installationId, owner, repo, headRef, headSha });
  if (!installationId || !owner || !repo || !headSha || !prNumber) return;

  const octokit = await getInstallationOctokit(installationId);

  const { data: check } = await octokit.request(
    "POST /repos/{owner}/{repo}/check-runs",
    {
      owner,
      repo,
      name: "Compliance",
      head_sha: headSha,
      status: "in_progress",
      headers: { Accept: "application/vnd.github+json" },
    }
  );

  try {
    const targets = ["README.md", "CONTRIBUTING.md"];
    const existence = await Promise.all(
      targets.map(async (p) => ({
        name: p,
        pass: await fileExists(octokit, { owner, repo, path: p, ref: headSha }),
        notes: "Checked at repo root",
      }))
    );

    const allPass = existence.every(x => x.pass);
    const table = renderTable(existence);
    const summary = `${existence.filter(x => x.pass).length} / ${existence.length} required files present`;
    const conclusion = allPass ? "success" : "failure";

    await octokit.request(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
      {
        owner,
        repo,
        check_run_id: check.id,
        status: "completed",
        conclusion,
        output: {
          title: `Compliance (files): ${allPass ? "PASSED" : "FAILED"}`,
          summary,
          text: `### Required files\n${table}`,
        },
        headers: { Accept: "application/vnd.github+json" },
      }
    );

    await octokit.request(
      "POST /repos/{owner}/{repo}/issues/{issue_number}/comments",
      {
        owner,
        repo,
        issue_number: prNumber,
        body: renderComment(existence),
        headers: { Accept: "application/vnd.github+json" },
      }
    );

    console.log(`[checks] completed ${conclusion} & commented for ${owner}/${repo}@${headSha}`);
  } catch (err) {
    console.error("Error during file checks:", err);
    try {
      await octokit.request(
        "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
        {
          owner,
          repo,
          check_run_id: check.id,
          status: "completed",
          conclusion: "failure",
          output: {
            title: "Compliance (files): ERROR",
            summary: "Error while performing required-file checks",
            text: "See app logs for details.",
          },
          headers: { Accept: "application/vnd.github+json" },
        }
      );
    } catch {}
  }
});

const server = http.createServer(createNodeMiddleware(webhooks, { path: "/events" }));
server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/events`);
  console.log(`Ensure your tunnel (e.g., smee-client) forwards here.`);
});
