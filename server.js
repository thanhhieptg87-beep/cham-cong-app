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

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
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
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (err) {
    console.error("Loi goi Anthropic API:", err);
    res.status(500).json({ error: { message: "Lỗi máy chủ khi gọi AI: " + err.message } });
  }
});

// health check - hữu ích để kiểm tra khi deploy
app.get("/api/health", (req, res) => {
  res.json({ ok: true, apiKeyConfigured: !!API_KEY, model: MODEL });
});

app.listen(PORT, () => {
  console.log(`CHAM CONG AI server dang chay tai http://localhost:${PORT}`);
  console.log(`API key da cau hinh: ${API_KEY ? "CO" : "CHUA - hay tao file .env"}`);
});
