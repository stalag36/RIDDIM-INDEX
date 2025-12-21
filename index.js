/* ============================================================
   RIDDIM INDEX index.js  v1.3 (perf tuned)
   - Virtual list
   - Favorites (localStorage) + Supabase sync (lazy load)
   - Row is <a class="row row--click"> (full-row link)
   - Sort header is <button class="sortHead" data-key data-dir ...> (SVG arrows)
   - ✅ Perf: rAF scroll render + range memo + (mobile) drop mouseenter listeners
   ============================================================ */

(() => {
  "use strict";

  /* ============================================================
     1) Touch hover (mobile)
     ============================================================ */

  let currentTouchedKey = null;

  document.addEventListener(
    "touchstart",
    (ev) => {
      const row = ev.target.closest(".row.row--click");
      if (!row) {
        currentTouchedKey = null;
        const prev = document.querySelector(".row.row--click.touch-hover");
        if (prev) prev.classList.remove("touch-hover");
        return;
      }

      const key = row.dataset.riddimKey || "";

      if (currentTouchedKey && currentTouchedKey !== key) {
        const prev = document.querySelector(".row.row--click.touch-hover");
        if (prev) prev.classList.remove("touch-hover");
      }

      row.classList.add("touch-hover");
      currentTouchedKey = key;
    },
    { passive: true }
  );

  /* ============================================================
     2) Init
     ============================================================ */

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    const listEl = document.getElementById("list");
    if (!listEl) return;

    const metaEl = document.getElementById("meta");
    const qInput = document.getElementById("q");
    const labelSelect = document.getElementById("labelSelect");
    const yearSelect = document.getElementById("yearSelect");

    // ✅ sort header buttons
    const sortHeads = Array.from(document.querySelectorAll(".sortHead"));

    const favFilterBtn = document.getElementById("filterFavorites");
    const resetBtn = document.getElementById("resetFilters");
    const toastEl = document.getElementById("toast");

    let items = [];
    let visible = [];

    let q = "";
    let qRe = null;
    let filterLabel = "All";
    let filterDecade = "All";
    let sortKey = "riddim";
    let sortDir = "asc";
    let filterFavoritesOnly = false;

    // ★ animation control
    let isFirstRender = true;
    let favIdleTimer = null;

    // ✅ perf flags
    const CAN_HOVER = window.matchMedia?.("(hover:hover)")?.matches ?? false;

    /* ============================================================
       3) Supabase (lazy load) - favorites sync
       ============================================================ */

    const SUPABASE_URL = window.SUPABASE_URL || "";
    const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY || "";

    let supabaseClient = null;

    async function getSupabaseClient() {
      try {
        if (supabaseClient) return supabaseClient;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

        if (typeof window.loadSupabase === "function") {
          supabaseClient = await window.loadSupabase(); // should return client
          return supabaseClient;
        }

        if (window.supabase && window.supabase.createClient) {
          supabaseClient = window.supabase.createClient(
            SUPABASE_URL,
            SUPABASE_ANON_KEY
          );
          return supabaseClient;
        }

        return null;
      } catch {
        return null;
      }
    }

    const LOCAL_USER_ID_KEY = "riddimIndexUserId";
    function getLocalUserId() {
      let id = null;
      try {
        id = localStorage.getItem(LOCAL_USER_ID_KEY);
        if (id) return id;

        if (window.crypto && crypto.randomUUID) {
          id = crypto.randomUUID();
        } else {
          id = "u_" + Date.now() + "_" + Math.random().toString(16).slice(2);
        }
        localStorage.setItem(LOCAL_USER_ID_KEY, id);
        return id;
      } catch {
        return "anon";
      }
    }

    async function syncFavoriteToSupabase(riddimKey, isFav) {
      const client = await getSupabaseClient();
      if (!client || !riddimKey) return;

      const userId = getLocalUserId();

      try {
        if (isFav) {
          await client
            .from("favorites")
            .delete()
            .eq("user_id", userId)
            .eq("riddim_key", riddimKey);

          await client.from("favorites").insert({
            user_id: userId,
            riddim_key: riddimKey,
          });
        } else {
          await client
            .from("favorites")
            .delete()
            .eq("user_id", userId)
            .eq("riddim_key", riddimKey);
        }
      } catch (e) {
        console.warn("syncFavoriteToSupabase (index) error:", e);
      }
    }

    /* ============================================================
       4) Favorites (localStorage)
       ============================================================ */

    const FAVORITES_KEY = "riddimFavorites";

    function loadFavorites() {
      try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    }

    function saveFavorites(arr) {
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
      } catch {
        /* ignore */
      }
    }

    function isFavorite(key) {
      if (!key) return false;
      return loadFavorites().includes(key);
    }

    function toggleFavorite(key) {
      if (!key) return;
      const favs = loadFavorites();
      const i = favs.indexOf(key);
      if (i === -1) favs.push(key);
      else favs.splice(i, 1);
      saveFavorites(favs);
    }

    /* ============================================================
       5) Toast / haptic / ripple
       ============================================================ */

    let toastTimer = null;

    function showToast(message) {
      if (!toastEl) return;

      toastEl.textContent = message;
      toastEl.classList.remove("show");
      void toastEl.offsetWidth;
      toastEl.classList.add("show");

      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastEl.classList.remove("show");
      }, 2000);
    }

    function hapticLight() {
      if (navigator.vibrate) navigator.vibrate(20);
    }

    function playRipple(btn) {
      const ripple = document.createElement("span");
      ripple.className = "favRipple";
      btn.appendChild(ripple);
      ripple.addEventListener("animationend", () => ripple.remove());
    }

    if (toastEl) {
      toastEl.addEventListener("click", () => {
        toastEl.classList.remove("show");
        if (toastTimer) {
          clearTimeout(toastTimer);
          toastTimer = null;
        }
      });
    }

    /* ============================================================
       6) List height
       ============================================================ */

    function fitListHeight() {
      const rect = listEl.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;

      const footer = document.querySelector(".footerNote");
      const footerH = footer ? footer.offsetHeight : 0;

      const bottomGap = footerH + 32;
      const target = Math.max(120, Math.floor(vh - rect.top - bottomGap));

      listEl.style.height = target + "px";
    }

    if (typeof ResizeObserver !== "undefined") {
      new ResizeObserver(fitListHeight).observe(document.body);
    }

    window.addEventListener("resize", fitListHeight, { passive: true });
    window.addEventListener("orientationchange", fitListHeight, { passive: true });
    setTimeout(fitListHeight, 0);

    /* ============================================================
       7) Utils
       ============================================================ */

    function makeQueryRe(s) {
      if (!s) return null;
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("(" + esc + ")", "ig");
    }

    const hi = (t) => (qRe ? String(t).replace(qRe, "<mark>$1</mark>") : t);

    const matchQuery = (it) => {
      if (!q) return true;
      const t = q.toLowerCase();
      return (
        String(it.riddim || "").toLowerCase().includes(t) ||
        String(it.label || "").toLowerCase().includes(t) ||
        String(it.year || "").includes(t)
      );
    };

    const toDecade = (y) => {
      const n = parseInt(y, 10);
      return n ? Math.floor(n / 10) * 10 : 0;
    };

    const cmp = (a, b) =>
      a == null && b == null
        ? 0
        : a == null
        ? 1
        : b == null
        ? -1
        : typeof a === "number" && typeof b === "number"
        ? a - b
        : String(a).localeCompare(String(b), undefined, { sensitivity: "base" });

    function normalizeFilenameKey(raw) {
      if (!raw) return "";
      let s = raw.trim();
      s = s.replace(/\s+riddim\s*$/i, "");
      s = s.replace(/\([^)]*\)/g, "");
      s = s.replace(/\./g, "_");
      s = s.replace(/\s+/g, "_");
      s = s.toLowerCase();
      return s.replace(/[^a-z0-9_]/g, "");
    }

    /* ============================================================
       8) Prefetch detail json
       ============================================================ */

    const prefetchedKeys = new Set();

    async function warmupDetailCache(riddimName) {
      try {
        if (!riddimName) return;

        const key = normalizeFilenameKey(riddimName);
        if (!key || prefetchedKeys.has(key)) return;
        prefetchedKeys.add(key);

        const cacheKey = `riddim:${key}`;
        try {
          if (sessionStorage.getItem(cacheKey)) return;
        } catch {
          return;
        }

        const candidates = [
          `data/${key}.json`,
          `data/${key}_full.json`,
          `data/${key.replace(/__/, "._")}.json`,
        ];

        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            const rec = await res.json();
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify(rec));
            } catch {
              /* ignore */
            }
            break;
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }

    /* ============================================================
       9) Select options
       ============================================================ */

    function buildOptions() {
      const uniq = (arr) =>
        Array.from(new Set(arr)).sort((a, b) =>
          String(a).localeCompare(String(b))
        );

      const labelOps = ["All", ...uniq(items.map((it) => it.label))];

      const decOps = ["All", ...Array.from(new Set(items.map((it) => toDecade(it.year))))]
        .filter((v) => v !== 0)
        .sort((a, b) => a - b)
        .map(String);

      if (labelSelect) {
        labelSelect.innerHTML =
          '<option value="All">レーベル（ALL）</option>' +
          labelOps
            .slice(1)
            .map((v) => `<option value="${v}">${v}</option>`)
            .join("");
      }

      if (yearSelect) {
        yearSelect.innerHTML =
          '<option value="All">年代（ALL）</option>' +
          decOps
            .slice(1)
            .map((v) => `<option value="${v}">${v}s</option>`)
            .join("");
      }
    }

    /* ============================================================
       10) Virtual list base
       ============================================================ */

    const outer = document.createElement("div");
    outer.style.position = "relative";
    listEl.appendChild(outer);

    const inner = document.createElement("div");
    inner.style.position = "absolute";
    inner.style.left = "0";
    inner.style.right = "0";
    outer.appendChild(inner);

    let ROW_H = 40;

    function measureRowH() {
      const probe = document.createElement("a");
      probe.className = "row row--click";
      probe.href = "#";
      probe.innerHTML =
        '<div class="name"><button type="button" class="favToggle">☆</button><span class="nameText">X</span></div>' +
        '<div class="label">X</div>' +
        '<div class="year">2000</div>';
      probe.style.visibility = "hidden";
      probe.style.position = "absolute";
      probe.style.left = "-9999px";
      outer.appendChild(probe);

      const h = probe.getBoundingClientRect().height;
      ROW_H = Math.max(28, Math.round(h)) || ROW_H;

      outer.removeChild(probe);
    }

    measureRowH();

    function pauseIdleAnimation() {
      const stars = listEl.querySelectorAll(".favToggle.is-on");
      stars.forEach((star) => {
        star.classList.remove("fav-idle-run");
        star.classList.add("fav-idle-stop");
      });
    }

    function startIdleAnimation() {
      const stars = listEl.querySelectorAll(".favToggle.is-on");
      stars.forEach((star) => {
        star.classList.remove("fav-idle-stop");
        star.classList.remove("fav-idle-run");
        void star.offsetWidth;
        star.classList.add("fav-idle-run");
      });
    }

    // ✅ perf: scroll render is throttled by rAF
    let rafId = 0;

    listEl.addEventListener(
      "scroll",
      () => {
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          render();
          pauseIdleAnimation();

          if (favIdleTimer) clearTimeout(favIdleTimer);
          favIdleTimer = setTimeout(() => startIdleAnimation(), 200);
        });
      },
      { passive: true }
    );

    /* ============================================================
       11) Filter / sort
       ============================================================ */

    function applyFiltersAndSort() {
      visible = items.filter(
        (it) =>
          matchQuery(it) &&
          (filterLabel === "All" || it.label === filterLabel) &&
          (filterDecade === "All" ||
            toDecade(it.year) === parseInt(filterDecade, 10))
      );

      if (filterFavoritesOnly) {
        const favs = loadFavorites();
        visible = visible.filter((it) => favs.includes(it.riddim));
      }

      visible.sort((a, b) => {
        const v = cmp(a[sortKey], b[sortKey]);
        return sortDir === "asc" ? v : -v;
      });

      // ✅ reset memo to force repaint after data changes
      lastStart = -1;
      lastEnd = -1;

      listEl.scrollTop = 0;
      render();
      updateSortUI();

      if (favIdleTimer) clearTimeout(favIdleTimer);
      favIdleTimer = setTimeout(() => startIdleAnimation(), 200);
    }

    function updateSortUI() {
      const setAria = (btn, dir) => {
        if (!btn) return;
        btn.setAttribute(
          "aria-sort",
          dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"
        );
      };

      sortHeads.forEach((btn) => {
        const key = btn.dataset.key || "";
        const isActive = key === sortKey;

        btn.classList.toggle("is-active", isActive);

        if (isActive) {
          btn.dataset.dir = sortDir;
          setAria(btn, sortDir);
        } else {
          btn.dataset.dir = "asc";
          setAria(btn, "none");
        }
      });

      const jpKey = (key) => {
        if (key === "riddim") return "Riddim";
        if (key === "label") return "レーベル";
        if (key === "year") return "リリース年";
        return key;
      };

      const jpDir = (dir) =>
        dir === "asc" ? "昇順" : dir === "desc" ? "降順" : dir;

      if (metaEl) {
        let text = `表示中 ${visible.length} / ${items.length} ‐ ソート：${jpKey(
          sortKey
        )}（${jpDir(sortDir)}）`;
        if (filterFavoritesOnly) text += " ‐ お気に入りのみ";
        metaEl.textContent = text;
      }
    }

    /* ============================================================
       12) Events
       ============================================================ */

    const toggleSortByHeader = (key) => {
      if (sortKey === key) sortDir = sortDir === "asc" ? "desc" : "asc";
      else {
        sortKey = key;
        sortDir = "asc";
      }
      applyFiltersAndSort();
    };

    sortHeads.forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.key || "";
        if (!key) return;
        toggleSortByHeader(key);
      });
    });

    if (qInput) {
      qInput.addEventListener(
        "input",
        (() => {
          let t = 0;
          return () => {
            clearTimeout(t);
            t = setTimeout(() => {
              q = qInput.value.trim();
              qRe = makeQueryRe(q);
              applyFiltersAndSort();
            }, 60);
          };
        })()
      );
    }

    labelSelect?.addEventListener("change", (e) => {
      filterLabel = e.target.value;
      applyFiltersAndSort();
    });

    yearSelect?.addEventListener("change", (e) => {
      filterDecade = e.target.value;
      applyFiltersAndSort();
    });

    favFilterBtn?.addEventListener("click", () => {
      filterFavoritesOnly = !filterFavoritesOnly;
      favFilterBtn.classList.toggle("is-active", filterFavoritesOnly);
      favFilterBtn.setAttribute(
        "aria-pressed",
        filterFavoritesOnly ? "true" : "false"
      );
      applyFiltersAndSort();
    });

    if (resetBtn) {
      const doReset = () => {
        if (qInput) qInput.value = "";
        q = "";
        qRe = null;

        filterLabel = "All";
        filterDecade = "All";
        if (labelSelect) labelSelect.value = "All";
        if (yearSelect) yearSelect.value = "All";

        filterFavoritesOnly = false;
        if (favFilterBtn) {
          favFilterBtn.classList.remove("is-active");
          favFilterBtn.setAttribute("aria-pressed", "false");
        }

        sortKey = "riddim";
        sortDir = "asc";

        applyFiltersAndSort();
      };

      resetBtn.addEventListener("click", doReset);

      resetBtn.addEventListener(
        "touchstart",
        () => resetBtn.classList.add("pressed"),
        { passive: true }
      );

      ["touchend", "touchcancel"].forEach((ev) => {
        resetBtn.addEventListener(
          ev,
          () => setTimeout(() => resetBtn.classList.remove("pressed"), 80),
          { passive: true }
        );
      });
    }

    /* ============================================================
       13) Rendering (virtual list) - row is <a>
       ============================================================ */

    function setFavVisual(btn, key, allowAnim = false) {
      const on = isFavorite(key);
      btn.textContent = on ? "★" : "☆";
      btn.classList.toggle("is-on", on);

      btn.classList.remove("fav-idle-run", "fav-idle-stop", "is-unfav");

      if (!on) return;

      if (allowAnim) {
        void btn.offsetWidth;
        btn.classList.add("fav-idle-run");
      } else {
        btn.classList.add("fav-idle-stop");
      }
    }

    // ✅ perf: memoize last rendered range
    let lastStart = -1;
    let lastEnd = -1;

    function render() {
      const viewportH = listEl.clientHeight || 300;
      const total = visible.length * ROW_H;

      const start = Math.max(0, Math.floor(listEl.scrollTop / ROW_H) - 10);
      const end = Math.min(
        visible.length,
        Math.ceil((listEl.scrollTop + viewportH) / ROW_H) + 10
      );

      // ✅ perf: if range didn't change, do nothing
      if (start === lastStart && end === lastEnd) return;
      lastStart = start;
      lastEnd = end;

      outer.style.height = total + "px";
      inner.style.transform = `translateY(${start * ROW_H}px)`;
      inner.innerHTML = "";

      for (let i = start; i < end; i++) {
        const it = visible[i];
        const key = it.riddim;

        const row = document.createElement("a");
        row.className = "row row--click";
        row.dataset.riddimKey = key || "";

        row.href = key ? `detail.html?riddim=${encodeURIComponent(key)}` : "#";
        if (!key) row.addEventListener("click", (e) => e.preventDefault());

        if (currentTouchedKey === key) row.classList.add("touch-hover");

        row.innerHTML =
          `<div class="name"></div>` +
          `<div class="label">${hi(it.label)}</div>` +
          `<div class="year">${it.year}</div>`;

        const nameDiv = row.querySelector(".name");

        const favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = "favToggle";
        favBtn.setAttribute("aria-label", "お気に入り");

        setFavVisual(favBtn, key, isFirstRender);

        favBtn.addEventListener("click", async (e) => {
          e.preventDefault();
          e.stopPropagation();

          playRipple(favBtn);

          const wasFav = isFavorite(key);
          toggleFavorite(key);

          setFavVisual(favBtn, key, true);

          const nowFav = isFavorite(key);

          const titleForToast =
            (it.riddim && String(it.riddim).trim()) || "（名称未設定）";

          if (!wasFav && nowFav) {
            showToast(`${titleForToast}\nお気に入りに追加しました`);
            hapticLight();
          } else if (wasFav && !nowFav) {
            favBtn.classList.remove("is-unfav");
            void favBtn.offsetWidth;
            favBtn.classList.add("is-unfav");
            setTimeout(() => favBtn.classList.remove("is-unfav"), 260);

            showToast(`${titleForToast}\nお気に入りを解除しました`);
          }

          syncFavoriteToSupabase(key, nowFav);

          if (filterFavoritesOnly) applyFiltersAndSort();
        });

        favBtn.addEventListener("keydown", (e) => e.stopPropagation());

        const nameSpan = document.createElement("span");
        nameSpan.className = "nameText";
        nameSpan.innerHTML = hi(it.riddim);

        if (nameDiv) {
          nameDiv.appendChild(favBtn);
          nameDiv.appendChild(nameSpan);
        }

        // ✅ perf: only attach hover-related listeners on hover-capable devices
        if (CAN_HOVER) {
          row.addEventListener("mouseenter", () => warmupDetailCache(key));
          row.addEventListener("focus", () => warmupDetailCache(key));
        }

        // keep small warmup for top items of current window
        if (i < start + 3) warmupDetailCache(key);

        inner.appendChild(row);
      }

      if (isFirstRender) isFirstRender = false;
    }

    /* ============================================================
       14) Load data
       ============================================================ */

    fetch("index.json")
      .then((res) => {
        if (!res.ok) throw new Error("index.json 読み込みエラー");
        return res.json();
      })
      .then((data) => {
        items = data.map((it, idx) => ({
          id: it.id ?? idx + 1,
          riddim: it.riddim ?? it.name ?? "",
          label: it.label ?? "",
          year: it.year ?? "",
        }));

        buildOptions();
        applyFiltersAndSort();
        fitListHeight();

        if (favIdleTimer) clearTimeout(favIdleTimer);
        favIdleTimer = setTimeout(() => startIdleAnimation(), 300);
      })
      .catch((err) => {
        console.error(err);
        if (metaEl) metaEl.textContent = "インデックスデータを読み込めませんでした。";
      });
  }
})();
