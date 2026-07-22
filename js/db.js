/* =========================================================
   db.js — EVERY storage call goes through this file. Stage 1
   only implements the local, in-memory backend (no crew code
   in the URL => local mode, works fully offline). Stage 2 adds
   a Firebase-backed implementation behind this exact same
   interface, selected by whether the URL carries a crew code —
   board.js and trip.js are written once against this interface
   and never need to change when Firebase is added.

   Shape mirrors the eventual crews/{crewCode}/... tree:
     trips/{tripId}      light index (title, category, date, cover,
                          status, archived, attendeeCount, headcount,
                          total, perPerson, updatedAt)
     tripData/{tripId}   attendees/stops/costs/suggestions/settings
   ========================================================= */
window.TrailheadDB = (function () {
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  // Local mode (no crew code) has no server, but the site is two real pages,
  // not an SPA — a plain in-memory object would be wiped by the full page
  // load that happens every time you click from the board into a trip.
  // sessionStorage is still zero-network and fully offline, it just survives
  // navigation within the same tab (and clears itself when the tab closes,
  // matching how ephemeral this fallback mode is meant to be).
  const STORAGE_KEY = "trailhead-local-store-v1";

  const store = {
    trips: {}, // tripId -> light index fields (no id inside)
    tripData: {}, // tripId -> { attendees:{}, stops:{}, costs:{}, suggestions:{}, settings:{} }
  };

  (function restore() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      store.trips = saved.trips || {};
      store.tripData = saved.tripData || {};
    } catch {
      // ignore corrupt/unavailable storage, start fresh
    }
  })();

  function persist() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
      // sessionStorage unavailable (e.g. some private-browsing modes) —
      // local mode still works within a single page load either way
    }
  }

  const tripsListeners = new Set();
  const tripDataListeners = {}; // tripId -> Set<fn>

  function currentTripsList() {
    return Object.entries(store.trips).map(([id, t]) => ({ id, ...t }));
  }

  function notifyTrips() {
    const list = currentTripsList();
    tripsListeners.forEach((cb) => cb(list));
  }

  function currentTripData(tripId) {
    const data = store.tripData[tripId];
    if (!data) return null;
    return {
      attendees: Object.entries(data.attendees).map(([id, a]) => ({ id, ...a })),
      stops: Object.entries(data.stops)
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => a.order - b.order),
      costs: Object.entries(data.costs).map(([id, c]) => ({ id, ...c })),
      suggestions: Object.entries(data.suggestions)
        .map(([id, s]) => ({ id, ...s }))
        .sort((a, b) => b.at - a.at),
      settings: { ...data.settings },
    };
  }

  function notifyTripData(tripId) {
    const set = tripDataListeners[tripId];
    if (!set || set.size === 0) return;
    const snapshot = currentTripData(tripId);
    set.forEach((cb) => cb(snapshot));
  }

  // Recomputes the light-index summary fields from tripData — the same
  // recompute-on-every-edit approach Stage 2/3 carries over to Firebase,
  // since there's no server to reconcile denormalized counters.
  function recompute(tripId) {
    const data = store.tripData[tripId];
    const trip = store.trips[tripId];
    if (!data || !trip) return;
    const t = window.Calculator.totals({
      stops: Object.values(data.stops),
      costs: Object.values(data.costs),
      attendeeCount: Object.keys(data.attendees).length,
      peopleOverride: data.settings.peopleOverride,
    });
    Object.assign(trip, {
      attendeeCount: t.attendeeCount,
      headcount: t.headcount,
      total: t.total,
      perPerson: t.perPerson,
      updatedAt: Date.now(),
    });
  }

  function touchTripData(tripId) {
    recompute(tripId);
    persist();
    notifyTripData(tripId);
    notifyTrips();
  }

  function nextOrder(tripId) {
    const stops = Object.values(store.tripData[tripId].stops);
    if (stops.length === 0) return 1000;
    return Math.max(...stops.map((s) => s.order || 0)) + 1000;
  }

  return {
    init() {
      // Stage 1: always local. Stage 2 will check for a crew code in the
      // URL here and swap in the Firebase-backed implementation.
      return { mode: "local" };
    },

    seedTrip({ title, category, date = "", cover = "", status = "planned", archived = false }) {
      const tripId = uid();
      store.trips[tripId] = {
        title,
        category,
        date,
        cover,
        status,
        archived,
        attendeeCount: 0,
        headcount: 0,
        total: 0,
        perPerson: 0,
        updatedAt: Date.now(),
      };
      store.tripData[tripId] = {
        attendees: {},
        stops: {},
        costs: {},
        suggestions: {},
        settings: { peopleOverride: null },
      };
      persist();
      return tripId;
    },

    isEmpty() {
      return Object.keys(store.trips).length === 0;
    },

    addTrip({ title, category, date = "" }) {
      const tripId = this.seedTrip({ title, category, date });
      notifyTrips();
      return tripId;
    },

    setArchived(tripId, archived) {
      if (!store.trips[tripId]) return;
      store.trips[tripId].archived = archived;
      persist();
      notifyTrips();
    },

    setStatus(tripId, status) {
      if (!store.trips[tripId]) return;
      store.trips[tripId].status = status;
      persist();
      notifyTrips();
    },

    deleteTrip(tripId) {
      // Trash-routing lands in Stage 5; for now this is a real removal,
      // same "no undo yet" behavior as today's site.
      delete store.trips[tripId];
      delete store.tripData[tripId];
      delete tripDataListeners[tripId];
      persist();
      notifyTrips();
    },

    onTrips(cb) {
      tripsListeners.add(cb);
      cb(currentTripsList());
      return () => tripsListeners.delete(cb);
    },

    onTripData(tripId, cb) {
      if (!tripDataListeners[tripId]) tripDataListeners[tripId] = new Set();
      tripDataListeners[tripId].add(cb);
      cb(currentTripData(tripId));
      return () => tripDataListeners[tripId].delete(cb);
    },

    getTrip(tripId) {
      const t = store.trips[tripId];
      return t ? { id: tripId, ...t } : null;
    },

    addAttendee(tripId, name) {
      store.tripData[tripId].attendees[uid()] = { name, addedAt: Date.now() };
      touchTripData(tripId);
    },

    removeAttendee(tripId, attendeeId) {
      delete store.tripData[tripId].attendees[attendeeId];
      touchTripData(tripId);
    },

    addStop(tripId, fields) {
      const stopId = uid();
      store.tripData[tripId].stops[stopId] = { ...fields, order: nextOrder(tripId) };
      touchTripData(tripId);
    },

    removeStop(tripId, stopId) {
      delete store.tripData[tripId].stops[stopId];
      touchTripData(tripId);
    },

    addCost(tripId, fields) {
      store.tripData[tripId].costs[uid()] = fields;
      touchTripData(tripId);
    },

    removeCost(tripId, costId) {
      delete store.tripData[tripId].costs[costId];
      touchTripData(tripId);
    },

    addSuggestion(tripId, fields) {
      store.tripData[tripId].suggestions[uid()] = { ...fields, at: Date.now() };
      touchTripData(tripId);
    },

    removeSuggestion(tripId, suggestionId) {
      delete store.tripData[tripId].suggestions[suggestionId];
      touchTripData(tripId);
    },

    setPeopleOverride(tripId, value) {
      store.tripData[tripId].settings.peopleOverride = value === "" || value == null ? null : Number(value);
      touchTripData(tripId);
    },
  };
})();
