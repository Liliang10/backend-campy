# Campy Backend API (Express.js + Supabase)

REST API Backend untuk aplikasi rental & perlengkapan camping **Campy** menggunakan Express.js dan database **Supabase**.

---

## 🏛️ Arsitektur Multi-Tabel Berbasis Role

Sesuai spesifikasi, database tidak menggunakan tabel profil tunggal melainkan memisahkan entitas pengguna ke dalam tabel khusus sesuai rolenya:
1. **`public.users`** : Menyimpan data pengguna dengan role `'user'` (pelanggan reguler).
2. **`public.admin`** : Menyimpan data pengguna dengan role `'admin'` (pengelola toko & hak akses penuh).
3. **`public.petugas`** : Menyimpan data pengguna dengan role `'petugas'` (pengelola stok inventaris camping).

Saat pengguna mendaftar atau login:
- Register dengan role `user` otomatis masuk ke tabel `users`.
- Register dengan role `admin` otomatis masuk ke tabel `admin`.
- Register dengan role `petugas` otomatis masuk ke tabel `petugas`.
- Trigger `handle_new_user()` di Supabase dan fallback direct insertion di backend menjamin sinkronisasi instan ke tabel yang tepat.

---

## 📌 Format Respons JSON Standar

Semua respons API menggunakan struktur JSON konsisten:
```json
{
  "success": true,
  "message": "Deskripsi status dalam Bahasa Indonesia",
  "data": { ... },
  "count": 9 // Opsional untuk array
}
```

Format field produk dan entitas database menggunakan format **snake_case** langsung dari tabel Supabase:
- `id`: string unik (misal `prod-1` atau `prod-xxxx`)
- `name`: nama barang
- `sub`: sub-judul / spesifikasi singkat
- `category`: nama kategori
- `category_slug`: slug kategori (`shelter`, `kitchen`, `lighting`, `apparel`)
- `price`: harga sewa/beli per unit (integer)
- `is_special_offer`: boolean penawaran khusus
- `icon`: nama icon Material Icons
- `image_url`: tautan gambar di bucket Supabase Storage
- `stock`: jumlah unit tersedia di inventaris
- `description`: deskripsi lengkap barang

---

## 🚀 Memulai (Quick Start)

### 1. Masuk ke direktori backend
```bash
cd backend
```

### 2. Install dependensi
```bash
npm install
```

### 3. File Lingkungan (`.env`)
```env
PORT=5001
NODE_ENV=development
CORS_ORIGIN=*
SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```
Salin `.env.example` menjadi `.env`, lalu isi URL proyek dan anon/publishable key Supabase Anda. Jangan gunakan `service_role` key di backend atau Flutter.
> *Catatan Port:* Port default Campy adalah `5001` untuk menghindari konflik port `5000` yang pada beberapa instalasi Windows dipakai oleh HTTP.sys/Hyper-V/WSL. Server mengikat ke `0.0.0.0` agar dapat diakses oleh emulator maupun perangkat fisik di jaringan Wi-Fi lokal.

### 4. Menjalankan Server
Mode Development (auto-reload):
```bash
npm run dev
```

Mode Standar:
```bash
npm start
```

### 5. Menjalankan Smoke Test Otomatis
Skrip ini membutuhkan akun admin dan petugas yang sudah tersedia di Supabase.
Atur `CAMPY_ADMIN_EMAIL`, `CAMPY_ADMIN_PASSWORD`, `CAMPY_PETUGAS_EMAIL`, dan
`CAMPY_PETUGAS_PASSWORD` pada environment shell terlebih dahulu, lalu jalankan
(Linux/macOS/Git Bash):

```bash
bash scripts/smoke-test.sh
```
Secara default smoke test menggunakan `http://localhost:5001`. Atur `API_URL`
jika backend berjalan pada host atau port yang berbeda.
Skrip membuat akun pengguna uji serta data inventaris uji di proyek yang
ditargetkan. Gunakan proyek pengembangan/pengujian, bukan proyek produksi.

---

## 📡 Daftar Endpoint Lengkap

### 🩺 Health & Root
- `GET /health` : Cek status kesehatan backend
- `GET /` : Informasi daftar endpoint

### 🔐 Autentikasi (`/api/auth`)
- `POST /api/auth/register` : Registrasi akun baru
  - Body: `{ email, password, name, phone }`
- `POST /api/auth/login` : Login user biasa
  - Body: `{ email, password }`
  - Response: `{ success: true, data: { accessToken, refreshToken, user, profile, role } }`
- `POST /api/auth/staff-login` : Login admin / petugas dengan verifikasi role di database
  - Body: `{ email, password, role: 'admin' | 'petugas' }`
- `POST /api/auth/refresh` : Refresh token sesi
  - Body: `{ refreshToken }`
- `GET /api/auth/profile` *(Bearer Token)* : Ambil profil user saat ini
- `PUT /api/auth/profile` *(Bearer Token)* : Update nama, nomor telepon, alamat, avatar, detail, lokasi

### ⛺ Katalog Produk (`/api/products`)
- `GET /api/products` *(Publik)* : Ambil seluruh produk
  - Filter opsional: `?category=shelter`, `?special_offers=true`, `?q=tent`, `?sort=price_asc|price_desc`
- `GET /api/products/:id` *(Publik)* : Ambil detail produk berdasarkan ID
- `POST /api/products` *(Staff only: admin/petugas)* : Tambah produk baru
- `PUT /api/products/:id` *(Staff only: admin/petugas)* : Update produk (whitelist field)
- `DELETE /api/products/:id` *(Staff only: admin/petugas)* : Hapus produk

### 🛒 Kalkulasi Checkout (`/api/checkout`)
- `POST /api/checkout/calculate` : Hitung subtotal dan total berdasarkan harga valid di database
  - Body:
    ```json
    {
      "deliveryMethod": "pickup", // atau "delivery"
      "items": [
        { "productId": "prod-1", "qty": 2 }
      ]
    }
    ```

### 📦 Pesanan (`/api/orders`)
- `POST /api/orders` *(Bearer Token)* : Buat pesanan baru via RPC atomik Supabase (validasi harga & stok otomatis)
  - Body:
    ```json
    {
      "deliveryMethod": "pickup", // atau "delivery"
      "paymentMethod": "BCA",
      "deliveryAddress": "Jl. Campy No. 1",
      "items": [
        { "productId": "prod-1", "qty": 1 }
      ]
    }
    ```
- `GET /api/orders` *(Bearer Token)* : Ambil riwayat pesanan (user melihat pesanannya sendiri, staff melihat semua)
- `GET /api/orders/:id` *(Bearer Token)* : Ambil detail pesanan beserta daftar item
- `PATCH /api/orders/:id/status` *(Bearer Token)* : Ubah status pesanan (`active`, `completed`, `cancelled`)

### 💳 Transaksi Pembayaran (`/api/transactions`)
- `POST /api/transactions` *(Bearer Token)* : Catat transaksi pembayaran (otomatis mencocokkan nominal dari `orders.total`)
  - Body:
    ```json
    {
      "orderId": "#ORD-12345678",
      "paymentMethod": "BCA",
      "status": "success"
    }
    ```
- `GET /api/transactions` *(Bearer Token)* : Ambil riwayat transaksi
- `GET /api/transactions/:id` *(Bearer Token)* : Ambil detail transaksi

### ❤️ Wishlist (`/api/wishlist`)
- `GET /api/wishlist` *(Bearer Token)* : Ambil daftar produk wishlist user
- `POST /api/wishlist` *(Bearer Token)* : Tambah ke wishlist (idempoten) `{ "productId": "prod-1" }`
- `DELETE /api/wishlist/:productId` *(Bearer Token)* : Hapus dari wishlist

### 👥 Admin Management (`/api/admins`)
*(Dilindungi: Hanya Role 'admin')*
- `GET /api/admins` : Ambil daftar admin
- `POST /api/admins` : Buat / promosikan admin baru
- `PUT /api/admins/:id` : Update data admin
- `DELETE /api/admins/:id` : Cabut status admin

### 📦 Petugas Inventaris (`/api/petugas`)
*(Dilindungi: Role 'petugas' atau 'admin')*
- `GET /api/petugas/stock` : Daftar stok inventaris
- `POST /api/petugas/stock` : Tambah barang ke inventaris
- `PUT /api/petugas/stock/:id` : Update stok dan harga barang
- `DELETE /api/petugas/stock/:id` : Hapus barang dari inventaris

### 🖼️ Upload Gambar (`/api/upload`)
*(Dilindungi: Role 'petugas' atau 'admin')*
- `POST /api/upload` : Upload file gambar ke bucket `product-images` di Supabase Storage
  - Header: `Content-Type: multipart/form-data`
  - Field: `image` (Maks 2MB, format: JPG, PNG, WEBP)
  - Respons: `{ success: true, data: { url: "https://..." } }`
