# Prayer Rotation Schedule

A small, no-backend webapp for randomizing your weekly opening & closing prayer
rotation, with a one-click way to swap someone out when they can't make it.

## Features

- **Fair random rotation** — everyone is shuffled into a random order and
  must go through the full cycle before anyone repeats. No one is ever
  picked for opening/closing back-to-back weeks, and no one does both
  opening *and* closing in the same week.
- **This week / days until next meeting** — meeting day defaults to
  Thursday (configurable) and the app always shows the current week plus
  as many future weeks as you want (default 8).
- **Reshuffle a specific person** — click the 🔀 next to anyone's name,
  then click 🔀 on any other upcoming assignment to swap the two people.
  Example: Keyan is out for closing prayer today, but Tony is scheduled
  for opening prayer in two weeks — click Keyan's 🔀, then click Tony's
  🔀, and they trade spots. Both cells get a small ↔ marker so everyone
  can see it was manually adjusted, and the swap is logged at the bottom
  of the page.
- **Manage participants** — add, rename, recolor, or remove people right
  from the sidebar.
- **Export / Import** — download the current schedule as a `.json` file,
  or load one back in.

## About data storage (read this)

This app has **no server or database** — it's plain HTML/CSS/JS, which is
what makes it possible to host for free on GitHub Pages. Because of that,
**all changes (participants, swaps, settings) are saved only in the
browser that made them** (via `localStorage`). Two people opening the same
GitHub Pages link on their own computers will each see their own local
copy, not each other's edits.

For a small team, the simplest way to use this today is to have **one
person be the "admin"** who makes changes, and everyone else just glances
at the page for reference — or the admin periodically posts a screenshot
or the exported JSON in a group chat.

If down the road you want real shared/live sync between everyone's
devices, the natural upgrades are:

1. **GitHub-as-a-database**: the admin's browser commits the updated
   `data.json` straight to this repo via the GitHub API (using a personal
   access token entered once), and everyone's page just reads the latest
   `data.json` on load. No server needed, but does require a bit more code.
2. **A free real-time backend** like Firebase/Supabase, so every device
   reads/writes the same shared data instantly.

Both are straightforward to add later without throwing away anything
here — just ask and it can be built in.

## Deploying to GitHub Pages

1. Create a new repository on GitHub (e.g. `prayer-rotation`).
2. Add these four files to the repo: `index.html`, `style.css`, `app.js`,
   `data.json` (drag-and-drop them on github.com, or `git push` them).
3. On GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to "Deploy from a
   branch," pick your default branch (usually `main`) and folder `/root`,
   then save.
5. GitHub will give you a URL like
   `https://<your-username>.github.io/prayer-rotation/` — that's the link
   to share with your team.

It can take a minute or two for the page to go live the first time.

## Customizing the starting schedule

`data.json` ships pre-loaded with the same 9 people and the same
Aug 13 – Oct 8, 2026 schedule shown in your original spreadsheet, so the
app picks up right where your Excel sheet left off. Everything after that
point is freshly randomized. You can edit `data.json` directly before
deploying (or just use the in-app "Add participant" / "Reset to default
schedule" controls) if you'd rather start from scratch.

## Local testing

Because the app `fetch()`es `data.json`, opening `index.html` directly
from disk (`file://`) will fail in most browsers due to CORS restrictions
on local files. Instead, serve the folder locally, e.g.:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000`.
