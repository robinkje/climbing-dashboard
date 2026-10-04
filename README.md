# Climbing dashboard

A local-only dashboard for the ascents in `data.csv`, inspired by the Crag logbook view.

## Run locally

```bash
npm start
```

Open [http://localhost:5173](http://localhost:5173).

No installation or external services are required. The page reads `data.csv` in the browser and does not upload the data.

## Daily 8a.nu export

The `Export 8a.nu data` GitHub Actions workflow signs in at 04:17 UTC each day, downloads 8a.nu's CSV export, validates it, and commits a changed `data.csv`.

Add these repository secrets under **Settings → Secrets and variables → Actions**:

- `EIGHTA_USERNAME`: the email address or username used to sign in to 8a.nu
- `EIGHTA_PASSWORD`: the account password

Then run **Actions → Export 8a.nu data → Run workflow** once to verify the credentials. The workflow requires an account without an interactive second factor. Credentials are only passed to the browser process and are not written to logs or files.

The export includes locations and comments and is committed to this repository. Keep the repository private if that data should not be public. 8a.nu uses Cloudflare bot protection; if it begins blocking GitHub-hosted runners, use the same workflow on a self-hosted runner or run `npm run export:8a` locally with the two environment variables set.
