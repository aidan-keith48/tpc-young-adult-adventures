/* =========================================================
   roadmap.js — builds the shareable, read-only Roadmap page
   from the current plan and opens it in a new tab. The page
   is self-contained (inline CSS/JS + the same generated SVG
   maps) and carries its own “Download this page” button.
   Exposed as window.Roadmap.
   ========================================================= */
(function () {
  const CATS = [
    { key: "roadTrips", vibe: "road", num: "01", title: "Road Trips", tag: "Windows down. Nowhere to be." },
    { key: "beachDays", vibe: "beach", num: "02", title: "Beach Days", tag: "Sand everywhere. Worth it." },
    { key: "camping", vibe: "camp", num: "03", title: "Camping", tag: "Pitch it. Light the fire." },
    { key: "hiking", vibe: "hike", num: "04", title: "Hiking", tag: "Switchbacks. Summit views." },
    { key: "events", vibe: "event", num: "05", title: "Events", tag: "Say yes. Figure it out later." },
  ];

  // Must mirror the landing gradients in styles.css
  const BANDS = {
    road: { grad: "linear-gradient(to bottom,#3A2650 0%,#6E3A6B 32%,#C25B7A 58%,#F5915B 80%,#FBC66A 100%)", text: "#F7F1E4", accent: "#FBC66A" },
    beach: { grad: "linear-gradient(to bottom,#8FD3E8 0%,#BFE9F2 48%,#E7F7F3 100%)", text: "#164653", accent: "#1E9AAB" },
    camp: { grad: "linear-gradient(to bottom,#0E1A15 0%,#16281F 34%,#234433 62%,#2C5545 100%)", text: "#F0EBDC", accent: "#FBC66A" },
    hike: { grad: "linear-gradient(to bottom,#3B2418 0%,#6B3A22 30%,#A85536 56%,#C97C42 78%,#F0B25E 100%)", text: "#F7F1E4", accent: "#F0B25E" },
    event: { grad: "linear-gradient(to bottom,#14102A 0%,#241543 30%,#3A1D5E 55%,#612C7F 78%,#9C4D9B 100%)", text: "#F7F1E4", accent: "#FF9DCB" },
  };

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (n) =>
    "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Same math as main.js: stops + shared costs, split over attendees.
  function advTotals(adv) {
    const stopsSum = (adv.stops || []).reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costsSum = (adv.costs || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const total = stopsSum + costsSum;
    const n = (adv.attendees || []).length;
    return { stopsSum, costsSum, total, n, per: n > 0 ? total / n : 0 };
  }

  function stopCard(stop) {
    const rows = [];
    if (stop.link) rows.push(["Directions", stop.link, /^https?:\/\//i.test(stop.link)]);
    if (stop.location) rows.push(["Location", stop.location, /^https?:\/\//i.test(stop.location)]);
    if (stop.meetingPoint) rows.push(["Meet", stop.meetingPoint, false]);
    if (stop.whatToBring) rows.push(["Bring", stop.whatToBring, false]);
    if (stop.notes) rows.push(["Notes", stop.notes, false]);
    return `<div class="stop rm-reveal">
      <div class="stop-top">
        <span class="stop-name">${esc(stop.name)}</span>
        ${stop.time ? `<span class="stop-time">${esc(stop.time)}</span>` : ""}
        <span class="stop-price">${money(stop.price)}</span>
      </div>
      ${rows.map(([k, v, isLink]) =>
        `<p class="stop-row"><strong>${k}:</strong> ${isLink ? `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>` : esc(v)}</p>`
      ).join("")}
    </div>`;
  }

  function bandHTML(cat, adventures, peopleById) {
    const band = BANDS[cat.vibe];
    const svg = window.CategoryMaps.buildMapSVG(adventures, cat.vibe, `rm-${cat.key}`, { animate: true });
    const advs = adventures.map((a) => {
      const t = advTotals(a);
      const names = (a.attendees || []).map((id) => peopleById[id]).filter(Boolean);
      const costs = (a.costs || []).length
        ? `<div class="adv-costs">${a.costs.map((c) =>
            `<div class="cost-line"><span>${esc(c.label)}</span><span class="mono">${money(c.amount)}</span></div>`
          ).join("")}</div>`
        : "";
      return `<article class="adv rm-reveal">
        <h3>${esc(a.name)}</h3>
        <p class="adv-meta">${a.stops.length} stop${a.stops.length === 1 ? "" : "s"} · ${t.n} going · ${money(t.total)}</p>
        ${names.length ? `<p class="adv-people"><strong>Going:</strong> ${esc(names.join(", "))}</p>` : ""}
        <div class="stops">${a.stops.map(stopCard).join("")}</div>
        ${costs}
        <p class="adv-total">Total ${money(t.total)}${t.n ? ` · ${money(t.per)} each` : ""}</p>
      </article>`;
    }).join("");
    return `<section class="band" style="background:${band.grad};color:${band.text}">
      <div class="wrap">
        <p class="eyebrow" style="color:${band.accent}">${cat.num} · ${cat.title}</p>
        <h2>${esc(cat.tag)}</h2>
        <div class="mapbox rm-reveal">${svg}</div>
        ${advs}
      </div>
    </section>`;
  }

  function overviewHTML(plan) {
    const rows = [];
    let grand = 0;
    CATS.forEach((c) => (plan.categories[c.key] || []).forEach((a) => {
      const t = advTotals(a);
      grand += t.total;
      rows.push(`<div class="cost-line">
        <span>${esc(a.name)} <em class="cost-cat">${c.title}</em></span>
        <span class="mono">${money(t.total)}${t.n ? ` · ${money(t.per)} each (${t.n})` : ""}</span>
      </div>`);
    }));
    if (!rows.length) return "";
    return `<section class="costs">
      <div class="wrap">
        <p class="eyebrow" style="color:#E39A3B">R · Split the costs</p>
        <h2>${esc(plan.meta.tripName || "The damage")}</h2>
        ${rows.join("")}
        <div class="totals">
          <div><span class="eyebrow">Grand total</span><b class="accent">${money(grand)}</b></div>
        </div>
      </div>
    </section>`;
  }

  function pageHTML(plan) {
    const peopleById = {};
    (plan.people || []).forEach((p) => { peopleById[p.id] = p.name; });
    const cats = CATS.filter((c) => (plan.categories[c.key] || []).some((a) => (a.stops || []).length));
    let advCount = 0, stopCount = 0, grandTotal = 0;
    CATS.forEach((c) => (plan.categories[c.key] || []).forEach((a) => {
      advCount++;
      stopCount += a.stops.length;
      grandTotal += advTotals(a).total;
    }));
    const dateStr = new Date().toLocaleDateString("en-ZA", { month: "long", day: "numeric", year: "numeric" });
    const tripName = (plan.meta && plan.meta.tripName) || "";
    const crewCount = (plan.people || []).length;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>TPC Young Adult Adventures — The Roadmap</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500..800&family=DM+Sans:opsz,wght@9..40,400..600&family=Caveat:wght@500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet" />
<style>
  *{box-sizing:border-box;margin:0}
  body{font-family:"DM Sans",system-ui,sans-serif;background:#F0EBDC;color:#1C2B27;-webkit-font-smoothing:antialiased;line-height:1.5}
  h1,h2,h3{font-family:"Bricolage Grotesque",system-ui,sans-serif;line-height:1.05;letter-spacing:-.012em}
  .wrap{max-width:1060px;margin:0 auto;padding:0 clamp(1rem,4vw,2.5rem)}
  .eyebrow{font-family:"Space Mono",monospace;text-transform:uppercase;letter-spacing:.2em;font-size:.72rem;margin-bottom:.9rem}
  .mono{font-family:"Space Mono",monospace}
  .hero{background:linear-gradient(120deg,#3A2650 0%,#1E9AAB 34%,#2C5545 66%,#A85536 100%);color:#F7F1E4;padding:clamp(3rem,8vw,5rem) 0 clamp(2.5rem,6vw,4rem)}
  .hero .eyebrow{color:#FBC66A}
  .hero h1{font-size:clamp(2.2rem,6vw,4rem);font-weight:800;max-width:18ch}
  .hero .sub{margin-top:1rem;color:rgba(247,241,228,.85);max-width:52ch}
  .stats{display:flex;gap:2.2rem;margin-top:1.8rem;flex-wrap:wrap;font-family:"Space Mono",monospace;font-size:.78rem;text-transform:uppercase;letter-spacing:.1em}
  .stats b{display:block;font-size:1.6rem;font-family:"Bricolage Grotesque",system-ui,sans-serif;letter-spacing:0}
  .btn{display:inline-flex;align-items:center;gap:.5rem;background:#E39A3B;color:#241C2E;border:none;border-radius:999px;padding:.75rem 1.4rem;font-weight:700;font-family:inherit;font-size:.95rem;cursor:pointer;margin-top:1.8rem}
  .btn:hover{filter:brightness(1.07)}
  .band{padding:clamp(2.5rem,6vw,4rem) 0}
  .band h2{font-size:clamp(1.7rem,4vw,2.7rem);font-weight:800}
  .mapbox{margin:1.6rem 0 1.8rem}
  .mapbox svg{display:block;width:100%;height:auto;border-radius:16px;box-shadow:0 18px 40px -18px rgba(15,15,25,.55)}
  .adv{background:rgba(247,241,228,.96);color:#1C2B27;border-radius:16px;padding:1.2rem 1.3rem;margin-bottom:1.1rem;box-shadow:0 10px 28px -16px rgba(15,15,25,.4)}
  .adv h3{font-size:1.2rem}
  .adv-meta{font-family:"Space Mono",monospace;font-size:.76rem;color:#5A6A62;margin:.25rem 0 .9rem}
  .adv-people{font-size:.9rem;margin:0 0 .9rem}
  .adv-people strong{color:#5A6A62;font-weight:600}
  .adv-costs{margin-top:.9rem}
  .adv-total{font-family:"Space Mono",monospace;font-weight:700;font-size:.85rem;margin:.8rem 0 0;color:#C05A2E}
  .cost-cat{font-style:normal;font-family:"Space Mono",monospace;font-size:.66rem;color:#5A6A62;text-transform:uppercase;letter-spacing:.08em;margin-left:.4rem}
  .stops{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:.8rem}
  .stop{background:#F0EBDC;border:1px solid rgba(28,43,39,.14);border-radius:12px;padding:.8rem .9rem}
  .stop-top{display:flex;gap:.6rem;align-items:baseline;margin-bottom:.35rem;flex-wrap:wrap}
  .stop-name{font-weight:700;flex:1}
  .stop-time{font-family:"Space Mono",monospace;font-size:.74rem;color:#5A6A62}
  .stop-price{font-family:"Space Mono",monospace;font-weight:700}
  .stop-row{font-size:.85rem;margin:.18rem 0}
  .stop-row strong{color:#5A6A62;font-weight:600}
  .stop-row a{color:#2C8C8C;word-break:break-all}
  .costs{padding:clamp(2.5rem,6vw,4rem) 0}
  .costs h2{font-size:clamp(1.6rem,3.5vw,2.4rem);margin-bottom:1.2rem}
  .cost-line{display:flex;justify-content:space-between;border-bottom:1px dashed rgba(28,43,39,.25);padding:.5rem 0;max-width:460px}
  .totals{display:flex;gap:2.5rem;margin-top:1.4rem;flex-wrap:wrap}
  .totals .eyebrow{color:#5A6A62;margin-bottom:.2rem}
  .totals b{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-size:2rem}
  .totals .accent{color:#C05A2E}
  .foot{background:#1C2B27;color:#F0EBDC;text-align:center;padding:2.6rem 1rem}
  .foot .cap{font-family:"Caveat",cursive;font-size:1.5rem;color:#FBC66A}
  .foot .btn{margin-top:1.2rem}
  .rm-reveal{opacity:0;transform:translateY(16px);transition:opacity .6s ease,transform .6s ease}
  .rm-reveal.in{opacity:1;transform:none}
  @media (prefers-reduced-motion:reduce){
    *{animation:none!important;transition:none!important}
    .rm-reveal{opacity:1!important;transform:none!important}
  }
</style>
</head>
<body>
  <header class="hero">
    <div class="wrap">
      <p class="eyebrow">TPC Young Adult Adventures · generated ${dateStr}</p>
      <h1>${esc(tripName || "The Roadmap")}</h1>
      <p class="sub">Every adventure on one page — the routes, the stops, the details. Read-only; the plan lives back on the planner.</p>
      <div class="stats">
        <div><b>${advCount}</b>adventure${advCount === 1 ? "" : "s"}</div>
        <div><b>${stopCount}</b>stop${stopCount === 1 ? "" : "s"}</div>
        <div><b>${crewCount}</b>in the crew</div>
        <div><b>${money(grandTotal)}</b>planned so far</div>
      </div>
      <button class="btn rm-dl" type="button">Download this page ↓</button>
    </div>
  </header>

  ${cats.map((c) => bandHTML(c, plan.categories[c.key].filter((a) => a.stops.length), peopleById)).join("")}

  ${overviewHTML(plan)}

  <footer class="foot">
    <p class="cap">see you out there</p>
    <p>TPC Young Adult Adventures — plan the trip before the group chat forgets.</p>
    <button class="btn rm-dl" type="button">Download this page ↓</button>
  </footer>

<script>
(function () {
  function dl() {
    var h = "<!DOCTYPE html>\\n" + document.documentElement.outerHTML;
    var b = new Blob([h], { type: "text/html" });
    var u = URL.createObjectURL(b);
    var a = document.createElement("a");
    a.href = u; a.download = "roadmap.html";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(u); }, 800);
  }
  Array.prototype.forEach.call(document.querySelectorAll(".rm-dl"), function (b) { b.addEventListener("click", dl); });

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) {
    Array.prototype.forEach.call(document.querySelectorAll("animate, animateMotion"), function (a) { a.remove(); });
  }
  var els = document.querySelectorAll(".rm-reveal");
  if (reduce || !("IntersectionObserver" in window)) {
    Array.prototype.forEach.call(els, function (e) { e.classList.add("in"); });
    return;
  }
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    });
  }, { threshold: 0.12 });
  Array.prototype.forEach.call(els, function (e) { io.observe(e); });
})();
<\/script>
</body>
</html>`;
  }

  function generate() {
    const plan = window.Trailhead && window.Trailhead.getPlan ? window.Trailhead.getPlan() : null;
    if (!plan) return;
    const hasStops = Object.values(plan.categories || {}).some((list) =>
      (list || []).some((a) => (a.stops || []).length)
    );
    if (!hasStops) {
      alert("Add at least one stop to an adventure first — then generate the roadmap.");
      return;
    }
    const html = pageHTML(plan);
    const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const win = window.open(url, "_blank");
    if (!win) {
      // popup blocked — fall back to downloading the file instead
      const a = Object.assign(document.createElement("a"), { href: url, download: "roadmap.html" });
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  window.Roadmap = { generate, _pageHTML: pageHTML };
})();
