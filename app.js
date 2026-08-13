(function () {
  "use strict";

  const STORAGE_KEY = "prayerRotation.v1";
  const HISTORY_KEEP_DAYS = 28; // how much past history to retain in storage
  const HISTORY_SHOW = 4; // how many recent past meetings to display

  let state = null;
  let swapSelection = null; // { weekId, slot } while picking a swap target
  let lastSwap = null; // for one-step undo
  let toastTimer = null;

  // ---------------------------------------------------------------------
  // Date helpers
  // ---------------------------------------------------------------------
  function todayMidnight() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function parseISO(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function addDays(d, n) {
    const nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return nd;
  }
  function fmtDate(d) {
    return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
  }
  function fmtDateLong(d) {
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }
  function daysUntil(d) {
    return Math.round((d.getTime() - todayMidnight().getTime()) / 86400000);
  }

  // ---------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------
  async function loadState() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        return JSON.parse(raw);
      } catch (e) {
        console.warn("Saved data was corrupt, falling back to default seed.", e);
      }
    }
    const resp = await fetch("data.json");
    const seed = await resp.json();
    return seed;
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------------------------------------------------------------------
  // Bag rotation (fair-rotation randomizer)
  // ---------------------------------------------------------------------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function activeParticipantIds() {
    return state.participants.map((p) => p.id);
  }
  function refillBag(slot) {
    const ids = activeParticipantIds();
    if (ids.length === 0) return [];
    let bag = shuffle(ids);
    const last = slot === "opening" ? state.bag.lastOpening : state.bag.lastClosing;
    if (bag.length > 1 && bag[0] === last) {
      const j = 1 + Math.floor(Math.random() * (bag.length - 1));
      [bag[0], bag[j]] = [bag[j], bag[0]];
    }
    return bag;
  }
  // Draw the next person for a slot ("opening"/"closing"), optionally avoiding
  // a specific id (used so the same person isn't opening+closing in one week).
  function drawFromBag(slot, avoidId) {
    const ids = activeParticipantIds();
    if (ids.length === 0) return null;

    let bag = (slot === "opening" ? state.bag.opening : state.bag.closing) || [];
    bag = bag.filter((id) => ids.includes(id));

    if (bag.length === 0) bag = refillBag(slot);

    if (avoidId != null && bag[0] === avoidId) {
      let swapIdx = bag.findIndex((id, i) => i > 0 && id !== avoidId);
      let attempts = 0;
      while (swapIdx === -1 && attempts < 5) {
        const fresh = refillBag(slot).filter((id) => !bag.includes(id));
        bag = bag.concat(fresh);
        swapIdx = bag.findIndex((id, i) => i > 0 && id !== avoidId);
        attempts++;
      }
      if (swapIdx > 0) [bag[0], bag[swapIdx]] = [bag[swapIdx], bag[0]];
      // if it's still stuck (e.g. only one participant total) we accept the conflict
    }

    const picked = bag.shift();
    if (slot === "opening") {
      state.bag.opening = bag;
      state.bag.lastOpening = picked;
    } else {
      state.bag.closing = bag;
      state.bag.lastClosing = picked;
    }
    return picked;
  }

  // ---------------------------------------------------------------------
  // Schedule generation
  // ---------------------------------------------------------------------
  function meetingWeekdayIndex() {
    return state.meetingWeekday ?? 4;
  }
  function firstMeetingDateOnOrAfter(date) {
    const target = meetingWeekdayIndex();
    const d = new Date(date);
    while (d.getDay() !== target) d.setDate(d.getDate() + 1);
    return d;
  }
  function appendWeek(dateObj) {
    const opening = drawFromBag("opening");
    const closing = drawFromBag("closing", opening);
    state.weeks.push({
      id: "w_" + toISO(dateObj),
      date: toISO(dateObj),
      opening,
      closing,
      openingSwapped: false,
      closingSwapped: false,
    });
  }
  function ensureSchedule() {
    const today = todayMidnight();

    if (!state.weeks || state.weeks.length === 0) {
      appendWeek(firstMeetingDateOnOrAfter(today));
    }

    const upcomingCount = () => state.weeks.filter((w) => parseISO(w.date) >= today).length;
    let guard = 0;
    while (upcomingCount() < (state.weeksAheadToShow || 8) && guard < 520) {
      const last = parseISO(state.weeks[state.weeks.length - 1].date);
      appendWeek(addDays(last, 7));
      guard++;
    }

    const cutoff = addDays(today, -HISTORY_KEEP_DAYS);
    state.weeks = state.weeks.filter((w) => parseISO(w.date) >= cutoff);
    state.weeks.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  // Redraw any upcoming, non-swapped slot whose assigned person was removed,
  // and fill in any slot that's sitting "Unassigned" (e.g. because the
  // roster was briefly empty) now that participants exist again. Called
  // after any participant add/remove/import so the schedule never gets
  // stuck with a gap a new person can't be dropped into.
  function refreshUpcomingAssignments() {
    const today = todayMidnight();
    const ids = activeParticipantIds();
    state.weeks.forEach((w) => {
      if (parseISO(w.date) < today) return;
      const openingInvalid = !w.opening || !ids.includes(w.opening);
      if (openingInvalid && !w.openingSwapped) {
        w.opening = drawFromBag("opening", w.closing);
      }
      const closingInvalid = !w.closing || !ids.includes(w.closing);
      if (closingInvalid && !w.closingSwapped) {
        w.closing = drawFromBag("closing", w.opening);
      }
    });
  }

  function rebuildFutureSchedule() {
    // Used when the meeting weekday changes: keep past history, regenerate
    // everything from today forward with a clean bag.
    const today = todayMidnight();
    state.weeks = state.weeks.filter((w) => parseISO(w.date) < today);
    state.bag.opening = [];
    state.bag.closing = [];
    ensureSchedule();
  }

  function participantById(id) {
    return state.participants.find((p) => p.id === id);
  }

  function nextMeeting() {
    const today = todayMidnight();
    const upcoming = state.weeks.filter((w) => parseISO(w.date) >= today).sort((a, b) => (a.date < b.date ? -1 : 1));
    return upcoming[0] || null;
  }

  // ---------------------------------------------------------------------
  // Swap logic
  // ---------------------------------------------------------------------
  function weekById(id) {
    return state.weeks.find((w) => w.id === id);
  }

  function attemptSwap(a, b) {
    // a, b: { weekId, slot }
    if (a.weekId === b.weekId && a.slot === b.slot) return { ok: false, error: "Pick a different assignment to swap with." };

    const weekA = weekById(a.weekId);
    const weekB = weekById(b.weekId);
    if (!weekA || !weekB) return { ok: false, error: "Could not find that assignment." };

    const personA = weekA[a.slot];
    const personB = weekB[b.slot];

    if (personA === personB) return { ok: false, error: "That's already the same person." };

    const prevA = { opening: weekA.opening, closing: weekA.closing, openingSwapped: weekA.openingSwapped, closingSwapped: weekA.closingSwapped };
    const prevB = { opening: weekB.opening, closing: weekB.closing, openingSwapped: weekB.openingSwapped, closingSwapped: weekB.closingSwapped };

    weekA[a.slot] = personB;
    weekB[b.slot] = personA;
    weekA[a.slot + "Swapped"] = true;
    weekB[b.slot + "Swapped"] = true;

    if (weekA.opening === weekA.closing || weekB.opening === weekB.closing) {
      // revert - would create a same-week duplicate
      Object.assign(weekA, prevA);
      Object.assign(weekB, prevB);
      return { ok: false, error: "That swap would put the same person on both opening and closing prayer in one week. Pick a different assignment." };
    }

    lastSwap = { a: { ...a }, b: { ...b }, prevA, prevB };

    const nameA = participantById(personA)?.name || "Someone";
    const nameB = participantById(personB)?.name || "Someone";
    const logEntry = {
      ts: Date.now(),
      text: `Swapped ${nameA} (${a.slot}, ${fmtDate(parseISO(weekA.date))}) with ${nameB} (${b.slot}, ${fmtDate(parseISO(weekB.date))}).`,
    };
    state.changelog.unshift(logEntry);
    state.changelog = state.changelog.slice(0, 30);

    return { ok: true };
  }

  function undoLastSwap() {
    if (!lastSwap) return;
    const weekA = weekById(lastSwap.a.weekId);
    const weekB = weekById(lastSwap.b.weekId);
    if (weekA) Object.assign(weekA, lastSwap.prevA);
    if (weekB) Object.assign(weekB, lastSwap.prevB);
    state.changelog.shift();
    lastSwap = null;
    saveState();
    renderAll();
    showToast("Swap undone.");
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  function renderStats() {
    const el = document.getElementById("stats");
    const nm = nextMeeting();
    let cards = [];

    if (nm) {
      const d = parseISO(nm.date);
      const du = daysUntil(d);
      cards.push(`
        <div class="stat-card highlight">
          <div class="label">This week's meeting</div>
          <div class="value">${fmtDateLong(d)}</div>
        </div>
      `);
      cards.push(`
        <div class="stat-card highlight">
          <div class="label">Days until next meeting</div>
          <div class="value">${du === 0 ? "Today" : du === 1 ? "Tomorrow" : du + " days"}</div>
        </div>
      `);
      const opening = participantById(nm.opening);
      const closing = participantById(nm.closing);
      cards.push(`
        <div class="stat-card">
          <div class="label">Opening / Closing</div>
          <div class="value" style="font-size:1.05rem;">
            ${opening ? opening.name : "—"} / ${closing ? closing.name : "—"}
          </div>
        </div>
      `);
    } else {
      cards.push(`<div class="stat-card"><div class="label">Meeting</div><div class="value">Add participants to build a schedule</div></div>`);
    }

    cards.push(`
      <div class="stat-card">
        <div class="label">Participants</div>
        <div class="value">${state.participants.length}</div>
      </div>
    `);

    el.innerHTML = cards.join("");
  }

  function namePill(id, slotEligible, weekId, slot) {
    const p = participantById(id);
    const name = p ? p.name : "Unassigned";
    const color = p ? p.color : "#999";
    return `<span class="name-pill" style="color:${color}"><span class="name-dot" style="background:${color}"></span>${escapeHtml(name)}</span>`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderSchedule() {
    const today = todayMidnight();
    const body = document.getElementById("schedule-body");
    const upcoming = state.weeks
      .filter((w) => parseISO(w.date) >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, state.weeksAheadToShow || 8);

    body.innerHTML = upcoming
      .map((w, idx) => {
        const d = parseISO(w.date);
        const du = daysUntil(d);
        const isCurrent = idx === 0;
        const duLabel = du === 0 ? "Today" : du === 1 ? "Tomorrow" : `${du} days`;

        return `
          <tr class="${isCurrent ? "current-week" : ""}" data-week-id="${w.id}">
            <td>${fmtDate(d)}</td>
            <td>${slotCell(w, "opening")}</td>
            <td>${slotCell(w, "closing")}</td>
            <td>${duLabel}</td>
          </tr>
        `;
      })
      .join("");

    // history
    const historyBody = document.getElementById("history-body");
    const past = state.weeks
      .filter((w) => parseISO(w.date) < today)
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, HISTORY_SHOW);
    historyBody.innerHTML = past
      .map((w) => {
        const d = parseISO(w.date);
        const op = participantById(w.opening);
        const cl = participantById(w.closing);
        return `<tr><td>${fmtDate(d)}</td><td>${op ? escapeHtml(op.name) : "—"}</td><td>${cl ? escapeHtml(cl.name) : "—"}</td></tr>`;
      })
      .join("") || `<tr><td colspan="3" style="opacity:.6;">No past meetings yet</td></tr>`;
  }

  function slotCell(week, slot) {
    const isSelected = swapSelection && swapSelection.weekId === week.id && swapSelection.slot === slot;
    const swapped = week[slot + "Swapped"];
    const pill = namePill(week[slot]);
    return `
      <div class="name-cell">
        ${pill}
        ${swapped ? `<span class="swapped-flag" title="This assignment was manually swapped">↔</span>` : ""}
        <button type="button" class="shuffle-btn ${isSelected ? "selected" : ""}"
          data-week-id="${week.id}" data-slot="${slot}"
          title="${isSelected ? "Cancel selection" : "Reshuffle this assignment"}">🔀</button>
      </div>
    `;
  }

  function renderParticipants() {
    const list = document.getElementById("participant-list");
    list.innerHTML = state.participants
      .map(
        (p) => `
      <li class="participant-row" data-id="${p.id}">
        <input type="color" value="${p.color}" data-action="color" data-id="${p.id}" />
        <input type="text" value="${escapeHtml(p.name)}" data-action="name" data-id="${p.id}" maxlength="40" />
        <button type="button" class="remove-btn" data-action="remove" data-id="${p.id}" title="Remove participant">✕</button>
      </li>
    `
      )
      .join("");

    const warn = document.getElementById("participant-warning");
    if (state.participants.length < 2) {
      warn.textContent = "Add at least 2 participants to build a rotation.";
      warn.classList.remove("hidden");
    } else if (state.participants.length < 3) {
      warn.textContent = "With only 2 participants, opening and closing prayer will always alternate between the two of them.";
      warn.classList.remove("hidden");
    } else {
      warn.classList.add("hidden");
    }
  }

  function renderChangelog() {
    const list = document.getElementById("changelog-list");
    if (!state.changelog || state.changelog.length === 0) {
      list.innerHTML = `<li class="changelog-empty">No swaps yet.</li>`;
      return;
    }
    list.innerHTML = state.changelog
      .map((entry) => `<li>${escapeHtml(entry.text)}</li>`)
      .join("");
  }

  function renderSettings() {
    document.getElementById("meeting-weekday").value = String(state.meetingWeekday ?? 4);
    document.getElementById("weeks-ahead").value = state.weeksAheadToShow || 8;
  }

  function renderSwapBanner() {
    const el = document.getElementById("swap-banner");
    if (!swapSelection) {
      el.classList.add("hidden");
      el.classList.remove("error");
      return;
    }
    const w = weekById(swapSelection.weekId);
    const p = participantById(w[swapSelection.slot]);
    el.classList.remove("hidden");
    el.classList.remove("error");
    el.innerHTML = `
      <span>Reshuffling <strong>${escapeHtml(p ? p.name : "this slot")}</strong>'s ${swapSelection.slot} prayer on ${fmtDate(parseISO(w.date))} —
      click 🔀 on another upcoming assignment to swap with, or cancel.</span>
      <button type="button" id="cancel-swap-btn">Cancel</button>
    `;
    document.getElementById("cancel-swap-btn").addEventListener("click", () => {
      swapSelection = null;
      renderAll();
    });
  }

  function showSwapError(msg) {
    const el = document.getElementById("swap-banner");
    el.classList.remove("hidden");
    el.classList.add("error");
    el.innerHTML = `<span>${escapeHtml(msg)}</span><button type="button" id="cancel-swap-btn">Cancel</button>`;
    document.getElementById("cancel-swap-btn").addEventListener("click", () => {
      swapSelection = null;
      renderAll();
    });
  }

  function showToast(msg, withUndo) {
    clearTimeout(toastTimer);
    const el = document.getElementById("toast");
    el.innerHTML = `<span>${escapeHtml(msg)}</span>` + (withUndo ? `<button type="button" id="undo-btn">Undo</button>` : "");
    el.classList.remove("hidden");
    if (withUndo) {
      document.getElementById("undo-btn").addEventListener("click", undoLastSwap);
    }
    toastTimer = setTimeout(() => el.classList.add("hidden"), 6000);
  }

  // Custom-styled replacements for window.confirm()/alert() so dialogs match
  // the rest of the app instead of looking like a bare browser popup.
  function showConfirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const overlay = document.getElementById("modal-overlay");
      const cancelBtn = document.getElementById("modal-cancel-btn");
      const confirmBtn = document.getElementById("modal-confirm-btn");

      document.getElementById("modal-message").textContent = message;
      confirmBtn.textContent = opts.confirmLabel || "Confirm";
      confirmBtn.classList.toggle("danger", opts.danger !== false);
      cancelBtn.classList.remove("hidden");
      cancelBtn.textContent = opts.cancelLabel || "Cancel";
      overlay.classList.remove("hidden");

      function cleanup(result) {
        overlay.classList.add("hidden");
        confirmBtn.removeEventListener("click", onConfirm);
        cancelBtn.removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onOverlay);
        document.removeEventListener("keydown", onKey);
        resolve(result);
      }
      function onConfirm() { cleanup(true); }
      function onCancel() { cleanup(false); }
      function onOverlay(e) { if (e.target === overlay) cleanup(false); }
      function onKey(e) {
        if (e.key === "Escape") cleanup(false);
        if (e.key === "Enter") cleanup(true);
      }
      confirmBtn.addEventListener("click", onConfirm);
      cancelBtn.addEventListener("click", onCancel);
      overlay.addEventListener("click", onOverlay);
      document.addEventListener("keydown", onKey);
      confirmBtn.focus();
    });
  }

  function showAlertModal(message) {
    return new Promise((resolve) => {
      const overlay = document.getElementById("modal-overlay");
      const cancelBtn = document.getElementById("modal-cancel-btn");
      const confirmBtn = document.getElementById("modal-confirm-btn");

      document.getElementById("modal-message").textContent = message;
      confirmBtn.textContent = "OK";
      confirmBtn.classList.remove("danger");
      cancelBtn.classList.add("hidden");
      overlay.classList.remove("hidden");

      function cleanup() {
        overlay.classList.add("hidden");
        confirmBtn.removeEventListener("click", onOk);
        overlay.removeEventListener("click", onOverlay);
        document.removeEventListener("keydown", onKey);
        resolve();
      }
      function onOk() { cleanup(); }
      function onOverlay(e) { if (e.target === overlay) cleanup(); }
      function onKey(e) { if (e.key === "Escape" || e.key === "Enter") cleanup(); }
      confirmBtn.addEventListener("click", onOk);
      overlay.addEventListener("click", onOverlay);
      document.addEventListener("keydown", onKey);
      confirmBtn.focus();
    });
  }

  function renderAll() {
    renderStats();
    renderParticipants();
    renderSchedule();
    renderChangelog();
    renderSettings();
    renderSwapBanner();
  }

  // ---------------------------------------------------------------------
  // Event wiring
  // ---------------------------------------------------------------------
  function wireEvents() {
    document.getElementById("schedule-body").addEventListener("click", (e) => {
      const btn = e.target.closest(".shuffle-btn");
      if (!btn) return;
      const weekId = btn.dataset.weekId;
      const slot = btn.dataset.slot;

      if (!swapSelection) {
        swapSelection = { weekId, slot };
        renderAll();
        return;
      }
      if (swapSelection.weekId === weekId && swapSelection.slot === slot) {
        swapSelection = null;
        renderAll();
        return;
      }
      const result = attemptSwap(swapSelection, { weekId, slot });
      if (result.ok) {
        swapSelection = null;
        saveState();
        renderAll();
        showToast("Assignments swapped.", true);
      } else {
        showSwapError(result.error);
      }
    });

    document.getElementById("participant-list").addEventListener("click", async (e) => {
      const btn = e.target.closest('[data-action="remove"]');
      if (!btn) return;
      const id = btn.dataset.id;
      const p = participantById(id);
      if (!p) return;
      const confirmed = await showConfirm(
        `Remove ${p.name} from the rotation? Any of their upcoming (non-swapped) assignments will be reshuffled to someone else.`,
        { confirmLabel: "Remove" }
      );
      if (!confirmed) return;
      state.participants = state.participants.filter((x) => x.id !== id);
      refreshUpcomingAssignments();
      saveState();
      renderAll();
    });

    document.getElementById("participant-list").addEventListener("input", (e) => {
      const target = e.target;
      const id = target.dataset.id;
      if (!id) return;
      const p = participantById(id);
      if (!p) return;
      if (target.dataset.action === "name") {
        p.name = target.value;
      } else if (target.dataset.action === "color") {
        p.color = target.value;
      }
      saveState();
      renderStats();
      renderChangelog();
      renderSchedule();
    });

    document.getElementById("add-participant-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const nameInput = document.getElementById("new-participant-name");
      const colorInput = document.getElementById("new-participant-color");
      const name = nameInput.value.trim();
      if (!name) return;
      const id = "p_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const newParticipant = { id, name, color: colorInput.value };
      state.participants.push(newParticipant);

      // Give the new person a shot at joining the current bags soon rather
      // than waiting for the bags to fully exhaust first.
      if (!state.bag.opening) state.bag.opening = [];
      if (!state.bag.closing) state.bag.closing = [];
      const openIdx = Math.floor(Math.random() * (state.bag.opening.length + 1));
      state.bag.opening.splice(openIdx, 0, id);
      const closeIdx = Math.floor(Math.random() * (state.bag.closing.length + 1));
      state.bag.closing.splice(closeIdx, 0, id);

      // Fill in any slot that's currently "Unassigned" (e.g. the roster was
      // briefly empty) now that there's someone available for it.
      refreshUpcomingAssignments();

      nameInput.value = "";
      colorInput.value = randomColor();
      saveState();
      renderAll();
    });

    document.getElementById("meeting-weekday").addEventListener("change", async (e) => {
      const val = Number(e.target.value);
      if (val === state.meetingWeekday) return;
      const confirmed = await showConfirm(
        "Changing the meeting day will regenerate all upcoming (future) assignments. Past history is kept. Continue?",
        { confirmLabel: "Change day" }
      );
      if (!confirmed) {
        renderSettings();
        return;
      }
      state.meetingWeekday = val;
      rebuildFutureSchedule();
      saveState();
      renderAll();
    });

    document.getElementById("weeks-ahead").addEventListener("change", (e) => {
      let val = Number(e.target.value);
      if (!val || val < 1) val = 1;
      if (val > 26) val = 26;
      state.weeksAheadToShow = val;
      ensureSchedule();
      saveState();
      renderAll();
    });

    document.getElementById("export-btn").addEventListener("click", () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `prayer-rotation-${toISO(todayMidnight())}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    document.getElementById("import-input").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const imported = JSON.parse(reader.result);
          if (!imported.participants || !imported.weeks) throw new Error("Missing required fields.");
          state = imported;
          swapSelection = null;
          lastSwap = null;
          state.changelog = state.changelog || [];
          state.bag = state.bag || { opening: [], closing: [], lastOpening: null, lastClosing: null };
          refreshUpcomingAssignments();
          ensureSchedule();
          saveState();
          renderAll();
          showToast("Schedule imported.");
        } catch (err) {
          await showAlertModal("That file doesn't look like a valid prayer-rotation export.\n" + err.message);
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });

    document.getElementById("reset-btn").addEventListener("click", async () => {
      const confirmed = await showConfirm(
        "Reset everything to the default starting schedule? This clears participants, swaps and history saved in this browser.",
        { confirmLabel: "Reset" }
      );
      if (!confirmed) return;
      localStorage.removeItem(STORAGE_KEY);
      state = await loadState();
      swapSelection = null;
      lastSwap = null;
      ensureSchedule();
      saveState();
      renderAll();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && swapSelection) {
        swapSelection = null;
        renderAll();
      }
    });
  }

  function randomColor() {
    const palette = ["#2563eb", "#dc2626", "#7c3aed", "#0ea5e9", "#84cc16", "#f59e0b", "#fb7185", "#059669", "#f97316", "#6366f1"];
    return palette[Math.floor(Math.random() * palette.length)];
  }

  // ---------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------
  async function init() {
    state = await loadState();
    state.changelog = state.changelog || [];
    state.bag = state.bag || { opening: [], closing: [], lastOpening: null, lastClosing: null };
    ensureSchedule();
    saveState();
    wireEvents();
    renderAll();
  }

  init();
})();