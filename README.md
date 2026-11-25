# Gia phả (PWA riêng tư trên Cloudflare)

App xem và sửa gia phả dòng họ. Dữ liệu nằm trong **Cloudflare KV**, chỉ trả về khi nhập đúng mật khẩu. Hai mật khẩu là **secret** đặt trong Cloudflare, không có trong code hay repo.

- `VIEW_PASSWORD`: mật khẩu để **xem**
- `EDIT_PASSWORD`: mật khẩu để **bật chế độ sửa** (cũng xem được)

## Cài đặt từng bước

1. **Tạo repo GitHub riêng** (nên để *Private*) và đưa toàn bộ thư mục này lên. Đừng đưa file sao lưu JSON của gia phả lên repo.
2. **Tạo KV**: Cloudflare Dashboard → *Storage & databases* → *KV* → *Create* (tên tuỳ ý, ví dụ `giapha`). Copy **ID** của namespace vừa tạo.
3. Mở `wrangler.jsonc`, thay `THAY_BANG_ID_KV_CUA_BAN` bằng ID đó. Commit và push.
4. **Tạo project**: *Workers & Pages* → *Create* → *Import a repository* → chọn repo. Cài đặt:
   - Build command: `npm install && npm run build`
   - Deploy command: `npx wrangler deploy`
5. Sau khi deploy xong, vào Worker `giapha` → *Settings* → *Variables and Secrets* → **Add** (loại *Secret*):
   - `VIEW_PASSWORD` = mật khẩu xem
   - `EDIT_PASSWORD` = mật khẩu sửa
   Bấm *Deploy* để áp dụng. Secret đặt trong dashboard sẽ được giữ nguyên qua các lần deploy sau.
6. Mở địa chỉ `https://giapha.<tài-khoản>.workers.dev`, nhập mật khẩu xem. Vào **Cài đặt → Chế độ sửa**, nhập mật khẩu sửa để bắt đầu tạo cây.

Nếu thấy “Máy chủ chưa được cấu hình mật khẩu hoặc KV”: kiểm tra lại bước 3 (ID KV, binding tên `GP_KV`) và bước 5 (hai secret).

## Chuyển dữ liệu từ Lịch Việt cũ
Trong Lịch Việt bản cũ: Cài đặt → Sao lưu → Xuất file JSON. Trong app Gia phả: bật chế độ sửa → Cài đặt → Sao lưu → Nhập từ file. Ngày mất nhập theo dương lịch trước đây sẽ được đổi sang âm lịch.

## Cách hoạt động
- `worker.js`: `POST /api/auth`, `GET /api/tree`, `PUT /api/tree` (cần quyền sửa, có kiểm tra phiên bản để hai người sửa cùng lúc không đè nhau). Nhập sai mật khẩu 8 lần trong 10 phút thì bị khoá tạm theo địa chỉ IP.
- App nhớ mật khẩu **xem** trên máy đã đăng nhập (để mở nhanh và dùng offline). Mật khẩu **sửa** không bao giờ được lưu, chỉ giữ trong lúc bật chế độ sửa.
- “Khoá và xoá dữ liệu trên máy này” (Cài đặt) xoá bản lưu và mật khẩu đã nhớ.

## Chạy thử trên máy
`npm install`, rồi `npx wrangler dev` (tạo file `.dev.vars` chứa `VIEW_PASSWORD=...` và `EDIT_PASSWORD=...`; file này đã được bỏ qua trong `.gitignore`).
