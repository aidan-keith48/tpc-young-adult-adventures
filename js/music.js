/* =========================================================
   music.js — YOUR SOUNDTRACK GOES HERE.

   Paste a link (or a local path) to an MP3 for each section.
   Leave "" for silence in that section. The floating 🎶
   button bottom-right unmutes; music ALWAYS starts muted.

   Where to find free tracks (download the MP3, then either
   upload it to Cloudinary like the photos, or drop it into
   assets/audio/ and use a path like "assets/audio/road.mp3"):
     · pixabay.com/music        (no attribution needed)
     · YouTube Audio Library    (studio.youtube.com → Audio Library)
     · freemusicarchive.org     (check each track's license)
   Note: Spotify links won't work here — Spotify doesn't allow
   direct playback without logins/SDKs. Use downloaded MP3s.
   ========================================================= */
window.TRIP_MUSIC = {
  hero: "assets/audio/landingPage.mp3", // starts on the "Let's go" tap, plays until the next section's song
  roadTrips: "assets/audio/RoadTrip.mp3",
  beachDays: "assets/audio/BeachDay.mp3",
  camping: "assets/audio/Camping.mp3",
  hiking: "assets/audio/Hiking.mp3",
  events: "assets/audio/Events.mp3",

  chime: "",      // optional short one-shot layered on top of the "Let's go" tap
};
