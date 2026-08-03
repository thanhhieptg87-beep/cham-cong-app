# CHẤM CÔNG AI

App quét bảng chấm công viết tay bằng AI, cho phép kiểm tra/sửa dữ liệu, tự tính **số ngày công** và **giờ tăng ca**, và xuất ra file Excel đúng mẫu.

App này là **web app độc lập**: bất kỳ ai có đường link đều dùng được trên điện thoại/máy tính, **không cần tài khoản Claude**. AI được gọi qua máy chủ (server) riêng của bạn, dùng API key của chính bạn.

---

## 1. Bạn cần chuẩn bị gì

1. **API key của Anthropic** (để AI đọc ảnh):
   - Vào https://console.anthropic.com → đăng ký/đăng nhập → mục **API Keys** → tạo key mới.
   - Đây là dịch vụ **trả phí theo mức sử dụng** (không dùng chung với gói Claude.ai bạn đang trả). Chi phí đọc 1 ảnh bảng công khoảng vài trăm đồng đến vài nghìn đồng tuỳ số nhân viên/ngày — rất rẻ so với chấm công thủ công, nhưng bạn nên nạp một khoản nhỏ để dùng thử.
2. **Nơi để chạy server** (chọn 1 trong các cách ở mục 3 bên dưới) — có các lựa chọn **miễn phí** để bắt đầu.

## 2. Chạy thử ở máy tính của bạn (khuyên làm trước khi deploy)

Cần cài [Node.js](https://nodejs.org) bản 18 trở lên.

```bash
cd cham-cong-app
npm install
cp .env.example .env
```

Mở file `.env` vừa tạo, dán API key của bạn vào dòng `ANTHROPIC_API_KEY=...`

```bash
npm start
```

Mở trình duyệt vào `http://localhost:3000` — app sẽ chạy, thử chụp/chọn ảnh và quét.

## 3. Đưa app lên internet để mọi nhân viên dùng được

Cách dễ nhất là dùng một dịch vụ hosting miễn phí hỗ trợ Node.js. Gợi ý 2 lựa chọn phổ biến:

### Cách A — Render.com (miễn phí, dễ nhất)
1. Tạo tài khoản tại https://render.com, đăng nhập bằng GitHub.
2. Đưa toàn bộ thư mục `cham-cong-app` này lên một repository GitHub của bạn (tạo repo mới, upload code, hoặc dùng `git push`).
3. Trên Render: **New +** → **Web Service** → chọn repo vừa tạo.
4. Cấu hình:
   - Build Command: `npm install`
   - Start Command: `npm start`
5. Vào tab **Environment** → thêm biến `ANTHROPIC_API_KEY` = API key của bạn.
6. Bấm **Create Web Service**. Sau vài phút, Render cho bạn 1 đường link dạng `https://ten-app.onrender.com` — gửi link này cho nhân viên là dùng được ngay trên điện thoại (thêm vào màn hình chính để dùng như app luôn).

### Cách B — Railway.app
Tương tự Render: kết nối GitHub repo, thêm biến môi trường `ANTHROPIC_API_KEY`, Railway tự nhận `npm start` để chạy.

> Lưu ý: các gói miễn phí có thể "ngủ" sau một thời gian không dùng, lần mở đầu tiên trong ngày có thể chậm vài giây — đây là bình thường.

## 4. Cách dùng hằng ngày

1. Mở đường link app trên điện thoại (nên "Thêm vào màn hình chính" để mở nhanh như app thật).
2. Chụp hoặc chọn ảnh bảng chấm công.
3. Bấm **"Quét bằng AI"**, đợi AI đọc xong.
4. **Kiểm tra và sửa lại** những ô đọc sai (chữ viết tay AI đọc không thể đúng 100%).
5. Xem số ngày công / giờ tăng ca tự tính, điều chỉnh **Cài đặt → Bảng ký hiệu** nếu quy tắc tính công của công ty khác mặc định.
6. Bấm **Xuất Excel** để tải file về.

## 5. Bảo mật API key

- **Không** chia sẻ file `.env` hay API key cho ai, không đưa lên GitHub công khai (`.gitignore` đã loại trừ `.env` sẵn).
- Nếu nghi ngờ key bị lộ, vào console.anthropic.com xoá key cũ và tạo key mới, cập nhật lại biến môi trường trên hosting.
- Bạn có thể đặt giới hạn chi tiêu (spend limit) trong console.anthropic.com để tránh phát sinh chi phí ngoài ý muốn.

## 6. Cấu trúc project

```
cham-cong-app/
├── server.js         # backend: giữ API key, chuyển tiếp yêu cầu quét ảnh tới Anthropic
├── package.json
├── .env.example       # copy thành .env và điền API key
└── public/
    ├── index.html      # giao diện app
    └── app.js          # toàn bộ logic app (quét, sửa bảng, tính công, xuất Excel)
```
