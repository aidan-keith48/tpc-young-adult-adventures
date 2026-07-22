/* =========================================================
   config.js — the one place category definitions live, plus
   the Firebase config slot (filled in Stage 2). Everything
   else (board.js, trip.js, map.js) reads CATEGORIES from here
   instead of hardcoding category lists — adding a 6th category
   later is one entry in this map, not a rewrite.
   ========================================================= */
window.TrailheadConfig = {
  // SINGLE-CREW LOCK — ⚠️ READ BEFORE FILLING THIS IN.
  // The crew code IS the password: anyone who has it can open and edit the
  // whole plan. This file ships to every visitor (and lives in the public
  // GitHub repo), so on a public site this must stay "" — share the ?crew=
  // link in the group chat instead, and lock crew *creation* in the Firebase
  // console rules (README → "Locking it down"). Only paste a code here if the
  // site itself is private.
  lockedCrewCode: "",

  CATEGORIES: {
    roadTrips: { label: "Road Trips", vibe: "road", mover: "🚐", stars: false, color: "#c2793b" },
    beachDays: { label: "Beach Days", vibe: "beach", mover: "⛵", stars: false, color: "#1e9aab" },
    camping: { label: "Camping", vibe: "camp", mover: "", stars: true, color: "#2c6e63" },
    hiking: { label: "Hiking", vibe: "hike", mover: "🚶", stars: false, color: "#a85536" },
    events: { label: "Events", vibe: "event", mover: "🚕", stars: true, color: "#8a4fa0" },
  },

  // This is safe to commit — Firebase's client config is not a secret. The
  // Realtime Database security rules in firebase/database.rules.json are the
  // only real access boundary; see README.
  //
  firebase: {
    apiKey: "AIzaSyDzYvqJjhP-0bXlB0mkzabT4WHFIl2WQ-E",
    authDomain: "tpc-young-adult.firebaseapp.com",
    databaseURL: "https://tpc-young-adult-default-rtdb.europe-west1.firebasedatabase.app/",
    projectId: "tpc-young-adult",
    storageBucket: "tpc-young-adult.firebasestorage.app",
    messagingSenderId: "1095024876668",
    appId: "1:1095024876668:web:05e029278fdd077f23bdf9",
  },
};
