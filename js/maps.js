/* =========================================================
   maps.js — hand-drawn themed SVG maps, one per category.
   Every adventure's stops become numbered pins along a
   winding route; the first stop of each adventure carries a
   flag with the adventure's name. buildMapSVG is a pure
   string generator (no DOM), so the Roadmap export reuses it.
   Exposed as window.CategoryMaps.
   ========================================================= */
(function () {
  const W = 1000, H = 380;

  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
  const money = (n) =>
    "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* Route geometry is pure math (no getPointAtLength) so pins and
     the path always agree and the SVG can be built as a string. */
  const routeXY = (t) => [
    70 + t * (W - 140),
    200 + 62 * Math.sin(t * Math.PI * 2 * 1.6 - 0.9),
  ];

  function routePathD() {
    const pts = [];
    for (let i = 0; i <= 80; i++) pts.push(routeXY(i / 80));
    return "M" + pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" L");
  }

  /* ---------- per-vibe theming ---------- */
  const VIBES = {
    road: {
      grad: [["0", "#3A2650"], [".32", "#6E3A6B"], [".58", "#C25B7A"], [".8", "#F5915B"], ["1", "#FBC66A"]],
      route: "#F4C542", dash: "16 13",
      pin: "#E39A3B", pinText: "#241C2E",
      label: "#F7F1E4", halo: "rgba(38,22,54,.6)", flag: "#FBC66A",
      mover: { emoji: "🚐", flip: true, dur: 14 },
      empty: "Add stops to chart this drive.",
      extraDefs: (p) =>
        `<radialGradient id="${p}-sun"><stop offset="0" stop-color="rgba(255,238,190,.55)"/><stop offset="1" stop-color="rgba(255,238,190,0)"/></radialGradient>`,
      deco: (p) => `<circle cx="500" cy="330" r="170" fill="url(#${p}-sun)"/>`,
    },
    beach: {
      grad: [["0", "#8FD3E8"], [".48", "#BFE9F2"], ["1", "#E7F7F3"]],
      route: "#1E9AAB", dash: "2 14",
      pin: "#FF8C6B", pinText: "#FFFFFF",
      label: "#164653", halo: "rgba(255,255,255,.75)", flag: "#1E9AAB",
      mover: { emoji: "⛵", flip: true, dur: 16 },
      empty: "Add stops to chart this beach day.",
      extraDefs: (p) =>
        `<radialGradient id="${p}-sunb"><stop offset="0" stop-color="rgba(255,236,168,.9)"/><stop offset="1" stop-color="rgba(255,236,168,0)"/></radialGradient>`,
      deco: (p) => `
        <circle cx="130" cy="80" r="60" fill="url(#${p}-sunb)"/>
        <circle cx="130" cy="80" r="30" fill="#FFD25A" opacity=".85"/>
        <path d="M640,332 q14,-10 28,0 t28,0 t28,0" stroke="rgba(30,154,171,.45)" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M120,306 q14,-10 28,0 t28,0" stroke="rgba(30,154,171,.4)" stroke-width="3" fill="none" stroke-linecap="round"/>
        <path d="M830,116 q14,-10 28,0 t28,0" stroke="rgba(255,255,255,.65)" stroke-width="3" fill="none" stroke-linecap="round"/>`,
    },
    camp: {
      grad: [["0", "#0E1A15"], [".34", "#16281F"], [".62", "#234433"], ["1", "#2C5545"]],
      route: "#FBC66A", dash: "12 12",
      pin: "#E39A3B", pinText: "#241C2E",
      label: "#F0EBDC", halo: "rgba(8,16,12,.65)", flag: "#FBC66A",
      mover: { firefly: true, dur: 16 },
      empty: "Add stops to chart this campout.",
      deco: (p, animate) => {
        const stars = [[90, 50], [210, 90], [330, 40], [470, 80], [610, 55], [750, 95], [880, 45], [540, 130], [160, 140], [820, 140]]
          .map(([x, y], i) =>
            `<circle cx="${x}" cy="${y}" r="2.2" fill="#FBC66A">${animate ? `<animate attributeName="opacity" values=".25;1;.25" dur="2.6s" begin="${(i * 0.4).toFixed(1)}s" repeatCount="indefinite"/>` : ""}</circle>`
          ).join("");
        const pts = [[0, .55], [5, .7], [10, .4], [16, .65], [22, .3], [28, .62], [34, .45], [40, .68], [46, .38], [52, .6], [58, .42], [64, .66], [70, .35], [76, .63], [82, .48], [88, .68], [94, .4], [100, .6]]
          .map(([x, f]) => `${x * 10},${(300 + f * 80).toFixed(0)}`).join(" ");
        return `${stars}<polygon points="0,380 ${pts} 1000,380" fill="#0B1611" opacity=".92"/>`;
      },
    },
    event: {
      grad: [["0", "#14102A"], [".3", "#241543"], [".55", "#3A1D5E"], [".78", "#612C7F"], ["1", "#9C4D9B"]],
      route: "#FF9DCB", dash: "14 12",
      pin: "#E86FA8", pinText: "#FFFFFF",
      label: "#F7F1E4", halo: "rgba(18,10,36,.65)", flag: "#FF9DCB",
      mover: { emoji: "🚕", flip: true, dur: 15 },
      empty: "Add stops to chart the night out.",
      deco: (p, animate) => {
        // city skyline with lit windows
        const skyline = [[0, 45], [6, 45], [6, 25], [12, 25], [12, 55], [20, 55], [20, 15], [27, 15], [27, 50], [34, 50], [34, 30], [42, 30], [42, 60], [50, 60], [50, 20], [57, 20], [57, 48], [64, 48], [64, 35], [71, 35], [71, 58], [78, 58], [78, 22], [85, 22], [85, 52], [92, 52], [92, 38], [100, 38]]
          .map(([x, f]) => `${x * 10},${(300 + f * 0.8).toFixed(0)}`).join(" ");
        const windows = [[45, 354], [120, 362], [210, 356], [300, 366], [390, 353], [470, 360], [560, 366], [650, 354], [740, 361], [830, 356], [920, 364]]
          .map(([x, y], i) =>
            `<rect x="${x}" y="${y}" width="5" height="5" fill="#FBC66A">${animate ? `<animate attributeName="opacity" values=".3;1;.3" dur="2.2s" begin="${(i * 0.3).toFixed(1)}s" repeatCount="indefinite"/>` : ""}</rect>`
          ).join("");
        return `<polygon points="0,380 ${skyline} 1000,380" fill="#0C0A1C" opacity=".95"/>${windows}`;
      },
    },
    hike: {
      grad: [["0", "#3B2418"], [".3", "#6B3A22"], [".56", "#A85536"], [".78", "#C97C42"], ["1", "#F0B25E"]],
      route: "#F7F1E4", dash: "10 11",
      pin: "#C05A2E", pinText: "#F7F1E4",
      label: "#F7F1E4", halo: "rgba(45,24,12,.6)", flag: "#F0B25E",
      mover: { emoji: "🚶", flip: true, dur: 18 },
      empty: "Add stops to chart this trail.",
      deco: () => {
        const back = [[0, .5], [15, .2], [28, .45], [42, .1], [56, .4], [70, .18], [84, .42], [100, .25]]
          .map(([x, f]) => `${x * 10},${(285 + f * 95).toFixed(0)}`).join(" ");
        const front = [[0, .62], [12, .3], [22, .55], [34, .15], [46, .5], [58, .25], [70, .58], [82, .2], [92, .48], [100, .35]]
          .map(([x, f]) => `${x * 10},${(300 + f * 80).toFixed(0)}`).join(" ");
        return `<polygon points="0,380 ${back} 1000,380" fill="rgba(59,36,24,.5)"/><polygon points="0,380 ${front} 1000,380" fill="rgba(43,26,16,.85)"/>`;
      },
    },
  };

  /* ---------- pieces ---------- */
  function pinSVG(stop, i, vibe, t) {
    const [x, y] = routeXY(t);
    const above = i % 2 === 0;
    const labelY = above ? y - 26 : y + 38;
    const tooltip = [
      stop.name,
      stop.time && `Time: ${stop.time}`,
      Number(stop.price) > 0 && `Price: ${money(stop.price)}`,
      stop.location && `Location: ${stop.location}`,
      stop.meetingPoint && `Meet: ${stop.meetingPoint}`,
      stop.whatToBring && `Bring: ${stop.whatToBring}`,
      stop.notes && `Notes: ${stop.notes}`,
    ].filter(Boolean).join("\n");

    let flag = "";
    if (stop._flag) {
      const flagY = above ? y - 48 : y - 26;
      flag = `<text x="${x.toFixed(1)}" y="${flagY.toFixed(1)}" text-anchor="middle" font-family="Caveat, cursive" font-size="19" fill="${vibe.flag}" paint-order="stroke" stroke="${vibe.halo}" stroke-width="4" stroke-linejoin="round">⚑ ${esc(trunc(stop._flag, 22))}</text>`;
    }

    return `<g>
      <title>${esc(tooltip)}</title>
      ${flag}
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${vibe.pin}" stroke="#F7F1E4" stroke-width="2.5"/>
      <text x="${x.toFixed(1)}" y="${(y + 4.5).toFixed(1)}" text-anchor="middle" font-family="Space Mono, monospace" font-size="13" font-weight="700" fill="${vibe.pinText}">${i + 1}</text>
      <text x="${x.toFixed(1)}" y="${labelY.toFixed(1)}" text-anchor="middle" font-family="DM Sans, system-ui, sans-serif" font-size="14" font-weight="600" fill="${vibe.label}" paint-order="stroke" stroke="${vibe.halo}" stroke-width="3.5" stroke-linejoin="round">${esc(trunc(stop.name, 18))}</text>
    </g>`;
  }

  function moverSVG(vibe, idPrefix) {
    const m = vibe.mover;
    const motion = `<animateMotion dur="${m.dur}s" repeatCount="indefinite"><mpath xlink:href="#${idPrefix}-route" href="#${idPrefix}-route"/></animateMotion>`;
    if (m.firefly) {
      return `<g>
        <circle r="9" fill="#FBC66A" opacity=".3"/>
        <circle r="4" fill="#FFE9B0"><animate attributeName="opacity" values="1;.35;1" dur="1.6s" repeatCount="indefinite"/></circle>
        ${motion}
      </g>`;
    }
    const glyph = `<text x="0" y="9" text-anchor="middle" font-size="26">${m.emoji}</text>`;
    // directional emoji face left by default; flip so they face the direction of travel
    return `<g>${m.flip ? `<g transform="scale(-1,1)">${glyph}</g>` : glyph}${motion}</g>`;
  }

  /* ---------- the generator ---------- */
  function buildMapSVG(adventures, vibeName, idPrefix, opts) {
    const vibe = VIBES[vibeName] || VIBES.road;
    const animate = !opts || opts.animate !== false;

    const stops = [];
    (adventures || []).forEach((adv) => {
      (adv.stops || []).forEach((s, si) => stops.push(Object.assign({}, s, { _flag: si === 0 ? adv.name : "" })));
    });

    const defs = `<defs>
      <linearGradient id="${idPrefix}-bg" x1="0" y1="0" x2="0" y2="1">${vibe.grad.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient>
      ${vibe.extraDefs ? vibe.extraDefs(idPrefix) : ""}
    </defs>`;

    const bg = `<rect width="${W}" height="${H}" fill="url(#${idPrefix}-bg)"/>`;
    const deco = vibe.deco ? vibe.deco(idPrefix, animate) : "";
    const route = `<path id="${idPrefix}-route" d="${routePathD()}" fill="none" stroke="${vibe.route}" stroke-width="5" stroke-dasharray="${vibe.dash}" stroke-linecap="round" opacity="${stops.length ? ".9" : ".4"}"/>`;

    const pins = stops
      .map((s, i) => pinSVG(s, i, vibe, stops.length === 1 ? 0.5 : 0.06 + 0.88 * (i / (stops.length - 1))))
      .join("");
    const mover = stops.length && animate ? moverSVG(vibe, idPrefix) : "";
    const emptyMsg = stops.length
      ? ""
      : `<text x="${W / 2}" y="${H / 2 - 40}" text-anchor="middle" font-family="Space Mono, monospace" font-size="16" fill="${vibe.label}" paint-order="stroke" stroke="${vibe.halo}" stroke-width="4" stroke-linejoin="round">${esc(vibe.empty)}</text>`;

    const label = stops.length
      ? `Illustrated route map with ${stops.length} stop${stops.length === 1 ? "" : "s"}`
      : "Illustrated route map, no stops yet";

    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" role="img" aria-label="${label}">${defs}${bg}${deco}${route}${pins}${mover}${emptyMsg}</svg>`;
  }

  /* ---------- live page hook ---------- */
  function update(key, adventures) {
    const box = document.querySelector(`.catmap[data-category="${key}"]`);
    if (!box) return;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    box.innerHTML = buildMapSVG(adventures, box.dataset.vibe, `catmap-${key}`, { animate: !reduce });
  }

  window.CategoryMaps = { update, buildMapSVG };
})();
