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

  // Paste the config object Firebase showed you when you registered the web
  // app (Project settings -> General -> Your apps -> the </> icon). This is
  // safe to commit — Firebase's client config is not a secret. The Realtime
  // Database security rules in firebase/database.rules.json are the only
  // real access boundary; see README. Leave as null to force local mode.
  firebase: null,
  // firebase: {
  //   apiKey: "...",
  //   authDomain: "...",
  //   databaseURL: "...",
  //   projectId: "...",
  //   storageBucket: "...",
  //   messagingSenderId: "...",
  //   appId: "...",
  // },
};
