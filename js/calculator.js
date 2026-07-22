/* =========================================================
   calculator.js — the one place cost maths lives. Previously
   duplicated across main.js, roadmap.js, and maps.js; this is
   the single source of truth board.js, trip.js, and (in a
   later stage) db.js's denormalized summary all call into.
   ========================================================= */
window.Calculator = (function () {
  function money(n) {
    return "R" + Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // stops/costs: arrays of {price}/{amount}. attendeeCount: raw attendee count.
  // peopleOverride: number|null/undefined — headcount wins over attendeeCount when set.
  function totals({ stops = [], costs = [], attendeeCount = 0, peopleOverride = null } = {}) {
    const stopsSum = stops.reduce((s, x) => s + (Number(x.price) || 0), 0);
    const costsSum = costs.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const total = stopsSum + costsSum;
    const headcount = peopleOverride != null && peopleOverride !== "" ? Number(peopleOverride) : attendeeCount;
    const perPerson = headcount > 0 ? total / headcount : 0;
    return { stopsSum, costsSum, total, attendeeCount, headcount, perPerson };
  }

  return { money, totals };
})();
