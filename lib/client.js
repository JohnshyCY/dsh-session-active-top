window.__ModuleLoader__.load({
  id: "dsh-session-active-top",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const STORAGE_KEY = "dsh-session-active-top:raised";
    const DIAG_KEY = "dsh-session-active-top:diag";
    // Far above every real updatedAt (now ~1.8e12), so raised rows outrank all.
    const RAISED_EPOCH = 4e12;
    const BROWSER_SLOT = "sidebar.workspaces";
    const inject = ["sessions", "slots"];

    function load() {
      try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
      } catch {
        return [];
      }
    }

    function save(ids) {
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(ids));
      } catch {}
    }

    /**
     * Publish one small trace so behaviour stays diagnosable without DevTools.
     * Writes only when something changed, since subscribers fire on every update.
     */
    let lastDiag;
    function diag(fields) {
      try {
        const next = JSON.stringify(fields);
        if (next === lastDiag) return;
        lastDiag = next;
        globalThis.localStorage?.setItem(DIAG_KEY, next);
      } catch {}
    }

    /**
     * Raised ids ordered by real activity, newest first, dropping rows the list no
     * longer knows. Ordering by activity (not by when the session floated up) keeps
     * the conversation you are in right now on top of the sessions that rose earlier.
     */
    function byRecency(raised, snap) {
      const rank = (id) => snap?.byId?.[id]?.updatedAt ?? -Infinity;
      return [...raised]
        .filter((id) => snap?.byId?.[id] !== void 0)
        .sort((left, right) => rank(right) - rank(left));
    }

    /**
     * Recency ordering (`orderBy: "updated"`) ranks rows by `summary.updatedAt`.
     * Hand raised sessions a synthetic rank above every real timestamp so they
     * lead. Manual ordering replays a saved order instead (see `frontOnce`), so
     * this projection stays inert there, keeping real "刚刚" labels honest.
     */
    function projectList(base, raised, manualMode, onRaise) {
      if (!base || base.phase !== "ready") return base;
      let changed = false;
      for (const id of base.ids) {
        if (base.byId[id]?.running === true && !raised.has(id)) {
          raised.add(id);
          changed = true;
        }
      }
      if (changed) {
        save([...raised]);
        onRaise?.();
      }
      if (manualMode) return base;
      const ranks = new Map();
      let seq = 0;
      // Newest activity leads, so the conversation being used right now sits first.
      for (const id of byRecency(raised, base)) ranks.set(id, RAISED_EPOCH + seq++);
      if (ranks.size === 0) return base;
      return {
        ...base,
        byId: Object.fromEntries(Object.entries(base.byId).map(([id, row]) => {
          const rank = ranks.get(id);
          return rank === void 0 ? [id, row] : [id, { ...row, updatedAt: rank }];
        }))
      };
    }

    /** Wrap one snapshot source, keeping a stable identity per underlying state. */
    function wrap(source, project) {
      const original = source.getSnapshot;
      let lastBase;
      let lastProjected;
      source.getSnapshot = function getSnapshot() {
        const base = original.call(this);
        if (base === lastBase) return lastProjected;
        lastBase = base;
        lastProjected = project(base);
        return lastProjected;
      };
      return () => {
        source.getSnapshot = original;
      };
    }

    /**
     * Resolve the WorkspaceBrowser's viewing-store instance behind its slot entry.
     * The workspace registration publishes `store` as `{...handle, create: () => instance}`,
     * so `create()` hands back the very instance the browser reads from. `entries()`
     * returns a render-erased view, so `store` survives only on the `entriesOfSlot()`
     * winners; `hostFace().storeOf()` is the fallback.
     */
    function viewStoreOf(slots) {
      const rows = [];
      for (const read of ["entriesOfSlot", "entries"]) {
        if (typeof slots?.[read] !== "function") continue;
        try {
          for (const row of slots[read](BROWSER_SLOT) ?? []) rows.push(row);
        } catch {}
      }
      for (const entry of rows) {
        const handle = entry?.store;
        if (handle === void 0) continue;
        try {
          const created = typeof handle.create === "function" ? handle.create() : void 0;
          if (created !== void 0 && typeof created.getSnapshot === "function") return created;
        } catch {}
        try {
          const resolved = slots.hostFace().storeOf(entry, void 0);
          if (resolved !== void 0 && typeof resolved.getSnapshot === "function") return resolved;
        } catch {}
      }
      return void 0;
    }

    function apply(ctx) {
      const list = ctx.get("sessions").list;
      const slots = ctx.get("slots");
      // Insertion order follows when each session started running; entries stay
      // after the session stops, which is the requested "no auto-return".
      const raised = new Set(load());
      const trace = { attach: "pending", orderBy: void 0, fronted: 0, raised: raised.size, error: void 0 };

      ctx.effect(() => {
        let view;
        const safeList = () => {
          try {
            return list.getSnapshot();
          } catch {
            return void 0;
          }
        };
        const manual = () => {
          try {
            return view?.getSnapshot?.()?.orderBy === "manual";
          } catch {
            return false;
          }
        };
        const restoreList = wrap(list, (base) => projectList(base, raised, manual()));
        const report = () => {
          trace.raised = raised.size;
          diag(trace);
        };
        /**
         * Manual mode replays a saved per-account order, so a raised session has to
         * lead that saved order. Write it through the store's own `setSessionOrder`
         * action, which persists exactly like a user drag, so the position survives
         * reloads and nothing returns the row when the session stops.
         *
         * The raised block is ordered by real activity, so the conversation you are
         * using right now sits first; everything below the block keeps the user's
         * own drag order untouched.
         */
        let running = false;
        const front = () => {
          // `setSessionOrder` notifies the same subscription that calls us back.
          if (running) return;
          running = true;
          try {
            frontOnce();
          } finally {
            running = false;
          }
        };
        const frontOnce = () => {
          // Refresh `raised` from the live list before reading the saved order.
          try {
            list.getSnapshot();
          } catch {}
          if (view === void 0) return;
          let state;
          try {
            state = view.getSnapshot();
          } catch (error) {
            trace.error = String(error?.message ?? error);
            report();
            return;
          }
          trace.attach = "attached";
          trace.orderBy = state?.orderBy;
          if (state?.orderBy !== "manual") {
            report();
            return;
          }
          // A session the user never dragged has no entry in the saved order, and
          // manual mode drops unknown ids, so leading it costs nothing and covers
          // sessions that started running before anyone ever reordered them.
          const frontOrder = byRecency(raised, safeList());
          const frontSet = new Set(frontOrder);
          for (const key of Object.keys(state.sessionOrderByAccount ?? {})) {
            let now;
            try {
              now = view.getSnapshot();
            } catch {
              break;
            }
            const current = now?.sessionOrderByAccount?.[key];
            if (!Array.isArray(current)) continue;
            // Only the leading block of raised ids is ours to order; everything
            // after it keeps the user's own drag order untouched.
            const leading = current.filter((id) => frontSet.has(id));
            const wanted = frontOrder.filter((id) => current.includes(id));
            if (leading.length === wanted.length && leading.every((id, i) => id === wanted[i])) continue;
            const desired = [...wanted, ...current.filter((id) => !frontSet.has(id))];
            try {
              view.actions.setSessionOrder(key, desired, now.sessionOrderByAccount);
              trace.fronted += 1;
            } catch (error) {
              trace.error = String(error?.message ?? error);
            }
          }
          report();
        };
        const stops = [];
        let tries = 0;
        const attach = () => {
          view = viewStoreOf(slots);
          if (view === void 0) {
            trace.attach = tries++ > 40 ? "gave-up" : "pending";
            report();
            if (trace.attach === "pending") globalThis.setTimeout?.(attach, 250);
            return;
          }
          // Both sources can move a row: the list (running flag) and the view
          // (sort mode or the user's own drag). Re-front on either.
          try {
            stops.push(list.subscribe(front));
          } catch {}
          try {
            stops.push(view.subscribe(front));
          } catch {}
          front();
        };
        attach();
        return () => {
          try {
            restoreList();
          } catch {}
          for (const stop of stops) {
            try {
              stop();
            } catch {}
          }
        };
      }, "session-active-top: raise running sessions to the top");
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
