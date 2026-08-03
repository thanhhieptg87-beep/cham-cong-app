// Backend server cho app CHẤM CÔNG AI
// - Phục vụ giao diện web (thư mục public/)
// - Nhận yêu cầu quét ảnh từ trình duyệt, gọi Anthropic API bằng API key giữ trên server
//   (API key KHÔNG bao giờ gửi xuống trình duyệt, nên an toàn khi nhiều người cùng dùng)

const express = require("express");
const path = require("path");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const API_KEY = process.env.ANTHROPIC_API_KEY;

app.use(express.json({ limit: "25mb" })); // ảnh base64 khá nặng, tăng giới hạn body
app.use(express.static(path.join(__dirname, "public")));

app.post("/api/claude", async (req, res) => {
  if (!API_KEY) {
    return res.status(500).json({ error: { message: "Máy chủ chưa cấu hình ANTHROPIC_API_KEY. Xem README để thiết lập." } });
  }
  try {
    const { system, messages, max_tokens } = req.body;
    if (!messages) return res.status(400).json({ error: { message: "Thiếu messages trong yêu cầu." } });

    const controller = new AbortController();
    // Tu tra loi JSON truoc khi Render tu dong ngat ket noi (gateway timeout se
    // tra ve trang HTML thay vi JSON, gay loi "AI tra ve du lieu khong hop le").
    const timeout = setTimeout(() => controller.abort(), 55000);

    let upstream;
    try {
      upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: max_tokens || 2000,
          system,
          messages,
          // Sonnet 5 bat "adaptive thinking" mac dinh, va phan suy luan do cung
          // tinh vao max_tokens. Voi tac vu doc du lieu co dinh (khong can suy
          // luan nhieu buoc), tat thinking de toan bo max_tokens danh cho JSON
          // tra loi, tranh bi cat truoc khi kip xuat text (=> loi "AI khong
          // tra ve noi dung van ban").
          thinking: { type: "disabled" },
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("Loi goi Anthropic API:", err);
    const isTimeout = err && err.name === "AbortError";
    res.status(500).json({
      error: {
        message: isTimeout
          ? "AI xử lý quá lâu (quá 55 giây) nên máy chủ đã hủy yêu cầu. Thử lại với ảnh nhỏ/rõ hơn."
          : "Lỗi máy chủ khi gọi AI: " + err.message,
      },
    });
  }
});

// health check - hữu ích để kiểm tra khi deploy
app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeyConfigured: !!API_KEY, model: MODEL });
});

// Bat moi loi con sot lai (vd body-parser bao loi khi anh gui len qua 25mb,
// hoac JSON gui len bi hong) va LUON tra ve JSON, khong bao gio de Express
// tra ve trang loi HTML mac dinh (nguyen nhan gay loi "AI tra ve du lieu
// khong hop le" phia trinh duyet).
app.use((err, req, res, next) => {
  console.error("Loi middleware:", err);
  const status = err.status || err.statusCode || 500;
  const message =
    err.type === "entity.too.large"
      ? "Ảnh gửi lên quá lớn cho máy chủ xử lý. Thử chụp lại ảnh nhỏ hơn hoặc quét từng ảnh một."
      : "Lỗi máy chủ: " + (err.message || "không rõ nguyên nhân");
  res.status(status).json({ error: { message } });
});

app.listen(PORT, () => {
  console.log(`CHAM CONG AI server dang chay tai http://localhost:${PORT}`);
  console.log(`API key da cau hinh: ${API_KEY ? "CO" : "CHUA - hay tao file .env"}`);
});
