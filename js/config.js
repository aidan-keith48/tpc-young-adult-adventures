/* =========================================================
   config.js — the one place category definitions live, plus
   the Firebase config slot (filled in Stage 2). Everything
   else (board.js, trip.js, map.js) reads CATEGORIES from here
   instead of hardcoding category lists — adding a 6th category
   later is one entry in this map, not a rewrite.
   ========================================================= */
window.TrailheadConfig = {
  CATEGORIES: {
    roadTrips: { label: "Road Trips", vibe: "road" },
    beachDays: { label: "Beach Days", vibe: "beach" },
    camping: { label: "Camping", vibe: "camp" },
    hiking: { label: "Hiking", vibe: "hike" },
    events: { label: "Events", vibe: "event" },
  },

  // Filled in during Stage 2 (Firebase project setup). This object is safe to
  // be public — Firebase's client config is not a secret. The Realtime
  // Database security rules are the only real access boundary; see README.
  firebase: null,
};
