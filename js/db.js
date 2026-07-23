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
    const store = { trips: {}, tripData: {}, trash: {}, people: {} };

    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        store.trips = saved.trips || {};
        store.tripData = saved.tripData || {};
        store.trash = saved.trash || {};
        store.people = saved.people || {};
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
    const trashListeners = new Set();
    const peopleListeners = new Set();

    function currentPeopleList() {
      return Object.entries(store.people).map(([id, p]) => ({ id, ...p }));
    }

    function notifyPeople() {
      const list = currentPeopleList();
      peopleListeners.forEach((cb) => cb(list));
    }

    function currentTrashList() {
      return Object.entries(store.trash)
        .map(([id, e]) => ({ id, ...e }))
        .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    function notifyTrash() {
      const list = currentTrashList();
      trashListeners.forEach((cb) => cb(list));
    }

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
      if (!data) return { attendees: [], stops: [], costs: [], suggestions: [], links: [], settings: { peopleOverride: null } };
      return {
        attendees: Object.entries(data.attendees).map(([id, a]) => ({ id, ...a })),
        stops: Object.entries(data.stops).map(([id, s]) => ({ id, ...s })).sort((a, b) => a.order - b.order),
        costs: Object.entries(data.costs).map(([id, c]) => ({ id, ...c })),
        suggestions: Object.entries(data.suggestions).map(([id, s]) => ({ id, ...s })).sort((a, b) => b.at - a.at),
        links: Object.entries(data.links || {}).map(([id, l]) => ({ id, ...l })),
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
        store.tripData[tripId] = { attendees: {}, stops: {}, costs: {}, suggestions: {}, links: {}, settings: { peopleOverride: null } };
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
      store.trash[uid()] = {
        kind, tripId, originalId,
        deletedAt: Date.now(), deletedBy: "",
        data: JSON.parse(JSON.stringify(data)),
      };
      notifyTrash();
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

      setCover(tripId, url) {
        if (!store.trips[tripId]) return;
        store.trips[tripId].cover = url;
        persist();
        notifyTrips();
      },

      updateTrip(tripId, fields) {
        if (!store.trips[tripId]) return;
        if (fields.title != null) store.trips[tripId].title = fields.title;
        if (fields.date != null) store.trips[tripId].date = fields.date;
        store.trips[tripId].updatedAt = Date.now();
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

      // One-time read, no live subscription — for the roadmap export, which
      // needs every trip's data just once rather than an ongoing listener.
      fetchTripDataOnce(tripId) {
        return Promise.resolve(currentTripData(tripId));
      },

      addAttendee(tripId, name) {
        ensureTripData(tripId).attendees[uid()] = { name, addedAt: Date.now() };
        touchTripData(tripId);
      },

      // Attendee keyed by a crew-roster person id — the one-page UI picks
      // people from the global roster rather than typing free-text names.
      addAttendeeAs(tripId, personId, name) {
        ensureTripData(tripId).attendees[personId] = { name, addedAt: Date.now() };
        touchTripData(tripId);
      },

      removeAttendee(tripId, attendeeId) {
        const data = ensureTripData(tripId);
        if (data.attendees[attendeeId]) trash(tripId, "attendee", attendeeId, data.attendees[attendeeId]);
        delete data.attendees[attendeeId];
        touchTripData(tripId);
      },

      /* ---- crew-wide people roster ---- */
      onPeople(cb) {
        peopleListeners.add(cb);
        cb(currentPeopleList());
        return () => peopleListeners.delete(cb);
      },

      addPerson(name) {
        const id = uid();
        store.people[id] = { name, addedAt: Date.now() };
        persist();
        notifyPeople();
        return id;
      },

      removePerson(personId) {
        delete store.people[personId];
        Object.keys(store.tripData).forEach((tripId) => {
          if (store.tripData[tripId].attendees[personId]) {
            delete store.tripData[tripId].attendees[personId];
            recompute(tripId);
            notifyTripData(tripId);
          }
        });
        persist();
        notifyPeople();
        notifyTrips();
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

      addLink(tripId, fields) {
        const data = ensureTripData(tripId);
        data.links = data.links || {};
        data.links[uid()] = fields;
        touchTripData(tripId);
      },

      removeLink(tripId, linkId) {
        const data = ensureTripData(tripId);
        if (data.links) delete data.links[linkId];
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

      onTrash(cb) {
        trashListeners.add(cb);
        cb(currentTrashList());
        return () => trashListeners.delete(cb);
      },

      restoreFromTrash(entryId) {
        const entry = store.trash[entryId];
        if (!entry) return;
        const { kind, tripId, originalId, data } = entry;
        if (kind === "trip") {
          store.trips[tripId] = data.light;
          store.tripData[tripId] = data.heavy;
        } else {
          const bucket = { attendee: "attendees", stop: "stops", cost: "costs", suggestion: "suggestions" }[kind];
          ensureTripData(tripId)[bucket][originalId] = data;
        }
        delete store.trash[entryId];
        if (kind !== "trip") recompute(tripId);
        persist();
        notifyTrash();
        notifyTrips();
        if (store.tripData[tripId]) notifyTripData(tripId);
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

    let cachedTrash = {};
    let trashAttached = false;
    const trashListeners = new Set();

    let cachedPeople = {};
    let peopleAttached = false;
    const peopleListeners = new Set();

    function ensurePeopleListener() {
      if (peopleAttached) return;
      peopleAttached = true;
      crewRef.child("people").on("value", (snap) => {
        cachedPeople = snap.val() || {};
        notifyPeople();
      });
    }

    function currentPeopleList() {
      return Object.entries(cachedPeople).map(([id, p]) => ({ id, ...p }));
    }

    function notifyPeople() {
      const list = currentPeopleList();
      peopleListeners.forEach((cb) => cb(list));
    }

    function ensureTripsListener() {
      if (tripsAttached) return;
      tripsAttached = true;
      tripsRef.on("value", (snap) => {
        cachedTrips = snap.val() || {};
        notifyTrips();
      });
    }

    function ensureTrashListener() {
      if (trashAttached) return;
      trashAttached = true;
      trashRef.on("value", (snap) => {
        cachedTrash = snap.val() || {};
        notifyTrash();
      });
    }

    function currentTrashList() {
      return Object.entries(cachedTrash)
        .map(([id, e]) => ({ id, ...e }))
        .sort((a, b) => b.deletedAt - a.deletedAt);
    }

    function notifyTrash() {
      const list = currentTrashList();
      trashListeners.forEach((cb) => cb(list));
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
        links: Object.entries(raw.links || {}).map(([id, l]) => ({ id, ...l })),
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

      setCover(tripId, url) {
        commit({ ["trips/" + tripId + "/cover"]: url });
      },

      updateTrip(tripId, fields) {
        const updates = {};
        if (fields.title != null) updates["trips/" + tripId + "/title"] = fields.title;
        if (fields.date != null) updates["trips/" + tripId + "/date"] = fields.date;
        updates["trips/" + tripId + "/updatedAt"] = Date.now();
        commit(updates);
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

      // One-time read for the roadmap export — reuses the live cache if a
      // listener already happens to be attached, otherwise a single .once()
      // read rather than opening a new permanent listener just for this.
      fetchTripDataOnce(tripId) {
        if (tripDataAttached[tripId]) return Promise.resolve(normalizedTripData(tripId));
        return crewRef.child("tripData/" + tripId).once("value").then((snap) => {
          tripDataCache[tripId] = snap.val() || {};
          return normalizedTripData(tripId);
        });
      },

      addAttendee(tripId, name) {
        const id = crewRef.child("tripData/" + tripId + "/attendees").push().key;
        const obj = { name, addedAt: Date.now() };
        const t = totalsAfter(tripId, (d) => { d.attendees = d.attendees || {}; d.attendees[id] = obj; });
        const updates = withSummary({ ["tripData/" + tripId + "/attendees/" + id]: obj }, tripId, t);
        commit(updates);
      },

      // Attendee keyed by a crew-roster person id (same {name, addedAt}
      // shape, so the deployed attendee validation rules already pass).
      addAttendeeAs(tripId, personId, name) {
        const obj = { name, addedAt: Date.now() };
        const t = totalsAfter(tripId, (d) => { d.attendees = d.attendees || {}; d.attendees[personId] = obj; });
        const updates = withSummary({ ["tripData/" + tripId + "/attendees/" + personId]: obj }, tripId, t);
        commit(updates);
      },

      /* ---- crew-wide people roster ---- */
      onPeople(cb) {
        ensurePeopleListener();
        peopleListeners.add(cb);
        cb(currentPeopleList());
        return () => peopleListeners.delete(cb);
      },

      addPerson(name) {
        const id = crewRef.child("people").push().key;
        commit({ ["people/" + id]: { name, addedAt: Date.now() } });
        return id;
      },

      // One multi-path write: drop the person from the roster AND from every
      // trip's attendees (the one-page app keeps every tripData listener
      // attached, so the caches are warm), fixing each summary as we go.
      removePerson(personId) {
        const updates = { ["people/" + personId]: null };
        Object.keys(tripDataCache).forEach((tripId) => {
          const attendees = (tripDataCache[tripId] || {}).attendees || {};
          if (!attendees[personId]) return;
          updates["tripData/" + tripId + "/attendees/" + personId] = null;
          const t = totalsAfter(tripId, (d) => { if (d.attendees) delete d.attendees[personId]; });
          withSummary(updates, tripId, t);
        });
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

      // Links don't touch the money summary — plain writes.
      addLink(tripId, fields) {
        const id = crewRef.child("tripData/" + tripId + "/links").push().key;
        commit({
          ["tripData/" + tripId + "/links/" + id]: fields,
          ["trips/" + tripId + "/updatedAt"]: Date.now(),
        });
      },

      removeLink(tripId, linkId) {
        commit({
          ["tripData/" + tripId + "/links/" + linkId]: null,
          ["trips/" + tripId + "/updatedAt"]: Date.now(),
        });
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

      onTrash(cb) {
        ensureTrashListener();
        trashListeners.add(cb);
        cb(currentTrashList());
        return () => trashListeners.delete(cb);
      },

      restoreFromTrash(entryId) {
        const entry = cachedTrash[entryId];
        if (!entry) return;
        const { kind, tripId, originalId, data } = entry;
        const updates = { ["trash/" + entryId]: null };
        if (kind === "trip") {
          updates["trips/" + tripId] = data.light;
          updates["tripData/" + tripId] = data.heavy;
          commit(updates);
          return;
        }
        const bucket = { attendee: "attendees", stop: "stops", cost: "costs", suggestion: "suggestions" }[kind];
        updates["tripData/" + tripId + "/" + bucket + "/" + originalId] = data;
        const t = totalsAfter(tripId, (d) => { d[bucket] = d[bucket] || {}; d[bucket][originalId] = data; });
        withSummary(updates, tripId, t);
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

    // Copies the page's current state into a freshly created crew in one
    // multi-path update, so "Start syncing" doesn't lose the work already
    // on screen. snapshot: { people: [{id, name}], adventures: [{category,
    // name, stops: […], costs: […], attendees: [personId…]}] }.
    // Fields are picked explicitly — the rules reject unknown keys.
    importIntoCrew(code, snapshot) {
      try {
        ensureFirebaseApp();
      } catch (err) {
        return Promise.reject(err);
      }
      const root = firebase.database().ref("crews/" + code);
      const now = Date.now();
      const updates = {};
      const peopleById = {};
      (snapshot.people || []).forEach((p) => {
        if (!p || !p.id || !p.name) return;
        peopleById[p.id] = p.name;
        updates["people/" + p.id] = { name: String(p.name).slice(0, 60), addedAt: now };
      });
      (snapshot.adventures || []).forEach((adv) => {
        const tripId = root.child("trips").push().key;
        const stops = {};
        let order = 1000;
        (adv.stops || []).forEach((s) => {
          if (!s || !s.name) return;
          stops[root.child("x").push().key] = {
            name: String(s.name).slice(0, 120),
            time: String(s.time || "").slice(0, 40),
            price: Number(s.price) || 0,
            location: String(s.location || "").slice(0, 200),
            link: String(s.link || "").slice(0, 500),
            meetingPoint: String(s.meetingPoint || "").slice(0, 200),
            whatToBring: String(s.whatToBring || "").slice(0, 300),
            notes: String(s.notes || "").slice(0, 1000),
            order: (order += 1000),
          };
        });
        const costs = {};
        (adv.costs || []).forEach((c) => {
          if (!c || !c.label) return;
          costs[root.child("x").push().key] = {
            label: String(c.label).slice(0, 80),
            amount: Number(c.amount) || 0,
          };
        });
        const attendees = {};
        (adv.attendees || []).forEach((pid) => {
          if (peopleById[pid]) attendees[pid] = { name: peopleById[pid], addedAt: now };
        });
        const links = {};
        (adv.links || []).forEach((l) => {
          if (!l || !l.label || !l.url) return;
          links[root.child("x").push().key] = {
            label: String(l.label).slice(0, 60),
            url: String(l.url).slice(0, 500),
          };
        });
        const t = window.Calculator.totals({
          stops: Object.values(stops),
          costs: Object.values(costs),
          attendeeCount: Object.keys(attendees).length,
          peopleOverride: null,
        });
        updates["trips/" + tripId] = {
          title: String(adv.name || "Untitled adventure").slice(0, 80),
          category: adv.category, date: "", cover: "", status: "planned", archived: false,
          attendeeCount: t.attendeeCount, headcount: t.headcount,
          total: t.total, perPerson: t.perPerson, updatedAt: now,
        };
        updates["tripData/" + tripId] = { attendees, stops, costs, links };
      });
      return root.update(updates).then(() => code);
    },

    // Checks the CURRENT crew for a tombstone (left behind by a rotation)
    // before board.js/trip.js do anything else — a small targeted read of
    // just the tombstone fields, not the whole crew subtree. Resolves to
    // the message to show, or null if the crew is live as normal.
    checkExpired() {
      if (!currentCrewCode) return Promise.resolve(null);
      const ref = firebase.database().ref("crews/" + currentCrewCode);
      return ref.child("tombstone").once("value").then((snap) => {
        if (snap.val() !== true) return null;
        return ref.child("tombstoneMessage").once("value").then(
          (s2) => s2.val() || "This link has expired — ask the group for the new one."
        );
      });
    },

    fetchMeta() {
      if (!currentCrewCode) return Promise.resolve(null);
      return firebase.database().ref("crews/" + currentCrewCode + "/meta").once("value").then((snap) => snap.val());
    },

    // Copies the whole crew to a new ~80-bit code, then replaces the OLD
    // path with a tombstone so stale links show the expired message instead
    // of quietly failing. Only meaningful in sync mode.
    rotateCrew() {
      if (!currentCrewCode) return Promise.reject(new Error("Not in a synced crew."));
      const oldCode = currentCrewCode;
      const oldRef = firebase.database().ref("crews/" + oldCode);
      return oldRef.once("value").then((snap) => {
        const data = snap.val() || {};
        const newCode = slugify((data.meta && data.meta.name) || "crew") + "-" + randomSuffix();
        const meta = Object.assign({}, data.meta, { rotatedAt: Date.now() });
        const payload = Object.assign({}, data, { meta });
        delete payload.tombstone;
        delete payload.tombstoneAt;
        delete payload.tombstoneMessage;
        return firebase.database().ref("crews/" + newCode).set(payload).then(() =>
          oldRef.set({
            tombstone: true,
            tombstoneAt: Date.now(),
            tombstoneMessage: "This link has expired — ask the group for the new one.",
          })
        ).then(() => newCode);
      });
    },

    onTrash: (...a) => backend.onTrash(...a),
    restoreFromTrash: (...a) => backend.restoreFromTrash(...a),

    isEmpty: (...a) => backend.isEmpty(...a),
    seedTrip: (...a) => backend.seedTrip(...a),
    addTrip: (...a) => backend.addTrip(...a),
    setArchived: (...a) => backend.setArchived(...a),
    setStatus: (...a) => backend.setStatus(...a),
    setCover: (...a) => backend.setCover(...a),
    updateTrip: (...a) => backend.updateTrip(...a),
    deleteTrip: (...a) => backend.deleteTrip(...a),
    onTrips: (...a) => backend.onTrips(...a),
    onTrip: (...a) => backend.onTrip(...a),
    onTripData: (...a) => backend.onTripData(...a),
    fetchTripDataOnce: (...a) => backend.fetchTripDataOnce(...a),
    addAttendee: (...a) => backend.addAttendee(...a),
    addAttendeeAs: (...a) => backend.addAttendeeAs(...a),
    removeAttendee: (...a) => backend.removeAttendee(...a),
    onPeople: (...a) => backend.onPeople(...a),
    addPerson: (...a) => backend.addPerson(...a),
    removePerson: (...a) => backend.removePerson(...a),
    addStop: (...a) => backend.addStop(...a),
    removeStop: (...a) => backend.removeStop(...a),
    addCost: (...a) => backend.addCost(...a),
    removeCost: (...a) => backend.removeCost(...a),
    addLink: (...a) => backend.addLink(...a),
    removeLink: (...a) => backend.removeLink(...a),
    addSuggestion: (...a) => backend.addSuggestion(...a),
    removeSuggestion: (...a) => backend.removeSuggestion(...a),
    setPeopleOverride: (...a) => backend.setPeopleOverride(...a),
  };
})();
