/* =========================================================
   main.js — renders the whole one-page planner. All data now
   lives behind TrailheadDB (js/db.js): local scratchpad by
   default, or Firebase live-sync when the URL carries a
   ?crew= link. `plan` below is a READ-MODEL assembled from
   DB listeners — render functions read it, but every
   mutation goes through TrailheadDB and comes back via a
   listener. Runs last so all globals exist.
   ========================================================= */
(function () {
  const CATEGORIES = ["roadTrips", "beachDays", "camping", "hiking", "events"];
  const CAT_LABELS = { roadTrips: "Road Trips", beachDays: "Beach Days", camping: "Camping", hiking: "Hiking", events: "Events" };
  const DB = window.TrailheadDB;

  // Assembled read-model. Adventures carry their DB trip id; stops/costs
  // carry their DB ids; attendees is an array of crew-roster person ids.
  const plan = {
    meta: { app: "TPC Young Adult Adventures", version: 3, tripName: "" },
    people: [],
    categories: { roadTrips: [], beachDays: [], camping: [], hiking: [], events: [] },
  };

  let syncMode = "local";
  let tripsIndex = [];          // latest light trip list from DB.onTrips
  const tripDataCache = {};     // tripId -> { stops, costs, attendees(ids) }
  const tripDataUnsubs = {};    // tripId -> unsubscribe fn

  const money = (n) =>
    "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Amounts stay inside what the sync rules accept (0 … R1 000 000).
  const clampMoney = (v) => Math.min(1000000, Math.max(0, Number(v) || 0));

  // Only real web addresses become clickable — blocks javascript: and friends,
  // and forgives a missing https:// prefix.
  function normalizeUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) return null;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      if (!parsed.hostname.includes(".")) return null;
      return parsed.href.slice(0, 500);
    } catch {
      return null;
    }
  }

  // A clearly-clickable pill for a stored {label, url} — used on adventure
  // cards, in the preview popup, and (as inline HTML) in the roadmap export.
  function makeLinkPill(l) {
    const a = document.createElement("a");
    a.className = "linkpill";
    a.href = l.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const icon = document.createElement("span");
    icon.className = "linkpill__icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🔗";
    const label = document.createElement("span");
    label.textContent = l.label;
    a.append(icon, label, document.createTextNode(" ↗"));
    return a;
  }

  // Everything is a group cost split evenly: stops + shared costs, over attendees.
  function advTotals(adv) {
    const stopsSum = (adv.stops || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costsSum = (adv.costs || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const total = stopsSum + costsSum;
    const n = (adv.attendees || []).length;
    return { stopsSum, costsSum, total, n, per: n > 0 ? total / n : 0 };
  }

  /* ---------- Dates ---------- */
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const isPast = (iso) => Boolean(iso) && iso < todayISO();
  function fmtDate(iso) {
    const d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" });
  }

  // Soonest-dated first, then undated, then past (most recent past first).
  function advSort(a, b) {
    const rank = (x) => (!x.date ? 1 : isPast(x.date) ? 2 : 0);
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    if (ra === 2) return a.date > b.date ? -1 : a.date < b.date ? 1 : 0;
    return 0;
  }

  /* ---------- Render one category's list of adventures ---------- */
  const EMPTY_LINES = {
    roadTrips: "Nothing on the calendar yet — the road's wide open.",
    beachDays: "No beach days booked — the tide's waiting.",
    camping: "No campouts planned — the stars are patient.",
    hiking: "No hikes lined up — the trail's not going anywhere.",
    events: "Nothing on the books — someone find the plans.",
  };

  function renderCategory(key) {
    const container = document.querySelector(`.adventures[data-category="${key}"]`);
    const adventures = (plan.categories[key] || []).slice().sort(advSort);
    if (container) {
      container.innerHTML = "";
      if (adventures.length === 0) {
        container.innerHTML = `<p class="adv-empty">${EMPTY_LINES[key]}</p>`;
      } else {
        adventures.forEach((adventure) => {
          container.appendChild(buildAdventureCard(key, adventure));
        });
      }
    }
    if (window.CategoryMaps) window.CategoryMaps.update(key, adventures);
    renderOverview();
    renderGlobal();
  }

  /* ---------- Per-adventure suggestions (visible to the whole crew) ---------- */
  function timeAgo(ts) {
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function buildSuggestionRow(s, onRemove) {
    const row = document.createElement("div");
    row.className = "sugg__row";
    row.innerHTML = `<p class="sugg__text"></p><p class="sugg__meta"></p><button type="button" class="sugg__del" aria-label="Remove suggestion">✕</button>`;
    row.querySelector(".sugg__text").textContent = s.text;
    row.querySelector(".sugg__meta").textContent = (s.name ? s.name + " · " : "") + timeAgo(s.at);
    row.querySelector(".sugg__del").addEventListener("click", () => onRemove(s.id));
    return row;
  }

  function renderSuggestionList(wrap, suggestions, tripId) {
    wrap.innerHTML = "";
    if (!suggestions || suggestions.length === 0) {
      wrap.innerHTML = '<p class="sugg__empty">No suggestions yet for this one.</p>';
    } else {
      suggestions.forEach((s) => wrap.appendChild(buildSuggestionRow(s, (id) => DB.removeSuggestion(tripId, id))));
    }
  }

  function wireSuggestForm(form, tripId) {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = (new FormData(form).get("text") || "").trim();
      if (!text) return;
      DB.addSuggestion(tripId, { text: text.slice(0, 500) });
      form.reset();
    });
  }

  /* ---------- Adventure display card (read-only + Edit) ---------- */
  function buildAdventureCard(key, adventure) {
    const t = advTotals(adventure);
    const past = isPast(adventure.date);

    const card = document.createElement("div");
    card.className = "adventure adventure--card" + (past ? " adventure--past" : "");
    card.innerHTML = `
      <header class="adventure__head">
        <div>
          <h4 class="adventure__name"></h4>
          <p class="adventure__meta"></p>
        </div>
        <div class="adventure__btns">
          <button class="btn btn--ghost btn--sm adventure__edit" type="button">Edit</button>
          <button class="adventure__del" type="button" aria-label="Remove adventure">✕</button>
        </div>
      </header>
      <p class="adventure__going"></p>
      <p class="adventure__links"></p>
      <div class="adventure__stops"></div>
      <div class="adventure__costrows"></div>
      <p class="adventure__money"></p>
      <div class="adventure__suggs">
        <h5 class="adventure__suggtitle">💡 Suggestions</h5>
        <div class="adventure__sugglist"></div>
        <form class="adventure__suggform">
          <input name="text" placeholder="Suggest something for this one…" maxlength="500" />
          <button type="submit" class="btn btn--ghost btn--sm">Send</button>
        </form>
      </div>`;

    card.querySelector(".adventure__name").textContent = adventure.name;
    card.querySelector(".adventure__meta").textContent = [
      adventure.date ? (past ? "past · " : "") + fmtDate(adventure.date) : null,
      `${adventure.stops.length} stop${adventure.stops.length === 1 ? "" : "s"}`,
      `${t.n} going`,
    ].filter(Boolean).join(" · ");

    card.querySelector(".adventure__edit").addEventListener("click", () => {
      openAdvDialog(key, adventure);
    });
    card.querySelector(".adventure__del").addEventListener("click", () => {
      UI.confirm(`Delete “${adventure.name}”? It stays recoverable behind the scenes.`, {
        title: "Delete adventure", okText: "Delete",
      }).then((ok) => { if (ok) DB.deleteTrip(adventure.id); });
    });

    const going = card.querySelector(".adventure__going");
    const names = adventure.attendees
      .map((pid) => (plan.people.find((p) => p.id === pid) || {}).name)
      .filter(Boolean);
    if (names.length) going.textContent = "Going: " + names.join(", ");
    else going.remove();

    const linksWrap = card.querySelector(".adventure__links");
    const validLinks = (adventure.links || []).filter((l) => /^https?:\/\//i.test(l.url));
    if (validLinks.length) {
      validLinks.forEach((l) => linksWrap.appendChild(makeLinkPill(l)));
    } else {
      linksWrap.remove();
    }

    const stopsWrap = card.querySelector(".adventure__stops");
    if (adventure.stops.length === 0) {
      stopsWrap.innerHTML = '<p class="cards__empty">No stops yet — hit Edit to add some.</p>';
    } else {
      adventure.stops.forEach((stop) => stopsWrap.appendChild(buildStopCard(stop)));
    }

    const costRows = card.querySelector(".adventure__costrows");
    adventure.costs.forEach((cost) => {
      const row = document.createElement("div");
      row.className = "adventure__costrow";
      row.innerHTML = `<span class="adventure__costlabel"></span><span class="adventure__costamount">${money(cost.amount)}</span>`;
      row.querySelector(".adventure__costlabel").textContent = cost.label;
      costRows.appendChild(row);
    });

    card.querySelector(".adventure__money").innerHTML =
      `Total ${money(t.total)} <small>(stops ${money(t.stopsSum)} + shared ${money(t.costsSum)})</small> · ` +
      (t.n > 0 ? `${money(t.per)} each` : `<small>add people to split</small>`);

    renderSuggestionList(card.querySelector(".adventure__sugglist"), adventure.suggestions, adventure.id);
    wireSuggestForm(card.querySelector(".adventure__suggform"), adventure.id);

    return card;
  }

  /* ---------- Global "what's coming up" grid ---------- */
  const SECTION_IDS = {
    roadTrips: "road-trips-body", beachDays: "beach-days-body",
    camping: "camping-body", hiking: "hiking-body", events: "events-body",
  };

  function renderGlobal() {
    const grid = document.getElementById("tripGrid");
    if (!grid) return;
    const all = [];
    CATEGORIES.forEach((k) => (plan.categories[k] || []).forEach((a) => all.push({ key: k, a })));
    all.sort((x, y) => advSort(x.a, y.a));
    grid.innerHTML = "";
    if (all.length === 0) {
      grid.innerHTML = '<p class="adv-empty">Nothing planned yet — scroll down and start the first adventure ↓</p>';
      return;
    }
    all.forEach(({ key, a }) => {
      const t = advTotals(a);
      const past = isPast(a.date);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "tripcard" + (past ? " tripcard--past" : "");
      card.dataset.cat = key;
      card.innerHTML = `
        <span class="tripcard__badge">${CAT_LABELS[key]}</span>
        <span class="tripcard__name"></span>
        <span class="tripcard__date"></span>
        <span class="tripcard__meta"></span>
        <span class="tripcard__stops"></span>`;
      card.querySelector(".tripcard__name").textContent = a.name;
      card.querySelector(".tripcard__date").textContent =
        a.date ? (past ? "past · " : "") + fmtDate(a.date) : "date TBC";
      card.querySelector(".tripcard__meta").textContent =
        `${a.stops.length} stop${a.stops.length === 1 ? "" : "s"} · ${t.n} going · ${money(t.total)}`;
      const linkCount = (a.links || []).filter((l) => /^https?:\/\//i.test(l.url)).length;
      const preview = a.stops.slice(0, 2).map((s) => s.name).join(" · ");
      card.querySelector(".tripcard__stops").textContent =
        preview + (a.stops.length > 2 ? " · …" : "") + (linkCount ? ` · 🔗×${linkCount}` : "");
      card.addEventListener("click", () => openPreview(key, a.id));
      grid.appendChild(card);
    });
  }

  /* ---------- Adventure preview (from the global grid) ---------- */
  function openPreview(key, adventureId) {
    const dialog = document.getElementById("previewDialog");
    if (!dialog || !dialog.showModal) return;
    const a = findAdventure(adventureId);
    if (!a) return;
    const t = advTotals(a);
    const past = isPast(a.date);

    dialog.dataset.cat = key;
    dialog.dataset.tripId = adventureId;
    document.getElementById("previewBadge").textContent = CAT_LABELS[key];
    document.getElementById("previewName").textContent = a.name;
    document.getElementById("previewMeta").textContent = [
      a.date ? (past ? "past · " : "") + fmtDate(a.date) : "date TBC",
      `${a.stops.length} stop${a.stops.length === 1 ? "" : "s"}`,
      `${t.n} going`,
    ].join(" · ");

    const going = document.getElementById("previewGoing");
    const names = a.attendees.map((pid) => (plan.people.find((p) => p.id === pid) || {}).name).filter(Boolean);
    going.textContent = names.length ? "Going: " + names.join(", ") : "";
    going.hidden = names.length === 0;

    const linksWrap = document.getElementById("previewLinks");
    linksWrap.innerHTML = "";
    const validLinks = (a.links || []).filter((l) => /^https?:\/\//i.test(l.url));
    validLinks.forEach((l) => linksWrap.appendChild(makeLinkPill(l)));
    linksWrap.hidden = validLinks.length === 0;

    const stopsWrap = document.getElementById("previewStops");
    stopsWrap.innerHTML = "";
    if (a.stops.length === 0) {
      stopsWrap.innerHTML = '<p class="cards__empty">No stops yet.</p>';
    } else {
      a.stops.forEach((s) => stopsWrap.appendChild(buildStopCard(s)));
    }

    const costsWrap = document.getElementById("previewCosts");
    costsWrap.innerHTML = "";
    a.costs.forEach((c) => {
      const row = document.createElement("div");
      row.className = "adventure__costrow";
      row.innerHTML = `<span class="adventure__costlabel"></span><span class="adventure__costamount">${money(c.amount)}</span>`;
      row.querySelector(".adventure__costlabel").textContent = c.label;
      costsWrap.appendChild(row);
    });

    document.getElementById("previewMoney").innerHTML =
      `Total ${money(t.total)} <small>(stops ${money(t.stopsSum)} + shared ${money(t.costsSum)})</small> · ` +
      (t.n > 0 ? `${money(t.per)} each` : `<small>add people to split</small>`);

    renderSuggestionList(document.getElementById("previewSuggList"), a.suggestions, a.id);

    const goto = document.getElementById("previewGoto");
    goto.onclick = () => {
      dialog.close();
      const target = document.getElementById(SECTION_IDS[key]);
      if (target) setTimeout(() => target.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    };

    dialog.showModal();
  }

  /* ---------- Crew roster ---------- */
  function renderCrew() {
    const box = document.getElementById("crewChips");
    if (!box) return;
    box.innerHTML = "";
    if (plan.people.length === 0) {
      box.innerHTML = '<p class="cards__empty">No one yet — add your people and they\'ll show up in every adventure\'s dropdown.</p>';
      return;
    }
    plan.people.forEach((person) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      const nameEl = document.createElement("span");
      nameEl.textContent = person.name;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Remove ${person.name} from the crew`);
      del.addEventListener("click", () => {
        DB.removePerson(person.id); // also drops them from every adventure
      });
      chip.append(nameEl, del);
      box.appendChild(chip);
    });
  }

  function wireCrew() {
    const form = document.getElementById("crewForm");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = [(data.get("firstName") || "").trim(), (data.get("lastName") || "").trim()]
        .filter(Boolean).join(" ").slice(0, 60); // sync rules cap names at 60
      if (!name) return;
      DB.addPerson(name);
      form.reset();
    });
  }

  /* ---------- Site-wide suggestion box (not tied to an adventure) ---------- */
  function renderGlobalSuggestions(list) {
    const box = document.getElementById("globalSuggList");
    if (!box) return;
    box.innerHTML = "";
    if (list.length === 0) {
      box.innerHTML = '<p class="cards__empty">Nothing sent yet — first one\'s free.</p>';
      return;
    }
    list.forEach((s) => box.appendChild(buildSuggestionRow(s, (id) => DB.removeGlobalSuggestion(id))));
  }

  function wireGlobalSuggestions() {
    DB.onGlobalSuggestions(renderGlobalSuggestions);
    const form = document.getElementById("globalSuggForm");
    if (!form) return;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(form);
      const name = (data.get("name") || "").trim().slice(0, 60);
      const text = (data.get("text") || "").trim().slice(0, 500);
      if (!text) return;
      DB.addGlobalSuggestion({ name, text });
      form.reset();
    });
  }

  /* ---------- Cost overview (auto-computed) ---------- */
  function renderOverview() {
    const box = document.getElementById("overview");
    if (!box) return;
    const rows = [];
    let grand = 0;
    CATEGORIES.forEach((k) => (plan.categories[k] || []).forEach((a) => {
      const t = advTotals(a);
      grand += t.total;
      rows.push({ cat: CAT_LABELS[k], adventure: a, t });
    }));
    box.innerHTML = "";
    if (rows.length === 0) {
      box.innerHTML = '<p class="cards__empty">No adventures yet — totals will show up here.</p>';
      return;
    }
    const table = document.createElement("table");
    table.className = "overview__table";
    table.innerHTML = `
      <thead><tr><th>Adventure</th><th>Going</th><th>Total</th><th>Each</th></tr></thead>
      <tbody></tbody>
      <tfoot><tr><td>Grand total</td><td>${plan.people.length} in crew</td><td>${money(grand)}</td><td></td></tr></tfoot>`;
    const tbody = table.querySelector("tbody");
    rows.forEach(({ cat, adventure, t }) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><span class="overview__name"></span><span class="overview__cat">${cat}</span></td>
        <td>${t.n || "—"}</td>
        <td>${money(t.total)}</td>
        <td>${t.n ? money(t.per) : "—"}</td>`;
      tr.querySelector(".overview__name").textContent = adventure.name;
      tbody.appendChild(tr);
    });
    box.appendChild(table);
  }

  /* ---------- One collapsible stop within an adventure ---------- */
  function buildStopCard(stop, onDelete) {
    const row = document.createElement("div");
    row.className = "stopcard";
    row.innerHTML = `
      <button class="stopcard__summary" type="button" aria-expanded="false">
        <span class="stopcard__name"></span>
        <span class="stopcard__time"></span>
        <span class="stopcard__price">${money(stop.price)}</span>
        <span class="stopcard__chevron" aria-hidden="true">▾</span>
      </button>
      <div class="stopcard__details" hidden></div>`;

    row.querySelector(".stopcard__name").textContent = stop.name;
    row.querySelector(".stopcard__time").textContent = stop.time || "";

    const details = row.querySelector(".stopcard__details");
    const detailFields = [
      ["Directions", stop.link, true],
      ["Location", stop.location, true],
      ["Meeting point", stop.meetingPoint, false],
      ["What to bring", stop.whatToBring, false],
    ];
    const filled = detailFields.filter(([, value]) => value);
    if (filled.length === 0 && !stop.notes) {
      const empty = document.createElement("p");
      empty.className = "stopcard__field stopcard__field--empty";
      empty.textContent = "No extra details added.";
      details.appendChild(empty);
    } else {
      filled.forEach(([label, value, linkable]) => {
        const p = document.createElement("p");
        p.className = "stopcard__field";
        const strong = document.createElement("strong");
        strong.textContent = label + ": ";
        p.appendChild(strong);
        if (linkable && /^https?:\/\//i.test(value)) {
          const a = document.createElement("a");
          a.href = value;
          a.target = "_blank";
          a.rel = "noopener";
          a.className = "card__link";
          a.textContent = value;
          p.appendChild(a);
        } else {
          const span = document.createElement("span");
          span.textContent = value;
          p.appendChild(span);
        }
        details.appendChild(p);
      });
    }

    // Notes get their own block so line breaks and longer text read properly
    if (stop.notes) {
      const noteBlock = document.createElement("div");
      noteBlock.className = "stopcard__notes";
      const label = document.createElement("strong");
      label.textContent = "Notes";
      const body = document.createElement("p");
      body.textContent = stop.notes; // pre-wrap CSS keeps the line breaks
      noteBlock.append(label, body);
      details.appendChild(noteBlock);
    }

    if (onDelete) {
      const del = document.createElement("button");
      del.type = "button";
      del.className = "stopcard__del";
      del.textContent = "Remove stop";
      del.addEventListener("click", (e) => { e.stopPropagation(); onDelete(); });
      details.appendChild(del);
    }

    const summary = row.querySelector(".stopcard__summary");
    summary.addEventListener("click", () => {
      const open = summary.getAttribute("aria-expanded") === "true";
      summary.setAttribute("aria-expanded", String(!open));
      details.hidden = open;
      row.classList.toggle("stopcard--open", !open);
    });

    return row;
  }

  function renderAll() {
    CATEGORIES.forEach(renderCategory);
  }

  /* ---------- Adventure editor dialog (create + edit, draft-based) ---------- */
  const CAT_SINGULAR = { roadTrips: "road trip", beachDays: "beach day", camping: "campout", hiking: "hike", events: "event" };
  let draft = null; // { id|null, category, name, date, stops[], costs[], attendees[] }
  let editingStopIndex = null; // index into draft.stops currently loaded into the stop form, or null
  let advEls = null;

  function dialogEls() {
    if (!advEls) {
      advEls = {
        dialog: document.getElementById("advDialog"),
        title: document.getElementById("advDialogTitle"),
        name: document.getElementById("advName"),
        date: document.getElementById("advDate"),
        stops: document.getElementById("advStops"),
        stopForm: document.getElementById("advStopForm"),
        stopSubmit: document.getElementById("advStopSubmit"),
        stopCancelEdit: document.getElementById("advStopCancelEdit"),
        chips: document.getElementById("advChips"),
        addPerson: document.getElementById("advAddPerson"),
        costs: document.getElementById("advCosts"),
        costForm: document.getElementById("advCostForm"),
        links: document.getElementById("advLinks"),
        linkForm: document.getElementById("advLinkForm"),
        money: document.getElementById("advMoney"),
        cancel: document.getElementById("advCancel"),
        save: document.getElementById("advSave"),
      };
    }
    return advEls;
  }

  function updateStopFormMode() {
    const els = dialogEls();
    if (editingStopIndex !== null) {
      els.stopSubmit.textContent = "Save changes";
      els.stopCancelEdit.hidden = false;
    } else {
      els.stopSubmit.textContent = "＋ Add this stop";
      els.stopCancelEdit.hidden = true;
    }
  }

  function fillStopForm(s) {
    const f = dialogEls().stopForm.elements;
    f.name.value = s.name || "";
    f.time.value = s.time || "";
    f.price.value = s.price || "";
    f.location.value = s.location || "";
    f.link.value = s.link || "";
    f.meetingPoint.value = s.meetingPoint || "";
    f.whatToBring.value = s.whatToBring || "";
    f.notes.value = s.notes || "";
  }

  function openAdvDialog(category, adventure) {
    const els = dialogEls();
    if (!els.dialog || !els.dialog.showModal) return;
    draft = adventure
      ? {
          id: adventure.id, category,
          name: adventure.name, date: adventure.date || "",
          stops: adventure.stops.map((s) => ({ ...s })),
          costs: adventure.costs.map((c) => ({ ...c })),
          links: (adventure.links || []).map((l) => ({ ...l })),
          attendees: adventure.attendees.slice(),
        }
      : { id: null, category, name: "", date: "", stops: [], costs: [], links: [], attendees: [] };
    els.title.textContent = adventure ? "Edit adventure" : `New ${CAT_SINGULAR[category]}`;
    els.name.value = draft.name;
    els.date.value = draft.date;
    els.stopForm.reset();
    els.costForm.reset();
    els.linkForm.reset();
    editingStopIndex = null;
    updateStopFormMode();
    advError("");
    renderDraft();
    els.dialog.showModal();
  }

  function renderDraft() {
    if (!draft) return;
    const els = dialogEls();

    // stops
    els.stops.innerHTML = draft.stops.length
      ? ""
      : '<p class="cards__empty">No stops yet — fill the fields below and hit “Add this stop”.</p>';
    draft.stops.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "advd__stoprow" + (editingStopIndex === i ? " advd__stoprow--editing" : "");
      row.innerHTML = `<span class="advd__stopname"></span><span class="advd__stopmeta"></span>
        <button type="button" class="advd__stopedit">Edit</button>
        <button type="button" class="advd__stopdel" aria-label="Remove stop">✕</button>`;
      row.querySelector(".advd__stopname").textContent = s.name;
      row.querySelector(".advd__stopmeta").textContent =
        [s.time, Number(s.price) > 0 ? money(s.price) : ""].filter(Boolean).join(" · ");
      row.querySelector(".advd__stopedit").addEventListener("click", () => {
        editingStopIndex = i;
        fillStopForm(s);
        updateStopFormMode();
        renderDraft();
        dialogEls().stopForm.elements.name.focus();
      });
      row.querySelector(".advd__stopdel").addEventListener("click", () => {
        if (editingStopIndex === i) {
          editingStopIndex = null;
          els.stopForm.reset();
          updateStopFormMode();
        } else if (editingStopIndex !== null && editingStopIndex > i) {
          editingStopIndex--; // rows after the removed one shift down
        }
        draft.stops.splice(i, 1);
        renderDraft();
      });
      els.stops.appendChild(row);
    });

    // who's coming
    els.chips.innerHTML = "";
    draft.attendees.forEach((pid) => {
      const person = plan.people.find((p) => p.id === pid);
      if (!person) return;
      const chip = document.createElement("span");
      chip.className = "chip chip--small";
      const nameEl = document.createElement("span");
      nameEl.textContent = person.name;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Remove ${person.name}`);
      del.addEventListener("click", () => {
        draft.attendees = draft.attendees.filter((id) => id !== pid);
        renderDraft();
      });
      chip.append(nameEl, del);
      els.chips.appendChild(chip);
    });

    els.addPerson.innerHTML = "";
    const remaining = plan.people.filter((p) => !draft.attendees.includes(p.id));
    if (plan.people.length === 0) {
      els.addPerson.innerHTML = '<p class="adventure__hint">Add people in The Crew section first — then pick who\'s coming here.</p>';
    } else if (remaining.length === 0) {
      els.addPerson.innerHTML = '<p class="adventure__hint">The whole crew is in ✓</p>';
    } else {
      const select = document.createElement("select");
      select.setAttribute("aria-label", "Add someone to this adventure");
      const ph = document.createElement("option");
      ph.value = "";
      ph.textContent = "Add someone…";
      select.appendChild(ph);
      remaining.forEach((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => {
        if (!select.value) return;
        draft.attendees.push(select.value);
        renderDraft();
      });
      els.addPerson.appendChild(select);
    }

    // links
    els.links.innerHTML = "";
    draft.links.forEach((l, i) => {
      const row = document.createElement("div");
      row.className = "adventure__costrow";
      row.innerHTML = `<span class="adventure__costlabel"></span><span class="advd__url"></span><button type="button" aria-label="Remove link">✕</button>`;
      row.querySelector(".adventure__costlabel").textContent = l.label;
      row.querySelector(".advd__url").textContent = l.url;
      row.querySelector("button").addEventListener("click", () => {
        draft.links.splice(i, 1);
        renderDraft();
      });
      els.links.appendChild(row);
    });

    // costs
    els.costs.innerHTML = "";
    draft.costs.forEach((c, i) => {
      const row = document.createElement("div");
      row.className = "adventure__costrow";
      row.innerHTML = `<span class="adventure__costlabel"></span><span class="adventure__costamount">${money(c.amount)}</span><button type="button" aria-label="Remove cost">✕</button>`;
      row.querySelector(".adventure__costlabel").textContent = c.label;
      row.querySelector("button").addEventListener("click", () => {
        draft.costs.splice(i, 1);
        renderDraft();
      });
      els.costs.appendChild(row);
    });

    // live totals
    const t = advTotals(draft);
    els.money.innerHTML =
      `Total ${money(t.total)} <small>(stops ${money(t.stopsSum)} + shared ${money(t.costsSum)})</small> · ` +
      (t.n > 0 ? `${money(t.per)} each` : `<small>add people to split</small>`);
  }

  function stopFields(s) {
    return {
      name: s.name,
      time: s.time || "",
      price: clampMoney(s.price),
      location: s.location || "",
      link: s.link || "",
      meetingPoint: s.meetingPoint || "",
      whatToBring: s.whatToBring || "",
      notes: s.notes || "",
    };
  }

  function findAdventure(id) {
    for (const k of CATEGORIES) {
      const a = (plan.categories[k] || []).find((x) => x.id === id);
      if (a) return a;
    }
    return null;
  }

  function advError(msg) {
    const el = document.getElementById("advError");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
  }

  function saveDraft() {
    if (!draft) return;
    const els = dialogEls();

    // anything typed but not yet added? add it rather than silently losing it
    if ((new FormData(els.stopForm).get("name") || "").trim()) els.stopForm.requestSubmit();
    if ((new FormData(els.costForm).get("label") || "").trim()) els.costForm.requestSubmit();
    if ((new FormData(els.linkForm).get("url") || "").trim()) {
      els.linkForm.requestSubmit();
      // still there after submitting? it was invalid — let the error show
      if ((new FormData(els.linkForm).get("url") || "").trim()) return;
    }

    const name = els.name.value.trim();
    if (!name) {
      advError("Give the adventure a name first — that's the only must-have.");
      els.name.focus();
      return;
    }
    advError("");
    const date = els.date.value || "";

    if (!draft.id) {
      const tripId = DB.addTrip({ title: name, category: draft.category, date });
      draft.stops.forEach((s) => DB.addStop(tripId, stopFields(s)));
      draft.costs.forEach((c) => DB.addCost(tripId, { label: c.label, amount: clampMoney(c.amount) }));
      draft.links.forEach((l) => DB.addLink(tripId, { label: l.label, url: l.url }));
      draft.attendees.forEach((pid) => {
        const p = plan.people.find((x) => x.id === pid);
        if (p) DB.addAttendeeAs(tripId, p.id, p.name);
      });
    } else {
      const current = findAdventure(draft.id);
      if (current) {
        if (current.name !== name || (current.date || "") !== date) {
          DB.updateTrip(draft.id, { title: name, date });
        }
        const draftStopIds = new Set(draft.stops.filter((s) => s.id).map((s) => s.id));
        current.stops.forEach((s) => { if (!draftStopIds.has(s.id)) DB.removeStop(draft.id, s.id); });
        draft.stops.forEach((s) => {
          if (!s.id) {
            DB.addStop(draft.id, stopFields(s));
            return;
          }
          const orig = current.stops.find((x) => x.id === s.id);
          if (!orig) return;
          const before = stopFields(orig), after = stopFields(s);
          if (JSON.stringify(before) !== JSON.stringify(after)) DB.updateStop(draft.id, s.id, after);
        });

        const draftCostIds = new Set(draft.costs.filter((c) => c.id).map((c) => c.id));
        current.costs.forEach((c) => { if (!draftCostIds.has(c.id)) DB.removeCost(draft.id, c.id); });
        draft.costs.filter((c) => !c.id).forEach((c) => DB.addCost(draft.id, { label: c.label, amount: clampMoney(c.amount) }));

        const draftLinkIds = new Set(draft.links.filter((l) => l.id).map((l) => l.id));
        (current.links || []).forEach((l) => { if (!draftLinkIds.has(l.id)) DB.removeLink(draft.id, l.id); });
        draft.links.filter((l) => !l.id).forEach((l) => DB.addLink(draft.id, { label: l.label, url: l.url }));

        current.attendees.forEach((pid) => { if (!draft.attendees.includes(pid)) DB.removeAttendee(draft.id, pid); });
        draft.attendees.filter((pid) => !current.attendees.includes(pid)).forEach((pid) => {
          const p = plan.people.find((x) => x.id === pid);
          if (p) DB.addAttendeeAs(draft.id, p.id, p.name);
        });
      }
    }
    draft = null;
    els.dialog.close();
  }

  function wireAdvDialog() {
    const els = dialogEls();
    if (!els.dialog) return;

    els.stopForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!draft) return;
      const data = new FormData(els.stopForm);
      const name = (data.get("name") || "").trim();
      if (!name) return;
      const fields = {
        name,
        time: (data.get("time") || "").trim(),
        price: clampMoney(data.get("price")),
        location: (data.get("location") || "").trim(),
        link: (data.get("link") || "").trim(),
        meetingPoint: (data.get("meetingPoint") || "").trim(),
        whatToBring: (data.get("whatToBring") || "").trim(),
        notes: (data.get("notes") || "").trim(),
      };
      if (editingStopIndex !== null) {
        const existingId = draft.stops[editingStopIndex] && draft.stops[editingStopIndex].id;
        draft.stops[editingStopIndex] = existingId ? { id: existingId, ...fields } : fields;
        editingStopIndex = null;
      } else {
        draft.stops.push(fields);
      }
      els.stopForm.reset();
      updateStopFormMode();
      renderDraft();
    });

    els.stopCancelEdit.addEventListener("click", () => {
      editingStopIndex = null;
      els.stopForm.reset();
      updateStopFormMode();
      renderDraft();
    });

    els.costForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!draft) return;
      const data = new FormData(els.costForm);
      const label = (data.get("label") || "").trim();
      if (!label) return;
      draft.costs.push({ label, amount: clampMoney(data.get("amount")) });
      els.costForm.reset();
      renderDraft();
    });

    els.linkForm.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!draft) return;
      const data = new FormData(els.linkForm);
      const label = (data.get("label") || "").trim();
      const url = normalizeUrl(data.get("url"));
      if (!label) { advError("Give the link a name — e.g. Tickets, Payment, Website."); return; }
      if (!url) { advError("That link doesn't look like a web address — it needs something like example.com."); return; }
      advError("");
      draft.links.push({ label: label.slice(0, 60), url });
      els.linkForm.reset();
      renderDraft();
    });

    els.cancel.addEventListener("click", () => { draft = null; els.dialog.close(); });
    els.save.addEventListener("click", saveDraft);
  }

  function wireCreateButtons() {
    document.querySelectorAll(".adv-create").forEach((btn) => {
      btn.addEventListener("click", () => openAdvDialog(btn.dataset.category, null));
    });
  }

  function wirePreviewDialog() {
    const dialog = document.getElementById("previewDialog");
    const close = document.getElementById("previewClose");
    if (dialog && close) close.addEventListener("click", () => dialog.close());
    const suggForm = document.getElementById("previewSuggForm");
    if (dialog && suggForm) {
      suggForm.addEventListener("submit", (e) => {
        e.preventDefault();
        const tripId = dialog.dataset.tripId;
        const text = (new FormData(suggForm).get("text") || "").trim();
        if (!tripId || !text) return;
        DB.addSuggestion(tripId, { text: text.slice(0, 500) });
        suggForm.reset();
      });
    }
  }

  // Keeps the preview popup's suggestion list live while it's open — every
  // other field is a point-in-time snapshot from when it was opened, but
  // suggestions are the one thing worth seeing update in real time.
  function refreshOpenPreview() {
    const dialog = document.getElementById("previewDialog");
    if (!dialog || !dialog.open || !dialog.dataset.tripId) return;
    const a = findAdventure(dialog.dataset.tripId);
    if (a) renderSuggestionList(document.getElementById("previewSuggList"), a.suggestions, a.id);
  }

  /* ---------- JSON save / load ---------- */
  function exportPlan() {
    plan.meta.saved = new Date().toISOString();
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "tpc-adventures-plan.json",
    });
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function normalizeStop(s = {}) {
    return {
      name: s.name || "Stop",
      time: s.time || "",
      price: clampMoney(s.price),
      location: s.location || "",
      link: s.link || "",
      meetingPoint: s.meetingPoint || "",
      whatToBring: s.whatToBring || "",
      notes: s.notes || "",
    };
  }

  // Accepts every saved shape: v3 adventures pass through; v2 adventures get
  // empty attendees/costs; a v1 flat stop list gets wrapped into a single
  // "Imported list" adventure.
  function toAdventures(list, validIds) {
    if (!Array.isArray(list) || list.length === 0) return [];
    const isAdventureList = list.every((it) => it && Array.isArray(it.stops));
    if (isAdventureList) {
      return list.map((a) => ({
        name: a.name || "Untitled adventure",
        date: typeof a.date === "string" ? a.date : "",
        stops: (a.stops || []).map(normalizeStop),
        attendees: (Array.isArray(a.attendees) ? a.attendees : []).filter((id) => validIds.has(id)),
        costs: (Array.isArray(a.costs) ? a.costs : []).map((c) => ({
          label: (c && c.label) || "Cost",
          amount: Number(c && c.amount) || 0,
        })),
        links: (Array.isArray(a.links) ? a.links : [])
          .map((l) => ({ label: String((l && l.label) || "Link").slice(0, 60), url: normalizeUrl(l && l.url) }))
          .filter((l) => l.url),
      }));
    }
    return [{
      name: "Imported list",
      attendees: [],
      costs: [],
      stops: list.map((it) => normalizeStop({ name: it.name, price: it.price, location: it.url || "" })),
    }];
  }

  function importPlan(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch {
        UI.alert("That file isn't valid JSON. Pick a plan you saved from here.", "Couldn't restore");
        return;
      }
      if (!data.categories) {
        UI.alert("This file is missing trip data. Nothing was changed.", "Couldn't restore");
        return;
      }
      if (syncMode === "sync") {
        const ok = await UI.confirm(
          "Restoring replaces the crew's current plan for EVERYONE on this link. Replaced adventures stay recoverable in trash. Continue?",
          { title: "Restore over the live plan?", okText: "Restore" }
        );
        if (!ok) return;
      }

      const importedPeople = (Array.isArray(data.people) ? data.people : [])
        .filter((p) => p && p.id && p.name)
        .map((p) => ({ id: String(p.id), name: String(p.name) }));
      const validIds = new Set(importedPeople.map((p) => p.id));
      const importedCategories = {};
      CATEGORIES.forEach((key) => {
        importedCategories[key] = toAdventures(data.categories[key], validIds);
      });

      // Replace current backend contents. Deleted adventures land in trash
      // (recoverable); the roster is swapped outright.
      tripsIndex.slice().forEach((t) => DB.deleteTrip(t.id));
      plan.people.slice().forEach((p) => DB.removePerson(p.id));

      const idMap = {}; // old person id -> { newId, name }
      importedPeople.forEach((p) => {
        idMap[p.id] = { newId: DB.addPerson(p.name), name: p.name };
      });
      CATEGORIES.forEach((key) => importedCategories[key].forEach((adv) => {
        const tripId = DB.addTrip({ title: adv.name, category: key, date: adv.date || "" });
        adv.stops.forEach((s) => DB.addStop(tripId, s));
        adv.costs.forEach((c) => DB.addCost(tripId, c));
        (adv.links || []).forEach((l) => DB.addLink(tripId, l));
        adv.attendees.forEach((oldId) => {
          const m = idMap[oldId];
          if (m) DB.addAttendeeAs(tripId, m.newId, m.name);
        });
      }));

      // v2 files kept the trip name on the calculator
      plan.meta.tripName = (data.meta && data.meta.tripName) || (data.calculator && data.calculator.tripName) || "";
      const tripInput = document.getElementById("tripName");
      if (tripInput && !tripInput.disabled) tripInput.value = plan.meta.tripName;
    };
    reader.readAsText(file);
  }

  function wireSaveLoad() {
    document.getElementById("exportBtn").addEventListener("click", exportPlan);
    const fileInput = document.getElementById("importFile");
    document.getElementById("importBtn").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      if (e.target.files[0]) importPlan(e.target.files[0]);
      e.target.value = ""; // allow re-importing the same file
    });
  }

  /* ---------- In-app dialogs (no window.alert/confirm/prompt) ---------- */
  const UI = (function () {
    let els = null;
    let resolver = null;

    function get() {
      if (!els) {
        els = {
          dialog: document.getElementById("msgDialog"),
          title: document.getElementById("msgTitle"),
          body: document.getElementById("msgBody"),
          input: document.getElementById("msgInput"),
          ok: document.getElementById("msgOk"),
          cancel: document.getElementById("msgCancel"),
        };
        if (els.dialog) {
          els.ok.addEventListener("click", () => { settle(true); els.dialog.close(); });
          els.cancel.addEventListener("click", () => { settle(false); els.dialog.close(); });
          els.dialog.addEventListener("cancel", () => settle(false)); // ESC
          els.input.addEventListener("focus", () => els.input.select());
        }
      }
      return els;
    }

    function settle(value) {
      if (resolver) { resolver(value); resolver = null; }
    }

    function open({ title, body, okText, cancelText, inputValue }) {
      const e = get();
      if (!e.dialog || !e.dialog.showModal) {
        // ancient-browser fallback
        return Promise.resolve(cancelText ? window.confirm(body) : (window.alert(body), true));
      }
      settle(false); // resolve any dangling promise from a previous dialog
      e.title.textContent = title;
      e.body.textContent = body;
      e.ok.textContent = okText || "OK";
      e.cancel.hidden = !cancelText;
      if (cancelText) e.cancel.textContent = cancelText;
      e.input.hidden = inputValue == null;
      if (inputValue != null) e.input.value = inputValue;
      e.dialog.showModal();
      return new Promise((resolve) => { resolver = resolve; });
    }

    return {
      alert: (body, title = "Heads up") => open({ title, body }),
      confirm: (body, opts = {}) =>
        open({ title: opts.title || "Are you sure?", body, okText: opts.okText || "Yes, do it", cancelText: opts.cancelText || "Cancel" }),
      showLink: (url, body) =>
        open({ title: "Share this link", body: body || "Copy it and drop it in the group chat:", inputValue: url }),
    };
  })();
  window.UI = UI; // roadmap.js uses this too

  /* ---------- Small escaping helpers ---------- */
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
  }

  /* ---------- Photos: one pool from js/photos.js, spread across
     every polaroid and slowly cycled so each picture gets seen ---------- */
  const PHOTO_SLOTS = {
    hero: ".hero__polaroids .pola__img",
    roadTrips: "#road-trips .landing .pola__img",
    beachDays: "#beach-days .landing .snap__img",
    camping: "#camping .landing .pola__img",
    hiking: "#hiking .landing .pola__img",
    events: "#events .landing .pola__img",
  };

  const CYCLE_MS = 3500; // one polaroid swaps its photo this often
  const photoRatio = {}; // url → natural aspect ratio, so frames fit the whole photo

  // Real photos range from tall portraits to wide panoramas; letting a frame
  // take on the *exact* ratio can stretch a scattered polaroid layout way
  // out of its slot (badly on the small screens where space is tightest).
  // Clamping keeps every frame close to a real print's proportions — a
  // panorama gets a little more crop (already covered by background-size:
  // cover) instead of blowing up the layout.
  const clampRatio = (r) => Math.min(1.5, Math.max(0.6, r));

  function setPhoto(el, url) {
    el.style.backgroundImage = `url("${url.replace(/"/g, "%22")}")`;
    // Inline overrides: the placeholder rules use the `background:` shorthand,
    // which resets background-size to auto (a huge zoomed-in crop) and would
    // otherwise win on specificity.
    el.style.backgroundSize = "cover";
    el.style.backgroundPosition = "center";
    el.style.backgroundRepeat = "no-repeat";
    el.textContent = "";
    el.dataset.photo = url;
    if (photoRatio[url]) {
      el.style.aspectRatio = photoRatio[url];
    } else {
      const img = new Image();
      img.onload = () => {
        photoRatio[url] = clampRatio(img.naturalWidth / img.naturalHeight).toFixed(4);
        if (el.dataset.photo === url) el.style.aspectRatio = photoRatio[url];
      };
      img.src = url;
    }
  }

  function applyPhotos() {
    const cfg = window.TRIP_PHOTOS;

    // Legacy shape: per-section arrays ({ hero: [...], roadTrips: [...] })
    if (cfg && !Array.isArray(cfg)) {
      Object.entries(PHOTO_SLOTS).forEach(([key, selector]) => {
        const urls = cfg[key] || [];
        document.querySelectorAll(selector).forEach((el, i) => {
          const url = (urls[i] || "").trim();
          if (url) setPhoto(el, url);
        });
      });
      return;
    }

    const pool = (cfg || []).map((u) => String(u || "").trim()).filter(Boolean);
    if (!pool.length) return; // keep the colored placeholders

    // Warm the cache so swaps never flash empty, and record each
    // photo's aspect ratio so its frame can fit it exactly (no crop)
    pool.forEach((u) => {
      const img = new Image();
      img.onload = () => { photoRatio[u] = clampRatio(img.naturalWidth / img.naturalHeight).toFixed(4); };
      img.src = u;
    });

    const slots = Object.values(PHOTO_SLOTS).flatMap((sel) =>
      Array.from(document.querySelectorAll(sel))
    );
    // Slot i starts at photo i; offsets stay distinct as they advance,
    // so neighboring polaroids (almost) never show the same picture.
    const pointer = slots.map((_, i) => i % pool.length);
    slots.forEach((el, i) => setPhoto(el, pool[pointer[i]]));

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || pool.length < 2) return;
    const step = (slots.length % pool.length) || 1; // never 0, keeps offsets distinct
    let turn = 0;
    setInterval(() => {
      const i = turn % slots.length;
      turn++;
      pointer[i] = (pointer[i] + step) % pool.length;
      const el = slots[i];
      el.style.opacity = "0";
      setTimeout(() => {
        setPhoto(el, pool[pointer[i]]);
        el.style.opacity = "";
      }, 450);
    }, CYCLE_MS);
  }

  /* ---------- Beach hero: seamless rolling wave layers ---------- */
  function wavePath(amp, base) {
    const total = 2880, half = 120;
    let d = `M0,${base} Q${half / 2},${base - amp} ${half},${base}`;
    for (let x = half; x < total; x += half) d += ` T${x + half},${base}`;
    return d + ` L${total},170 L0,170 Z`;
  }
  function initBeachWaves() {
    const layers = [
      { sel: ".wave--back", amp: 16, base: 70, fill: "#5FD6DB" },
      { sel: ".wave--mid", amp: 22, base: 80, fill: "#37BEC9" },
      { sel: ".wave--front", amp: 14, base: 92, fill: "#1E9AAB" },
    ];
    layers.forEach((l) => {
      const el = document.querySelector(l.sel);
      if (!el) return;
      el.innerHTML = `<svg viewBox="0 0 2880 170" preserveAspectRatio="none"><path d="${wavePath(l.amp, l.base)}" fill="${l.fill}"/></svg>`;
    });
  }

  /* ---------- Scroll-reveal (.reveal elements fade in on view) ---------- */
  function wireReveals() {
    const els = document.querySelectorAll(".reveal");
    if (!els.length) return;
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("in"));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      });
    }, { threshold: 0.12 });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- DB assembly: listeners → read-model → render ---------- */
  function rebuildModel() {
    CATEGORIES.forEach((k) => { plan.categories[k] = []; });
    tripsIndex.forEach((t) => {
      if (t.archived || !plan.categories[t.category]) return;
      const d = tripDataCache[t.id] || { stops: [], costs: [], links: [], suggestions: [], attendees: [] };
      plan.categories[t.category].push({
        id: t.id,
        name: t.title,
        date: t.date || "",
        stops: d.stops,
        costs: d.costs,
        links: d.links || [],
        suggestions: d.suggestions || [],
        attendees: d.attendees,
      });
    });
  }

  function startData() {
    DB.onPeople((list) => {
      plan.people = list.map((p) => ({ id: p.id, name: p.name }));
      renderCrew();
      renderAll(); // chips + every dropdown depend on the roster
    });

    DB.onTrips((list) => {
      tripsIndex = list;

      // attach a data listener for every trip we haven't seen yet —
      // the one-page layout shows all adventures at once, so unlike the
      // rebuild's board we deliberately want every tripData live.
      list.forEach((t) => {
        if (tripDataUnsubs[t.id]) return;
        tripDataUnsubs[t.id] = DB.onTripData(t.id, (data) => {
          tripDataCache[t.id] = {
            stops: data.stops,
            costs: data.costs,
            links: data.links || [],
            suggestions: data.suggestions || [],
            attendees: data.attendees.map((a) => a.id),
          };
          rebuildModel();
          const trip = tripsIndex.find((x) => x.id === t.id);
          if (trip) renderCategory(trip.category);
          else renderAll();
          refreshOpenPreview();
        });
      });

      // drop listeners for trips that no longer exist
      Object.keys(tripDataUnsubs).forEach((id) => {
        if (list.some((t) => t.id === id)) return;
        tripDataUnsubs[id]();
        delete tripDataUnsubs[id];
        delete tripDataCache[id];
      });

      rebuildModel();
      renderAll();
    });
  }

  // Local scratchpad starts with the same demo content the page always had.
  function seedLocalDemo() {
    const p1 = DB.addPerson("Naledi Mokoena");
    const p2 = DB.addPerson("Josh van Wyk");
    const blank = { time: "", location: "", link: "", meetingPoint: "", whatToBring: "", notes: "" };
    const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

    const t1 = DB.addTrip({ title: "Coast Highway Run", category: "roadTrips", date: inDays(12) });
    DB.addStop(t1, { ...blank, name: "Sunset overlook, mile 88", price: 450 });
    DB.addCost(t1, { label: "Petrol", amount: 600 });
    DB.addAttendeeAs(t1, p1, "Naledi Mokoena");
    DB.addAttendeeAs(t1, p2, "Josh van Wyk");

    const t2 = DB.addTrip({ title: "Low Tide Loop", category: "beachDays" });
    DB.addStop(t2, { ...blank, name: "Tide pools at low tide", price: 0 });

    const t3 = DB.addTrip({ title: "Lakeside Weekend", category: "camping", date: inDays(33) });
    DB.addStop(t3, { ...blank, name: "Two nights, lakeside site", price: 950 });

    const t4 = DB.addTrip({ title: "Ridge Runners", category: "hiking", date: inDays(-9) });
    DB.addStop(t4, { ...blank, name: "Ridge loop — 6.2 mi", price: 120 });

    const t5 = DB.addTrip({ title: "Concert Night", category: "events", date: inDays(5) });
    DB.addStop(t5, { ...blank, name: "Indie show at the amphitheatre", time: "7:00 PM", price: 350 });
    DB.addAttendeeAs(t5, p1, "Naledi Mokoena");
    DB.addAttendeeAs(t5, p2, "Josh van Wyk");
  }

  /* ---------- Sync chrome: banner, invite, start-syncing dialog ---------- */
  function wireSync(mode) {
    const syncBtn = document.getElementById("syncBtn");
    const banner = document.getElementById("syncBanner");
    const dialog = document.getElementById("crewNameDialog");
    if (!syncBtn) return;
    syncBtn.hidden = false;

    if (mode === "sync") {
      syncBtn.textContent = "Invite the group";
      syncBtn.addEventListener("click", () => {
        const share = () => {
          syncBtn.textContent = "Link copied ✓";
          setTimeout(() => { syncBtn.textContent = "Invite the group"; }, 2000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(location.href).then(share, () => UI.showLink(location.href));
        } else {
          UI.showLink(location.href);
        }
      });
      if (banner) {
        banner.hidden = false;
        banner.textContent = "Live crew link — everyone who has it sees and edits this plan. Don't post it publicly.";
      }
      DB.checkExpired().then((msg) => {
        if (msg && banner) {
          banner.hidden = false;
          banner.classList.add("sync-banner--expired");
          banner.textContent = msg;
        }
      }).catch(() => {});
      return;
    }

    // local mode, crew already pinned in config: the button just opens it —
    // no way to create more crews from the UI.
    const locked = (window.TrailheadConfig && window.TrailheadConfig.lockedCrewCode || "").trim();
    if (locked) {
      syncBtn.textContent = "Open the live plan";
      syncBtn.addEventListener("click", () => {
        location.href = location.pathname + "?crew=" + encodeURIComponent(locked);
      });
      return;
    }

    // local mode, no crew yet: the button opens the crew-name dialog
    syncBtn.textContent = "Start syncing";
    syncBtn.addEventListener("click", () => { if (dialog && dialog.showModal) dialog.showModal(); });
    const cancel = document.getElementById("crewNameCancel");
    if (cancel) cancel.addEventListener("click", () => dialog.close());
    const form = document.getElementById("crewNameForm");
    if (form) form.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = (new FormData(form).get("name") || "").trim() || "Our Crew";
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = "Creating…";
      const snapshot = {
        people: plan.people,
        adventures: CATEGORIES.flatMap((key) => (plan.categories[key] || []).map((a) => ({
          category: key, name: a.name, stops: a.stops, costs: a.costs, links: a.links, attendees: a.attendees,
        }))),
      };
      DB.createCrew(name)
        .then((code) => DB.importIntoCrew(code, snapshot))
        .then((code) => { location.href = location.pathname + "?crew=" + code; })
        .catch((err) => {
          submitBtn.disabled = false;
          submitBtn.textContent = "Create the link";
          dialog.close();
          UI.alert("Couldn't create the crew link — " + err.message, "Sync didn't start");
        });
    });
  }

  /* ---------- One-time safety notice (per browser) ---------- */
  function maybeShowSafetyNotice() {
    const KEY = "tpc-safety-ack-v1";
    let seen = false;
    try { seen = Boolean(localStorage.getItem(KEY)); } catch { /* private mode etc. */ }
    if (seen) return;
    const dialog = document.getElementById("safetyDialog");
    const ok = document.getElementById("safetyOk");
    if (!dialog || !dialog.showModal || !ok) return;
    ok.addEventListener("click", () => {
      try { localStorage.setItem(KEY, String(Date.now())); } catch { /* fine */ }
      dialog.close();
    }, { once: true });
    // wait for the loading overlay to finish before popping anything up
    const waiter = setInterval(() => {
      if (document.getElementById("loader")) return;
      clearInterval(waiter);
      if (!document.querySelector("dialog[open]")) dialog.showModal();
    }, 400);
  }

  // Native <dialog> modals stop click-through to the page but iOS Safari
  // still lets a finger drag scroll the body behind them — this watches
  // every dialog's `open` attribute and locks/unlocks the page scroll to
  // match, restoring the exact scroll position on close.
  function wireDialogScrollLock() {
    function isAnyDialogOpen() {
      return !!document.querySelector("dialog[open]");
    }
    function sync() {
      const open = isAnyDialogOpen();
      const locked = document.body.classList.contains("dialog-lock");
      if (open && !locked) {
        const y = window.scrollY;
        document.body.dataset.lockScrollY = String(y);
        document.body.style.top = `-${y}px`;
        document.body.classList.add("dialog-lock");
      } else if (!open && locked) {
        const y = Number(document.body.dataset.lockScrollY || 0);
        document.body.classList.remove("dialog-lock");
        document.body.style.top = "";
        delete document.body.dataset.lockScrollY;
        window.scrollTo(0, y);
      }
    }
    new MutationObserver(sync).observe(document.body, {
      attributes: true, attributeFilter: ["open"], subtree: true,
    });
    sync();
  }

  /* ---------- Boot ---------- */
  // .has-js gates the reveal-hidden state so content stays visible without JS
  document.documentElement.classList.add("has-js");

  // Read-only handle for roadmap.js (and anything else that needs the plan)
  window.Trailhead = { getPlan: () => plan };

  document.addEventListener("DOMContentLoaded", () => {
    const { mode } = DB.init();
    syncMode = mode;

    applyPhotos();
    wireDialogScrollLock();
    wireCrew();
    wireGlobalSuggestions();
    wireCreateButtons();
    wireAdvDialog();
    wirePreviewDialog();
    wireSaveLoad();
    initBeachWaves();
    wireReveals();
    wireSync(mode);

    if (mode === "local" && DB.isEmpty()) seedLocalDemo();
    startData();

    const tripInput = document.getElementById("tripName");
    if (tripInput) {
      if (mode === "sync") {
        // the crew's name doubles as the trip/roadmap title on a live link
        tripInput.disabled = true;
        tripInput.placeholder = "…";
        DB.fetchMeta().then((meta) => {
          if (meta && meta.name) {
            plan.meta.tripName = meta.name;
            tripInput.value = meta.name;
          }
        }).catch(() => {});
      } else {
        tripInput.value = plan.meta.tripName || "";
        tripInput.addEventListener("input", () => { plan.meta.tripName = tripInput.value; });
      }
    }

    const roadmapBtn = document.getElementById("roadmapBtn");
    if (roadmapBtn && window.Roadmap) roadmapBtn.addEventListener("click", window.Roadmap.generate);

    maybeShowSafetyNotice();
  });
})();
