/* =========================================================
   audio.js — the loading overlay + ambient soundtrack.
   Tracks come from js/music.js (window.TRIP_MUSIC). One
   looping <audio> element; an IntersectionObserver watches
   which section sits mid-viewport and crossfades to its
   track, fading out/in on every switch. The "Let's go" tap
   on the loader starts the landing track (a tap is what
   makes sound legal in browsers); the floating 🎶 button
   mutes/unmutes, and everything fades rather than cutting.
   Exposed as window.TripAudio.
   ========================================================= */
(function () {
  const cfg = window.TRIP_MUSIC || {};
  const SECTIONS = [
    { sel: ".hero", key: "hero" },
    { sel: "#road-trips", key: "roadTrips" },
    { sel: "#beach-days", key: "beachDays" },
    { sel: "#camping", key: "camping" },
    { sel: "#hiking", key: "hiking" },
    { sel: "#events", key: "events" },
  ];
  const TARGET_VOL = 0.55;

  const tracks = {};
  SECTIONS.forEach((s) => {
    const url = String(cfg[s.key] || "").trim();
    if (url) tracks[s.key] = url;
  });
  const hasTracks = Object.keys(tracks).length > 0;
  const chimeUrl = String(cfg.chime || "").trim();

  let audio = null;
  let currentKey = "hero"; // section currently mid-viewport
  let currentUrl = "";     // track currently loaded
  let muted = true;        // ALWAYS starts muted
  let fadeTimer = null;

  function ensureAudio() {
    if (!audio) {
      audio = new Audio();
      audio.loop = true;
      audio.volume = 0;
    }
    return audio;
  }

  function fadeTo(target, done) {
    const a = ensureAudio();
    clearInterval(fadeTimer);
    const STEP_MS = 40, STEPS = 30; // ~1.2s — songs fade, never cut
    const delta = (target - a.volume) / STEPS;
    let i = 0;
    fadeTimer = setInterval(() => {
      i++;
      a.volume = Math.min(1, Math.max(0, a.volume + delta));
      if (i >= STEPS) {
        a.volume = target;
        clearInterval(fadeTimer);
        if (done) done();
      }
    }, STEP_MS);
  }

  // Play the track for a section key. Sections with no track keep
  // whatever is already playing (silence stays silent).
  function playKey(key) {
    const url = tracks[key];
    if (!url || muted) return;
    const a = ensureAudio();
    if (url === currentUrl) {
      if (a.paused) { a.play().catch(() => {}); fadeTo(TARGET_VOL); }
      return;
    }
    const swap = () => {
      currentUrl = url;
      a.src = url;
      a.play().catch(() => {});
      fadeTo(TARGET_VOL);
    };
    if (!a.paused && a.volume > 0.05) fadeTo(0, swap);
    else swap();
  }

  function setMuted(next) {
    muted = next;
    const btn = document.querySelector(".music-btn");
    if (btn) {
      btn.textContent = muted ? "🔇" : "🎶";
      btn.setAttribute("aria-pressed", String(!muted));
      btn.title = muted ? "Play the soundtrack" : "Mute the soundtrack";
    }
    if (muted) {
      if (audio) fadeTo(0, () => audio.pause());
    } else {
      playKey(tracks[currentKey] ? currentKey : "hero");
    }
  }

  function initMusic() {
    if (!hasTracks) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "music-btn";
    btn.addEventListener("click", () => setMuted(!muted));
    document.body.appendChild(btn);
    setMuted(true); // sets icon/labels

    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const key = e.target.dataset.musicKey;
        if (key && key !== currentKey) {
          currentKey = key;
          playKey(key);
        }
      });
    }, { rootMargin: "-45% 0px -45% 0px", threshold: 0 });

    SECTIONS.forEach((s) => {
      const el = document.querySelector(s.sel);
      if (el) {
        el.dataset.musicKey = s.key;
        io.observe(el);
      }
    });
  }

  function chime() {
    if (!chimeUrl) return;
    const c = new Audio(chimeUrl);
    c.volume = 0.7;
    c.play().catch(() => {});
  }

  /* ---------- loading overlay ---------- */
  function initLoader() {
    const loader = document.getElementById("loader");
    if (!loader) return;
    const btn = loader.querySelector(".loader__btn");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    document.body.classList.add("no-scroll");
    let gone = false;
    const reveal = (withSound) => {
      if (gone) return;
      gone = true;
      if (withSound) {
        chime();
        setMuted(false); // the tap is a user gesture — start the landing track
      }
      loader.classList.add("loader--out");
      document.body.classList.remove("no-scroll");
      setTimeout(() => loader.remove(), 900);
    };

    if (reduce) { reveal(false); return; }

    btn.addEventListener("click", () => reveal(true), { once: true });
    const ready = () => loader.classList.add("loader--ready");
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready);
    setTimeout(ready, 2500);        // don't wait forever for slow assets
    setTimeout(() => reveal(false), 7000); // never trap anyone
  }

  document.addEventListener("DOMContentLoaded", () => {
    initLoader();
    initMusic();
  });

  window.TripAudio = { chime, setMuted };
})();
