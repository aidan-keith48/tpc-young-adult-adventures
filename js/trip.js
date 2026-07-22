/* =========================================================
   trip.js — single trip page (trip.html). Always computes its
   own totals/headcount live from its own tripData subscription
   — never reads the denormalized summary fields the board uses
   (trips/{id}.total etc.). Those exist only so the board can
   avoid loading tripData; trusting them here would let the
   board's brief, self-healing staleness leak into the one page
   that's supposed to be the source of truth for its own trip.
   ========================================================= */
(function () {
  const CATEGORIES = window.TrailheadConfig.CATEGORIES;
  const money = window.Calculator.money;

  function getTripId() {
    return new URLSearchParams(window.location.search).get("trip");
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function linkify(url) {
    if (!url) return "";
    return /^https?:\/\//i.test(url)
      ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">directions</a>`
      : "";
  }

  function renderAttendees(tripId, attendees) {
    const box = document.getElementById("attendeeChips");
    if (attendees.length === 0) {
      box.innerHTML = '<p class="empty-hint">No one yet — be the first to say you\'re in.</p>';
      return;
    }
    box.innerHTML = attendees
      .map((a) => `<span class="chip" data-id="${a.id}"><span></span><button type="button" aria-label="Remove">✕</button></span>`)
      .join("");
    box.querySelectorAll(".chip").forEach((chip, i) => {
      chip.querySelector("span").textContent = attendees[i].name;
      chip.querySelector("button").addEventListener("click", () => {
        window.TrailheadDB.removeAttendee(tripId, attendees[i].id);
      });
    });
  }

  function renderStops(tripId, stops) {
    const box = document.getElementById("stopsList");
    if (stops.length === 0) {
      box.innerHTML = '<p class="empty-hint">No stops yet — add the first one below.</p>';
      return;
    }
    box.innerHTML = stops
      .map(
        (s) => `<div class="list-row" data-id="${s.id}">
          <div class="list-row__main">
            <span class="list-row__name"></span>
            <span class="list-row__sub"></span>
          </div>
          <button class="list-row__del" type="button" aria-label="Remove stop">✕</button>
        </div>`
      )
      .join("");
    box.querySelectorAll(".list-row").forEach((row, i) => {
      const s = stops[i];
      row.querySelector(".list-row__name").textContent = s.name;
      const sub = row.querySelector(".list-row__sub");
      const parts = [Number(s.price) > 0 ? money(s.price) : ""].filter(Boolean);
      sub.innerHTML = parts.map(escapeHtml).join(" · ") + (s.link ? (parts.length ? " · " : "") + linkify(s.link) : "");
      row.querySelector(".list-row__del").addEventListener("click", () => {
        window.TrailheadDB.removeStop(tripId, s.id);
      });
    });
  }

  function renderCosts(tripId, costs) {
    const box = document.getElementById("costsList");
    if (costs.length === 0) {
      box.innerHTML = '<p class="empty-hint">No shared costs yet.</p>';
      return;
    }
    box.innerHTML = costs
      .map(
        (c) => `<div class="list-row" data-id="${c.id}">
          <div class="list-row__main">
            <span class="list-row__name"></span>
          </div>
          <span>${money(c.amount)}</span>
          <button class="list-row__del" type="button" aria-label="Remove cost">✕</button>
        </div>`
      )
      .join("");
    box.querySelectorAll(".list-row").forEach((row, i) => {
      row.querySelector(".list-row__name").textContent = costs[i].label;
      row.querySelector(".list-row__del").addEventListener("click", () => {
        window.TrailheadDB.removeCost(tripId, costs[i].id);
      });
    });
  }

  function renderSuggestions(tripId, suggestions) {
    const box = document.getElementById("suggestionsList");
    if (suggestions.length === 0) {
      box.innerHTML = '<p class="empty-hint">No suggestions yet.</p>';
      return;
    }
    box.innerHTML = suggestions
      .map(
        (s) => `<div class="list-row" data-id="${s.id}">
          <div class="list-row__main">
            <span class="list-row__name"></span>
            <span class="list-row__sub"></span>
          </div>
          <button class="list-row__del" type="button" aria-label="Remove suggestion">✕</button>
        </div>`
      )
      .join("");
    box.querySelectorAll(".list-row").forEach((row, i) => {
      row.querySelector(".list-row__name").textContent = suggestions[i].text;
      row.querySelector(".list-row__sub").textContent = suggestions[i].name || "anonymous";
      row.querySelector(".list-row__del").addEventListener("click", () => {
        window.TrailheadDB.removeSuggestion(tripId, suggestions[i].id);
      });
    });
  }

  function renderCalc(stops, costs, attendeeCount, peopleOverride) {
    const t = window.Calculator.totals({ stops, costs, attendeeCount, peopleOverride });
    document.getElementById("calcTotal").textContent = money(t.total);
    document.getElementById("calcPerPerson").textContent = t.headcount > 0 ? money(t.perPerson) : "—";
    document.getElementById("headcountNote").textContent =
      `${attendeeCount} attendee${attendeeCount === 1 ? "" : "s"}` +
      (peopleOverride != null ? ` · split uses your override of ${peopleOverride}` : " · split uses the attendee count");
  }

  function init() {
    const tripId = getTripId();
    window.TrailheadDB.init();
    const trip = tripId && window.TrailheadDB.getTrip(tripId);

    if (!trip) {
      document.getElementById("tripNotFound").hidden = false;
      return;
    }
    document.getElementById("tripContent").hidden = false;

    const cat = CATEGORIES[trip.category];
    document.getElementById("tripCat").textContent = cat ? cat.label : trip.category;
    document.getElementById("tripTitle").textContent = trip.title;
    document.getElementById("tripDate").textContent = trip.date || "No date yet";
    document.title = `Trailhead — ${trip.title}`;

    const peopleOverrideInput = document.getElementById("peopleOverride");

    window.TrailheadDB.onTripData(tripId, (data) => {
      if (!data) return;
      renderAttendees(tripId, data.attendees);
      renderStops(tripId, data.stops);
      renderCosts(tripId, data.costs);
      renderSuggestions(tripId, data.suggestions);
      renderCalc(data.stops, data.costs, data.attendees.length, data.settings.peopleOverride);
      if (document.activeElement !== peopleOverrideInput) {
        peopleOverrideInput.value = data.settings.peopleOverride ?? "";
      }

      const mapVibe = cat ? cat.vibe : "road";
      window.TripMap.update(document.getElementById("mapBox"), data.stops, mapVibe, trip.title, `map-${tripId}`);
    });

    document.getElementById("attendeeForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const name = (data.get("name") || "").trim();
      if (!name) return;
      window.TrailheadDB.addAttendee(tripId, name);
      e.target.reset();
    });

    document.getElementById("stopForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const name = (data.get("name") || "").trim();
      if (!name) return;
      window.TrailheadDB.addStop(tripId, {
        name,
        link: (data.get("link") || "").trim(),
        price: Number(data.get("price")) || 0,
        time: "",
        location: "",
        meetingPoint: "",
        whatToBring: "",
        notes: "",
        addedBy: "",
      });
      e.target.reset();
    });

    document.getElementById("costForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const label = (data.get("label") || "").trim();
      if (!label) return;
      window.TrailheadDB.addCost(tripId, { label, amount: Number(data.get("amount")) || 0 });
      e.target.reset();
    });

    document.getElementById("suggestionForm").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const text = (data.get("text") || "").trim();
      if (!text) return;
      window.TrailheadDB.addSuggestion(tripId, { name: (data.get("name") || "").trim(), text });
      e.target.reset();
    });

    peopleOverrideInput.addEventListener("change", () => {
      window.TrailheadDB.setPeopleOverride(tripId, peopleOverrideInput.value);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
