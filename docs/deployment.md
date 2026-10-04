# Website deployment

Push or merge changes to `prod` to update [transcribe.lukhausen.de](https://transcribe.lukhausen.de). Pushes to `main` do not deploy. The **Deploy website** GitHub Actions workflow installs dependencies, runs lint, builds with Node 22, and uploads `dist/` over verified FTPS. It can also be run manually with `prod` selected.

GitHub repository configuration:

- Variables: `HETZNER_FTP_HOST=www111.your-server.de`, `HETZNER_FTP_DIR=/transcribe` (relative to the dedicated FTP account's root).
- Secrets: `HETZNER_FTP_USER` and `HETZNER_FTP_PASSWORD`. Update these in repository Settings → Secrets and variables → Actions when the deployment account changes. Credentials stay out of the repository and browser bundle.

The dedicated account's `/transcribe/index.html` was checked against the live page before setup. Files are uploaded to temporary names and renamed into place; the entry page is published last. Old assets are retained for visitors with an older page open. Uploads never delete other server files. The included Apache configuration enables the cross-origin isolation needed by browser FFmpeg and prevents caching the entry page.

Check a run in the repository's Actions tab. A failed validation or build stops before uploading. A transfer failure leaves the previous entry page in place until all other files have uploaded; individual shared files may already have updated. To roll back, revert the offending changes on `prod` and push again. `python scripts/deployment/upload.py --check` tests login and the target folder without writes when the four configuration values are set in the environment.
