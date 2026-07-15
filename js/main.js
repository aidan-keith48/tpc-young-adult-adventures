/* =========================================================
   main.js — holds the whole plan (adventures → stops per
   category), renders it, applies photo links, and handles
   JSON save/load. Runs last so it can call Calculator,
   CategoryMaps, and Roadmap (all loaded before it).
   ========================================================= */
(function () {
  const CATEGORIES = ["roadTrips", "beachDays", "camping", "hiking", "events"];
  const CAT_LABELS = { roadTrips: "Road Trips", beachDays: "Beach Days", camping: "Camping", hiking: "Hiking", events: "Events" };

  // The single source of truth for the page. Save/Load round-trips this.
  // Each category holds adventures; each adventure holds stops, an attendee
  // list (ids from plan.people), and its own shared costs.
  const plan = {
    meta: { app: "TPC Young Adult Adventures", version: 3, tripName: "" },
    people: [
      { id: "p1", name: "Naledi Mokoena" },
      { id: "p2", name: "Josh van Wyk" },
    ],
    categories: {
      roadTrips: [{ name: "Coast Highway Run", attendees: ["p1", "p2"], costs: [{ label: "Petrol", amount: 600 }], stops: [
        { name: "Sunset overlook, mile 88", time: "", price: 450, location: "", meetingPoint: "", whatToBring: "", link: "", notes: "" },
      ] }],
      beachDays: [{ name: "Low Tide Loop", attendees: [], costs: [], stops: [
        { name: "Tide pools at low tide", time: "", price: 0, location: "", meetingPoint: "", whatToBring: "", link: "", notes: "" },
      ] }],
      camping: [{ name: "Lakeside Weekend", attendees: [], costs: [], stops: [
        { name: "Two nights, lakeside site", time: "", price: 950, location: "", meetingPoint: "", whatToBring: "", link: "", notes: "" },
      ] }],
      hiking: [{ name: "Ridge Runners", attendees: [], costs: [], stops: [
        { name: "Ridge loop — 6.2 mi", time: "", price: 120, location: "", meetingPoint: "", whatToBring: "", link: "", notes: "" },
      ] }],
      events: [{ name: "Concert Night", attendees: ["p1", "p2"], costs: [], stops: [
        { name: "Indie show at the amphitheatre", time: "7:00 PM", price: 350, location: "", meetingPoint: "", whatToBring: "", link: "", notes: "" },
      ] }],
    },
  };

  let nextPersonId = 3;

  const money = (n) =>
    "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Everything is a group cost split evenly: stops + shared costs, over attendees.
  function advTotals(adv) {
    const stopsSum = (adv.stops || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costsSum = (adv.costs || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const total = stopsSum + costsSum;
    const n = (adv.attendees || []).length;
    return { stopsSum, costsSum, total, n, per: n > 0 ? total / n : 0 };
  }

  /* ---------- Render one category's list of adventures ---------- */
  function renderCategory(key) {
    const container = document.querySelector(`.adventures[data-category="${key}"]`);
    const adventures = plan.categories[key] || [];
    if (container) {
      container.innerHTML = "";
      if (adventures.length === 0) {
        container.innerHTML = '<p class="cards__empty">No adventures yet — start your first one.</p>';
      } else {
        adventures.forEach((adventure, ai) => {
          container.appendChild(buildAdventureCard(key, adventure, ai));
        });
      }
    }
    if (window.CategoryMaps) window.CategoryMaps.update(key, adventures);
    renderOverview();
  }

  function buildAdventureCard(key, adventure, ai) {
    adventure.attendees = adventure.attendees || [];
    adventure.costs = adventure.costs || [];
    const t = advTotals(adventure);

    const card = document.createElement("div");
    card.className = "adventure";
    card.innerHTML = `
      <header class="adventure__head">
        <div>
          <h4 class="adventure__name"></h4>
          <p class="adventure__meta"></p>
        </div>
        <button class="adventure__del" type="button" aria-label="Remove adventure">✕</button>
      </header>
      <div class="adventure__stops"></div>
      <div class="adventure__people">
        <h5 class="adventure__subtitle">Who's coming</h5>
        <div class="adventure__chips"></div>
        <div class="adventure__addperson"></div>
      </div>
      <div class="adventure__costs">
        <h5 class="adventure__subtitle">Shared costs</h5>
        <div class="adventure__costrows"></div>
        <form class="adventure__addcost">
          <input name="label" placeholder="Petrol, tickets…" required />
          <input name="amount" type="number" min="0" step="0.01" placeholder="0.00" required />
          <button class="btn btn--solid" type="submit">Add</button>
        </form>
        <p class="adventure__money"></p>
      </div>
      <form class="adventure__addstop">
        <label>Activity <input name="name" placeholder="Stop name" required /></label>
        <label>Time <input name="time" placeholder="6:30 PM" /></label>
        <label>Price (R) <input name="price" type="number" min="0" step="1" placeholder="0" /></label>
        <label>Location <input name="location" placeholder="Address or landmark" /></label>
        <label>Directions link <input name="link" type="url" placeholder="https://maps.app.goo.gl/…" /></label>
        <label>Meeting point <input name="meetingPoint" placeholder="Where to meet up" /></label>
        <label>What to bring <input name="whatToBring" placeholder="Snacks, sunscreen…" /></label>
        <label class="adventure__addstop-notes">Notes <textarea name="notes" rows="2" placeholder="Anything else worth remembering"></textarea></label>
        <button class="btn btn--solid" type="submit">Add stop</button>
      </form>`;

    card.querySelector(".adventure__name").textContent = adventure.name;
    card.querySelector(".adventure__meta").textContent =
      `${adventure.stops.length} stop${adventure.stops.length === 1 ? "" : "s"} · ` +
      `${t.n} going · ${money(t.total)}`;
    card.querySelector(".adventure__del").addEventListener("click", () => {
      plan.categories[key].splice(ai, 1);
      renderCategory(key);
    });

    /* ---- stops ---- */
    const stopsWrap = card.querySelector(".adventure__stops");
    if (adventure.stops.length === 0) {
      stopsWrap.innerHTML = '<p class="cards__empty">No stops yet — add the first one below.</p>';
    } else {
      adventure.stops.forEach((stop, si) => {
        stopsWrap.appendChild(buildStopCard(stop, () => {
          adventure.stops.splice(si, 1);
          renderCategory(key);
        }));
      });
    }

    /* ---- who's coming ---- */
    const chipsWrap = card.querySelector(".adventure__chips");
    adventure.attendees.forEach((pid) => {
      const person = plan.people.find((p) => p.id === pid);
      if (!person) return;
      const chip = document.createElement("span");
      chip.className = "chip chip--small";
      const nameEl = document.createElement("span");
      nameEl.textContent = person.name;
      const del = document.createElement("button");
      del.type = "button";
      del.textContent = "✕";
      del.setAttribute("aria-label", `Remove ${person.name} from this adventure`);
      del.addEventListener("click", () => {
        adventure.attendees = adventure.attendees.filter((id) => id !== pid);
        renderCategory(key);
      });
      chip.append(nameEl, del);
      chipsWrap.appendChild(chip);
    });

    const addPerson = card.querySelector(".adventure__addperson");
    const remaining = plan.people.filter((p) => !adventure.attendees.includes(p.id));
    if (plan.people.length === 0) {
      addPerson.innerHTML = '<p class="adventure__hint">Add your people in <a href="#crew">The Crew</a> first, then pick who\'s coming here.</p>';
    } else if (remaining.length === 0) {
      addPerson.innerHTML = '<p class="adventure__hint">The whole crew is in ✓</p>';
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
        adventure.attendees.push(select.value);
        renderCategory(key);
      });
      addPerson.appendChild(select);
    }

    /* ---- shared costs ---- */
    const costRows = card.querySelector(".adventure__costrows");
    adventure.costs.forEach((cost, ci) => {
      const row = document.createElement("div");
      row.className = "adventure__costrow";
      row.innerHTML = `<span class="adventure__costlabel"></span>
        <span class="adventure__costamount">${money(cost.amount)}</span>
        <button type="button" aria-label="Remove cost">✕</button>`;
      row.querySelector(".adventure__costlabel").textContent = cost.label;
      row.querySelector("button").addEventListener("click", () => {
        adventure.costs.splice(ci, 1);
        renderCategory(key);
      });
      costRows.appendChild(row);
    });

    card.querySelector(".adventure__addcost").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const label = (data.get("label") || "").trim();
      if (!label) return;
      adventure.costs.push({ label, amount: Number(data.get("amount")) || 0 });
      renderCategory(key);
    });

    const moneyLine = card.querySelector(".adventure__money");
    moneyLine.innerHTML =
      `Total ${money(t.total)} <small>(stops ${money(t.stopsSum)} + shared ${money(t.costsSum)})</small> · ` +
      (t.n > 0 ? `${money(t.per)} each` : `<small>add people to split</small>`);

    /* ---- add stop ---- */
    card.querySelector(".adventure__addstop").addEventListener("submit", (e) => {
      e.preventDefault();
      const data = new FormData(e.target);
      const name = (data.get("name") || "").trim();
      if (!name) return;
      adventure.stops.push({
        name,
        time: (data.get("time") || "").trim(),
        price: Number(data.get("price")) || 0,
        location: (data.get("location") || "").trim(),
        link: (data.get("link") || "").trim(),
        meetingPoint: (data.get("meetingPoint") || "").trim(),
        whatToBring: (data.get("whatToBring") || "").trim(),
        notes: (data.get("notes") || "").trim(),
      });
      renderCategory(key);
    });

    return card;
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
        plan.people = plan.people.filter((p) => p.id !== person.id);
        CATEGORIES.forEach((k) => (plan.categories[k] || []).forEach((a) => {
          a.attendees = (a.attendees || []).filter((id) => id !== person.id);
        }));
        renderCrew();
        renderAll();
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
        .filter(Boolean).join(" ");
      if (!name) return;
      plan.people.push({ id: "p" + nextPersonId++, name });
      form.reset();
      renderCrew();
      renderAll(); // refresh every adventure's dropdown
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
      ["Notes", stop.notes, false],
    ];
    const filled = detailFields.filter(([, value]) => value);
    if (filled.length === 0) {
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

    const del = document.createElement("button");
    del.type = "button";
    del.className = "stopcard__del";
    del.textContent = "Remove stop";
    del.addEventListener("click", (e) => { e.stopPropagation(); onDelete(); });
    details.appendChild(del);

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

  /* ---------- "Start an adventure" forms ---------- */
  function wireAddForms() {
    document.querySelectorAll("form.add[data-category]").forEach((form) => {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const key = form.dataset.category;
        const data = new FormData(form);
        const name = (data.get("name") || "").trim();
        if (!name) return;
        plan.categories[key].push({ name, stops: [] });
        form.reset();
        renderCategory(key);
      });
    });
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
      price: Number(s.price) || 0,
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
        stops: (a.stops || []).map(normalizeStop),
        attendees: (Array.isArray(a.attendees) ? a.attendees : []).filter((id) => validIds.has(id)),
        costs: (Array.isArray(a.costs) ? a.costs : []).map((c) => ({
          label: (c && c.label) || "Cost",
          amount: Number(c && c.amount) || 0,
        })),
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
    reader.onload = (e) => {
      let data;
      try {
        data = JSON.parse(e.target.result);
      } catch {
        alert("That file isn't valid JSON. Pick a plan you saved from here.");
        return;
      }
      if (!data.categories) {
        alert("This file is missing trip data. Nothing was changed.");
        return;
      }
      plan.people = (Array.isArray(data.people) ? data.people : [])
        .filter((p) => p && p.id && p.name)
        .map((p) => ({ id: String(p.id), name: String(p.name) }));
      nextPersonId = plan.people.reduce((max, p) => {
        const m = /^p(\d+)$/.exec(p.id);
        return m ? Math.max(max, Number(m[1]) + 1) : max;
      }, 1);
      const validIds = new Set(plan.people.map((p) => p.id));
      CATEGORIES.forEach((key) => {
        plan.categories[key] = toAdventures(data.categories[key], validIds);
      });
      // v2 files kept the trip name on the calculator
      plan.meta.tripName = (data.meta && data.meta.tripName) || (data.calculator && data.calculator.tripName) || "";
      const tripInput = document.getElementById("tripName");
      if (tripInput) tripInput.value = plan.meta.tripName;
      renderCrew();
      renderAll();
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
        photoRatio[url] = (img.naturalWidth / img.naturalHeight).toFixed(4);
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
      img.onload = () => { photoRatio[u] = (img.naturalWidth / img.naturalHeight).toFixed(4); };
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

  /* ---------- Boot ---------- */
  // Read-only handle for roadmap.js (and anything else that needs the plan)
  window.Trailhead = { getPlan: () => plan };

  document.addEventListener("DOMContentLoaded", () => {
    applyPhotos();
    renderCrew();
    renderAll();
    wireCrew();
    wireAddForms();
    wireSaveLoad();
    initBeachWaves();

    const tripInput = document.getElementById("tripName");
    if (tripInput) {
      tripInput.value = plan.meta.tripName || "";
      tripInput.addEventListener("input", () => { plan.meta.tripName = tripInput.value; });
    }

    const roadmapBtn = document.getElementById("roadmapBtn");
    if (roadmapBtn && window.Roadmap) roadmapBtn.addEventListener("click", window.Roadmap.generate);
  });
})();
