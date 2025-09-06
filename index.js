import http from "http";
import fs from "fs";
import "dotenv/config";
import { App as OctoApp } from "@octokit/app";
import { Webhooks, createNodeMiddleware } from "@octokit/webhooks";

// ---- env ----
const {
  APP_ID,
  WEBHOOK_SECRET,
  PRIVATE_KEY_PATH,
  PORT = 3000,
} = process.env;

if (!APP_ID || !WEBHOOK_SECRET || !PRIVATE_KEY_PATH) {
  console.error("Missing env. Ensure APP_ID, WEBHOOK_SECRET, PRIVATE_KEY_PATH are set in .env");
  process.exit(1);
}

const privateKey = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");

// GitHub App auth helper: returns installation-scoped Octokit (core)
async function getInstallationOctokit(installationId) {
  const app = new OctoApp({ appId: Number(APP_ID), privateKey });
  const octokit = await app.getInstallationOctokit(Number(installationId));
  return octokit; // has .request(), not .rest
}

// Webhook handler
const webhooks = new Webhooks({ secret: WEBHOOK_SECRET });

webhooks.on("pull_request", async ({ payload, id, name }) => {
  const action = payload.action;
  if (!["opened", "reopened", "synchronize"].includes(action)) return;

  const installationId = payload.installation?.id;
  const owner = payload.repository?.owner?.login;
  const repo = payload.repository?.name;
  const headSha = payload.pull_request?.head?.sha;
  const prNumber = payload.number;

  console.log("PR event", { delivery: id, name, action, installationId, owner, repo, headSha });

  if (!installationId || !owner || !repo || !headSha) {
    console.error("Missing required fields from webhook payload");
    return;
  }

  const octokit = await getInstallationOctokit(installationId);

  // 1) Create an in-progress check (request API — no .rest)
  const { data: check } = await octokit.request(
    "POST /repos/{owner}/{repo}/check-runs",
    {
      owner,
      repo,
      name: "Compliance",
      head_sha: headSha,
      status: "in_progress",
      headers: { "Accept": "application/vnd.github+json" }
    }
  );

  console.log(`[checks] in_progress created id=${check.id} for ${owner}/${repo}@${headSha}`);

  try {
    // 2) DEMO: simulate calling your Compliance Engine (replace this block)
    await new Promise((r) => setTimeout(r, 2000));
    const compliant = Math.random() > 0.5;
    const checks = [
      { name: "No Critical Vulns", pass: compliant, description: compliant ? "OK" : "Found 1 critical (demo)" },
      { name: "License Policy", pass: true, description: "OK" },
      { name: "Sonar Quality Gate", pass: true, description: "OK" },
    ];
    const passedCount = checks.filter(c => c.pass).length;

    const rows = checks.map(c => `| ${c.name} | ${c.pass ? "✅" : "❌"} | ${c.description} |`).join("\n");
    const table = `| Check | Result | Notes |\n|---|---|---|\n${rows}`;
    const summary = `${passedCount} / ${checks.length} checks passed`;
    const conclusion = compliant ? "success" : "failure";

    // 3) Complete the check
    await octokit.request(
      "PATCH /repos/{owner}/{repo}/check-runs/{check_run_id}",
      {
        owner,
        repo,
        check_run_id: check.id,
        status: "completed",
        conclusion,
        output: {
          title: `Compliance: ${compliant ? "PASSED" : "FAILED"}`,
          summary,
          text: `### Checks\n${table}`,
        },
        headers: { "Accept": "application/vnd.github+json" }
      }
    );

    console.log(`[checks] completed ${conclusion} for ${owner}/${repo}@${headSha}`);
  } catch (err) {
    console.error("Error during compliance run:", err);

    // Ensure the check is marked as failure so you can see it in the PR
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
            title: "Compliance: ERROR",
            summary: "Compliance run failed",
            text: "See server logs for details.",
          },
          headers: { "Accept": "application/vnd.github+json" }
        }
      );
    } catch (e2) {
      console.error("Also failed to update check run:", e2);
    }
  }
});

// HTTP server for webhooks
const server = http.createServer(createNodeMiddleware(webhooks, { path: "/events" }));
server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}/events`);
  console.log(`Ensure your tunnel (e.g., smee-client) forwards here.`);
});
