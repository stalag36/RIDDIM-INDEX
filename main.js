(function () {
  /* ========================================
     1. タッチホバー（モバイル共通）
     ======================================== */

  // 現在タッチ中の「リディムキー」を保存
  let currentTouchedKey = null;

  document.addEventListener(
    "touchstart",
    (ev) => {
      const row = ev.target.closest(".row.row--click");

      if (!row) {
        // 行以外をタッチした場合は既存の hover を解除
        currentTouchedKey = null;
        const prev = document.querySelector(".row.row--click.touch-hover");
        if (prev) prev.classList.remove("touch-hover");
        return;
      }

      const key = row.dataset.riddimKey || "";

      // 別の行に切り替えた場合は前の hover を解除
      if (currentTouchedKey && currentTouchedKey !== key) {
        const prev = document.querySelector(".row.row--click.touch-hover");
        if (prev) prev.classList.remove("touch-hover");
      }

      // 新しい行に hover クラスを付与
      row.classList.add("touch-hover");
      currentTouchedKey = key;
    },
    { passive: true }
  );

  /* ========================================
     2. DOM 準備完了後の初期化
     ======================================== */

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    /* ----------------------------------------
       2-1. バージョン表示と要素参照
       ---------------------------------------- */
    const metaVer = document.querySelector('meta[name="version"]');
    const ver = metaVer ? metaVer.content : "";
    const verEl = document.getElementById("ver");
    if (verEl && ver) verEl.textContent = ver;

    const listEl = document.getElementById("list");
    const metaEl = document.getElementById("meta");
    const qInput = document.getElementById("q");
    const labelSelect = document.getElementById("labelSelect");
    const yearSelect = document.getElementById("yearSelect");

    const hName = document.getElementById("hName");
    const hLabel = document.getElementById("hLabel");
    const hYear = document.getElementById("hYear");

    if (!listEl) return;

    /* ----------------------------------------
       2-2. データ本体と状態
       ---------------------------------------- */
    // index.json から読み込むデータ本体
    let items = [];

    // 検索・フィルタ・ソートの状態
    let q = "";
    let qRe = null;
    let filterLabel = "All";
    let filterDecade = "All";
    let sortKey = "riddim";
    let sortDir = "asc";
    let visible = items.slice();

    /* ========================================
       3. レイアウト調整（リスト高さフィット）
       ======================================== */

    function fitListHeight() {
      if (!listEl) return;

      const rect = listEl.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;

      const footer = document.querySelector(".footerNote");
      const footerH = footer ? footer.offsetHeight : 0;

      const extraGap = 32;
      const bottomGap = footerH + extraGap;

      const target = Math.max(120, Math.floor(vh - rect.top - bottomGap));
      listEl.style.height = target + "px";
    }

    new ResizeObserver(fitListHeight).observe(document.body);
    window.addEventListener("resize", fitListHeight, { passive: true });
    window.addEventListener("orientationchange", fitListHeight, { passive: true });
    setTimeout(fitListHeight, 0);

    /* ========================================
       4. ユーティリティ関数
       ======================================== */

    // 検索キーワードから正規表現を生成
    function makeQueryRe(s) {
      if (!s) return null;
      const esc = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("(" + esc + ")", "ig");
    }

    // 検索キーワードにヒットした部分を <mark> で強調
    function hi(text) {
      return qRe ? String(text).replace(qRe, "<mark>$1</mark>") : text;
    }

    // 検索クエリとのマッチ判定
    function matchQuery(it) {
      if (!q) return true;
      const t = q.toLowerCase();
      return (
        it.riddim.toLowerCase().includes(t) ||
        it.label.toLowerCase().includes(t) ||
        String(it.year).includes(t)
      );
    }

    // 年から年代（10 年ごと）に変換
    function toDecade(y) {
      return Math.floor(y / 10) * 10;
    }

    // 共通比較関数（文字列・数値双方対応）
    function cmp(a, b) {
      if (a == null && b == null) return 0;
      if (a == null) return 1;
      if (b == null) return -1;
      if (typeof a === "number" && typeof b === "number") return a - b;
      return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
    }

    // detail.js と揃えたファイル名キー正規化
    function normalizeFilenameKey(raw) {
      if (!raw) return "";

      let s = raw.trim();
      s = s.replace(/\s+riddim\s*$/i, "");
      s = s.replace(/\([^)]*\)/g, "");
      s = s.replace(/\./g, "_");
      s = s.replace(/\s+/g, "_");
      s = s.toLowerCase();
      s = s.replace(/[^a-z0-9_]/g, "");
      return s;
    }

    /* ========================================
       4-2. detail.json の事前読み込み（プレフェッチ）
       ======================================== */

    const prefetchedKeys = new Set();

    async function warmupDetailCache(riddimName) {
      try {
        if (!riddimName) return;

        const key = normalizeFilenameKey(riddimName);
        if (!key) return;

        // すでにプレフェッチ済みならスキップ
        if (prefetchedKeys.has(key)) return;
        prefetchedKeys.add(key);

        const cacheKey = `riddim:${key}`;

        // sessionStorage に既にあればネットワークアクセス不要
        try {
          if (sessionStorage.getItem(cacheKey)) return;
        } catch {
          // sessionStorage が使えない環境ではそのままフェッチだけ試す
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
              // 容量オーバーなどは無視
            }
            break;
          } catch {
            // 次の候補を試す
          }
        }
      } catch {
        // プレフェッチはあくまで「おまけ」なのでエラーは握りつぶす
      }
    }

    /* ========================================
       5. セレクトボックスの中身生成
       ======================================== */

    function buildOptions() {
      const uniq = (arr) =>
        Array.from(new Set(arr)).sort((a, b) =>
          String(a).localeCompare(String(b))
        );

      const labelOps = ["All", ...uniq(items.map((it) => it.label))];
      const decOps = [
        "All",
        ...Array.from(new Set(items.map((it) => toDecade(it.year))))
          .sort((a, b) => a - b)
          .map(String),
      ];

      if (labelSelect) {
        labelSelect.innerHTML = [
          '<option value="All">レーベル（ALL）</option>',
          ...labelOps
            .slice(1)
            .map((v) => `<option value="${v}">${v}</option>`),
        ].join("");
      }

      if (yearSelect) {
        yearSelect.innerHTML = [
          '<option value="All">年代（ALL）</option>',
          ...decOps
            .slice(1)
            .map((v) => `<option value="${v}">${v}s</option>`),
        ].join("");
      }
    }

    // 初期状態（データ未読込）でも「ALL」だけは出しておく
    buildOptions();

    /* ========================================
       6. バーチャルリストの準備
       ======================================== */

    const outer = document.createElement("div");
    outer.style.position = "relative";
    listEl.appendChild(outer);

    const inner = document.createElement("div");
    inner.style.position = "absolute";
    inner.style.left = 0;
    inner.style.right = 0;
    outer.appendChild(inner);

    // 1 行あたりの高さ推定（レスポンシブ対応のため計測）
    let ROW_H = 40;

    function measureRowH() {
      const probe = document.createElement("div");
      probe.className = "row";
      probe.innerHTML =
        '<div class="name">Probe</div><div class="label">Probe</div><div class="year">2000</div>';
      probe.style.visibility = "hidden";
      outer.appendChild(probe);

      const h = probe.getBoundingClientRect().height;
      ROW_H = Math.max(28, Math.round(h)) || ROW_H;

      outer.removeChild(probe);
    }

    measureRowH();

    listEl.addEventListener(
      "scroll",
      () => {
        render();
      },
      { passive: true }
    );

    /* ========================================
       7. ソート・フィルタと UI 反映
       ======================================== */

    function applyFiltersAndSort() {
      visible = items.filter(
        (it) =>
          matchQuery(it) &&
          (filterLabel === "All" || it.label === filterLabel) &&
          (filterDecade === "All" || toDecade(it.year) === parseInt(filterDecade, 10))
      );

      visible.sort((a, b) => {
        const v = cmp(a[sortKey], b[sortKey]);
        return sortDir === "asc" ? v : -v;
      });

      listEl.scrollTop = 0;
      render();
      updateSortUI();
    }

    function updateSortUI() {
      function jpKey(key) {
        if (key === "riddim") return "Riddim";
        if (key === "label") return "レーベル";
        if (key === "year") return "リリース年";
        return key;
      }

      function jpDir(dir) {
        if (dir === "asc") return "昇順";
        if (dir === "desc") return "降順";
        return dir;
      }

      function arrow(dir) {
        return dir === "asc" ? " ▲" : " ▼";
      }

      hName.classList.remove("sorted");
      hLabel.classList.remove("sorted");
      hYear.classList.remove("sorted");

      hName.textContent = "Riddim";
      hLabel.textContent = "レーベル";
      hYear.textContent = "リリース年";

      hName.setAttribute("aria-sort", "none");
      hLabel.setAttribute("aria-sort", "none");
      hYear.setAttribute("aria-sort", "none");

      if (sortKey === "riddim") {
        hName.classList.add("sorted");
        hName.textContent += arrow(sortDir);
        hName.setAttribute(
          "aria-sort",
          sortDir === "asc" ? "ascending" : "descending"
        );
      } else if (sortKey === "label") {
        hLabel.classList.add("sorted");
        hLabel.textContent += arrow(sortDir);
        hLabel.setAttribute(
          "aria-sort",
          sortDir === "asc" ? "ascending" : "descending"
        );
      } else if (sortKey === "year") {
        hYear.classList.add("sorted");
        hYear.textContent += arrow(sortDir);
        hYear.setAttribute(
          "aria-sort",
          sortDir === "asc" ? "ascending" : "descending"
        );
      }

      if (metaEl) {
        metaEl.textContent =
          `表示中 ${visible.length} / ${items.length} ‐ ソート：` +
          `${jpKey(sortKey)}（${jpDir(sortDir)}）`;
      }
    }

    /* ========================================
       8. イベント設定
       ======================================== */

    // 検索ボックス（入力のデバウンス）
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

    // レーベルセレクト
    labelSelect.addEventListener("change", (e) => {
      filterLabel = e.target.value;
      applyFiltersAndSort();
    });

    // 年代セレクト
    yearSelect.addEventListener("change", (e) => {
      filterDecade = e.target.value;
      applyFiltersAndSort();
    });

    // ヘッダークリックでソート切り替え
    function toggleSortByHeader(key) {
      if (sortKey === key) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortKey = key;
        sortDir = "asc";
      }
      applyFiltersAndSort();
    }

    hName.addEventListener("click", () => toggleSortByHeader("riddim"));
    hLabel.addEventListener("click", () => toggleSortByHeader("label"));
    hYear.addEventListener("click", () => toggleSortByHeader("year"));

    /* ========================================
       9. 描画処理（バーチャルリスト）
       ======================================== */

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
        const it = visible[i];
        const row = document.createElement("div");
        row.className = "row row--click";

        const riddimKey = it.riddim || it.name || "";
        row.dataset.riddimKey = riddimKey;

        // 再描画時に、タッチ済み行の hover を復元
        if (currentTouchedKey && currentTouchedKey === riddimKey) {
          row.classList.add("touch-hover");
        }

        row.innerHTML =
          `<div class="name">${hi(it.riddim)}</div>` +
          `<div class="label">${hi(it.label)}</div>` +
          `<div class="year">${it.year}</div>`;

        row.setAttribute("role", "link");
        row.setAttribute("tabindex", "0");

        const goDetail = () => {
          const key = it.riddim || it.name || "";
          if (!key) return;
          location.href = "detail.html?riddim=" + encodeURIComponent(key);
        };

        row.addEventListener("click", goDetail);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            goDetail();
          }
        });

        // ホバー・フォーカス時にもプレフェッチ
        row.addEventListener("mouseenter", () => {
          warmupDetailCache(riddimKey);
        });
        row.addEventListener("focus", () => {
          warmupDetailCache(riddimKey);
        });

        // 画面上部の数件は自動でプレフェッチ
        if (i < start + 5) {
          warmupDetailCache(riddimKey);
        }

        inner.appendChild(row);
      }
    }

    /* ========================================
       10. データ読み込みと初期描画
       ======================================== */

    fetch("index.json")
      .then((res) => {
        if (!res.ok) throw new Error("index.json 読み込みエラー");
        return res.json();
      })
      .then((data) => {
        // index.json は [ { id, riddim(or name), label, year }, ... ] の配列を想定
        items = data.map((it, idx) => ({
          id: it.id ?? idx + 1,
          riddim: it.riddim ?? it.name ?? "",
          label: it.label ?? "",
          year: it.year ?? "",
        }));

        buildOptions();
        applyFiltersAndSort();
        fitListHeight();
      })
      .catch((err) => {
        console.error(err);
        if (metaEl) {
          metaEl.textContent = "インデックスデータを読み込めませんでした。";
        }
      });
  }
})();
