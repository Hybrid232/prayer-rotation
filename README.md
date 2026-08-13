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

## About data storage / Team Sync (read this)

This app still has **no traditional server or database** — it's plain
HTML/CSS/JS hosted for free on GitHub Pages. Instead, this repo's own
`data.json` acts as the shared "database":

- **Viewing is always live, for everyone, no setup required.** Every time
  the page is opened, it reads the latest `data.json` straight from this
  repo via the GitHub API. Whoever last saved a change, everyone else sees
  it on their next page load (or by clicking "Refresh from team").
- **Editing requires a sync token**, because GitHub only allows the shared
  file to be written by someone authenticated. Ask your admin for the team
  sync token and paste it into the **Team Sync** box in the sidebar once —
  it's remembered on that device from then on. Any change you make
  (add/remove a person, swap, settings) is committed back to `data.json`
  a couple seconds after you stop editing.
- Without a token, you can still see everything live — you just can't push
  changes back (they'd only be saved in that browser's local cache).
- This is **last-write-wins**, not true real-time collaboration: if two
  people save within the same couple of seconds, the second save quietly
  overwrites the first. Fine for occasional edits from a small team; not
  meant for simultaneous heavy editing.

### Creating the team sync token (do this once, as the admin)

1. Go to
   [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   (a **fine-grained** token, scoped tightly).
2. Under **Repository access**, choose "Only select repositories" and pick
   this repo (`prayer-rotation`).
3. Under **Permissions → Repository permissions**, set **Contents** to
   **Read and write**. Leave everything else as "No access."
4. Generate the token and copy it (it's only shown once).
5. Share it with your team the same way you'd share the page link (chat,
   email, etc.) — treat it like a shared password. Each person pastes it
   into the **Team Sync** box in the app once per device/browser.

If the token ever leaks or someone leaves the team, delete it from
[github.com/settings/tokens](https://github.com/settings/tokens) and
generate a new one to hand out.

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
