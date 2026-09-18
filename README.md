# VJ Signature Salon — Website + Admin Panel

A small full-stack project:
- **Frontend:** the public salon website (`public/index.html`), pulling its services, team, and contact details live from the backend.
- **Backend:** a Node.js + Express server with a simple JSON-file database (`data/db.json`) — no database installation needed.
- **Admin panel:** `public/admin.html` — a password-protected page to add/edit/delete services and team members, and update salon settings (name, address, phone, hours, logo).

## Setup

```bash
npm install
npm start
```

Then open:
- Public site: http://localhost:3000
- Admin panel: http://localhost:3000/admin.html
## How it works

- All salon data (services, team, settings) lives in `data/db.json`. The admin panel edits this file through the API; the public site reads from the same API on every page load, so changes show up immediately — no rebuilding or redeploying needed.
- Admin login uses a server-side session cookie (`express-session`). Only logged-in sessions can create, edit, or delete data — the public site only ever reads.
- To add a logo: paste an image URL into Settings → Logo URL. To use your own uploaded logo file instead of a URL, drop the image into `public/` (e.g. `public/logo.png`) and set the Logo URL field to `/logo.png`.
- Team photos work the same way — paste a URL, or drop images into `public/` and reference them as `/your-photo.jpg`.

## Project structure

```
vj-salon/
├── server.js           # Express server + REST API
├── package.json
├── data/
│   └── db.json          # services, team, settings ("database")
└── public/
    ├── index.html        # public site (fetches data from the API)
    ├── admin.html         # admin login + dashboard
    ├── admin.js            # admin panel logic
    └── styles.css           # shared styling for both pages
```


