# EOD Reporting Desk

A static app for preparing, reviewing, and saving end-of-day reports.

## Run locally

From the project directory, run:

```sh
python -m http.server 5000 --bind 127.0.0.1 --directory public
```

Open http://localhost:5000 in your browser.

## Deploy to Cloudflare Pages

1. In Cloudflare, open Workers & Pages and create a Pages project using Git integration.
2. Connect GitHub and select `nikhilkunta0112/EOD_Project`.
3. Select the `main` production branch.
4. Use framework preset **None**, leave the build command blank, and set the build output directory to `public`.
5. Save and deploy. Cloudflare provides a `pages.dev` URL and deploys future pushes automatically.

The app uses static HTML, CSS, and JavaScript. No environment variables, database, or package installation are required.

Each user sets their name, recipients, projects, and time zone in Settings. Reports and history are stored in their browser for the published URL. Saved reports from a different hostname will still be on the old hostname.
