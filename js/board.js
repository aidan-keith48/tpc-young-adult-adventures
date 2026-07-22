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
      <a class="trip-card" href="trip.html?trip=${encodeURIComponent(trip.id)}" style="--cat-color:${CAT_COLOR[trip.category] || "#888"}">
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
      window.location.href = `trip.html?trip=${encodeURIComponent(tripId)}`;
    });
  }

  function seedDemoTrips() {
    window.TrailheadDB.seedTrip({ title: "Coast Highway Run", category: "roadTrips", date: "" });
    window.TrailheadDB.seedTrip({ title: "Low Tide Loop", category: "beachDays", date: "" });
    window.TrailheadDB.seedTrip({ title: "Lakeside Weekend", category: "camping", date: "" });
    window.TrailheadDB.seedTrip({ title: "Ridge Runners", category: "hiking", date: "" });
    window.TrailheadDB.seedTrip({ title: "Concert Night", category: "events", date: "" });
  }

  document.addEventListener("DOMContentLoaded", () => {
    window.TrailheadDB.init();
    if (window.TrailheadDB.isEmpty()) seedDemoTrips();
    wireNewTripForm();
    window.TrailheadDB.onTrips(renderBoard);
  });
})();
