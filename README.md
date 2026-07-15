# TPC Young Adult Adventures

A one-page planner for road trips, beach days, camping, hikes, and random events
with your people. Prices are in rands (R). Plain HTML/CSS/JS — no build step,
no server. Your plans save to a JSON file you own.

## Run it locally

Just open `index.html` in a browser. Fonts come from a CDN, so the first load looks
best with an internet connection. If you want a local server:

```bash
# Python 3
python3 -m http.server 5173
# then visit http://localhost:5173
```

## Structure

```
adventure-planner/
├── index.html          # the whole page (all sections + loading screen)
├── css/styles.css      # field-guide theme, landing heroes, layout
├── js/
│   ├── photos.js       # ← paste your photo links here
│   ├── music.js        # ← paste your MP3 links/paths here
│   ├── maps.js         # hand-drawn SVG route maps (one per category)
│   ├── roadmap.js      # "Generate roadmap" — shareable static page
│   ├── audio.js        # loading overlay + ambient soundtrack engine
│   └── main.js         # crew/adventures/stops/costs + JSON save/load (loads last)
├── data/sample-trips.json
├── assets/audio/       # optional local MP3s for the soundtrack
└── assets/images/      # optional local images
```

## How plans are organized

Start with **The Crew** (section 00): add everyone's names once. Each category
(Road Trips, Beach Days, Camping, Hiking, Events) holds **adventures**, and each
adventure holds **stops**, a **who's coming** list picked from the crew, and its
own **shared costs** (petrol, tickets…). A stop can carry a time, price (R),
location, a directions link (paste a Google Maps link and it becomes clickable),
meeting point, what to bring, and notes — click a stop row to expand it.

Money math: an adventure's total = its stop prices + its shared costs, and
"each" = total ÷ number of people coming. The **Split the costs** section at the
bottom is an auto-computed overview of every adventure plus the grand total.

## Music & the loading screen

The site opens with a short loading animation and a **Let's go** button — the
tap reveals the page and starts the landing track (browsers only allow sound
after a tap; if the loader auto-dismisses without a tap, music stays off until
the 🎶 button is pressed). Each section has its own looping track that fades
out/in as you scroll — nothing ever cuts abruptly, and the floating 🎶 button
(bottom-right) fades the music out/in too. Tracks live in `assets/audio/` and
are mapped in `js/music.js` (Cloudinary URLs work too, same as photos). Free
tracks: Pixabay Music, YouTube Audio Library, Free Music Archive. Spotify links
won't work — Spotify doesn't allow playback without logins/SDKs.

## Add your photos

Open `js/photos.js` and paste image links between the quotes. Order matches the
polaroids left-to-right in each section; leave `""` to keep a placeholder tile.

## Category maps

Every category has its own illustrated route map, drawn from that category's
adventures — pins are numbered stops (hover one for its details), flags mark
each adventure's first stop, and something drives/sails/hikes the route.
They redraw automatically as you add or remove stops.

## Generate the roadmap

Hit **Generate roadmap** (bottom of the page) to build a read-only, animated,
self-contained page with every adventure, map, and detail. It opens in a new
tab; use its **Download this page** button to save `roadmap.html` and share it
with the group.

## Save / load plans

- **Save plan** downloads everything (crew + adventures + costs) as `tpc-adventures-plan.json`.
- **Load plan** reads a file back in. Nothing is stored on a server or in the browser.
- Try **Load plan** with `data/sample-trips.json` to see the format. Older flat-format
  files still load — they get wrapped into an "Imported list" adventure.

## Deploy to GitHub Pages

1. Create a repo and push these files (the site root must contain `index.html`).
   ```bash
   git init
   git add .
   git commit -m "TPC Young Adult Adventures"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/adventure-planner.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment**.
3. Source: **Deploy from a branch**. Branch: **main**, folder: **/ (root)**. Save.
4. Wait ~1 minute, then visit `https://YOUR-USERNAME.github.io/adventure-planner/`.

## What's next

Easy extensions later: per-adventure calculators, date pickers, a packing
checklist, or drag-to-reorder stops.
