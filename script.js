(function () {
  "use strict";

  const TABLE = "public.webcontentmappingtoliferay";
  const $ = (id) => document.getElementById(id);
  const output = $("output");
  const status = $("status");

  // ---------- SQL helpers ----------
  const quote = (v) => "'" + String(v).replace(/'/g, "''") + "'";   // ' -> ''
  const isInt = (v) => /^\d+$/.test(String(v).trim());
  const filled = (v) => String(v).trim() !== "";
  const boolSql = (v) => (String(v).toLowerCase() === "true" ? "true" : "false");

  function dateSql(v) {
    const t = String(v).trim();
    if (!t) return "NULL";
    return t.toUpperCase() === "CURRENT_TIMESTAMP" ? "CURRENT_TIMESTAMP" : quote(t);
  }

  // ---------- generic editable grid ----------
  // cfg: head, body, storageKey, columns [{key, kind}], makeRow(), seed(), focusKey, onChange()
  function createGrid(cfg) {
    let rows = load();

    const headRow = document.createElement("tr");
    cfg.columns.forEach((c) => {
      const th = document.createElement("th");
      th.textContent = c.key;
      headRow.appendChild(th);
    });
    headRow.appendChild(document.createElement("th"));
    cfg.head.appendChild(headRow);

    function load() {
      try {
        const saved = JSON.parse(localStorage.getItem(cfg.storageKey));
        if (Array.isArray(saved) && saved.length) return saved.map((r) => Object.assign(cfg.makeRow(), r));
      } catch (e) { /* storage unavailable or corrupted: start fresh */ }
      return cfg.seed();
    }

    function save() {
      try { localStorage.setItem(cfg.storageKey, JSON.stringify(rows)); } catch (e) { /* ignore */ }
    }

    function render() {
      cfg.body.innerHTML = "";
      rows.forEach((row, i) => {
        const tr = document.createElement("tr");
        cfg.columns.forEach((c) => {
          const td = document.createElement("td");
          let el;
          if (c.kind === "bool" || c.kind === "boolOpt") {
            el = document.createElement("select");
            if (c.kind === "boolOpt") el.add(new Option("(no change)", ""));
            el.add(new Option("false", "false"));
            el.add(new Option("true", "true"));
          } else {
            el = document.createElement("input");
            if (c.kind === "type") el.setAttribute("list", "fieldTypes");
            if (c.kind === "int") el.inputMode = "numeric";
          }
          el.value = row[c.key];
          el.dataset.row = i;
          el.dataset.key = c.key;
          td.appendChild(el);
          tr.appendChild(td);
        });
        const tdDel = document.createElement("td");
        const del = document.createElement("button");
        del.type = "button";
        del.className = "del";
        del.textContent = "\u2715";
        del.title = "Delete row";
        del.dataset.del = i;
        tdDel.appendChild(del);
        tr.appendChild(tdDel);
        cfg.body.appendChild(tr);
      });
      cfg.onChange();
    }

    function onEdit(e) {
      const t = e.target;
      if (t.dataset.key === undefined) return;
      rows[Number(t.dataset.row)][t.dataset.key] = t.value;
      save();
      cfg.onChange();
    }
    cfg.body.addEventListener("input", onEdit);
    cfg.body.addEventListener("change", (e) => { if (e.target.tagName === "SELECT") onEdit(e); });

    cfg.body.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-del]");
      if (!btn) return;
      rows.splice(Number(btn.dataset.del), 1);
      save();
      render();
    });

    return {
      render,
      get rows() { return rows; },
      add() {
        rows.push(cfg.makeRow());
        save();
        render();
        const last = cfg.body.lastElementChild;
        if (last) last.querySelector('[data-key="' + cfg.focusKey + '"]').focus();
      },
      clear() {
        if (!rows.length || !confirm("Delete all rows?")) return;
        rows = [];
        save();
        render();
      },
      mark(i, key, bad) {
        const tr = cfg.body.children[i];
        const el = tr && tr.querySelector('[data-key="' + key + '"]');
        if (el) el.classList.toggle("invalid", bad);
      }
    };
  }

  // ---------- INSERT ----------
  const INSERT_COLUMNS = [
    { key: "structureid", kind: "int" }, { key: "sitetitle", kind: "text" },
    { key: "excelheadername", kind: "text" }, { key: "fieldname", kind: "text" },
    { key: "fieldtype", kind: "type" }, { key: "fieldreferencename", kind: "text" },
    { key: "ismandatory", kind: "bool" }, { key: "createddate", kind: "text" },
    { key: "modifieddate", kind: "text" }, { key: "siteid", kind: "int" }
  ];

  const insertGrid = createGrid({
    head: $("insertHead"), body: $("insertBody"), storageKey: "webcontentMappingRows",
    columns: INSERT_COLUMNS, focusKey: "excelheadername", onChange: refresh,
    makeRow: () => ({
      structureid: $("defStructure").value.trim(), sitetitle: $("defSiteTitle").value,
      excelheadername: "", fieldname: "", fieldtype: "Text", fieldreferencename: "",
      ismandatory: "false", createddate: "CURRENT_TIMESTAMP", modifieddate: "CURRENT_TIMESTAMP",
      siteid: $("defSite").value.trim()
    }),
    seed: () => [{
      structureid: "1435696", sitetitle: "Demo Migration", excelheadername: "Judul", fieldname: "Judul",
      fieldtype: "Text", fieldreferencename: "Text59512308", ismandatory: "false",
      createddate: "CURRENT_TIMESTAMP", modifieddate: "CURRENT_TIMESTAMP", siteid: "143718"
    }]
  });

  function runInsert() {
    const tuples = [];
    let invalid = 0;
    insertGrid.rows.forEach((r, i) => {
      const skip = !filled(r.structureid);
      const badStructure = !skip && !isInt(r.structureid);
      const badSite = !skip && !isInt(r.siteid);
      insertGrid.mark(i, "structureid", badStructure);
      insertGrid.mark(i, "siteid", badSite);
      if (skip) return;
      if (badStructure || badSite) { invalid++; return; }
      tuples.push("( " + [
        r.structureid.trim(), quote(r.sitetitle), quote(r.excelheadername), quote(r.fieldname),
        quote(r.fieldtype), quote(r.fieldreferencename), boolSql(r.ismandatory),
        dateSql(r.createddate), dateSql(r.modifieddate), r.siteid.trim()
      ].join(", ") + ")");
    });

    // One INSERT for all rows: a single row stays on one line, several rows get one tuple per line
    const header = "INSERT INTO " + TABLE + " ( " + INSERT_COLUMNS.map((c) => c.key).join(", ") + ") VALUES";
    let text = "";
    if (tuples.length === 1) text = header + " " + tuples[0] + ";";
    else if (tuples.length > 1) text = header + "\n" + tuples.join(",\n") + ";";

    return {
      text,
      warn: invalid > 0,
      status: tuples.length + " row(s) in one INSERT" +
        (invalid ? " \u2013 " + invalid + " row(s) skipped: structureid and siteid must be numbers" : "")
    };
  }

  // ---------- UPDATE ----------
  const UPDATE_COLUMNS = [
    { key: "id", kind: "int" }, { key: "structureid", kind: "int" }, { key: "sitetitle", kind: "text" },
    { key: "excelheadername", kind: "text" }, { key: "fieldname", kind: "text" },
    { key: "fieldtype", kind: "type" }, { key: "fieldreferencename", kind: "text" },
    { key: "ismandatory", kind: "boolOpt" }, { key: "modifieddate", kind: "text" },
    { key: "siteid", kind: "int" }
  ];
  const updateRow = () => ({
    id: "", structureid: "", sitetitle: "", excelheadername: "", fieldname: "", fieldtype: "",
    fieldreferencename: "", ismandatory: "", modifieddate: "CURRENT_TIMESTAMP", siteid: ""
  });

  const updateGrid = createGrid({
    head: $("updateHead"), body: $("updateBody"), storageKey: "webcontentMappingUpdateRows",
    columns: UPDATE_COLUMNS, focusKey: "id", onChange: refresh,
    makeRow: updateRow, seed: () => [updateRow()]
  });

  function runUpdate() {
    const statements = [];
    let invalid = 0;
    let nothingToChange = 0;

    updateGrid.rows.forEach((r, i) => {
      const skip = !filled(r.id);
      const bad = {
        id: !skip && !isInt(r.id),
        structureid: !skip && filled(r.structureid) && !isInt(r.structureid),
        siteid: !skip && filled(r.siteid) && !isInt(r.siteid)
      };
      Object.keys(bad).forEach((k) => updateGrid.mark(i, k, bad[k]));
      if (skip) return;
      if (bad.id || bad.structureid || bad.siteid) { invalid++; return; }

      const set = [];
      if (filled(r.structureid)) set.push("structureid = " + r.structureid.trim());
      ["sitetitle", "excelheadername", "fieldname", "fieldtype", "fieldreferencename"].forEach((k) => {
        if (r[k] !== "") set.push(k + " = " + quote(r[k]));
      });
      if (r.ismandatory) set.push("ismandatory = " + boolSql(r.ismandatory));
      const changed = set.length + (filled(r.siteid) ? 1 : 0);   // modifieddate alone is not a change
      if (filled(r.modifieddate)) set.push("modifieddate = " + dateSql(r.modifieddate));
      if (filled(r.siteid)) set.push("siteid = " + r.siteid.trim());

      if (changed === 0) { nothingToChange++; return; }
      statements.push("UPDATE " + TABLE + " SET " + set.join(", ") + " WHERE id = " + r.id.trim() + ";");
    });

    const notes = [];
    if (invalid) notes.push(invalid + " row(s) skipped: id, structureid and siteid must be numbers");
    if (nothingToChange) notes.push(nothingToChange + " row(s) skipped: no field to change");
    return {
      text: statements.join("\n"),
      warn: notes.length > 0,
      status: statements.length + " UPDATE statement(s)" + (notes.length ? " \u2013 " + notes.join("; ") : "")
    };
  }

  // ---------- DELETE ----------
  const DELETE_KEY = "webcontentMappingDeleteIds";
  try { $("deleteIds").value = localStorage.getItem(DELETE_KEY) || ""; } catch (e) { /* ignore */ }

  $("deleteIds").addEventListener("input", () => {
    try { localStorage.setItem(DELETE_KEY, $("deleteIds").value); } catch (e) { /* ignore */ }
    refresh();
  });

  function runDelete() {
    const tokens = $("deleteIds").value.split(/[\s,;]+/).filter(Boolean);
    const ids = [];
    let invalid = 0;
    tokens.forEach((t) => {
      if (!isInt(t)) { invalid++; return; }
      if (!ids.includes(t)) ids.push(t);
    });

    let text = "";
    if (ids.length === 1) text = "DELETE FROM " + TABLE + " WHERE id = " + ids[0] + ";";
    else if (ids.length > 1) text = "DELETE FROM " + TABLE + " WHERE id IN (" + ids.join(", ") + ");";

    return {
      text,
      warn: invalid > 0,
      status: ids.length + " id(s)" + (invalid ? " \u2013 " + invalid + " invalid value(s) ignored (ids must be numbers)" : "")
    };
  }

  // ---------- tabs + output ----------
  const MODES = {
    insert: { title: "INSERT", file: "webcontentmappingtoliferay-insert.sql", run: runInsert },
    update: { title: "UPDATE", file: "webcontentmappingtoliferay-update.sql", run: runUpdate },
    delete: { title: "DELETE", file: "webcontentmappingtoliferay-delete.sql", run: runDelete }
  };
  let active = "insert";

  function refresh() {
    const result = MODES[active].run();
    output.value = result.text;
    status.textContent = result.status;
    status.classList.toggle("warn", result.warn);
  }

  function setTab(name) {
    active = name;
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
    document.querySelectorAll(".tab-panel").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
    $("outputTitle").textContent = "Generated script (" + MODES[name].title + ")";
    refresh();
  }

  document.querySelector(".tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-tab]");
    if (btn) setTab(btn.dataset.tab);
  });

  $("addInsert").addEventListener("click", () => insertGrid.add());
  $("clearInsert").addEventListener("click", () => insertGrid.clear());
  $("addUpdate").addEventListener("click", () => updateGrid.add());
  $("clearUpdate").addEventListener("click", () => updateGrid.clear());

  // ---------- copy / download ----------
  $("copyAll").addEventListener("click", async () => {
    const btn = $("copyAll");
    if (!output.value) return;
    try {
      await navigator.clipboard.writeText(output.value);
    } catch (e) {
      output.select();
      document.execCommand("copy");
    }
    const old = btn.textContent;
    btn.textContent = "Copied!";
    setTimeout(() => { btn.textContent = old; }, 1200);
  });

  $("downloadSql").addEventListener("click", () => {
    if (!output.value) return;
    const blob = new Blob([output.value + "\n"], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = MODES[active].file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  });

  // ---------- start ----------
  insertGrid.render();
  updateGrid.render();
  setTab("insert");
})();
