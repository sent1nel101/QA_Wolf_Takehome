const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

// ── Default configuration ──────────────────────────────────────────────────────
// These defaults populate the settings UI on first launch.

const DEFAULT_CONFIG = {
  targetArticles: 100,
  url: "https://news.ycombinator.com/newest",
  maxRetries: 3,
  retryDelayMs: 2000,
  navigationTimeoutMs: 15000,
  reportPath: path.join(__dirname, "report.html"),
};

// ── Console formatting helpers ─────────────────────────────────────────────────

const fmt = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
};

function log(msg) {
  const ts = new Date().toLocaleTimeString();
  console.log(`${fmt.dim(`[${ts}]`)} ${msg}`);
}

// ── Settings UI ────────────────────────────────────────────────────────────────

/**
 * Builds the settings dashboard HTML. Each CONFIG field gets its own
 * labeled input so the user can tweak values before kicking off a run.
 */
function generateSettingsHtml(config) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HN Validator — Settings</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 2rem; }
  .container { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: .25rem; }
  .subtitle { color: #888; font-size: .85rem; margin-bottom: 1.5rem; }
  .fields { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; }
  .field { background: #fff; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .field.full { grid-column: 1 / -1; }
  .field label { display: block; font-size: .7rem; text-transform: uppercase; letter-spacing: .05em; color: #888; margin-bottom: .4rem; font-weight: 600; }
  .field input { width: 100%; padding: .5rem .625rem; border: 1px solid #ddd; border-radius: 6px; font-size: .9rem; font-family: inherit; transition: border-color .15s; }
  .field input:focus { outline: none; border-color: #ff6600; box-shadow: 0 0 0 3px rgba(255,102,0,.12); }
  .field .hint { font-size: .7rem; color: #aaa; margin-top: .3rem; }
  .actions { display: flex; gap: .75rem; align-items: center; }
  #run-btn { background: #ff6600; color: #fff; border: none; padding: .7rem 2rem; border-radius: 8px; font-size: .95rem; font-weight: 600; cursor: pointer; transition: background .15s; }
  #run-btn:hover { background: #e55b00; }
  #run-btn:disabled { background: #ccc; cursor: not-allowed; }
  #reset-btn { background: none; border: 1px solid #ddd; padding: .65rem 1.25rem; border-radius: 8px; font-size: .85rem; cursor: pointer; color: #666; transition: border-color .15s; }
  #reset-btn:hover { border-color: #999; }
  .status { font-size: .8rem; color: #888; margin-left: auto; }
</style>
</head>
<body>
  <div class="container">
    <h1>Hacker News Sort Validator</h1>
    <p class="subtitle">Configure the validation parameters below, then hit Run.</p>

    <div class="fields">
      <div class="field">
        <label for="targetArticles">Target Articles</label>
        <input type="number" id="targetArticles" value="${config.targetArticles}" min="1" max="500">
        <div class="hint">Number of articles to validate (default: 100)</div>
      </div>

      <div class="field">
        <label for="maxRetries">Max Retries</label>
        <input type="number" id="maxRetries" value="${config.maxRetries}" min="0" max="10">
        <div class="hint">Retry attempts per page navigation</div>
      </div>

      <div class="field">
        <label for="retryDelayMs">Retry Delay (ms)</label>
        <input type="number" id="retryDelayMs" value="${config.retryDelayMs}" min="0" max="30000" step="500">
        <div class="hint">Wait time between retries</div>
      </div>

      <div class="field">
        <label for="navigationTimeoutMs">Navigation Timeout (ms)</label>
        <input type="number" id="navigationTimeoutMs" value="${config.navigationTimeoutMs}" min="1000" max="60000" step="1000">
        <div class="hint">Max wait for a page to load</div>
      </div>

      <div class="field full">
        <label for="url">Hacker News URL</label>
        <input type="text" id="url" value="${config.url}">
        <div class="hint">The page to scrape — change this if you want to test a different HN view</div>
      </div>

      <div class="field full">
        <label for="reportPath">Report Output Path</label>
        <input type="text" id="reportPath" value="${config.reportPath.replace(/\\/g, "\\\\")}">
        <div class="hint">Where to save the HTML report on disk</div>
      </div>
    </div>

    <div class="actions">
      <button id="run-btn">Run Validation</button>
      <button id="reset-btn">Reset Defaults</button>
      <span class="status" id="status"></span>
    </div>
  </div>

  <script>
    const defaults = ${JSON.stringify(config)};

    document.getElementById("reset-btn").addEventListener("click", () => {
      document.getElementById("targetArticles").value = defaults.targetArticles;
      document.getElementById("maxRetries").value = defaults.maxRetries;
      document.getElementById("retryDelayMs").value = defaults.retryDelayMs;
      document.getElementById("navigationTimeoutMs").value = defaults.navigationTimeoutMs;
      document.getElementById("url").value = defaults.url;
      document.getElementById("reportPath").value = defaults.reportPath;
    });

    document.getElementById("run-btn").addEventListener("click", () => {
      const btn = document.getElementById("run-btn");
      btn.disabled = true;
      document.getElementById("status").textContent = "Starting validation...";

      const settings = {
        targetArticles: parseInt(document.getElementById("targetArticles").value, 10),
        maxRetries: parseInt(document.getElementById("maxRetries").value, 10),
        retryDelayMs: parseInt(document.getElementById("retryDelayMs").value, 10),
        navigationTimeoutMs: parseInt(document.getElementById("navigationTimeoutMs").value, 10),
        url: document.getElementById("url").value.trim(),
        reportPath: document.getElementById("reportPath").value.trim(),
      };

      // Bridge to Node.js — this function is exposed by Playwright
      window.__onSettingsSubmit(JSON.stringify(settings));
    });
  </script>
</body>
</html>`;
}

// ── Scraping ───────────────────────────────────────────────────────────────────

/**
 * Pulls article data from the current HN page. Each article row (.athing)
 * is paired with a subtext row containing the age and title metadata.
 */
async function scrapeArticles(page) {
  return page.$$eval("tr.athing", (rows) =>
    rows.map((row) => {
      const titleAnchor = row.querySelector("td.title span.titleline > a");
      const subtext = row.nextElementSibling;
      const ageEl = subtext?.querySelector("span.age");

      return {
        title: titleAnchor?.textContent?.trim() ?? "(untitled)",
        timestamp: ageEl?.getAttribute("title") ?? null,
        ageText: ageEl?.textContent?.trim() ?? "",
      };
    })
  );
}

/**
 * Collects articles across multiple pages by following the "More" link.
 * Includes retry logic in case a page navigation fails mid-run.
 */
async function collectArticles(page, config) {
  const articles = [];
  let pageNum = 1;

  while (articles.length < config.targetArticles) {
    log(`Scraping page ${pageNum}... (${articles.length}/${config.targetArticles} articles so far)`);

    const pageArticles = await scrapeArticles(page);

    // Sanity check — if a page is empty something went wrong
    if (pageArticles.length === 0) {
      log(fmt.yellow("WARNING: Empty page encountered, stopping collection."));
      break;
    }

    // Filter out any articles with missing timestamps (shouldn't happen, but be safe)
    const valid = pageArticles.filter((a) => a.timestamp !== null);
    if (valid.length < pageArticles.length) {
      log(
        fmt.yellow(
          `WARNING: ${pageArticles.length - valid.length} article(s) missing timestamps on page ${pageNum}.`
        )
      );
    }

    articles.push(...valid);
    pageNum++;

    if (articles.length < config.targetArticles) {
      const moreLink = page.locator("a.morelink");
      if ((await moreLink.count()) === 0) {
        log(fmt.yellow("WARNING: No 'More' link found — ran out of pages."));
        break;
      }

      await navigateWithRetry(page, moreLink, config);
    }
  }

  return articles.slice(0, config.targetArticles);
}

/**
 * Clicks a navigation link with retry logic. HN can occasionally be slow
 * or drop a request, so we retry a few times before giving up.
 */
async function navigateWithRetry(page, linkLocator, config) {
  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      await linkLocator.click();
      await page.waitForSelector("span.age", {
        timeout: config.navigationTimeoutMs,
      });
      return;
    } catch (err) {
      if (attempt === config.maxRetries) {
        throw new Error(
          `Navigation failed after ${config.maxRetries} attempts: ${err.message}`
        );
      }
      log(
        fmt.yellow(
          `Navigation attempt ${attempt} failed, retrying in ${config.retryDelayMs}ms...`
        )
      );
      await new Promise((r) => setTimeout(r, config.retryDelayMs));
    }
  }
}

// ── Validation ─────────────────────────────────────────────────────────────────

/**
 * Walks the article list pairwise and flags any case where an article
 * appears older than the one after it (violating newest-first order).
 */
function validateSortOrder(articles) {
  const violations = [];

  for (let i = 0; i < articles.length - 1; i++) {
    const current = new Date(articles[i].timestamp);
    const next = new Date(articles[i + 1].timestamp);

    if (current < next) {
      violations.push({
        position: i + 1,
        article: articles[i],
        nextArticle: articles[i + 1],
      });
    }
  }

  return violations;
}

// ── Console report ─────────────────────────────────────────────────────────────

function printReport(articles, violations, durationMs) {
  const seconds = (durationMs / 1000).toFixed(1);

  console.log("\n" + "=".repeat(70));
  console.log(fmt.bold("  Hacker News Sort Order — Validation Report"));
  console.log("=".repeat(70));
  console.log(`  Articles checked:  ${fmt.cyan(articles.length)}`);
  console.log(`  Time elapsed:      ${fmt.cyan(seconds + "s")}`);
  console.log(`  Oldest article:    ${fmt.dim(articles[articles.length - 1].timestamp)}`);
  console.log(`  Newest article:    ${fmt.dim(articles[0].timestamp)}`);
  console.log("-".repeat(70));

  if (violations.length === 0) {
    console.log(
      fmt.green(
        `  PASS: All ${articles.length} articles are correctly sorted newest to oldest.`
      )
    );
  } else {
    console.log(
      fmt.red(`  FAIL: ${violations.length} sort order violation(s) detected.\n`)
    );
    for (const v of violations) {
      console.log(fmt.red(`  #${v.position}: "${v.article.title}"`));
      console.log(
        `    ${v.article.timestamp} should come before ${v.nextArticle.timestamp}`
      );
    }
  }

  console.log("=".repeat(70) + "\n");
}

// ── HTML report ────────────────────────────────────────────────────────────────

function generateHtmlReport(articles, violations, durationMs, config) {
  const passed = violations.length === 0;
  const seconds = (durationMs / 1000).toFixed(1);

  // Build a set of violation positions for quick lookup when rendering rows
  const violationPositions = new Set(violations.map((v) => v.position));

  const articleRows = articles
    .map((a, i) => {
      const isViolation = violationPositions.has(i + 1);
      const rowClass = isViolation ? ' class="violation"' : "";
      const badge = isViolation ? '<span class="badge">OUT OF ORDER</span>' : "";
      return `
        <tr${rowClass}>
          <td>${i + 1}</td>
          <td>${escapeHtml(a.title)}</td>
          <td>${a.timestamp}</td>
          <td>${a.ageText} ${badge}</td>
        </tr>`;
    })
    .join("");

  // Show the config that was used for this run
  const configSummary = `
    <div class="config-summary">
      <span>URL: ${escapeHtml(config.url)}</span>
      <span>Retries: ${config.maxRetries}</span>
      <span>Timeout: ${config.navigationTimeoutMs}ms</span>
    </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>HN Sort Validation Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 2rem; }
  .container { max-width: 960px; margin: 0 auto; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 1.5rem; flex-wrap: wrap; gap: .75rem; }
  h1 { font-size: 1.5rem; }
  #rerun-btn { background: #ff6600; color: #fff; border: none; padding: .55rem 1.25rem; border-radius: 8px; font-size: .85rem; font-weight: 600; cursor: pointer; transition: background .15s; }
  #rerun-btn:hover { background: #e55b00; }
  .summary { display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .card { background: #fff; border-radius: 8px; padding: 1rem 1.25rem; flex: 1; min-width: 140px; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .card .label { font-size: .75rem; text-transform: uppercase; letter-spacing: .05em; color: #888; margin-bottom: .25rem; }
  .card .value { font-size: 1.25rem; font-weight: 600; }
  .status-pass { color: #16a34a; }
  .status-fail { color: #dc2626; }
  .config-summary { display: flex; gap: 1.5rem; flex-wrap: wrap; font-size: .75rem; color: #999; margin-bottom: 1.5rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  th { background: #ff6600; color: #fff; text-align: left; padding: .625rem .75rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; }
  td { padding: .5rem .75rem; border-bottom: 1px solid #eee; font-size: .85rem; }
  tr:last-child td { border-bottom: none; }
  tr.violation { background: #fef2f2; }
  .badge { background: #dc2626; color: #fff; font-size: .65rem; padding: .15rem .4rem; border-radius: 4px; font-weight: 600; margin-left: .5rem; }
  .footer { margin-top: 1.5rem; font-size: .75rem; color: #aaa; text-align: center; }
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>Hacker News Sort Validation Report</h1>
      <button id="rerun-btn" onclick="window.__onRerun()">Run Again</button>
    </div>
    <div class="summary">
      <div class="card">
        <div class="label">Result</div>
        <div class="value ${passed ? "status-pass" : "status-fail"}">${passed ? "PASS" : "FAIL"}</div>
      </div>
      <div class="card">
        <div class="label">Articles Checked</div>
        <div class="value">${articles.length}</div>
      </div>
      <div class="card">
        <div class="label">Violations</div>
        <div class="value ${violations.length > 0 ? "status-fail" : ""}">${violations.length}</div>
      </div>
      <div class="card">
        <div class="label">Duration</div>
        <div class="value">${seconds}s</div>
      </div>
    </div>
    ${configSummary}
    <table>
      <thead>
        <tr><th>#</th><th>Title</th><th>Timestamp (UTC)</th><th>Age</th></tr>
      </thead>
      <tbody>${articleRows}</tbody>
    </table>
    <div class="footer">Generated on ${new Date().toISOString()}</div>
  </div>
</body>
</html>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Main ───────────────────────────────────────────────────────────────────────

/**
 * Waits for the user to configure settings in the browser UI and click Run.
 * Returns the parsed config values from the form.
 */
async function waitForSettings(page, config) {
  // Expose the bridge function so the browser can pass settings back to Node
  let resolveSettings;
  const settingsPromise = new Promise((resolve) => {
    resolveSettings = resolve;
  });

  await page.exposeFunction("__onSettingsSubmit", (json) => {
    resolveSettings(JSON.parse(json));
  });

  await page.setContent(generateSettingsHtml(config));
  log("Settings UI loaded — waiting for user input.");

  return settingsPromise;
}

/**
 * Runs one full validation cycle: scrape, validate, report.
 * Uses a separate page so the settings page stays available in history.
 */
async function runValidation(context, config) {
  const startTime = Date.now();
  const page = await context.newPage();

  try {
    page.setDefaultTimeout(config.navigationTimeoutMs);

    log(`Navigating to ${fmt.cyan(config.url)}`);
    await page.goto(config.url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("span.age");

    const articles = await collectArticles(page, config);
    const durationMs = Date.now() - startTime;

    if (articles.length < config.targetArticles) {
      log(
        fmt.red(
          `ERROR: Only collected ${articles.length}/${config.targetArticles} articles.`
        )
      );
      return { success: false };
    }

    const violations = validateSortOrder(articles);
    printReport(articles, violations, durationMs);

    // Save the HTML report to disk
    const html = generateHtmlReport(articles, violations, durationMs, config);
    fs.writeFileSync(config.reportPath, html);
    log(`HTML report saved to ${fmt.cyan(config.reportPath)}`);

    return { success: true, articles, violations, durationMs, html };
  } finally {
    await page.close();
  }
}

/**
 * Main loop: show settings UI -> run validation -> show report -> repeat.
 * The user can click "Run Again" on the report to return to settings.
 */
async function run() {
  let browser;

  try {
    log(fmt.bold("Launching browser..."));
    browser = await chromium.launch({ headless: false });
    const context = await browser.newContext();

    // This config object carries forward between runs so the user's
    // previous values are preserved if they click "Run Again".
    let activeConfig = { ...DEFAULT_CONFIG };

    // Main loop — each iteration is one settings -> validate -> report cycle
    let keepRunning = true;
    while (keepRunning) {
      const settingsPage = await context.newPage();

      // Phase 1: collect user settings from the UI
      const userSettings = await waitForSettings(settingsPage, activeConfig);
      activeConfig = { ...userSettings };
      log(fmt.bold("Settings received — starting validation."));
      log(fmt.dim(JSON.stringify(activeConfig, null, 2)));
      await settingsPage.close();

      // Phase 2: scrape and validate
      const result = await runValidation(context, activeConfig);

      if (!result.success) {
        process.exitCode = 1;
        break;
      }

      if (result.violations.length > 0) {
        process.exitCode = 1;
      }

      // Phase 3: show report with a "Run Again" option
      const reportPage = await context.newPage();

      let resolveRerun;
      const rerunPromise = new Promise((resolve) => {
        resolveRerun = resolve;
      });

      await reportPage.exposeFunction("__onRerun", () => {
        resolveRerun(true);
      });

      await reportPage.setContent(result.html);
      log(fmt.dim("Report displayed — click 'Run Again' or close the tab to exit."));

      // Wait for either the "Run Again" click or the tab/window closing
      const action = await Promise.race([
        rerunPromise,
        reportPage.waitForEvent("close").then(() => false),
      ]);

      // Clean up the report page if it's still open
      if (!reportPage.isClosed()) await reportPage.close();

      keepRunning = action === true;
    }
  } catch (err) {
    log(fmt.red(`ERROR: ${err.message}`));
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

run();
