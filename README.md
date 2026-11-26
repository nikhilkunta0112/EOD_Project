# EOD Reporting Desk

Prepare, review, and save end-of-day reports using a local SQLite database.

## Run locally

Install Python 3.9 or newer, then run from the project directory:

```sh
python server.py
```

Open http://localhost:5000. To use a different port, run `python server.py --port 8000`.
No extra Python packages are required. Stop the server with Ctrl+C.

## Storage and retention

The database is created automatically at `data/eod.sqlite3` and excluded from Git.
Drafts and saved report history are kept for **today and the previous two calendar days**, using the time zone selected in Settings. Older records are automatically deleted on reads, writes, and during the server's periodic cleanup. Profile settings remain saved.

Existing browser data is imported on the first visit if the database has no settings. Only records within the three-day window are retained. Keep using the same browser URL for the import to find your previous data.

The server listens only on this computer. All browser sessions using this server share one local profile and database. SQLite writes are queued by the browser, and failed saves show a notification.

## Hosting

SQLite storage requires the Python server and a persistent writable disk. Static-only hosting, including Cloudflare Pages, cannot run this version's storage API. For local use, always start the app with `python server.py`.
