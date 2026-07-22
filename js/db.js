/* =========================================================
   db.js — EVERY storage call goes through this file. Two
   backends share one interface, selected by whether the URL
   carries a crew code (?crew=...):
     - local:  in-memory + sessionStorage, fully offline, no
               server. Used when there's no crew code.
     - sync:   Firebase Realtime Database, scoped to
               crews/{crewCode}/... Used once a crew exists.
   board.js and trip.js are written once against this interface
   and never branch on which backend is active.

   Both backends keep the same light/heavy split:
     trips/{tripId}      light index (title, category, date, cover,
                          status, archived, attendeeCount, headcount,
                          total, perPerson, updatedAt) — boards read
                          ONLY this.
     tripData/{tripId}   attendees/stops/costs/suggestions/settings —
                          loaded only for the one trip that's open.

   Every delete routes through `trash` instead of a bare remove —
   copy the item into trash and null the original path in the same
   atomic multi-path write. This is a rule for both backends now
   (Stage 5 adds the "Recently deleted" restore UI on top of it).
   ========================================================= */
window.TrailheadDB = (function () {
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

  function nextOrder(stops) {
    const values = Object.values(stops || {});
    return values.length ? Math.max(...values.map((s) => s.order || 0)) + 1000 : 1000;
  }

  // ---------------------------------------------------------------
  // Local backend — in-memory, mirrored to sessionStorage so it
  // survives navigation between the two real pages (this is not an
  // SPA, so a plain in-memory object would be wiped on every click
  // from the board into a trip). sessionStorage is still zero-
  // network and fully offline; it just clears when the tab closes.
  // ---------------------------------------------------------------
  function createLocalBackend() {
    const STORAGE_KEY = "trailhead-local-store-v1";
    const store = { trips: {}, tripData: {} };

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        store.trips = saved.trips || {};
        store.tripData = saved.tripData || {};
      }
    } catch {
      // corrupt/unavailable storage — start fresh
    }

    function persist() {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      } catch {
        // unavailable (e.g. some private-browsing modes) — still works
        // within a single page load either way
      }
    }

    const tripsListeners = new Set();
    const tripListeners = {}; // tripId -> Set<fn>, single-trip light-index subscribers
    const tripDataListeners = {}; // tripId -> Set<fn>

    function currentTripsList() {
      return Object.entries(store.trips).map(([id, t]) => ({ id, ...t }));
    }

    function notifyTrips() {
      const list = currentTripsList();
      tripsListeners.forEach((cb) => cb(list));
      Object.keys(tripListeners).forEach((tripId) => {
        const set = tripListeners[tripId];
        if (!set || set.size === 0) return;
        const t = store.trips[tripId] ? { id: tripId, ...store.trips[tripId] } : null;
        set.forEach((cb) => cb(t));
      });
    }

    function currentTripData(tripId) {
      const data = store.tripData[tripId];
      if (!data) return { attendees: [], stops: [], costs: [], suggestions: [], settings: { peopleOverride: null } };
      return {
        attendees: Object.entries(data.attendees).map(([id, a]) => ({ id, ...a })),
        stops: Object.entries(data.stops).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.order - b.order),
        costs: Object.entries(data.costs).map(([id, c]) => ({ id, ...c })),
        suggestions: Object.entries(data.suggestions).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.at - a.at),
        settings: { ...data.settings },
      };
    }

    function notifyTripData(tripId) {
      const set = tripDataListeners[tripId];
      if (!set || set.size === 0) return;
      set.forEach((cb) => cb(currentTripData(tripId)));
    }

    function ensureTripData(tripId) {
      if (!store.tripData[tripId]) {
        store.tripData[tripId] = { attendees: {}, stops: {}, costs: {}, suggestions: {}, settings: { peopleOverride: null } };
      }
      return store.tripData[tripId];
    }

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

    function trash(tripId, kind, originalId, data) {
      const data2 = JSON.parse(JSON.stringify(data));
      ensureTripData(tripId); // trash lives independent of a trip's own data
      store.tripData[tripId]._trashBin = store.tripData[tripId]._trashBin || [];
      // Stage 5 builds real browsing/restore; for now this just proves the
      // "copy then null" pattern works identically to the Firebase backend.
      window.__trailheadTrash = window.__trailheadTrash || [];
      window.__trailheadTrash.push({ kind, tripId, originalId, deletedAt: Date.now(), deletedBy: "", data: data2 });
    }

    return {
      isEmpty() {
        return Object.keys(store.trips).length === 0;
      },

      seedTrip({ title, category, date = "", cover = "", status = "planned", archived = false }) {
        const tripId = uid();
        store.trips[tripId] = {
          title, category, date, cover, status, archived,
          attendeeCount: 0, headcount: 0, total: 0, perPerson: 0, updatedAt: Date.now(),
        };
        ensureTripData(tripId);
        persist();
        return tripId;
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
        trash(tripId, "trip", tripId, { light: store.trips[tripId], heavy: store.tripData[tripId] });
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

      onTrip(tripId, cb) {
        if (!tripListeners[tripId]) tripListeners[tripId] = new Set();
        tripListeners[tripId].add(cb);
        cb(store.trips[tripId] ? { id: tripId, ...store.trips[tripId] } : null);
        return () => tripListeners[tripId].delete(cb);
      },

      onTripData(tripId, cb) {
        if (!tripDataListeners[tripId]) tripDataListeners[tripId] = new Set();
        tripDataListeners[tripId].add(cb);
        cb(currentTripData(tripId));
        return () => tripDataListeners[tripId].delete(cb);
      },

      addAttendee(tripId, name) {
        ensureTripData(tripId).attendees[uid()] = { name, addedAt: Date.now() };
        touchTripData(tripId);
      },

      removeAttendee(tripId, attendeeId) {
        const data = ensureTripData(tripId);
        if (data.attendees[attendeeId]) trash(tripId, "attendee", attendeeId, data.attendees[attendeeId]);
        delete data.attendees[attendeeId];
        touchTripData(tripId);
      },

      addStop(tripId, fields) {
        const data = ensureTripData(tripId);
        data.stops[uid()] = { ...fields, order: nextOrder(data.stops) };
        touchTripData(tripId);
      },

      removeStop(tripId, stopId) {
        const data = ensureTripData(tripId);
        if (data.stops[stopId]) trash(tripId, "stop", stopId, data.stops[stopId]);
        delete data.stops[stopId];
        touchTripData(tripId);
      },

      addCost(tripId, fields) {
        ensureTripData(tripId).costs[uid()] = fields;
        touchTripData(tripId);
      },

      removeCost(tripId, costId) {
        const data = ensureTripData(tripId);
        if (data.costs[costId]) trash(tripId, "cost", costId, data.costs[costId]);
        delete data.costs[costId];
        touchTripData(tripId);
      },

      addSuggestion(tripId, fields) {
        ensureTripData(tripId).suggestions[uid()] = { ...fields, at: Date.now() };
        touchTripData(tripId);
      },

      removeSuggestion(tripId, suggestionId) {
        const data = ensureTripData(tripId);
        if (data.suggestions[suggestionId]) trash(tripId, "suggestion", suggestionId, data.suggestions[suggestionId]);
        delete data.suggestions[suggestionId];
        touchTripData(tripId);
      },

      setPeopleOverride(tripId, value) {
        ensureTripData(tripId).settings.peopleOverride = value === "" || value == null ? null : Number(value);
        touchTripData(tripId);
      },
    };
  }

  // ---------------------------------------------------------------
  // Sync backend — Firebase Realtime Database, scoped to one crew.
  // Keeps two SEPARATE listeners (trips vs. one open trip's tripData)
  // rather than one listener on the whole crew subtree, so the board
  // never downloads tripData for trips it isn't showing — the same
  // light/heavy split the local backend already has.
  // ---------------------------------------------------------------
  let firebaseApp = null;
  function ensureFirebaseApp() {
    if (firebaseApp) return firebaseApp;
    const cfg = window.TrailheadConfig.firebase;
    if (!cfg) throw new Error("Trailhead: no Firebase config in js/config.js yet — paste it in, then reload.");
    if (typeof firebase === "undefined") throw new Error("Trailhead: the Firebase SDK didn't load (check your network connection).");
    firebaseApp = firebase.initializeApp(cfg);
    return firebaseApp;
  }

  function createFirebaseBackend(crewCode) {
    ensureFirebaseApp();
    const crewRef = firebase.database().ref("crews/" + crewCode);
    const tripsRef = crewRef.child("trips");
    const trashRef = crewRef.child("trash");

    let cachedTrips = {};
    let tripsAttached = false;
    const tripsListeners = new Set();

    const tripDataCache = {};
    const tripDataAttached = {};
    const tripDataListeners = {};

    function ensureTripsListener() {
      if (tripsAttached) return;
      tripsAttached = true;
      tripsRef.on("value", (snap) => {
        cachedTrips = snap.val() || {};
        notifyTrips();
      });
    }

    function currentTripsList() {
      return Object.entries(cachedTrips).map(([id, t]) => ({ id, ...t }));
    }

    function notifyTrips() {
      const list = currentTripsList();
      tripsListeners.forEach((cb) => cb(list));
    }

    function ensureTripDataListener(tripId) {
      if (tripDataAttached[tripId]) return;
      tripDataAttached[tripId] = true;
      crewRef.child("tripData/" + tripId).on("value", (snap) => {
        tripDataCache[tripId] = snap.val() || {};
        notifyTripData(tripId);
      });
    }

    function normalizedTripData(tripId) {
      const raw = tripDataCache[tripId] || {};
      return {
        attendees: Object.entries(raw.attendees || {}).map(([id, a]) => ({ id, ...a })),
        stops: Object.entries(raw.stops || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.order - b.order),
        costs: Object.entries(raw.costs || {}).map(([id, c]) => ({ id, ...c })),
        suggestions: Object.entries(raw.suggestions || {}).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.at - a.at),
        settings: { peopleOverride: (raw.settings && raw.settings.peopleOverride) ?? null },
      };
    }

    function notifyTripData(tripId) {
      const set = tripDataListeners[tripId];
      if (!set || set.size === 0) return;
      const snapshot = normalizedTripData(tripId);
      set.forEach((cb) => cb(snapshot));
    }

    // Recomputes the light-index summary fields against a hypothetical
    // post-mutation snapshot, since Firebase writes are async and there's
    // no server to reconcile these denormalized counters for us.
    function totalsAfter(tripId, mutate) {
      const draft = JSON.parse(JSON.stringify(tripDataCache[tripId] || {}));
      mutate(draft);
      return window.Calculator.totals({
        stops: Object.values(draft.stops || {}),
        costs: Object.values(draft.costs || {}),
        attendeeCount: Object.keys(draft.attendees || {}).length,
        peopleOverride: (draft.settings || {}).peopleOverride ?? null,
      });
    }

    function withSummary(updates, tripId, t) {
      updates["trips/" + tripId + "/attendeeCount"] = t.attendeeCount;
      updates["trips/" + tripId + "/headcount"] = t.headcount;
      updates["trips/" + tripId + "/total"] = t.total;
      updates["trips/" + tripId + "/perPerson"] = t.perPerson;
      updates["trips/" + tripId + "/updatedAt"] = Date.now();
      return updates;
    }

    function commit(updates) {
      crewRef.update(updates).catch((err) => console.error("Trailhead: write rejected —", err.message));
    }

    function trashAndClear(tripId, kind, originalId, path, data) {
      const trashId = trashRef.push().key;
      const updates = {};
      updates[path] = null;
      updates["trash/" + trashId] = { kind, tripId, originalId, deletedAt: Date.now(), deletedBy: "", data };
      return updates;
    }

    return {
      isEmpty() {
        return Object.keys(cachedTrips).length === 0;
      },

      addTrip({ title, category, date = "" }) {
        const tripId = tripsRef.push().key;
        const updates = {};
        updates["trips/" + tripId] = {
          title, category, date, cover: "", status: "planned", archived: false,
          attendeeCount: 0, headcount: 0, total: 0, perPerson: 0, updatedAt: Date.now(),
        };
        commit(updates);
        return tripId;
      },

      setArchived(tripId, archived) {
        commit({ ["trips/" + tripId + "/archived"]: archived });
      },

      setStatus(tripId, status) {
        commit({ ["trips/" + tripId + "/status"]: status });
      },

      deleteTrip(tripId) {
        const trashId = trashRef.push().key;
        const updates = {};
        updates["trips/" + tripId] = null;
        updates["tripData/" + tripId] = null;
        updates["trash/" + trashId] = {
          kind: "trip", tripId, originalId: tripId, deletedAt: Date.now(), deletedBy: "",
          data: { light: cachedTrips[tripId] || null, heavy: tripDataCache[tripId] || null },
        };
        commit(updates);
      },

      onTrips(cb) {
        ensureTripsListener();
        tripsListeners.add(cb);
        cb(currentTripsList());
        return () => tripsListeners.delete(cb);
      },

      onTrip(tripId, cb) {
        // Piggybacks on the trips (light-index) listener, filtered to one id
        // — still never touches tripData just to show a title/category/date.
        ensureTripsListener();
        const wrapped = (list) => cb(list.find((t) => t.id === tripId) || null);
        tripsListeners.add(wrapped);
        wrapped(currentTripsList());
        return () => tripsListeners.delete(wrapped);
      },

      onTripData(tripId, cb) {
        ensureTripDataListener(tripId);
        if (!tripDataListeners[tripId]) tripDataListeners[tripId] = new Set();
        tripDataListeners[tripId].add(cb);
        cb(normalizedTripData(tripId));
        return () => tripDataListeners[tripId].delete(cb);
      },

      addAttendee(tripId, name) {
        const id = crewRef.child("tripData/" + tripId + "/attendees").push().key;
        const obj = { name, addedAt: Date.now() };
        const t = totalsAfter(tripId, (d) => { d.attendees = d.attendees || {}; d.attendees[id] = obj; });
        const updates = withSummary({ ["tripData/" + tripId + "/attendees/" + id]: obj }, tripId, t);
        commit(updates);
      },

      removeAttendee(tripId, attendeeId) {
        const obj = ((tripDataCache[tripId] || {}).attendees || {})[attendeeId];
        if (!obj) return;
        const t = totalsAfter(tripId, (d) => { if (d.attendees) delete d.attendees[attendeeId]; });
        const updates = withSummary(
          trashAndClear(tripId, "attendee", attendeeId, "tripData/" + tripId + "/attendees/" + attendeeId, obj),
          tripId, t
        );
        commit(updates);
      },

      addStop(tripId, fields) {
        const id = crewRef.child("tripData/" + tripId + "/stops").push().key;
        const obj = { ...fields, order: nextOrder((tripDataCache[tripId] || {}).stops) };
        const t = totalsAfter(tripId, (d) => { d.stops = d.stops || {}; d.stops[id] = obj; });
        const updates = withSummary({ ["tripData/" + tripId + "/stops/" + id]: obj }, tripId, t);
        commit(updates);
      },

      removeStop(tripId, stopId) {
        const obj = ((tripDataCache[tripId] || {}).stops || {})[stopId];
        if (!obj) return;
        const t = totalsAfter(tripId, (d) => { if (d.stops) delete d.stops[stopId]; });
        const updates = withSummary(
          trashAndClear(tripId, "stop", stopId, "tripData/" + tripId + "/stops/" + stopId, obj),
          tripId, t
        );
        commit(updates);
      },

      addCost(tripId, fields) {
        const id = crewRef.child("tripData/" + tripId + "/costs").push().key;
        const t = totalsAfter(tripId, (d) => { d.costs = d.costs || {}; d.costs[id] = fields; });
        const updates = withSummary({ ["tripData/" + tripId + "/costs/" + id]: fields }, tripId, t);
        commit(updates);
      },

      removeCost(tripId, costId) {
        const obj = ((tripDataCache[tripId] || {}).costs || {})[costId];
        if (!obj) return;
        const t = totalsAfter(tripId, (d) => { if (d.costs) delete d.costs[costId]; });
        const updates = withSummary(
          trashAndClear(tripId, "cost", costId, "tripData/" + tripId + "/costs/" + costId, obj),
          tripId, t
        );
        commit(updates);
      },

      addSuggestion(tripId, fields) {
        const id = crewRef.child("tripData/" + tripId + "/suggestions").push().key;
        const obj = { ...fields, at: Date.now() };
        const t = totalsAfter(tripId, (d) => { d.suggestions = d.suggestions || {}; d.suggestions[id] = obj; });
        const updates = withSummary({ ["tripData/" + tripId + "/suggestions/" + id]: obj }, tripId, t);
        commit(updates);
      },

      removeSuggestion(tripId, suggestionId) {
        const obj = ((tripDataCache[tripId] || {}).suggestions || {})[suggestionId];
        if (!obj) return;
        const t = totalsAfter(tripId, (d) => { if (d.suggestions) delete d.suggestions[suggestionId]; });
        const updates = withSummary(
          trashAndClear(tripId, "suggestion", suggestionId, "tripData/" + tripId + "/suggestions/" + suggestionId, obj),
          tripId, t
        );
        commit(updates);
      },

      setPeopleOverride(tripId, value) {
        const parsed = value === "" || value == null ? null : Number(value);
        const t = totalsAfter(tripId, (d) => { d.settings = d.settings || {}; d.settings.peopleOverride = parsed; });
        const updates = withSummary({ ["tripData/" + tripId + "/settings/peopleOverride"]: parsed }, tripId, t);
        commit(updates);
      },
    };
  }

  // ---------------------------------------------------------------
  // Crew-code generation — ~80 bits of randomness (16 Crockford
  // base32 chars), because the crew path IS the credential; there's
  // no accounts, no auth, just an unguessable link.
  // ---------------------------------------------------------------
  const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  function randomSuffix() {
    const bytes = crypto.getRandomValues(new Uint8Array(10)); // 80 bits
    let bits = "";
    bytes.forEach((b) => { bits += b.toString(2).padStart(8, "0"); });
    let out = "";
    for (let i = 0; i < bits.length; i += 5) out += CROCKFORD[parseInt(bits.slice(i, i + 5), 2)];
    return out.toLowerCase();
  }

  function slugify(name) {
    const s = String(name || "crew").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (s || "crew").slice(0, 30);
  }

  // ---------------------------------------------------------------
  // Dispatcher — picks a backend based on ?crew= in the URL.
  // ---------------------------------------------------------------
  let backend = null;
  let currentCrewCode = null;

  function getCrewCodeFromURL() {
    return new URLSearchParams(window.location.search).get("crew");
  }

  return {
    init() {
      const crewCode = getCrewCodeFromURL();
      if (crewCode) {
        backend = createFirebaseBackend(crewCode);
        currentCrewCode = crewCode;
        return { mode: "sync", crewCode };
      }
      backend = createLocalBackend();
      currentCrewCode = null;
      return { mode: "local", crewCode: null };
    },

    getCrewCode() {
      return currentCrewCode;
    },

    // Bootstraps a brand-new crew in Firebase and returns its code —
    // usable from local mode, since this is exactly how you leave local
    // mode. Independent of whatever `backend` is currently selected.
    createCrew(name) {
      try {
        ensureFirebaseApp();
      } catch (err) {
        return Promise.reject(err);
      }
      const code = slugify(name) + "-" + randomSuffix();
      return firebase.database().ref("crews/" + code).set({
        meta: { name: name || "Our Crew", createdAt: Date.now(), rotatedAt: null, schemaVersion: 1 },
      }).then(() => code);
    },

    isEmpty: (...a) => backend.isEmpty(...a),
    seedTrip: (...a) => backend.seedTrip(...a),
    addTrip: (...a) => backend.addTrip(...a),
    setArchived: (...a) => backend.setArchived(...a),
    setStatus: (...a) => backend.setStatus(...a),
    deleteTrip: (...a) => backend.deleteTrip(...a),
    onTrips: (...a) => backend.onTrips(...a),
    onTrip: (...a) => backend.onTrip(...a),
    onTripData: (...a) => backend.onTripData(...a),
    addAttendee: (...a) => backend.addAttendee(...a),
    removeAttendee: (...a) => backend.removeAttendee(...a),
    addStop: (...a) => backend.addStop(...a),
    removeStop: (...a) => backend.removeStop(...a),
    addCost: (...a) => backend.addCost(...a),
    removeCost: (...a) => backend.removeCost(...a),
    addSuggestion: (...a) => backend.addSuggestion(...a),
    removeSuggestion: (...a) => backend.removeSuggestion(...a),
    setPeopleOverride: (...a) => backend.setPeopleOverride(...a),
  };
})();
