# Script Walkthrough — index.js

This document explains how the Playwright validation script works, section by section.

## How to Run

```bash
npm i                # install dependencies (first time only)
node index.js        # run the script
```

The script launches a Chromium window with a settings dashboard. Configure the validation parameters, click "Run Validation", and the script scrapes Hacker News, checks the sort order, and displays results both in the terminal and as an HTML report in the browser.

## Application Flow

```
Launch -> Settings UI -> Run Validation -> Console Report -> HTML Report
                ^                                                |
                |_____________ "Run Again" button _______________|
```

The user can run multiple validation cycles without restarting the script. Previous settings are preserved between runs.

## Script Structure

The script is organized into seven sections, each handling a distinct responsibility.

### 1. Default Configuration

```js
const DEFAULT_CONFIG = {
  targetArticles: 100,
  url: "https://news.ycombinator.com/newest",
  maxRetries: 3,
  retryDelayMs: 2000,
  navigationTimeoutMs: 15000,
  reportPath: path.join(__dirname, "report.html"),
};
```

These defaults populate the settings UI on first launch. They are not modified at runtime — the user's choices are stored in a separate `activeConfig` object that carries forward between runs.

### 2. Console Formatting

A small `fmt` helper object wraps strings in ANSI escape codes for colored terminal output. The `log()` function prefixes every message with a timestamp so you can see exactly when each step happened.

### 3. Settings UI (`generateSettingsHtml` and `waitForSettings`)

**`generateSettingsHtml(config)`** builds the HTML for the settings dashboard. It creates a form with labeled inputs for every configuration field, a "Run Validation" button, and a "Reset Defaults" button. The current config values are injected into the form so returning users see their previous choices.

**`waitForSettings(page, config)`** displays the settings page and bridges the browser back to Node.js using Playwright's `exposeFunction` API:

1. A function called `__onSettingsSubmit` is exposed to the browser's `window` object.
2. When the user clicks "Run Validation", the browser collects all form values into a JSON object and calls `__onSettingsSubmit`.
3. The Node.js side receives the JSON, parses it, and resolves a Promise with the user's config.

This pattern avoids polling and gives clean async control flow — `await waitForSettings()` blocks until the user clicks Run.

### 4. Scraping (`scrapeArticles` and `collectArticles`)

**`scrapeArticles(page)`** runs inside the browser context using Playwright's `$$eval`. It selects every `tr.athing` row (each HN article) and extracts:

- **title** — the article's display text from the title link
- **timestamp** — the precise UTC datetime from the `span.age` element's `title` attribute (e.g., `2026-02-11T16:17:00`)
- **ageText** — the human-readable relative time (e.g., "2 minutes ago")

**`collectArticles(page, config)`** calls `scrapeArticles` in a loop, paginating by clicking the "More" link at the bottom of each HN page. Since HN displays roughly 30 articles per page, this typically runs across 4 pages to reach 100. It filters out any articles missing a timestamp and stops early if it runs out of pages.

**`navigateWithRetry(page, linkLocator, config)`** wraps the "More" link click in retry logic. If the page fails to load (network timeout, dropped connection), it waits and tries again up to the configured retry count.

### 5. Validation (`validateSortOrder`)

```js
function validateSortOrder(articles) {
  const violations = [];
  for (let i = 0; i < articles.length - 1; i++) {
    const current = new Date(articles[i].timestamp);
    const next = new Date(articles[i + 1].timestamp);
    if (current < next) {
      violations.push({ position: i + 1, article: articles[i], nextArticle: articles[i + 1] });
    }
  }
  return violations;
}
```

This walks the list pairwise. For the articles to be sorted newest-to-oldest, each article's timestamp must be greater than or equal to the next one's. If article N is older than article N+1, that pair is recorded as a violation.

### 6. Reporting

**Console report** — `printReport()` writes a formatted summary block to the terminal showing the article count, elapsed time, timestamp range, and a PASS or FAIL verdict. On failure, each violation is listed with its position and the two conflicting timestamps.

**HTML report** — `generateHtmlReport()` builds a self-contained HTML page with:

- A header with the title and a "Run Again" button
- Four summary cards (Result, Articles Checked, Violations, Duration)
- A config summary line showing the URL, retry count, and timeout used for the run
- A full table listing every article with its position number, title, timestamp, and relative age
- Violation rows highlighted in red with a badge

The report uses HN's signature orange (`#ff6600`) for table headers and clean card-based styling.

### 7. Main Orchestration (`run`)

The `run()` function manages the full application lifecycle as a loop:

1. **Launch** — Opens Chromium in headed mode and creates a browser context.
2. **Settings phase** — Opens a new tab with the settings UI and waits for the user to click "Run Validation".
3. **Validation phase** — Opens a separate tab, navigates to HN, scrapes articles, validates sort order, and prints results to the console. The scraping tab is closed when done.
4. **Report phase** — Opens the HTML report in a new tab with a "Run Again" button wired via `exposeFunction`.
5. **Decision point** — The script waits for either:
   - "Run Again" click → closes the report tab and loops back to step 2 with the previous settings preserved.
   - Tab/window close → exits the loop and shuts down the browser.
6. **Cleanup** — The `finally` block always closes the browser, even on errors.

Each phase uses its own page (tab), keeping the navigation history clean and avoiding state leakage between runs.

## Key Design Decisions

**Why use `exposeFunction` for the settings bridge?**
Playwright's `exposeFunction` creates a direct channel from browser JavaScript to Node.js. It avoids polling, avoids writing temp files, and integrates naturally with async/await. The browser calls a function, Node.js gets the result — clean and simple.

**Why use the `title` attribute instead of parsing relative age text?**
The relative text ("2 minutes ago") is imprecise and locale-dependent. The `title` attribute contains an exact UTC timestamp down to the second, which makes comparison reliable and deterministic.

**Why retry on navigation?**
Hacker News is a lightweight site, but any network request can fail transiently. Retrying with a short backoff handles intermittent issues without overcomplicating the script.

**Why a run-again loop instead of a one-shot script?**
For a QA tool, being able to tweak settings and re-run without restarting the process saves time. It also makes it easy to experiment with different article counts or URLs during testing.

**Why separate tabs for each phase?**
Each phase (settings, scraping, report) gets its own page. This prevents navigation history from interfering between phases and makes cleanup straightforward — just close the tab.
