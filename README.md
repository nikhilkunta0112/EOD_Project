# EOD Reporting Desk

## Deploy to Cloudflare Pages

1. In Cloudflare, open Workers & Pages and create a Pages project using Git integration.
2. Connect GitHub and select `nikhilkunta0112/EOD_Project`.
3. Select the `main` production branch.
4. Use framework preset **None**, leave the build command blank, and set the build output directory to `public`.
5. Save and deploy. Cloudflare provides a `pages.dev` URL and deploys future pushes automatically.

No environment variables, database, or package installation are required.

## Run or deploy on Replit

1. Sign in and open https://replit.com/import.
2. Select ZIP and upload eod-reporting-desk-replit.zip.
3. Open the imported project. Run starts a preview of the site.
4. Open Publishing and select Static. Confirm the public directory is public and leave the build command blank.
5. Choose Public if anyone with the link should be able to use it. Publish and share the generated replit.app URL.

The app uses static HTML, CSS, and JavaScript. It needs no database, dependencies, or secrets. The Python command is for the editor preview.

Each user sets their name, recipients, projects, and time zone in Settings. Reports and history are stored in their browser for the published URL. Saved reports from a different hostname will still be on the old hostname.
