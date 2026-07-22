/* =========================================================
   board.js — the trip board (index.html). Reads only the
   light trips index via TrailheadDB.onTrips; never touches
   tripData (that split matters for scale once Stage 3 lands
   many trips — this file is written so that split just works).
   ========================================================= */
(function () {
  const CATEGORIES = window.TrailheadConfig.CATEGORIES;
  const CAT_COLOR = {
    roadTrips: "#c2793b",
    beachDays: "#1e9aab",
    camping: "#2c6e63",
    hiking: "#a85536",
    events: "#8a4fa0",
  };

  let crewCode = null;

  function withCrew(url) {
    return crewCode ? `${url}${url.includes("?") ? "&" : "?"}crew=${encodeURIComponent(crewCode)}` : url;
  }

  function todayStr() {
    return new Date().toISOString().slice(0, 10);
  }

  function isPast(trip) {
    return trip.archived || (trip.date && trip.date < todayStr());
  }

  function tripCardHTML(trip) {
    const cat = CATEGORIES[trip.category];
    const headcount = trip.headcount || 0;
    const total = window.Calculator.money(trip.total || 0);
    return `
      <a class="trip-card" href="${withCrew(`trip.html?trip=${encodeURIComponent(trip.id)}`)}" style="--cat-color:${CAT_COLOR[trip.category] || "#888"}">
        <span class="trip-card__cat">${cat ? cat.label : trip.category}</span>
        <h3 class="trip-card__title"></h3>
        <div class="trip-card__meta">
          <span>${trip.date || "No date yet"}</span>
          <span>${headcount} going</span>
          <span>${total}</span>
        </div>
      </a>`;
  }

  function renderGrid(el, trips) {
    if (trips.length === 0) {
      el.innerHTML = '<p class="board__empty">Nothing here yet.</p>';
      return;
    }
    el.innerHTML = trips.map(tripCardHTML).join("");
    // titles set via textContent, not innerHTML, so a trip title can never
    // inject markup into the board
    el.querySelectorAll(".trip-card").forEach((card, i) => {
      card.querySelector(".trip-card__title").textContent = trips[i].title;
    });
  }

  function renderBoard(trips) {
    const upcoming = trips.filter((t) => !isPast(t)).sort((a, b) => (a.date || "9999").localeCompare(b.date || "9999"));
    const past = trips.filter(isPast).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    renderGrid(document.getElementById("upcomingGrid"), upcoming);
    renderGrid(document.getElementById("pastGrid"), past);
  }

  function wireNewTripForm() {
    const select = document.getElementById("newTripCategory");
    Object.entries(CATEGORIES).forEach(([key, cfg]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = cfg.label;
      select.appendChild(opt);
    });

    const form = document.getElementById("newTripForm");
    document.getElementById("newTripBtn").addEventListener("click", () => {
      form.hidden = !form.hidden;
    });
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const title = (data.get("title") || "").trim();
      if (!title) return;
      const tripId = window.TrailheadDB.addTrip({
        title,
        category: data.get("category"),
        date: data.get("date") || "",
      });
      form.reset();
      form.hidden = true;
      window.location.href = withCrew(`trip.html?trip=${encodeURIComponent(tripId)}`);
    });
  }

  function seedDemoTrips() {
    window.TrailheadDB.seedTrip({ title: "Coast Highway Run", category: "roadTrips", date: "" });
    window.TrailheadDB.seedTrip({ title: "Low Tide Loop", category: "beachDays", date: "" });
    window.TrailheadDB.seedTrip({ title: "Lakeside Weekend", category: "camping", date: "" });
    window.TrailheadDB.seedTrip({ title: "Ridge Runners", category: "hiking", date: "" });
    window.TrailheadDB.seedTrip({ title: "Concert Night", category: "events", date: "" });
  }

  // Local mode's one-way door into sync mode: create a crew in Firebase and
  // reload the board pointed at it. A proper Crew Settings panel (with
  // rotate/rename) is Stage 5 — this is deliberately just enough to prove
  // two-device sync for Stage 2.
  function wireStartSyncing() {
    const btn = document.getElementById("startSyncBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const name = window.prompt("Name this crew (e.g. Sunday Crew):", "Our Crew");
      if (name === null) return;
      btn.disabled = true;
      btn.textContent = "Creating…";
      window.TrailheadDB.createCrew(name)
        .then((code) => {
          window.location.href = `index.html?crew=${encodeURIComponent(code)}`;
        })
        .catch((err) => {
          alert("Couldn't create the crew: " + err.message);
          btn.disabled = false;
          btn.textContent = "Start syncing this crew";
        });
    });
  }

  function wireInvite() {
    const btn = document.getElementById("inviteBtn");
    if (!btn) return;
    btn.hidden = !crewCode;
    if (!crewCode) return;
    btn.addEventListener("click", async () => {
      const url = window.location.href;
      if (navigator.share) {
        try {
          await navigator.share({ title: "Trailhead", text: "Plan trips with us on Trailhead", url });
          return;
        } catch {
          // user cancelled the share sheet — fall through to copy
        }
      }
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Link copied!";
        setTimeout(() => { btn.textContent = "Invite the group"; }, 2000);
      } catch {
        prompt("Copy this link:", url);
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    let mode, code;
    try {
      ({ mode, crewCode: code } = window.TrailheadDB.init());
    } catch (err) {
      document.getElementById("dbError").hidden = false;
      document.getElementById("dbError").textContent =
        "Couldn't connect to this crew's data: " + err.message;
      return;
    }
    crewCode = code;
    document.getElementById("startSyncBtn").hidden = mode !== "local";
    if (mode === "local" && window.TrailheadDB.isEmpty()) seedDemoTrips();
    wireNewTripForm();
    wireStartSyncing();
    wireInvite();
    window.TrailheadDB.onTrips(renderBoard);
  });
})();
