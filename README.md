# Sanoaf's chef portfolio

A public chef portfolio and a private editor for the owner. Visitors can browse the profile, culinary projects, journal thoughts, and approved customer reviews. The owner can change the profile, upload project photos or a portrait, add and edit content, and choose which entries are published.

The site is ready to run on a Node.js host with a persistent disk. It has no runtime package dependencies. Changes are stored on the server, so visitors see the same updates from every device.

## Run locally

Install Node.js 20 or newer, open a terminal in this folder, and run:

```sh
npm start
```

If Windows PowerShell blocks `npm.ps1`, use `npm.cmd start` or `node server.mjs` instead. The same `npm.cmd` form works for the test and reset commands; no PowerShell policy change is needed.

Open `http://127.0.0.1:3000` for the public portfolio. Open `http://127.0.0.1:3000/admin` for the owner editor.

The first start prints a **one-time owner setup token** in the terminal. Paste that token into the editor and choose a password of at least 12 characters. Keep the password and setup token private. Setup locks after the owner is created. The token is regenerated on a restart until setup is complete.

There is one owner account. An owner session lasts 12 hours and ends when the server restarts. The public portfolio has no editing access. Draft projects, thoughts, and reviews are omitted from the public API. Customer reviews are entered and approved by the owner; the site does not accept anonymous review submissions.

## Update the portfolio

- **My profile:** change the portrait, name, chef title, biography, contact details, specialties, and experience. Click **Save profile** to publish the changes.
- **Creations:** add a photo, title, category, description, and optional date. Mark **Feature this creation** to place it first in the public gallery.
- **Kitchen notes:** write or edit thoughts and stories from the kitchen.
- **Customer reviews:** enter feedback with the customer's permission. Leave the rating at **No star rating** when they did not supply one. The three initial reviews come from the original portfolio; confirm them with the owner before launch.
- For creations, notes, and reviews, check **Publish on my portfolio** to make the item visible, or leave it unchecked to save a private draft. Each item's Save button stores the change immediately.
- Use **Preview portfolio** to see the public page and **Copy link** to share it. Visitors have read access only, even if they know the `/admin` address.

The original 22 food photographs are retained. Existing experience dates are taken from the original portfolio and should be checked before launch. Kitchen notes start empty so the owner can write his own.

## Deploy

Use a host that can run a long-lived Node.js process and attach a persistent disk or volume. A static-only host does not run the editing API.

1. Upload the source folder or connect its repository.
2. Use Node.js 20 or newer and `npm start` as the start command. No dependency installation or build step is required.
3. Set `HOST=0.0.0.0` so the host can reach the server. Set `PORT` to the port supplied by the hosting platform.
4. Attach a persistent disk. Set `PORTFOLIO_DATA_DIR` to its absolute folder path, for example `/var/data/chef-portfolio`.
5. Serve the app through HTTPS and set `COOKIE_SECURE=true`. Configure the HTTPS proxy to preserve the incoming `Host` header.
6. Read the one-time setup token from the private server logs, open `https://your-domain/admin`, and create the owner's password.
7. Share `https://your-domain/` with visitors. Give the owner the `/admin` address and password separately.

The Dockerfile is also ready for a container host. Mount a persistent volume at `/app/data` and route HTTPS to port 3000. Set `COOKIE_SECURE=true` when the browser accesses the site using HTTPS. If running Docker locally over HTTP, leave it unset.

```sh
docker build -t sanoaf-portfolio .
docker run --rm -p 3000:3000 -v sanoaf-data:/app/data sanoaf-portfolio
```

An optional `PORTFOLIO_OWNER_PASSWORD` environment variable can initialize an owner on the first start instead of the setup flow. It is used only when no owner exists. Supply it through the host's secret settings and remove it after initialization. Do not place passwords in source files or commits.

## Persistence and backups

The data folder contains `portfolio.json`, the owner's salted password hash in `owner.json`, and the `uploads/` image directory. Back up the entire folder together. Stop the server before restoring a backup. Protect backups as private files; the application never serves the data JSON files.

The initial content is in `server/seed.json`. It is copied into the data folder only on the first start. Editing the seed after setup does not overwrite the owner's saved portfolio. Uploaded images remain on disk after removing an entry, so backups preserve previous photos. An uploaded image is public only when it is the saved profile portrait or belongs to a published project. Draft and unattached uploads can be previewed by the signed-in owner and are served without caching. Removing all public references makes an upload private at the server; previously public photos can remain in browser or proxy caches for up to one hour. The owner can clean unused upload files manually while the server is stopped.

To reset a forgotten password, **stop the running server**, remove `PORTFOLIO_OWNER_PASSWORD` if set, and run:

```sh
npm run reset-owner
```

This keeps the portfolio and photos, removes the old owner's password hash, starts the server, and prints a new setup token. Complete setup at `/admin`. Anyone who can access the private server logs and filesystem has administrative control, so restrict that access.

## Validation and security

Run the integration checks with `npm test`. Authentication uses a salted scrypt password hash and an HttpOnly, SameSite=Strict cookie. Editing requests also require a session CSRF token and an allowed Origin. Repeated login or setup attempts are limited. Concurrent saves use portfolio revisions to prevent overwriting a newer edit.

Uploads accept JPEG, PNG, and WebP files up to 8 MB, with file signature checks. Static files are served from an explicit allowlist; source, credentials, data, and environment files are private. Content Security Policy prevents inline or third-party scripts. The server binds to the local machine by default until `HOST` is configured for deployment.

Environment settings: `HOST`, `PORT`, `PORTFOLIO_DATA_DIR`, `COOKIE_SECURE`, and optional first-run `PORTFOLIO_OWNER_PASSWORD`. This application runs as one server process; keep one instance attached to a data folder so its in-memory sessions and revision checks stay consistent.

`.env.example` shows the available settings. It is documentation only; `npm start` reads environment variables supplied by the terminal or hosting platform and does not automatically load `.env` files. Reviews can be saved without a star rating (rating `0`). Projects need a category and a photo before publishing; unfinished photos can stay in drafts.
