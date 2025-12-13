// ranking.js
(() => {
  const metaEl = document.getElementById("rankingMeta");
  const barsEl = document.getElementById("rankingBars");

  const fail = (msg, err) => {
    console.error("[ranking] error", err);
    if (metaEl) metaEl.textContent = msg;
  };

  const url = window.SUPABASE_URL;
  const key = window.SUPABASE_ANON_KEY;

  if (!url || !key) {
    fail("Supabase 設定が見つかりません（SUPABASE_URL / ANON_KEY）");
    return;
  }

  const supabase = window.supabase.createClient(url, key);

  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  // 「リディム名」っぽいカラム優先（ここが一番大事）
  const NAME_COLS = [
    "riddim",
    "riddim_name",
    "riddimName",
    "name",
    "title",
    "riddim_title",
    "slug",
    "riddim_slug",
  ];

  // 逆に「絶対拾っちゃダメ」寄りの id 系
  const BAD_KEYS = new Set([
    "id",
    "user_id",
    "userid",
    "created_at",
    "updated_at",
  ]);

  const isBadKey = (k) => {
    if (!k) return true;
    if (BAD_KEYS.has(k)) return true;
    if (k.endsWith("_id")) return true;
    return false;
  };

  const pickNameField = (row) => {
    if (!row || typeof row !== "object") return null;

    // 1) 優先候補から存在するもの（ただし _id は避ける）
    for (const k of NAME_COLS) {
      if (k in row && !isBadKey(k)) return k;
    }

    // 2) 文字列カラムの中から「uuidっぽくない」ものを拾う
    for (const k of Object.keys(row)) {
      if (isBadKey(k)) continue;
      const v = row[k];
      if (typeof v === "string" && v.trim() && !UUID_RE.test(v.trim())) return k;
    }

    // 3) それでも無理なら、最後に「文字列カラムなら何でも」(uuidでも)
    for (const k of Object.keys(row)) {
      if (isBadKey(k)) continue;
      const v = row[k];
      if (typeof v === "string" && v.trim()) return k;
    }

    return null;
  };

  const render = (entries, totalRows) => {
    const maxCount = entries[0][1];
    if (metaEl) metaEl.textContent = `表示: ${entries.length}件（favorites総数: ${totalRows}）`;
    barsEl.innerHTML = "";

    entries.forEach(([name, count], i) => {
      const pct = maxCount ? (count / maxCount) * 100 : 0;

      const row = document.createElement("div");
      row.className = "rankBarRow";

      const rank = document.createElement("div");
      rank.className = "rankBarRank";
      rank.textContent = `#${i + 1}`;

      const link = document.createElement("a");
      link.className = "rankBarLink";
      link.href = `detail.html?riddim=${encodeURIComponent(name)}`;

      const label = document.createElement("div");
      label.className = "rankBarLabel";
      label.textContent = name;

      const track = document.createElement("div");
      track.className = "rankBarTrack";

      const fill = document.createElement("div");
      fill.className = "rankBarFill";
      fill.style.width = `${pct}%`;

      track.appendChild(fill);
      link.appendChild(label);
      link.appendChild(track);

      const c = document.createElement("div");
      c.className = "rankBarCount";
      c.innerHTML = `<span class="rankBarCountNum">${count}</span> ★`;

      row.appendChild(rank);
      row.appendChild(link);
      row.appendChild(c);

      barsEl.appendChild(row);
    });
  };

  // favorites が uuid しか無い場合の救済：riddims.json から ID→表示名を解決
  const resolveByRiddimsJson = async (idField) => {
    // ここはあなたのプロジェクトのパスに合わせて（同階層にある前提）
    const res = await fetch("riddims.json", { cache: "no-store" });
    if (!res.ok) throw new Error("riddims.json が読めません");

    const json = await res.json();
    const list = Array.isArray(json) ? json : (json?.riddims || []);
    if (!Array.isArray(list)) throw new Error("riddims.json の形式が想定外");

    // idっぽいキー候補
    const ID_KEYS = ["id", "riddim_id", "uuid", "key", "slug"];
    const NAME_KEYS = ["riddim", "name", "riddim_name", "title", "RIDDIM"];

    const map = new Map();
    for (const r of list) {
      if (!r || typeof r !== "object") continue;

      let rid = null;
      for (const k of ID_KEYS) {
        if (r[k]) { rid = String(r[k]); break; }
      }

      let nm = null;
      for (const k of NAME_KEYS) {
        if (r[k]) { nm = String(r[k]); break; }
      }

      if (rid && nm) map.set(rid, nm);
    }

    const { data, error } = await supabase.from("favorites").select(idField);
    if (error) throw error;

    const counts = new Map();
    for (const row of data) {
      const rid = String(row?.[idField] ?? "").trim();
      if (!rid) continue;
      const name = map.get(rid);
      if (!name) continue; // 解決できないのは表示しない（必要なら後で表示に変えられる）
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return { entries, total: data.length, resolved: true };
  };

  (async () => {
    if (metaEl) metaEl.textContent = "読み込み中...";

    // まず1件見てカラム構造を把握
    const { data: sample, error: sampleErr } = await supabase
      .from("favorites")
      .select("*")
      .limit(1);

    if (sampleErr) {
      fail(`Supabase 取得エラー: ${sampleErr.message || ""}`, sampleErr);
      return;
    }
    if (!sample?.length) {
      if (metaEl) metaEl.textContent = "データがありません（favorites が0件）";
      return;
    }

    console.log("[favorites sample]", sample[0]);

    // リディム名として使うカラムを選ぶ
    let nameField = pickNameField(sample[0]);

    // もし “nameField が無い / あるけど uuid っぽい” 場合は idField を推定して riddims.json で解決を試す
    if (!nameField) {
      fail("favorites にリディム名カラムが見つかりません。Consoleの [favorites sample] を見てください。");
      return;
    }

    // nameField の値が UUID っぽい (= 実質ID) なら、json解決ルートへ
    const v = String(sample[0][nameField] ?? "").trim();
    const looksLikeId = UUID_RE.test(v) || nameField.endsWith("_id") || nameField === "id";

    if (looksLikeId) {
      try {
        const { entries, total } = await resolveByRiddimsJson(nameField);
        if (!entries.length) {
          fail(
            "favorites はID( UUID )しか無さそうです。riddims.json でID→名前の解決に失敗しました。\nConsoleの [favorites sample] と riddims.json の中身（id/nameのキー）を確認してね。"
          );
          return;
        }
        render(entries, total);
        return;
      } catch (e) {
        fail(
          "favorites はID( UUID )しか無さそうです。riddims.json 参照での解決に失敗しました（Console参照）。",
          e
        );
        return;
      }
    }

    // 通常ルート（リディム名がそのまま入ってる）
    const { data, error } = await supabase.from("favorites").select(nameField);
    if (error) {
      fail(`Supabase 取得エラー: ${error.message || ""}`, error);
      return;
    }

    const counts = new Map();
    for (const row of data) {
      const name = String(row?.[nameField] ?? "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const entries = [...counts.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]);

    if (!entries.length) {
      if (metaEl) metaEl.textContent = "ランキング対象がありません";
      return;
    }

    render(entries, data.length);
  })();
})();
