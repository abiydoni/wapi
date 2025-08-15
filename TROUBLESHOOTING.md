# Troubleshooting WhatsApp API

## Masalah 1: Login Tidak Bisa Masuk ke Halaman Selanjutnya

### Gejala:

1. Login berhasil (username: admin, password: admin)
2. Setelah login, diarahkan ke halaman login lagi
3. Tidak bisa masuk ke dashboard utama

### Penyebab:

1. Session configuration tidak optimal
2. Middleware requireLogin tidak bekerja dengan benar
3. Session tidak tersimpan dengan benar

### Solusi yang Diterapkan:

#### 1. **Perbaikan Session Configuration**

```javascript
// Sebelum
app.use(
  session({
    secret: "whatsapp-gateway-secret",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 },
  })
);

// Sesudah
app.use(
  session({
    secret: "whatsapp-gateway-secret",
    resave: true,
    saveUninitialized: true,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      secure: false,
      httpOnly: true,
      sameSite: "lax",
    },
  })
);
```

#### 2. **Perbaikan Middleware Logging**

```javascript
function requireLogin(req, res, next) {
  console.log("🔍 Checking session:", req.session);
  console.log("🔍 User in session:", req.session?.user);

  if (req.session && req.session.user) {
    console.log("✅ User authenticated, proceeding...");
    return next();
  }

  console.log("❌ User not authenticated, redirecting to login");
  res.redirect("/login");
}
```

### Cara Testing Login:

1. **Restart aplikasi**: `npm start`
2. **Buka browser**: `http://localhost:8080`
3. **Login dengan**: username `admin`, password `admin`
4. **Monitor console logs** untuk melihat:
   ```
   ✅ User authenticated, proceeding...
   ```

### Expected Behavior Setelah Perbaikan:

- ✅ **Login berhasil** → Diarahkan ke dashboard
- ✅ **Session tersimpan** → Tidak diarahkan ke login lagi
- ✅ **Dashboard accessible** → Bisa melihat halaman utama

---

## Masalah 2: Session Hilang Setelah Restart / Status Disconnected

### Gejala:

1. Setelah scan QR berhasil, session tersimpan
2. Setelah restart aplikasi, muncul status "Disconnected"
3. Session hilang setelah beberapa detik
4. Muncul halaman "No active sessions"

### Penyebab:

1. Session tidak tersimpan dengan benar di wa-multi-session storage
2. Session recovery tidak bekerja dengan baik
3. Status tracking tidak akurat
4. Event handler tidak memperbarui status dengan benar

### Penyebab:

1. Session tidak tersimpan dengan benar di database
2. Event handler tidak memperbarui status session
3. Session recovery tidak bekerja dengan baik

### Solusi yang Sudah Diterapkan:

#### 1. **Perbaikan Session Recovery**

```javascript
// Menambahkan pengecekan session di wa-multi-session storage
const existingSession = whatsapp.getSession(session.sessionId);

if (existingSession) {
  // Session ada di storage, buat client data
  const clientData = {
    sessionId: session.sessionId,
    isConnected: true, // Assume connected if session exists
    // ... other properties
  };
  this.clients.set(session.sessionId, clientData);
} else {
  // Session tidak ada, initialize baru
  await this.initWhatsApp(session.sessionId, ...);
}
```

#### 2. **Perbaikan Event Handler**

```javascript
// Sebelum
whatsapp.onConnected((session) => {
  // Tidak async, tidak update database dengan benar
});

// Sesudah
whatsapp.onConnected(async (session) => {
  // Async, update database dan numberToSessionMap
  await this.updateSessionStatus(session, true);
  if (clientData.numberId) {
    this.numberToSessionMap.set(clientData.numberId, session);
  }
});
```

#### 2. **Perbaikan Session Recovery**

```javascript
// Menambahkan pengecekan session yang sudah ada
if (this.clients.has(session.sessionId)) {
  this.logger.info(`Session ${session.sessionId} already in memory, skipping`);
  continue;
}

// Update numberToSessionMap saat recovery
if (session.numberId) {
  this.numberToSessionMap.set(session.numberId, session.sessionId);
}
```

#### 3. **Perbaikan Status Checking**

```javascript
// Menambahkan pengecekan session di wa-multi-session
const sessionExists = whatsapp.getSession(sessionId);

// Determine actual connection status
let isConnected = false;
if (sessionExists) {
  isConnected = true;
  // Update client data if it was marked as disconnected
  if (!clientData.isConnected) {
    clientData.isConnected = true;
    clientData.connectedAt = clientData.connectedAt || new Date();
  }
} else {
  isConnected = false;
  if (clientData.isConnected) {
    clientData.isConnected = false;
  }
}
```

#### 4. **Auto Recovery untuk Session yang Hilang**

```javascript
// Jika tidak ada client data saat session connected
if (!clientData) {
  // Try to recover from database
  const sessionData = await this.db.getSession(session);
  if (sessionData) {
    const recoveredClientData = {
      sessionId: session,
      isConnected: true,
      numberId: sessionData.numberId,
      // ... other properties
    };
    this.clients.set(session, recoveredClientData);
  }
}
```

```javascript
// Menambahkan pengecekan session di wa-multi-session
const sessionExists = whatsapp.getSession(sessionId);
const status = {
  isConnected: clientData.isConnected && !!sessionExists,
  sessionExists: !!sessionExists,
};
```

## Cara Testing Perbaikan:

### 1. **Restart Aplikasi**

```bash
npm start
```

### 2. **Buat Session Baru**

1. Buka `http://localhost:8080`
2. Login dengan username: `admin`, password: `admin`
3. Masukkan nomor WhatsApp (contoh: `089510101008`)
4. Klik "Add Number"
5. Scan QR code sampai berhasil

### 3. **Monitor Logs Saat Membuat Session**

Cari log messages ini:

```
✅ Session [session-id] saved to database successfully
Session '[session-id]' connected
✅ Session [session-id] fully connected and saved
✅ Session [session-id] status updated in database: connected=true
```

### 4. **Cek Database Setelah Session Dibuat**

```bash
node check_sessions.js
```

Seharusnya menampilkan:

```
📊 Sessions in database: 1
  - [session-id] ([number-id]) - Connected: Yes
```

### 5. **Test Restart Aplikasi**

1. Stop aplikasi (Ctrl+C)
2. Start lagi: `npm start`
3. Login dan cek apakah session masih ada dan connected

### 6. **Cek Logs Saat Recovery**

Cari log messages ini:

```
Found 1 sessions to recover
Attempting to recover session: [session-id] ([number-id])
✅ Session [session-id] recovered from wa-multi-session storage
```

## Jika Masih Bermasalah:

### 1. **Clear Session Data**

```bash
# Hapus folder auth
rm -rf auth/

# Hapus database (jika perlu)
rm -rf data/
```

### 2. **Check Database**

```bash
# Cek apakah session tersimpan di database
sqlite3 data/sessions.db "SELECT * FROM sessions;"
```

### 3. **Manual Session Check**

```javascript
// Di console browser
fetch("/sessions")
  .then((r) => r.json())
  .then((data) => console.log(data));
```

## Expected Behavior Setelah Perbaikan:

1. ✅ **Scan QR berhasil** → Status "Connected"
2. ✅ **Refresh halaman** → Tetap di dashboard, tidak login lagi
3. ✅ **Kirim pesan** → Berhasil, tidak ada error "WhatsApp belum terhubung"
4. ✅ **Restart aplikasi** → Session otomatis recovery dan tetap connected
5. ✅ **Status tracking** → Akurat sesuai dengan session di wa-multi-session
6. ✅ **Session persistence** → Session tidak hilang setelah restart

## Debug Commands:

### Cek Session Status:

```bash
curl -X GET http://localhost:8080/sessions
```

### Cek Session Specific:

```bash
curl -X GET "http://localhost:8080/session/status?sessionId=YOUR_SESSION_ID"
```

### Test Send Message:

```bash
curl -X POST http://localhost:8080/send-message \
  -H "Content-Type: application/json" \
  -H "x-session-id: YOUR_SESSION_ID" \
  -d '{"phoneNumber":"081234567890","message":"Test"}'
```

## Log Messages yang Harus Muncul:

```
✅ Session [session-id] fully connected and saved
✅ Session [session-id] recovered from wa-multi-session storage
✅ Session [session-id] recovered and connected
Session '[session-id]' connected
Session [session-id] status updated to connected
```

Jika masih ada masalah, cek logs untuk error messages dan pastikan semua dependencies terinstall dengan benar.
