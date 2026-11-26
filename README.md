# EOD Reporting Desk

Prepare, review, and save end-of-day reports. Supports static hosting with browser storage, or a local Python server with SQLite.

## Generate an EOD from raw notes

Paste your raw work notes and select **Generate EOD**. No profile setup or per-update fields are required. The formatter adds a professional subject, greeting, work sections, and closing, and normalizes spacing, capitalization, and punctuation. It recognizes clear completion and pending wording; ambiguous notes remain under Work Updates rather than being marked completed.

When configured on Cloudflare, **Generate EOD** sends report drafts to Workers AI for grammar correction and professional rewriting. The prompt requires preserving facts, blockers, uncertainty, and completion status. Review generated wording before sharing. Reports remain editable. If AI is unavailable, times out, exceeds its free allowance, or returns invalid output, the original rule formatter provides a clearly labeled fallback. Requests do not overwrite edits made while AI is running.

## Deploy to Cloudflare Pages with Workers AI

1. Open Cloudflare **Workers & Pages**, create or select your **Pages** project, and connect GitHub repository `nikhilkunta0112/EOD_Project`.
2. Set production branch to `main`, framework preset to **None**, build command blank, and build output directory to `public`. Keep root directory at the repository root so Cloudflare discovers `functions/`.
3. Under your Pages project's **Settings**, select the production environment, then **Bindings > Add > Workers AI**. Set the variable name to exactly **AI** and save. Add the same binding to Preview if you want AI on preview deployments.
4. Deploy or redeploy after adding the binding. Existing Git-connected projects can use Retry deployment for the latest commit.
5. Open the generated `pages.dev` URL, paste some notes, and select **Generate EOD**. A successful rewrite displays **Rewritten with Cloudflare AI**. If the binding is missing, the app explicitly indicates basic formatting was used.

No external API key is needed: `functions/api/reformat.js` calls Workers AI using the server-side `AI` binding. The selected model is `@cf/meta/llama-3.1-8b-instruct`, with JSON output validation and bounded input/output lengths. The Function does not log or store report contents. The browser sends current report drafts, including any names in them, to Cloudflare for processing when Generate EOD is selected.

`public/_routes.json` routes only `/api/reformat` through Pages Functions. Static assets and `/api/state` bypass Functions; the latter uses the existing static fallback to browser storage. Keep using Git integration: uploading only the `public` folder omits the Function.

Workers AI includes a daily free allowance of 10,000 neurons; usage depends on report length. The free plan stops AI calls when the allowance is exhausted. Keep the Workers Free plan to avoid paid overages. The public endpoint shares the account's AI allowance among visitors; same-origin checks are not authentication or a per-user quota.

Official references: [Pages Workers AI bindings](https://developers.cloudflare.com/pages/functions/bindings/#workers-ai), [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/).

### Storage on Cloudflare

Settings, drafts, and history are saved only in each user's browser for that URL. They do not sync between devices or browsers. Clearing browser data removes them. The interface displays **This browser - 3 days**. No database is needed for the hosted version.

## Three-day retention

Drafts and saved history are kept for **today and the previous two calendar days**, using the time zone selected in Settings. Expired days are removed on startup, saves, and periodic cleanup while the app is open. Profile settings remain saved. Browser data cannot be deleted while the site is closed; it is cleaned on the next visit.

## Run locally with SQLite

Install Python 3.9 or newer, then run:

```sh
python server.py
```

Open http://localhost:5000. To use a different port, run `python server.py --port 8000`. No extra Python packages are required. Stop the server with Ctrl+C.

The app detects the local storage API and displays **SQLite - 3 days**. Its database is created at `data/eod.sqlite3` and excluded from Git. Existing browser data on that same URL is imported when the database has no settings. The server listens only on this computer; browser sessions using it share one local profile and database.

To preview the static browser-storage version locally instead:

```sh
python -m http.server 5000 --bind 127.0.0.1 --directory public
```

## Checks

```sh
node --check public/app.js
node --test test_storage.cjs test_ai.cjs
python -m unittest -v
```

## Local AI development (optional)

To run Pages Functions locally, use the official Wrangler CLI from the project root:

```sh
npx wrangler login
npx wrangler pages dev public --ai AI
```

AI inference uses your Cloudflare account and consumes its allowance even during local development. The Python server remains a SQLite-only option with basic formatting; it does not run Cloudflare Pages Functions.

The automated AI tests mock the binding and verify validation, fallback, and concurrency behavior without using the AI allowance. A live Cloudflare smoke test requires the deployed Function and configured AI binding.
