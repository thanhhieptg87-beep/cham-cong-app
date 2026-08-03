/* ============ STATE ============ */
const DEFAULT_LEGEND = [
  { sym: "X", label: "Công đủ 1 ngày", cong: 1 },
  { sym: "P", label: "Phép", cong: 1 },
  { sym: "C", label: "Ca khác / nghỉ có phép", cong: 0.5 },
  { sym: "NC", label: "Nghỉ chờ việc / nghỉ có lương", cong: 0 },
  { sym: "O", label: "Nghỉ không phép", cong: 0 },
];
const DEFAULT_SETTINGS = {
  legend: DEFAULT_LEGEND,
  stdHoursPerDay: 8,
  numberRule: "ot", // "ot" = số ghi trong ô là giờ tăng ca ; "hours" = số ghi trong ô là tổng giờ làm ngày hôm đó
};

let state = {
  screen: "home",
  files: [],            // {name, dataUrl, base64, mediaType}
  pages: [],            // extracted pages [{boPhan, thang, nam, employees:[...]}]
  activePage: 0,
  settings: null,
  history: [],
  stats: { scannedToday: 0, employeesSeen: 0, exportsCount: 0 },
  loadingMsg: "",
  errorMsg: "",
};

const $app = document.getElementById("app");

function toast(msg, ms = 2600) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function esc(s) {
  if (s === null || s === undefined) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============ PERSISTENCE ============ */
async function loadInitial() {
  try {
    const s = await window.storage.get("settings");
    state.settings = s ? JSON.parse(s.value) : JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  } catch (e) {
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  }
  try {
    const st = await window.storage.get("stats");
    state.stats = st ? JSON.parse(st.value) : state.stats;
  } catch (e) {}
  await refreshHistoryList();
  render();
}

async function saveSettings() {
  try { await window.storage.set("settings", JSON.stringify(state.settings)); } catch (e) {}
}
async function saveStats() {
  try { await window.storage.set("stats", JSON.stringify(state.stats)); } catch (e) {}
}
async function refreshHistoryList() {
  try {
    const res = await window.storage.list("history:");
    if (!res || !res.keys) { state.history = []; return; }
    const items = [];
    for (const k of res.keys) {
      try {
        const r = await window.storage.get(k);
        if (r) items.push(JSON.parse(r.value));
      } catch (e) {}
    }
    items.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    state.history = items;
  } catch (e) { state.history = []; }
}
async function saveToHistory(record) {
  try { await window.storage.set("history:" + record.id, JSON.stringify(record)); } catch (e) {}
}
async function deleteHistory(id) {
  try { await window.storage.delete("history:" + id); } catch (e) {}
  await refreshHistoryList();
  render();
}

/* ============ HELPERS: attendance parsing ============ */
// cell code format examples: "X", "X3.5", "P", "NC", "C", "5.83", "", "-"
function parseCell(code) {
  if (!code) return { symbol: "", num: null };
  code = String(code).trim();
  if (code === "" || code === "-") return { symbol: "", num: null };
  const m = code.match(/^([A-Za-zÀ-ỹ]*)\s*(-?\d+(?:[.,]\d+)?)?$/);
  if (!m) return { symbol: code, num: null };
  const symbol = (m[1] || "").toUpperCase();
  const num = m[2] ? parseFloat(m[2].replace(",", ".")) : null;
  return { symbol, num };
}

function legendFor(settings, symbol) {
  return settings.legend.find((l) => l.sym.toUpperCase() === symbol.toUpperCase());
}

function computeRow(settings, days) {
  let cong = 0, tangCa = 0;
  const dayKeys = Object.keys(days || {});
  for (const k of dayKeys) {
    const { symbol, num } = parseCell(days[k]);
    if (symbol) {
      const leg = legendFor(settings, symbol);
      if (leg) cong += Number(leg.cong) || 0;
    }
    if (num !== null && !isNaN(num)) {
      if (settings.numberRule === "ot") {
        tangCa += num;
        if (!symbol) cong += 1; // number alone implies a worked day
      } else {
        // number = total hours worked that day
        const std = Number(settings.stdHoursPerDay) || 8;
        if (num > std) tangCa += (num - std);
        cong += Math.min(1, num / std);
      }
    }
  }
  return { cong: Math.round(cong * 100) / 100, tangCa: Math.round(tangCa * 100) / 100 };
}

function daysInMonth(thang, nam) {
  const m = parseInt(thang, 10), y = parseInt(nam, 10);
  if (!m || !y) return 31;
  const d = new Date(y, m, 0).getDate();
  return d || 31;
}

/* ============ FILE HANDLING ============ */
function fileToResizedBase64(file, maxDim = 1600, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function pdfToImages(file) {
  const buf = await file.arrayBuffer();
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const out = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width; canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    out.push({ name: file.name + " (trang " + i + ")", dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
  }
  return out;
}

async function handleFiles(fileList) {
  const arr = Array.from(fileList);
  for (const f of arr) {
    try {
      if (f.type === "application/pdf") {
        const imgs = await pdfToImages(f);
        state.files.push(...imgs);
      } else {
        const r = await fileToResizedBase64(f);
        state.files.push({ name: f.name, ...r });
      }
    } catch (e) { console.error(e); }
  }
  render();
}

/* ============ AI VISION EXTRACTION ============ */
// NOTE: the AI proxy available inside this artifact only accepts small responses,
// so we NEVER ask for the whole table (names + 31 days x many employees) in one call.
// Instead: 1) read the roster (names only, tiny output), 2) read attendance codes in
// small batches of employees per call. This keeps every response short and reliable.
const BATCH_SIZE = 8;

async function callClaude(system, content, maxTokens) {
  let response;
  try {
    response = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        max_tokens: maxTokens || 2000,
        system,
        messages: [{ role: "user", content }],
      }),
    });
  } catch (e) {
    throw new Error("Không kết nối được tới máy chủ. Kiểm tra kết nối mạng và thử lại. Chi tiết: " + (e && e.message ? e.message : String(e)));
  }
  let rawResp;
  try { rawResp = await response.text(); } catch (e) { throw new Error("Không đọc được phản hồi từ máy chủ."); }
  let data;
  try {
    data = JSON.parse(rawResp);
  } catch (e) {
    const snippet = rawResp.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(
      `Máy chủ trả về dữ liệu không phải JSON (mã ${response.status}). ` +
      (snippet ? `Nội dung nhận được: "${snippet}${rawResp.length > 160 ? "..." : ""}"` : "Phản hồi rỗng.") +
      " Có thể do máy chủ Render bị treo/khởi động lại — thử đợi chút rồi quét lại."
    );
  }
  if (data.error) throw new Error(data.error.message || "Lỗi gọi AI");
  const textBlock = (data.content || []).find((b) => b.type === "text");
  if (!textBlock) {
    if (data.stop_reason === "max_tokens") {
      throw new Error("AI bị cắt giữa chừng do hết token trước khi trả lời xong (thường vì ảnh khó đọc). Thử chụp ảnh rõ nét hơn hoặc chia nhỏ ảnh rồi quét lại.");
    }
    if (data.stop_reason === "refusal") {
      throw new Error("AI từ chối đọc ảnh này. Thử chụp lại ảnh khác hoặc rõ nét hơn.");
    }
    throw new Error("AI không trả về nội dung văn bản (stop_reason: " + (data.stop_reason || "không rõ") + ").");
  }
  let raw = textBlock.text.trim();
  raw = raw.replace(/^```json/i, "").replace(/^```/, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(raw);
  } catch (e) {
    const extracted = extractFirstJsonBlock(raw);
    if (extracted) {
      try { return JSON.parse(extracted); } catch (e2) { /* rơi xuống dưới */ }
    }
    throw new Error("Không đọc được kết quả AI trả về (định dạng không hợp lệ, có thể do ảnh khó đọc). Thử quét lại.");
  }
}

// Tìm khối JSON { } hoặc [ ] ĐẦU TIÊN, tính đúng độ sâu ngoặc và bỏ qua ngoặc nằm trong chuỗi text,
// để không bị lẫn nếu AI lỡ viết thêm chữ (có dấu ngoặc) sau đoạn JSON.
function extractFirstJsonBlock(raw) {
  const objStart = raw.indexOf("{");
  const arrStart = raw.indexOf("[");
  let start = -1, openCh, closeCh;
  if (objStart === -1 && arrStart === -1) return null;
  if (arrStart === -1 || (objStart !== -1 && objStart < arrStart)) { start = objStart; openCh = "{"; closeCh = "}"; }
  else { start = arrStart; openCh = "["; closeCh = "]"; }

  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < raw.length; i++) {
    const c = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh) {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

function imgBlock(img) {
  return { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } };
}

// Phase 1: read roster only (names/MSNV/notes) - tiny output.
async function extractRoster(img) {
  const system = `Bạn đọc ẢNH một BẢNG CHẤM CÔNG viết tay của nhà máy Việt Nam. Ảnh có thể bị xoay bất kỳ hướng nào - tự xác định hướng đúng bằng cách tìm hàng tiêu đề "STT/Họ/Tên/MSNV" và dãy số ngày 1..31.
CHỈ đọc phần DANH SÁCH NHÂN VIÊN (KHÔNG đọc dữ liệu chấm công từng ngày). Nếu ảnh có nhiều bộ phận/tổ khác nhau, tách thành nhiều phần tử "pages".
Trả lời DUY NHẤT JSON hợp lệ, không markdown, không thêm bất kỳ chữ, ghi chú hay giải thích nào trước hoặc sau JSON, theo schema:
{"pages":[{"boPhan":"...","thang":"07","nam":"2026","employees":[{"stt":"1","ho":"...","ten":"...","msnv":"...","ghiChu":"..."}]}]}
Giữ đúng thứ tự nhân viên từ trên xuống dưới như trong ảnh.`;
  const content = [imgBlock(img), { type: "text", text: "Đọc danh sách nhân viên trong bảng chấm công này." }];
  const parsed = await callClaude(system, content, 2000);
  return parsed.pages || [];
}

// Phase 2: read day-by-day codes for a small batch of employees (by position).
async function extractDaysBatch(img, page, batchEmployees, nDays) {
  const list = batchEmployees.map((e, i) => `${i + 1}. ${e.ho || ""} ${e.ten || ""} (MSNV ${e.msnv || "?"})`).join("\n");
  const system = `Bạn đọc ẢNH bảng chấm công viết tay (bộ phận: ${page.boPhan || "?"}, tháng ${page.thang || "?"}/${page.nam || "?"}). Ảnh có thể xoay bất kỳ hướng nào.
Chỉ đọc dữ liệu chấm công của ĐÚNG ${batchEmployees.length} nhân viên sau, theo ĐÚNG thứ tự liệt kê (đây là thứ tự các dòng liên tiếp trong bảng):
${list}
Với mỗi ngày từ 1 đến ${nDays}, mã hoá ô thành chuỗi ngắn:
- Ký hiệu chữ không kèm số (X, P, C, NC, O...) => chính ký hiệu đó, in hoa. VD "X".
- Ký hiệu chữ kèm số viết thêm (thường mực đỏ = giờ tăng ca) => nối liền, VD "X3.5".
- Chỉ có số, không có chữ => chính số đó, VD "5.83".
- Ô trống / cột gạch chéo (thường Chủ nhật) / không rõ => chuỗi rỗng "".
Trả lời DUY NHẤT JSON hợp lệ, không markdown, không thêm bất kỳ chữ, ghi chú hay giải thích nào trước hoặc sau JSON, theo đúng thứ tự đã liệt kê ở trên:
{"employees":[{"days":{"1":"X","2":"","3":"X3.5", ... đến "${nDays}"}}]}`;
  const content = [imgBlock(img), { type: "text", text: "Đọc dữ liệu chấm công theo đúng thứ tự nhân viên đã nêu." }];
  const parsed = await callClaude(system, content, 2500);
  return parsed.employees || [];
}

async function scanAllImages(imageBlocks, onProgress) {
  const allPages = [];
  const warnings = [];
  for (let i = 0; i < imageBlocks.length; i++) {
    const img = imageBlocks[i];
    onProgress(`Đang đọc danh sách nhân viên (ảnh ${i + 1}/${imageBlocks.length})...`);
    const rosterPages = await extractRoster(img);
    for (const page of rosterPages) {
      const emps = page.employees || [];
      const nDays = daysInMonth(page.thang, page.nam);

      // Cảnh báo nếu STT bị nhảy cóc (dấu hiệu ảnh nghiêng làm AI đọc sót dòng)
      const sttNums = emps.map((e) => parseInt(e.stt, 10)).filter((n) => !isNaN(n));
      for (let k = 1; k < sttNums.length; k++) {
        if (sttNums[k] - sttNums[k - 1] > 1) {
          warnings.push(`"${page.boPhan || "bảng " + (i + 1)}": có thể thiếu nhân viên STT ${sttNums[k - 1] + 1}-${sttNums[k] - 1} (ảnh bị nghiêng nên AI đọc sót dòng). Kiểm tra lại và chụp ảnh thẳng hơn nếu cần.`);
        }
      }

      for (let b = 0; b < emps.length; b += BATCH_SIZE) {
        const batch = emps.slice(b, b + BATCH_SIZE);
        onProgress(`Đang đọc chấm công "${page.boPhan || "bảng " + (i + 1)}" - nhân viên ${b + 1}-${Math.min(b + BATCH_SIZE, emps.length)}/${emps.length}...`);
        let daysRes = await extractDaysBatch(img, page, batch, nDays);
        if (daysRes.length !== batch.length) {
          // Số người AI trả về không khớp số người yêu cầu -> dữ liệu chắc chắn bị lệch hàng nếu cứ gán thẳng.
          // Thử lại 1 lần với batch nhỏ hơn (4 người) để AI dễ bám đúng dòng hơn trên ảnh nghiêng.
          const half = Math.ceil(batch.length / 2);
          const sub1 = batch.slice(0, half), sub2 = batch.slice(half);
          const r1 = await extractDaysBatch(img, page, sub1, nDays);
          const r2 = sub2.length ? await extractDaysBatch(img, page, sub2, nDays) : [];
          daysRes = r1.concat(r2);
        }
        if (daysRes.length !== batch.length) {
          warnings.push(`"${page.boPhan || "bảng " + (i + 1)}": nhân viên ${b + 1}-${Math.min(b + BATCH_SIZE, emps.length)} có thể bị đọc lệch hàng do ảnh nghiêng. Vui lòng kiểm tra kỹ phần này, hoặc chụp lại ảnh thẳng hơn rồi quét lại riêng phần đó.`);
        }
        daysRes.forEach((r, k) => { if (batch[k]) batch[k].days = r.days || {}; });
      }
      allPages.push(page);
    }
  }
  return { pages: allPages, warnings };
}

async function runScan() {
  if (state.files.length === 0) { toast("Vui lòng chọn hoặc chụp ảnh bảng chấm công trước."); return; }
  state.screen = "processing";
  state.loadingMsg = "Đang chuẩn bị...";
  state.errorMsg = "";
  render();
  try {
    const { pages, warnings } = await scanAllImages(state.files, (msg) => { state.loadingMsg = msg; render(); });
    if (!pages.length) throw new Error("Không nhận diện được bảng chấm công nào trong ảnh.");
    state.pages = pages;
    state.activePage = 0;
    state.screen = "review";
    const empCount = pages.reduce((a, p) => a + (p.employees ? p.employees.length : 0), 0);
    state.stats.scannedToday = (state.stats.scannedToday || 0) + state.files.length;
    state.stats.employeesSeen = (state.stats.employeesSeen || 0) + empCount;
    await saveStats();
    render();
    if (warnings.length) {
      state.errorMsg = "⚠ " + warnings.join(" | ");
      render();
      toast(`Đã quét xong nhưng có ${warnings.length} chỗ nghi ngờ đọc sai — xem chi tiết ở trên, nên kiểm tra kỹ trước khi xuất file.`, 6000);
    } else {
      toast(`Đã quét xong ${pages.length} bảng, ${empCount} nhân viên.`);
    }
  } catch (e) {
    console.error(e);
    state.errorMsg = e.message || "Có lỗi xảy ra khi quét ảnh.";
    state.screen = "capture";
    render();
    toast("Lỗi: " + state.errorMsg, 4000);
  }
}

/* ============ EXPORT TO EXCEL (matches original template layout) ============ */
function isSundayCol(thang, nam, day) {
  const m = parseInt(thang, 10), y = parseInt(nam, 10);
  if (!m || !y) return false;
  return new Date(y, m - 1, day).getDay() === 0;
}

const THIN_BORDER = {
  top: { style: "thin", color: { argb: "FFB9C9F0" } },
  left: { style: "thin", color: { argb: "FFB9C9F0" } },
  bottom: { style: "thin", color: { argb: "FFB9C9F0" } },
  right: { style: "thin", color: { argb: "FFB9C9F0" } },
};
const FILL_SUNDAY = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD6D9E0" } }; // xám
const FILL_HEADER = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAF1FF" } };
const FILL_TITLE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6FA" } };

function styleCell(cell, { bold, fill, align = "center", size, italic, color } = {}) {
  cell.border = THIN_BORDER;
  cell.alignment = { horizontal: align, vertical: "middle", wrapText: true };
  cell.font = { bold: !!bold, italic: !!italic, size: size || 11, color: color ? { argb: color } : undefined };
  if (fill) cell.fill = fill;
}

function buildWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Cham cong AI";
  const summaryRows = [["Bộ phận", "STT", "Họ", "Tên", "MSNV", "Ghi chú", "Số ngày công", "Giờ tăng ca"]];

  state.pages.forEach((page, idx) => {
    const nDays = daysInMonth(page.thang, page.nam);
    const firstDayCol = 5; // A STT,B Họ,C Tên,D MSNV, E = ngày 1...
    const lastDayCol = firstDayCol + nDays - 1;
    const ghiChuCol = lastDayCol + 1;
    const soCongCol = lastDayCol + 2;
    const tcaCol = lastDayCol + 3;

    const sheetName = (page.boPhan || `Bang${idx + 1}`).substring(0, 28).replace(/[\\/*?:\[\]]/g, "");
    const ws = wb.addWorksheet(sheetName || `Bang${idx + 1}`);

    // Tiêu đề
    ws.mergeCells(1, 1, 1, tcaCol);
    styleCell(ws.getCell(1, 1), { bold: true, size: 13, fill: FILL_TITLE });
    ws.getCell(1, 1).value = `BẢNG CHẤM CÔNG THÁNG ${page.thang || ""} NĂM ${page.nam || ""}`;

    ws.mergeCells(2, 1, 2, tcaCol);
    styleCell(ws.getCell(2, 1), { bold: true, fill: FILL_TITLE });
    ws.getCell(2, 1).value = `BỘ PHẬN: ${page.boPhan || ""}`;

    // Hàng tiêu đề cột
    const headerRow = 3;
    const headers = ["STT", "Họ", "Tên", "MSNV"];
    for (let d = 1; d <= nDays; d++) headers.push(d);
    headers.push("GHI CHÚ", "SỐ CÔNG", "T.CA");
    headers.forEach((h, i) => {
      const cell = ws.getCell(headerRow, i + 1);
      cell.value = h;
      styleCell(cell, { bold: true, fill: FILL_HEADER });
    });
    for (let d = 1; d <= nDays; d++) {
      if (isSundayCol(page.thang, page.nam, d)) ws.getCell(headerRow, firstDayCol + d - 1).fill = FILL_SUNDAY;
    }

    let r = headerRow + 1;
    (page.employees || []).forEach((emp) => {
      const symRow = r, otRow = r + 1;
      const rr = computeRow(state.settings, emp.days || {});
      const cong = rr.cong, tangCa = rr.tangCa;

      // Cột tĩnh: gộp ô theo chiều dọc giữa dòng ký hiệu + dòng giờ tăng ca
      [[1, emp.stt || "", "center"], [2, emp.ho || "", "left"], [3, emp.ten || "", "left"], [4, emp.msnv || "", "center"], [ghiChuCol, emp.ghiChu || "", "left"]]
        .forEach(([col, val, align]) => {
          ws.mergeCells(symRow, col, otRow, col);
          const cell = ws.getCell(symRow, col);
          cell.value = val;
          styleCell(cell, { align });
          ws.getCell(otRow, col).border = THIN_BORDER;
        });

      // SỐ CÔNG (dòng ký hiệu) và T.CA = tổng giờ tăng ca (dòng phụ, có công thức)
      const congCell = ws.getCell(symRow, soCongCol);
      congCell.value = cong;
      styleCell(congCell, { bold: true });
      ws.getCell(otRow, soCongCol).border = THIN_BORDER;

      const startRef = ws.getCell(otRow, firstDayCol).address;
      const endRef = ws.getCell(otRow, lastDayCol).address;
      const tcaCell = ws.getCell(otRow, tcaCol);
      tcaCell.value = { formula: `SUM(${startRef}:${endRef})` };
      styleCell(tcaCell, { bold: true });
      ws.getCell(symRow, tcaCol).border = THIN_BORDER;

      // Các cột ngày 1..N
      for (let d = 1; d <= nDays; d++) {
        const code = (emp.days && emp.days[String(d)]) || "";
        const { symbol, num } = parseCell(code);
        const col = firstDayCol + d - 1;
        const sunday = isSundayCol(page.thang, page.nam, d);
        const symCell = ws.getCell(symRow, col);
        const otCell = ws.getCell(otRow, col);
        if (symbol && num !== null) { symCell.value = symbol; otCell.value = num; }
        else if (symbol) { symCell.value = symbol; otCell.value = ""; }
        else if (num !== null) { symCell.value = ""; otCell.value = num; }
        else { symCell.value = ""; otCell.value = ""; }
        styleCell(symCell, { fill: sunday ? FILL_SUNDAY : null });
        styleCell(otCell, { fill: sunday ? FILL_SUNDAY : null, italic: true, size: 9, color: "FFB45309" });
      }

      summaryRows.push([page.boPhan || "", emp.stt || "", emp.ho || "", emp.ten || "", emp.msnv || "", emp.ghiChu || "", cong, tangCa]);
      r += 2;
    });

    ws.getColumn(1).width = 5;
    ws.getColumn(2).width = 14;
    ws.getColumn(3).width = 10;
    ws.getColumn(4).width = 9;
    for (let d = 0; d < nDays; d++) ws.getColumn(firstDayCol + d).width = 4.3;
    ws.getColumn(ghiChuCol).width = 10;
    ws.getColumn(soCongCol).width = 9;
    ws.getColumn(tcaCol).width = 7;
    ws.views = [{ state: "frozen", ySplit: headerRow, xSplit: 4 }];
  });

  const wsSum = wb.addWorksheet("Tong hop");
  summaryRows.forEach((row, ri) => {
    row.forEach((val, ci) => {
      const cell = wsSum.getCell(ri + 1, ci + 1);
      cell.value = val;
      styleCell(cell, { bold: ri === 0, fill: ri === 0 ? FILL_HEADER : null, align: ci === 2 || ci === 3 ? "left" : "center" });
    });
  });
  wsSum.columns = [{ width: 16 }, { width: 6 }, { width: 14 }, { width: 10 }, { width: 9 }, { width: 10 }, { width: 12 }, { width: 12 }];
  wsSum.views = [{ state: "frozen", ySplit: 1 }];

  return wb;
}

async function exportExcel() {
  try {
    const wb = buildWorkbook();
    const first = state.pages[0] || {};
    const fname = `bang_cham_cong_T${first.thang || ""}_${first.nam || ""}.xlsx`;
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    state.stats.exportsCount = (state.stats.exportsCount || 0) + 1;
    await saveStats();
    render();
    toast("Đã xuất file Excel: " + fname);
  } catch (e) {
    console.error(e);
    toast("Lỗi khi xuất Excel: " + e.message, 4000);
  }
}

async function saveCurrentToHistory() {
  const first = state.pages[0] || {};
  const record = {
    id: "h" + Date.now(),
    savedAt: new Date().toISOString(),
    thang: first.thang || "",
    nam: first.nam || "",
    pages: state.pages,
  };
  await saveToHistory(record);
  await refreshHistoryList();
  toast("Đã lưu vào lịch sử.");
  render();
}

/* ============ RENDER ============ */
function render() {
  let html = "";
  if (state.screen === "home") html = renderHome();
  else if (state.screen === "capture") html = renderCapture();
  else if (state.screen === "processing") html = renderProcessing();
  else if (state.screen === "review") html = renderReview();
  else if (state.screen === "settings") html = renderSettings();
  else if (state.screen === "history") html = renderHistory();
  $app.innerHTML = html;
}

function topBar(title, back) {
  return `<div class="topbar">
    ${back ? `<button class="iconbtn" onclick="goHome()">‹</button>` : `<span style="width:34px"></span>`}
    <div class="title">${esc(title)}</div>
    <button class="iconbtn" onclick="goScreen('settings')">⚙</button>
  </div>`;
}

function goHome() { state.screen = "home"; render(); }
function goScreen(s) { state.screen = s; render(); }

function renderHome() {
  const s = state.stats;
  return `
  ${topBar("CHẤM CÔNG AI", false)}
  <div class="content">
    <div class="hero">
      <div class="brand">CHẤM CÔNG</div>
      <div class="app-name">Ứng dụng chấm công AI</div>
      <div class="tag">Quét bảng công viết tay → Excel tự động</div>
      <div class="badge">✨ Powered by AI</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="num" style="color:var(--blue-700)">${s.scannedToday || 0}</div><div class="lbl">Bảng đã quét</div></div>
      <div class="stat"><div class="num" style="color:var(--green)">${s.employeesSeen || 0}</div><div class="lbl">Nhân viên đã nhận diện</div></div>
      <div class="stat"><div class="num" style="color:var(--orange-d)">${s.exportsCount || 0}</div><div class="lbl">File Excel đã xuất</div></div>
    </div>

    <button class="actionbtn bg-blue" onclick="openCapture('camera')">
      <div class="ic">📷</div>
      <div class="tx"><div class="h">Chụp bảng chấm công</div><div class="s">Dùng camera để chụp trực tiếp</div></div>
      <div class="chev">›</div>
    </button>
    <button class="actionbtn bg-green" onclick="openCapture('gallery')">
      <div class="ic">🖼️</div>
      <div class="tx"><div class="h">Chọn ảnh</div><div class="s">Chọn 1 hoặc nhiều ảnh từ thư viện</div></div>
      <div class="chev">›</div>
    </button>
    <button class="actionbtn bg-red" onclick="openCapture('pdf')">
      <div class="ic">📄</div>
      <div class="tx"><div class="h">Chọn PDF</div><div class="s">Chọn file PDF bảng chấm công</div></div>
      <div class="chev">›</div>
    </button>
    <button class="actionbtn bg-orange" onclick="goScreen('history')">
      <div class="ic">🕘</div>
      <div class="tx"><div class="h">Lịch sử</div><div class="s">Xem lại các bảng đã quét</div></div>
      <div class="chev">›</div>
    </button>
    <button class="actionbtn bg-purple" onclick="goScreen('settings')">
      <div class="ic">⚙️</div>
      <div class="tx"><div class="h">Cài đặt</div><div class="s">Ký hiệu chấm công &amp; quy tắc tính giờ</div></div>
      <div class="chev">›</div>
    </button>
    <button class="btn btn-outline btn-block" onclick="testConnection()">🔧 Kiểm tra kết nối AI</button>
    <div class="footer-note">Phiên bản 1.0.0 · Dữ liệu lưu riêng trên thiết bị của bạn</div>
  </div>`;
}

let pendingCaptureMode = "gallery";
function openCapture(mode) {
  pendingCaptureMode = mode;
  state.screen = "capture";
  render();
}

function renderCapture() {
  const thumbs = state.files.map((f, i) => `
    <div class="thumb"><img src="${f.dataUrl}"><button class="rm" onclick="removeFile(${i})">✕</button></div>
  `).join("");
  return `
  ${topBar("Chụp / Chọn ảnh", true)}
  <div class="content">
    ${state.errorMsg ? `<div class="card" style="border:1px solid #f3c7c7;background:#fff6f6"><div class="muted" style="color:var(--red)">${esc(state.errorMsg)}</div></div>` : ""}
    <div class="card">
      <h3>Ảnh bảng chấm công</h3>
      <div class="dropzone" onclick="document.getElementById('fileInput').click()">
        <div class="ic">📎</div>
        <div class="t">Nhấn để chụp ảnh hoặc chọn ảnh/PDF</div>
        <div class="s">Có thể chọn nhiều ảnh cùng lúc (mỗi ảnh 1 bảng/tổ)</div>
      </div>
      <input type="file" id="fileInput" accept="image/*,application/pdf" multiple style="display:none" onchange="handleFiles(this.files)">
      ${thumbs ? `<div class="thumbs">${thumbs}</div>` : ""}
    </div>
    ${state.files.length ? `
    <button class="btn btn-primary btn-block" onclick="runScan()">✨ Quét bằng AI (${state.files.length} ảnh)</button>
    <div class="footer-note">AI sẽ đọc từng ô chấm công. Bạn nên kiểm tra lại kết quả trước khi xuất file, vì chữ viết tay đôi khi khó đọc chính xác 100%.</div>
    ` : ""}
  </div>`;
}

function removeFile(i) { state.files.splice(i, 1); render(); }

function renderProcessing() {
  return `
  ${topBar("Đang xử lý", false)}
  <div class="content">
    <div class="proc-wrap">
      <div class="spinner"></div>
      <div class="msg">${esc(state.loadingMsg || "Đang quét bảng chấm công bằng AI...")}</div>
      <div class="sub">${state.files.length} ảnh · vui lòng đợi, có thể mất khoảng 1-2 phút</div>
    </div>
  </div>`;
}

/* ============ REVIEW SCREEN ============ */
function renderReview() {
  if (!state.pages.length) {
    return `${topBar("Kết quả", true)}<div class="content"><div class="empty"><div class="ic">📭</div><div>Chưa có dữ liệu. Hãy quét một bảng chấm công.</div></div></div>`;
  }
  const warnBanner = state.errorMsg ? `<div class="card" style="border:1px solid #f6d38a;background:#fffaf0"><div class="muted" style="color:#92610c">${esc(state.errorMsg)}</div></div>` : "";
  const tabs = state.pages.map((p, i) => `<button class="${i === state.activePage ? "active" : ""}" onclick="switchPage(${i})">${esc(p.boPhan || "Bảng " + (i + 1))}</button>`).join("");
  const page = state.pages[state.activePage];
  const nDays = daysInMonth(page.thang, page.nam);
  const pIdx = state.activePage;

  let dayHeaders = "";
  for (let d = 1; d <= nDays; d++) dayHeaders += `<th>${d}</th>`;

  const rows = (page.employees || []).map((emp, eIdx) => {
    let dayCells = "";
    for (let d = 1; d <= nDays; d++) {
      const val = (emp.days && emp.days[String(d)]) || "";
      dayCells += `<td><input class="cell" value="${esc(val)}" oninput="updateDay(${pIdx},${eIdx},${d},this.value)"></td>`;
    }
    const r = computeRow(state.settings, emp.days || {});
    return `<tr>
      <td><input class="txt" style="width:26px" value="${esc(emp.stt || "")}" oninput="updateEmp(${pIdx},${eIdx},'stt',this.value)"></td>
      <td class="name"><input class="txt" value="${esc(emp.ho || "")}" oninput="updateEmp(${pIdx},${eIdx},'ho',this.value)"><br><input class="txt" value="${esc(emp.ten || "")}" oninput="updateEmp(${pIdx},${eIdx},'ten',this.value)"></td>
      <td class="msnv"><input class="txt small" value="${esc(emp.msnv || "")}" oninput="updateEmp(${pIdx},${eIdx},'msnv',this.value)"></td>
      ${dayCells}
      <td><input class="txt small" value="${esc(emp.ghiChu || "")}" oninput="updateEmp(${pIdx},${eIdx},'ghiChu',this.value)"></td>
      <td class="tot" id="cong-${pIdx}-${eIdx}">${r.cong}</td>
      <td class="tot2" id="ot-${pIdx}-${eIdx}">${r.tangCa}</td>
      <td><button class="del" style="border:none;background:#fdeaea;color:var(--red);width:24px;height:24px;border-radius:6px;cursor:pointer;font-size:11px" onclick="removeEmp(${pIdx},${eIdx})">✕</button></td>
    </tr>`;
  }).join("");

  let totalCong = 0, totalOT = 0;
  (page.employees || []).forEach((emp) => { const r = computeRow(state.settings, emp.days || {}); totalCong += r.cong; totalOT += r.tangCa; });

  return `
  ${topBar("Kết quả quét", true)}
  <div class="content">
    ${warnBanner}
    <div class="pagepick">${tabs}</div>
    <div class="card">
      <div class="row-gap" style="margin-bottom:8px">
        <div><label class="field-lbl">Bộ phận</label><input class="txtfield" value="${esc(page.boPhan || "")}" oninput="updatePageMeta(${pIdx},'boPhan',this.value)"></div>
      </div>
      <div class="row-gap">
        <div><label class="field-lbl">Tháng</label><input class="txtfield" value="${esc(page.thang || "")}" oninput="updatePageMeta(${pIdx},'thang',this.value)"></div>
        <div><label class="field-lbl">Năm</label><input class="txtfield" value="${esc(page.nam || "")}" oninput="updatePageMeta(${pIdx},'nam',this.value)"></div>
      </div>
    </div>

    <div class="card" style="display:flex;gap:16px;">
      <div><div class="muted">Tổng ngày công (bảng này)</div><div style="font-size:20px;font-weight:800;color:var(--blue-700)">${Math.round(totalCong * 100) / 100}</div></div>
      <div><div class="muted">Tổng giờ tăng ca (bảng này)</div><div style="font-size:20px;font-weight:800;color:var(--orange-d)">${Math.round(totalOT * 100) / 100}</div></div>
    </div>

    <div class="card">
      <h3>Bảng dữ liệu (chạm vào ô để sửa)</h3>
      <div class="muted" style="margin-bottom:8px">Mã ô: <b>X</b>=công đủ, <b>P</b>=phép, <b>C</b>/<b>NC</b>/<b>O</b>=nghỉ, số (vd 3.5)=giờ tăng ca. Có thể ghép "X3.5". Xem/sửa quy tắc tính tại Cài đặt.</div>
      <div class="tablewrap">
        <table class="cc">
          <thead><tr>
            <th>STT</th><th class="name-h">Họ Tên</th><th>MSNV</th>${dayHeaders}<th>Ghi chú</th><th>Công</th><th>T.Ca(h)</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <button class="btn btn-ghost btn-sm" style="margin-top:10px" onclick="addEmp(${pIdx})">+ Thêm nhân viên</button>
    </div>

    <div class="row-gap">
      <button class="btn btn-outline btn-block" onclick="saveCurrentToHistory()">💾 Lưu lịch sử</button>
      <button class="btn btn-primary btn-block" onclick="exportExcel()">⬇ Xuất Excel</button>
    </div>
    <div class="footer-note">File Excel gồm 1 sheet theo mỗi bộ phận (đúng bố cục mẫu, có công thức tổng tăng ca) + 1 sheet "Tong hop" liệt kê số công &amp; giờ tăng ca từng người.</div>
  </div>`;
}

function switchPage(i) { state.activePage = i; render(); }

function updateDay(p, e, d, val) {
  state.pages[p].employees[e].days = state.pages[p].employees[e].days || {};
  state.pages[p].employees[e].days[String(d)] = val;
  const r = computeRow(state.settings, state.pages[p].employees[e].days);
  const congEl = document.getElementById(`cong-${p}-${e}`);
  const otEl = document.getElementById(`ot-${p}-${e}`);
  if (congEl) congEl.textContent = r.cong;
  if (otEl) otEl.textContent = r.tangCa;
}
function updateEmp(p, e, field, val) { state.pages[p].employees[e][field] = val; }
function updatePageMeta(p, field, val) { state.pages[p][field] = val; if (field === "thang" || field === "nam") render(); }
function addEmp(p) {
  state.pages[p].employees.push({ stt: String(state.pages[p].employees.length + 1), ho: "", ten: "", msnv: "", ghiChu: "", days: {} });
  render();
}
function removeEmp(p, e) { state.pages[p].employees.splice(e, 1); render(); }

/* ============ SETTINGS SCREEN ============ */
function renderSettings() {
  const legendRows = state.settings.legend.map((l, i) => `
    <div class="legend-row">
      <input class="sym" value="${esc(l.sym)}" oninput="updateLegend(${i},'sym',this.value)">
      <input class="lbl" value="${esc(l.label)}" oninput="updateLegend(${i},'label',this.value)">
      <input class="val" type="number" step="0.5" value="${l.cong}" oninput="updateLegend(${i},'cong',this.value)">
      <button class="del" onclick="removeLegend(${i})">✕</button>
    </div>`).join("");

  return `
  ${topBar("Cài đặt", true)}
  <div class="content">
    <div class="card">
      <h3>Bảng ký hiệu chấm công</h3>
      <div class="muted" style="margin-bottom:10px">Ký hiệu · Ý nghĩa · Số công tính cho ký hiệu đó</div>
      ${legendRows}
      <button class="btn btn-ghost btn-sm" style="margin-top:6px" onclick="addLegend()">+ Thêm ký hiệu</button>
    </div>

    <div class="card">
      <h3>Quy tắc với ô chỉ ghi SỐ (không có chữ)</h3>
      <select class="sel" onchange="updateNumberRule(this.value)">
        <option value="ot" ${state.settings.numberRule === "ot" ? "selected" : ""}>Số đó là GIỜ TĂNG CA thêm trong ngày</option>
        <option value="hours" ${state.settings.numberRule === "hours" ? "selected" : ""}>Số đó là TỔNG SỐ GIỜ làm trong ngày hôm đó</option>
      </select>
      <div style="margin-top:12px">
        <label class="field-lbl">Số giờ công chuẩn / ngày (dùng khi chọn "tổng số giờ làm")</label>
        <input class="txtfield" type="number" value="${state.settings.stdHoursPerDay}" oninput="updateStdHours(this.value)">
      </div>
    </div>

    <button class="btn btn-primary btn-block" onclick="applySettings()">Lưu cài đặt</button>
    <button class="btn btn-outline btn-block" style="margin-top:10px" onclick="resetSettings()">Khôi phục mặc định</button>
  </div>`;
}

function updateLegend(i, field, val) {
  state.settings.legend[i][field] = field === "cong" ? parseFloat(val) || 0 : val;
}
function addLegend() { state.settings.legend.push({ sym: "", label: "", cong: 0 }); render(); }
function removeLegend(i) { state.settings.legend.splice(i, 1); render(); }
function updateNumberRule(v) { state.settings.numberRule = v; }
function updateStdHours(v) { state.settings.stdHoursPerDay = parseFloat(v) || 8; }
async function applySettings() { await saveSettings(); toast("Đã lưu cài đặt."); render(); }
async function resetSettings() {
  state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  await saveSettings();
  toast("Đã khôi phục mặc định.");
  render();
}

/* ============ HISTORY SCREEN ============ */
function renderHistory() {
  if (!state.history.length) {
    return `${topBar("Lịch sử", true)}<div class="content"><div class="empty"><div class="ic">🕘</div><div>Chưa có bảng nào được lưu.</div></div></div>`;
  }
  const items = state.history.map((h) => {
    const empCount = (h.pages || []).reduce((a, p) => a + (p.employees ? p.employees.length : 0), 0);
    const dep = (h.pages && h.pages[0] && h.pages[0].boPhan) || "Bảng chấm công";
    const dateStr = h.savedAt ? new Date(h.savedAt).toLocaleString("vi-VN") : "";
    return `<div class="hist-item" onclick="openHistory('${h.id}')">
      <div><div class="l">${esc(dep)} · T${esc(h.thang)}/${esc(h.nam)}</div><div class="r">${empCount} nhân viên · ${dateStr}</div></div>
      <button class="del" style="border:none;background:#fdeaea;color:var(--red);width:28px;height:28px;border-radius:8px;cursor:pointer" onclick="event.stopPropagation();deleteHistory('${h.id}')">✕</button>
    </div>`;
  }).join("");
  return `${topBar("Lịch sử", true)}<div class="content">${items}</div>`;
}

function openHistory(id) {
  const rec = state.history.find((h) => h.id === id);
  if (!rec) return;
  state.pages = JSON.parse(JSON.stringify(rec.pages));
  state.activePage = 0;
  state.screen = "review";
  render();
}

/* ============ INIT ============ */
loadInitial();

async function testConnection() {
  toast("Đang kiểm tra kết nối AI...", 2000);
  try {
    await callClaude("Trả lời đúng 1 từ: OK", [{ type: "text", text: "Xin chào" }], 20);
    toast("✅ Kết nối AI hoạt động bình thường! Vấn đề trước đó có thể do ảnh quá lớn/nhiều. Thử lại với quét ảnh.", 6000);
  } catch (e) {
    toast("❌ " + (e.message || "Lỗi không xác định"), 9000);
  }
}
