(function () {
  /* ============================================================
     1. URL パラメータ / 共通ヘルパー
     ============================================================ */

  // クエリパラメータ取得
  function getParam(key) {
    return new URLSearchParams(location.search).get(key) || "";
  }

  // riddim名 → ファイル名用キー（index側と揃える）
  function normalizeFilenameKey(raw) {
    if (!raw) return "";

    let s = raw.trim();
    s = s.replace(/\s+riddim\s*$/i, "");   // 末尾の "riddim" を削除
    s = s.replace(/\([^)]*\)/g, "");      // () 内を削除
    s = s.replace(/\./g, "_");            // . → _
    s = s.replace(/\s+/g, "_");           // 空白 → _
    s = s.toLowerCase();
    s = s.replace(/[^a-z0-9_]/g, "");     // 許可文字だけ
    return s;
  }

  // 空なら "—" を入れてくれるテキストセット
  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;

    if (value === undefined || value === null) {
      el.textContent = "—";
      return;
    }
    const s = String(value).trim();
    el.textContent = s || "—";
  }

  // タイトルやアーティストから () を取ったりして整形
  const cleanTitle = (s) =>
    s ? s.replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim() : s;

  const cleanArtist = cleanTitle;

  // レーベル名の "(2)" などを除去
  const cleanLabel = (s) =>
    s ? s.replace(/\(\d+\)/g, "").trim() : s;



  /* ============================================================
   2. お気に入り共通ヘルパー + トースト
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
    } catch {}
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

  // ★ ビジュアル（初期状態）
  function setFavVisual(btn, key) {
    const on = isFavorite(key);
    btn.textContent = on ? "★" : "☆";
    btn.classList.toggle("is-on", on);
  }


  // ----------------------------------------------------
  // ★★★ iOS モーダル風トースト（中央に表示） ★★★
  // ----------------------------------------------------
  let toastEl = null;
  let toastTimer = null;

  function showToast(message) {
    if (!toastEl) return;

    toastEl.textContent = message;

    // 連打対応：アニメをリスタート
    toastEl.classList.remove("show");
    void toastEl.offsetWidth; // reflow
    toastEl.classList.add("show");

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2000);
  }

  // スマホ用の軽い振動（対応端末のみ）
  function hapticLight() {
    if (navigator.vibrate) {
      navigator.vibrate(20); // ぷるっ
    }
  }

  // トースト自体をタップで閉じる
  document.addEventListener("DOMContentLoaded", () => {
    toastEl = document.getElementById("toast");
    if (toastEl) {
      toastEl.addEventListener("click", () => {
        toastEl.classList.remove("show");
        if (toastTimer) clearTimeout(toastTimer);
      });
    }
  });


  /* ============================================================
     3. スマホ用タッチホバー（PICKUP 行）
     ============================================================ */

  function setupTouchHoverForSongs() {
    const rows = document.querySelectorAll(".songRow");
    if (!rows.length) return;

    let activeRow = null;

    rows.forEach((row) => {
      row.addEventListener(
        "touchstart",
        (e) => {
          if (e.touches && e.touches.length > 1) return;

          if (activeRow && activeRow !== row) {
            activeRow.classList.remove("touch-hover");
          }

          row.classList.add("touch-hover");
          activeRow = row;
        },
        { passive: true }
      );
    });

    // 画面の別の場所をタッチしたらホバー解除
    document.addEventListener(
      "touchstart",
      (e) => {
        const t = e.target.closest && e.target.closest(".songRow");
        if (!t && activeRow) {
          activeRow.classList.remove("touch-hover");
          activeRow = null;
        }
      },
      { passive: true }
    );
  }



  /* ============================================================
     4. メイン処理
     ============================================================ */

  async function load() {
    try {
      /* ------------------------------
         4-1. riddim パラメータとキー
         ------------------------------ */
      const rawRiddim = getParam("riddim");
      if (!rawRiddim) return;

      // トースト要素（detailページ用）
      toastEl = document.getElementById("toast") || null;

      // お気に入り用キー（インデックス同様、生のクエリ文字列）
      const favKey = rawRiddim;

      // JSON ファイル名用キー
      const key = normalizeFilenameKey(rawRiddim);
      if (!key) return;

      const cacheKey = `riddim:${key}`;
      const candidates = [
        `data/${key}.json`,
        `data/${key}_full.json`,
        `data/${key.replace(/__/, "._")}.json`,
      ];

      let rec = null;

      /* ------------------------------
         4-2. sessionStorage キャッシュ
         ------------------------------ */
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          rec = JSON.parse(cached);
        } catch {
          // ignore
        }
      }

      // キャッシュなし → fetch
      if (!rec) {
        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            rec = await res.json();
            sessionStorage.setItem(cacheKey, JSON.stringify(rec));
            break;
          } catch {
            // ignore
          }
        }
      }

      if (!rec) return;

      const tracks     = Array.isArray(rec.tracks) ? rec.tracks : [];
      const firstTrack = tracks[0] || null;
      const akaArr     = Array.isArray(rec.aka) ? rec.aka : [];

      const displayName =
        (rec.riddim && String(rec.riddim).trim()) ||
        (rec.name   && String(rec.name).trim()) ||
        rawRiddim;



      /* ------------------------------
         4-3. タイトル / お気に入りボタン
         ------------------------------ */

      document.title = "RIDDIM INDEX – " + displayName;
      setText("riddimTitle", displayName);

      const favBtn = document.getElementById("favDetailToggle");
      if (favBtn) {
        // 初期状態
        setFavVisual(favBtn, favKey);

        // クリック時：ON → CSS側 .is-on でポップ＋フレア
        //              OFF → .is-unfav を一瞬付与してポフっと消える
        favBtn.addEventListener("click", () => {
          const wasFav = isFavorite(favKey);

          toggleFavorite(favKey);      // 状態を反転
          setFavVisual(favBtn, favKey);

          const nowFav = isFavorite(favKey);

          if (!wasFav && nowFav) {
            // ☆ → ★
            showToast("お気に入りに追加しました");
            hapticLight(); // ← 追加時だけ軽く振動
          } else if (wasFav && !nowFav) {
            // ★ → ☆ に変わったときだけ「ポフっ…」アニメ
            favBtn.classList.remove("is-unfav");
            // 再レイアウトでアニメをリスタート
            void favBtn.offsetWidth;
            favBtn.classList.add("is-unfav");

            setTimeout(() => {
              favBtn.classList.remove("is-unfav");
            }, 260); // CSS の duration に合わせる

            showToast("お気に入りを解除しました");
          }
        });
      }



      /* ------------------------------
         4-4. メタ情報表示
         ------------------------------ */

      const baseLabel =
        rec.label ||
        (firstTrack && firstTrack.label) ||
        "";
      setText("label", cleanLabel(baseLabel) || "—");

      const baseYear =
        rec.year ||
        (rec.stats && (rec.stats.min_year || rec.stats.year)) ||
        (firstTrack && firstTrack.year) ||
        "";
      setText("year", baseYear || "—");

      let producer =
        (firstTrack && firstTrack.producer) ||
        rec.producer ||
        "";
      if (Array.isArray(producer)) {
        producer = producer.filter(Boolean).join(" & ");
      }
      producer = String(producer).replace(/&amp;/g, "&").trim();
      setText("producer", producer || "—");

      setText("aka", akaArr.length ? akaArr.filter(Boolean).join(" ／ ") : "—");



      /* ------------------------------
         4-5. PICKUP 展開
         ------------------------------ */

      const ul = document.getElementById("pickup");
      if (!ul) return;
      ul.innerHTML = "";

      let picks = [];

      // pickup が定義されている場合
      if (Array.isArray(rec.pickup) && rec.pickup.length) {
        const pickupArr = rec.pickup;

        // { row_index, tier, role } 形式 → tracks から引き直す
        if (!("artist" in pickupArr[0]) && tracks.length) {
          const map = new Map(tracks.map((t) => [t.row_index, t]));
          pickupArr.forEach((p) => {
            const base = map.get(p.row_index);
            if (!base) return;
            picks.push({ ...base, tier: p.tier, role: p.role });
          });
        } else {
          // すでに artist / title を持っている形式
          picks = pickupArr.slice();
        }
      }

      // original があればピックアップに追加（重複回避）
      if (rec.original?.artist && rec.original?.title) {
        const orig = rec.original;
        const origKey = `${orig.artist}___${orig.title}`.toLowerCase();
        if (!picks.some((p) => `${p.artist}___${p.title}`.toLowerCase() === origKey)) {
          picks.push(orig);
        }
      }

      // 年順ソート（数値あり優先）
      picks.sort((a, b) => {
        const ay = Number(a.year);
        const by = Number(b.year);
        const aOk = !isNaN(ay);
        const bOk = !isNaN(by);
        if (aOk && bOk) return ay - by;
        if (aOk) return -1;
        if (bOk) return 1;
        return 0;
      });

      // li を組み立て
      picks.forEach((p) => {
        let artist = cleanArtist(p.artist || "—");
        let title  = cleanTitle(p.title  || "—");
        let year   = p.year ? String(p.year).trim() : "";

        const li = document.createElement("li");
        li.className = "songRow";
        li.style.overflowX = "auto";
        li.style.webkitOverflowScrolling = "touch";

        const hasValid = (artist && artist !== "—") || (title && title !== "—");

        const yearHTML = year
          ? `<span class="songYear" aria-hidden="true"
               style="
                 user-select: none;
                 -webkit-user-select: none;
                 -moz-user-select: none;
                 -ms-user-select: none;
                 margin-left: 4px;
                 opacity: 0.85;
               "
             >(${year})</span>`
          : "";

        if (hasValid) {
          const queryStr = `${artist} ${title}`.trim();
          const a = document.createElement("a");
          a.className = "songLink";
          a.href =
            "https://www.youtube.com/results?search_query=" +
            encodeURIComponent(queryStr);
          a.target = "_blank";
          a.rel = "noopener";
          a.style.whiteSpace = "nowrap";

          a.innerHTML =
            `<span class="dot">・</span>` +
            `<span class="artist">${artist}</span>` +
            `<span class="sep"> - </span>` +
            `<span class="title">${title}</span>` +
            yearHTML;

          li.appendChild(a);
        } else {
          li.innerHTML =
            `<span class="dot">・</span>` +
            `<span class="artist">${artist}</span>` +
            `<span class="sep"> - </span>` +
            `<span class="title">${title}</span>` +
            yearHTML;
        }

        ul.appendChild(li);
      });

      // スマホ用タッチホバーを有効化
      setupTouchHoverForSongs();



      /* ------------------------------
         4-6. YouTube ボタン（riddim検索）
         ------------------------------ */

      const ytBtn = document.getElementById("ytRiddimBtn");
      if (ytBtn) {
        ytBtn.onclick = () => {
          const name =
            document.getElementById("riddimTitle")?.textContent?.trim() || "";
          if (!name) return;
          window.open(
            "https://www.youtube.com/results?search_query=" +
              encodeURIComponent(name + " riddim"),
            "_blank",
            "noopener"
          );
        };
      }



      /* ------------------------------
         4-7. PICKUP カード高さ調整
         ------------------------------ */

      function adjustPickupHeight() {
        try {
          const vh = window.innerHeight;
          if (!document.body.classList.contains("detailPage")) return;

          const masthead = document.querySelector(".masthead");
          const footer   = document.querySelector(".footerNote");
          const cards    = document.querySelectorAll(".detailPage .card.container");
          if (!masthead || !footer || cards.length < 2) return;

          const riddimCard  = cards[0];
          const pickupCard  = cards[1];
          const pickupHead  = pickupCard.querySelector(".cardHead");

          const usedTop =
            masthead.offsetTop +
            masthead.offsetHeight +
            riddimCard.offsetHeight +
            (pickupHead ? pickupHead.offsetHeight : 0);

          const usedBottom = footer.offsetHeight + 24;
          const max = Math.max(80, vh - usedTop - usedBottom);

          document.documentElement.style.setProperty(
            "--pickup-max-height",
            max + "px"
          );
        } catch {
          // ignore
        }
      }

      requestAnimationFrame(adjustPickupHeight);
      window.addEventListener("resize", adjustPickupHeight);



      /* ------------------------------
         4-8. 動的 JSON-LD を挿入
         ------------------------------ */

      function injectJsonLd(rec, displayName, baseLabel, baseYear, producer, akaArr) {
        const ld = {
          "@context": "https://schema.org",
          "@type": "CreativeWork",
          name: displayName,
          alternateName: akaArr.length ? akaArr : undefined,
          description: "RIDDIM INDEX のリディム詳細データ。",
          datePublished: baseYear || undefined,
          recordLabel: cleanLabel(baseLabel) || undefined,
          producer: producer || undefined,
          url: location.href,
          isPartOf: {
            "@type": "WebSite",
            name: "RIDDIM INDEX",
            url: "https://italisle.jp/",
          },
        };

        // 既存の動的 JSON-LD を削除
        document
          .querySelectorAll('script[data-dynamic-jsonld]')
          .forEach((el) => el.remove());

        const script = document.createElement("script");
        script.type = "application/ld+json";
        script.setAttribute("data-dynamic-jsonld", "1");
        script.textContent = JSON.stringify(ld);
        document.head.appendChild(script);
      }

      injectJsonLd(rec, displayName, baseLabel, baseYear, producer, akaArr);

    } catch (e) {
      console.error(e);
    }
  }



  /* ============================================================
   5. 実行（DOM 完了後に load を呼ぶ）
   ============================================================ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }

})();
