/* ============================================================
   RIDDIM INDEX index.js  v1.2
   ============================================================ */

(function () {

  /* ============================================================
     1. タッチホバー（モバイル）
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
     2. DOM 準備
     ============================================================ */

  document.addEventListener("DOMContentLoaded", init);

  function init() {

    /* ------------------------------------------------------------
       2-1. DOM 取得 / 状態
       ------------------------------------------------------------ */

    const listEl       = document.getElementById("list");
    if (!listEl) return;

    const metaEl       = document.getElementById("meta");
    const qInput       = document.getElementById("q");
    const labelSelect  = document.getElementById("labelSelect");
    const yearSelect   = document.getElementById("yearSelect");
    const hName        = document.getElementById("hName");
    const hLabel       = document.getElementById("hLabel");
    const hYear        = document.getElementById("hYear");
    const favFilterBtn = document.getElementById("filterFavorites");
    const resetBtn     = document.getElementById("resetFilters");
    const toastEl      = document.getElementById("toast");

    let items   = [];
    let visible = [];

    let q                   = "";
    let qRe                 = null;
    let filterLabel         = "All";
    let filterDecade        = "All";
    let sortKey             = "riddim";
    let sortDir             = "asc";
    let filterFavoritesOnly = false;

    // 初期描画かどうか（★アニメON制御用）
    let isFirstRender = true;

    // スクロール停止後にアイドルアニメを再開するためのタイマー
    let favIdleTimer = null;


    /* ============================================================
       3. お気に入り管理（localStorage）
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
       4. トースト / ハプティック / Ripple
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
      if (navigator.vibrate) {
        navigator.vibrate(20);
      }
    }

    function playRipple(btn) {
      const ripple = document.createElement("span");
      ripple.className = "favRipple";
      btn.appendChild(ripple);

      ripple.addEventListener("animationend", () => {
        ripple.remove();
      });
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
       5. リスト高さ調整
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
       6. ユーティリティ
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
        it.riddim.toLowerCase().includes(t) ||
        it.label.toLowerCase().includes(t) ||
        String(it.year).includes(t)
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
       7. detail.json プレフェッチ
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
       8. セレクトボックス生成
       ============================================================ */

    function buildOptions() {
      const uniq = (arr) =>
        Array.from(new Set(arr)).sort((a, b) =>
          String(a).localeCompare(String(b))
        );

      const labelOps = ["All", ...uniq(items.map((it) => it.label))];

      const decOps = [
        "All",
        ...Array.from(new Set(items.map((it) => toDecade(it.year)))),
      ]
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
       9. バーチャルリスト準備
       ============================================================ */

    const outer = document.createElement("div");
    outer.style.position = "relative";
    listEl.appendChild(outer);

    const inner = document.createElement("div");
    inner.style.position = "absolute";
    inner.style.left = 0;
    inner.style.right = 0;
    outer.appendChild(inner);

    let ROW_H = 40;

    function measureRowH() {
      const probe = document.createElement("div");
      probe.className = "row";
      probe.innerHTML =
        '<div class="name">X</div><div class="label">X</div><div class="year">2000</div>';
      probe.style.visibility = "hidden";
      outer.appendChild(probe);
      const h = probe.getBoundingClientRect().height;
      ROW_H = Math.max(28, Math.round(h)) || ROW_H;
      outer.removeChild(probe);
    }

    measureRowH();

    // ★アイドルアニメを一括で止める
    function pauseIdleAnimation() {
      const stars = listEl.querySelectorAll(".favToggle.is-on");
      stars.forEach((star) => {
        star.classList.remove("fav-idle-run");
        star.classList.add("fav-idle-stop");
      });
    }

    // ★アイドルアニメを一括で再開する
    function startIdleAnimation() {
      const stars = listEl.querySelectorAll(".favToggle.is-on");
      stars.forEach((star) => {
        star.classList.remove("fav-idle-stop");
        // アニメ再スタート用の強制リフロー
        star.classList.remove("fav-idle-run");
        void star.offsetWidth;
        star.classList.add("fav-idle-run");
      });
    }

    // スクロール：描画 + アニメ一時停止 + 停止後に再開
    listEl.addEventListener(
      "scroll",
      () => {
        render();

        // スクロール中はアイドルアニメ停止
        pauseIdleAnimation();

        if (favIdleTimer) clearTimeout(favIdleTimer);
        favIdleTimer = setTimeout(() => {
          // スクロールが一定時間止まったら再開
          startIdleAnimation();
        }, 200); // 200ms 無操作で「スクロール終了」とみなす
      },
      { passive: true }
    );


    /* ============================================================
       10. フィルタ・ソート
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

      listEl.scrollTop = 0;
      render();
      updateSortUI();

      // フィルタ変更後も少し待ってからアイドルアニメ再開
      if (favIdleTimer) clearTimeout(favIdleTimer);
      favIdleTimer = setTimeout(() => {
        startIdleAnimation();
      }, 200);
    }

    function updateSortUI() {
      const jpKey = (key) => {
        if (key === "riddim") return "Riddim";
        if (key === "label") return "レーベル";
        if (key === "year") return "リリース年";
        return key;
      };

      const jpDir = (dir) => {
        if (dir === "asc") return "昇順";
        if (dir === "desc") return "降順";
        return dir;
      };

      const arrow = sortDir === "asc" ? " ▲" : " ▼";

      const resetHeader = (el, label) => {
        if (!el) return;
        el.classList.remove("sorted");
        el.textContent = label;
        el.setAttribute("aria-sort", "none");
      };

      resetHeader(hName, "Riddim");
      resetHeader(hLabel, "レーベル");
      resetHeader(hYear, "リリース年");

      const activate = (el) => {
        if (!el) return;
        el.classList.add("sorted");
        el.textContent += arrow;
        el.setAttribute(
          "aria-sort",
          sortDir === "asc" ? "ascending" : "descending"
        );
      };

      if (sortKey === "riddim") activate(hName);
      if (sortKey === "label") activate(hLabel);
      if (sortKey === "year")  activate(hYear);

      if (metaEl) {
        let text =
          `表示中 ${visible.length} / ${items.length} ‐ ソート：` +
          `${jpKey(sortKey)}（${jpDir(sortDir)}）`;

        if (filterFavoritesOnly) {
          text += " ‐ お気に入りのみ";
        }

        metaEl.textContent = text;
      }
    }


    /* ============================================================
       11. イベント設定
       ============================================================ */

    const toggleSortByHeader = (key) => {
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = "asc";
      }
      applyFiltersAndSort();
    };

    if (hName) {
      hName.addEventListener("click", () => toggleSortByHeader("riddim"));
    }
    if (hLabel) {
      hLabel.addEventListener("click", () => toggleSortByHeader("label"));
    }
    if (hYear) {
      hYear.addEventListener("click", () => toggleSortByHeader("year"));
    }

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

    if (labelSelect) {
      labelSelect.addEventListener("change", (e) => {
        filterLabel = e.target.value;
        applyFiltersAndSort();
      });
    }

    if (yearSelect) {
      yearSelect.addEventListener("change", (e) => {
        filterDecade = e.target.value;
        applyFiltersAndSort();
      });
    }

    if (favFilterBtn) {
      favFilterBtn.addEventListener("click", () => {
        filterFavoritesOnly = !filterFavoritesOnly;
        favFilterBtn.classList.toggle("is-active", filterFavoritesOnly);
        favFilterBtn.setAttribute(
          "aria-pressed",
          filterFavoritesOnly ? "true" : "false"
        );
        applyFiltersAndSort();
      });
    }

    if (resetBtn) {
      const doReset = () => {
        if (qInput) qInput.value = "";
        q = "";
        qRe = null;

        filterLabel = "All";
        filterDecade = "All";
        if (labelSelect) labelSelect.value = "All";
        if (yearSelect)  yearSelect.value  = "All";

        filterFavoritesOnly = false;
        if (favFilterBtn) {
          favFilterBtn.classList.remove("is-active");
          favFilterBtn.setAttribute("aria-pressed", "false");
        }

        applyFiltersAndSort();
      };

      resetBtn.addEventListener("click", doReset);

      resetBtn.addEventListener(
        "touchstart",
        () => {
          resetBtn.classList.add("pressed");
        },
        { passive: true }
      );

      ["touchend", "touchcancel"].forEach((ev) => {
        resetBtn.addEventListener(
          ev,
          () => {
            setTimeout(() => resetBtn.classList.remove("pressed"), 80);
          },
          { passive: true }
        );
      });
    }


    /* ============================================================
       12. レンダリング（バーチャルリスト）
       ============================================================ */

    // ★の見た目 + アニメクラス付け
    // allowAnim = true のときだけ idle アニメを回す（初期描画 & クリック）
    function setFavVisual(btn, key, allowAnim = false) {
      const on = isFavorite(key);
      btn.textContent = on ? "★" : "☆";
      btn.classList.toggle("is-on", on);

      // いったん関連クラスを全部外す
      btn.classList.remove("fav-idle-run", "fav-idle-stop", "is-unfav");

      if (!on) return;

      if (allowAnim) {
        // 初期描画 or クリック時：pop + idle
        void btn.offsetWidth;
        btn.classList.add("fav-idle-run");
      } else {
        // スクロール等で再描画されたときは「停止状態」から始める
        btn.classList.add("fav-idle-stop");
      }
    }

    function render() {
      const viewportH = listEl.clientHeight || 300;
      const total = visible.length * ROW_H;

      const start = Math.max(0, Math.floor(listEl.scrollTop / ROW_H) - 10);
      const end = Math.min(
        visible.length,
        Math.ceil((listEl.scrollTop + viewportH) / ROW_H) + 10
      );

      outer.style.height = total + "px";
      inner.style.transform = `translateY(${start * ROW_H}px)`;
      inner.innerHTML = "";

      for (let i = start; i < end; i++) {
        const it  = visible[i];
        const key = it.riddim;

        const row = document.createElement("div");
        row.className = "row row--click";
        row.dataset.riddimKey = key;

        if (currentTouchedKey === key) {
          row.classList.add("touch-hover");
        }

        row.innerHTML =
          `<div class="name"></div>` +
          `<div class="label">${hi(it.label)}</div>` +
          `<div class="year">${it.year}</div>`;

        const nameDiv = row.querySelector(".name");

        const favBtn = document.createElement("button");
        favBtn.type = "button";
        favBtn.className = "favToggle";

        // 初期描画のみアニメON、それ以外（スクロール/再描画）は停止状態から
        setFavVisual(favBtn, key, isFirstRender);

        favBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          e.preventDefault();

          playRipple(favBtn);

          const wasFav = isFavorite(key);

          toggleFavorite(key);
          // クリック時は毎回アニメON（pop + idle）
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

            setTimeout(() => {
              favBtn.classList.remove("is-unfav");
            }, 260);

            showToast(`${titleForToast}\nお気に入りを解除しました`);
          }

          if (filterFavoritesOnly) applyFiltersAndSort();
        });

        favBtn.addEventListener("keydown", (e) => {
          e.stopPropagation();
        });

        const nameSpan = document.createElement("span");
        nameSpan.className = "nameText";
        nameSpan.innerHTML = hi(it.riddim);

        if (nameDiv) {
          nameDiv.appendChild(favBtn);
          nameDiv.appendChild(nameSpan);
        }

        const goDetail = () => {
          if (!key) return;
          location.href = "detail.html?riddim=" + encodeURIComponent(key);
        };

        row.setAttribute("role", "link");
        row.setAttribute("tabindex", "0");

        row.addEventListener("click", goDetail);

        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goDetail();
          }
        });

        row.addEventListener("mouseenter", () => warmupDetailCache(key));
        row.addEventListener("focus", () => warmupDetailCache(key));
        if (i < start + 5) {
          warmupDetailCache(key);
        }

        inner.appendChild(row);
      }

      // 初回描画が終わったらフラグを折る
      if (isFirstRender) {
        isFirstRender = false;
      }
    }


    /* ============================================================
       13. データ読み込み
       ============================================================ */

    fetch("index.json")
      .then((res) => {
        if (!res.ok) throw new Error("index.json 読み込みエラー");
        return res.json();
      })
      .then((data) => {
        items = data.map((it, idx) => ({
          id:     it.id     ?? idx + 1,
          riddim: it.riddim ?? it.name ?? "",
          label:  it.label  ?? "",
          year:   it.year   ?? "",
        }));

        buildOptions();
        applyFiltersAndSort();
        fitListHeight();

        // 初期描画後、少し遅らせて idle アニメをスタート
        if (favIdleTimer) clearTimeout(favIdleTimer);
        favIdleTimer = setTimeout(() => {
          startIdleAnimation();
        }, 300);
      })
      .catch((err) => {
        console.error(err);
        if (metaEl) {
          metaEl.textContent = "インデックスデータを読み込めませんでした。";
        }
      });

  } // init

})();
