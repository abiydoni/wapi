# Troubleshooting Session Management

## Masalah: Scan QR Berhasil Tapi Masuk Login Lagi

### Penyebab:

1. Session tidak tersimpan dengan benar di database
2. Event handler tidak memperbarui status session
3. Session recovery tidak bekerja dengan baik

### Solusi yang Sudah Diterapkan:

#### 1. **Perbaikan Event Handler**

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
2. Login
3. Klik "Add WhatsApp Number"
4. Scan QR code

### 3. **Cek Status Session**

- Setelah scan QR berhasil, cek apakah status "Connected"
- Coba refresh halaman, seharusnya tidak masuk login lagi
- Coba kirim pesan, seharusnya berhasil

### 4. **Cek Logs**

Monitor logs untuk melihat:

```
✅ Session [session-id] fully connected and saved
✅ Session [session-id] recovered successfully
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
4. ✅ **Restart aplikasi** → Session otomatis recovery

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
✅ Session [session-id] recovered successfully
Session '[session-id]' connected
```

Jika masih ada masalah, cek logs untuk error messages dan pastikan semua dependencies terinstall dengan benar.
