# EOD Reporting Desk

Prepare, review, and save end-of-day reports. Supports static hosting with browser storage, or a local Python server with SQLite.

## Deploy the static site to Cloudflare Pages

1. Open Cloudflare **Workers & Pages**, create a **Pages** project, and choose Git integration.
2. Connect the GitHub repository `nikhilkunta0112/EOD_Project`.
3. Set production branch to `main` and framework preset to **None**.
4. Leave the build command blank. Set build output directory to `public` and leave root directory at the repository root.
5. Save and deploy. Open the generated `pages.dev` URL.

No dependencies, environment variables, database, or paid plan are needed for this static version. Future pushes to `main` trigger deployments when Git integration is configured.

On static hosting, settings, drafts, and history are saved only in each user's browser for that URL. They do not sync between devices or browsers. Clearing browser data removes them. The interface displays **This browser - 3 days**.

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
node --test test_storage.cjs
python -m unittest -v
```
