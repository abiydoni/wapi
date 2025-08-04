<?php
require 'db.php';
date_default_timezone_set('Asia/Jakarta');

// Terjemahan hari dan bulan ke Bahasa Indonesia
$hariIndo = [
    'Sunday' => 'Minggu',
    'Monday' => 'Senin',
    'Tuesday' => 'Selasa',
    'Wednesday' => 'Rabu',
    'Thursday' => 'Kamis',
    'Friday' => 'Jumat',
    'Saturday' => 'Sabtu',
];

$bulanIndo = [
    'January' => 'Januari',
    'February' => 'Februari',
    'March' => 'Maret',
    'April' => 'April',
    'May' => 'Mei',
    'June' => 'Juni',
    'July' => 'Juli',
    'August' => 'Agustus',
    'September' => 'September',
    'October' => 'Oktober',
    'November' => 'November',
    'December' => 'Desember',
];

// Ambil data KK yang nominal-nya 0 pada hari kemarin
$stmt = $pdo->prepare("
SELECT 
m.code_id, 
m.kk_name, 
COALESCE(SUM(r.nominal), 0) AS jumlah_nominal
FROM master_kk m
LEFT JOIN report r ON m.code_id = r.report_id 
AND r.jimpitan_date = CURDATE() - INTERVAL 1 DAY 
GROUP BY m.code_id, m.kk_name
ORDER BY m.code_id ASC;
");
$stmt->execute();
$data = $stmt->fetchAll(PDO::FETCH_ASSOC);

$total_nominal = array_sum(array_column($data, 'jumlah_nominal'));

$kemarin = new DateTime('yesterday');
$tanggal = $kemarin->format('Y-m-d');
$hariEng = $kemarin->format('l');
$hariInd = $hariIndo[$hariEng];
$tgl = $kemarin->format('j');
$bulanEng = $kemarin->format('F');
$bulanInd = $bulanIndo[$bulanEng];
$tahun = $kemarin->format('Y');

$tanggalLengkap = "$hariInd, $tgl $bulanInd $tahun";

// Bangun text WhatsApp / Telegram
$text = "⏰ *Report Jimpitan Hari* $tanggalLengkap _(Semalam)_\n\n";
$text .= "💰 Sebesar Rp. " . number_format($total_nominal, 0, ',', '.') . "\n\n";
$text .= "📋 *Jimpitan yang kosong (kode KK) :*\n";
$text .= "==========================\n";

if ($data) {
    $no = 1;
    foreach ($data as $user) {
        if ((int)$user['jumlah_nominal'] === 0) {

            // $kk_name = $user['kk_name'];
            // $kk_anonim = strtoupper(substr($kk_name, 0, 1)) . '•••••' . strtolower(substr($kk_name, -1));
            // $text .= $no++ . ". " . $user['code_id'] . " - " . $kk_anonim . "\n";

            $text .= $no++ . ". " . $user['code_id'] . " - " . $user['kk_name'] . "\n";

        }
    }

    if ($no === 1) {
        $text .= "✅ Semua KK menyetor jimpitan.\n";
    }
} else {
    $text .= "❌ Tidak ada data tersedia.\n";
}
$text .= "==========================\n";
// Tambahkan data petugas jimpitan (scan > 0) dari tabel report
$stmt_petugas = $pdo->prepare("
    SELECT 
        kode_u, 
        nama_u, 
        COUNT(*) as jumlah_scan
    FROM report
    WHERE jimpitan_date = CURDATE() - INTERVAL 1 DAY
    GROUP BY kode_u, nama_u
    HAVING jumlah_scan > 0
    ORDER BY jumlah_scan DESC
");
$stmt_petugas->execute();
$data_petugas = $stmt_petugas->fetchAll(PDO::FETCH_ASSOC);

if ($data_petugas) {
    $text .= "👤 *Petugas Jimpitan :*\n";
    $no_petugas = 1;
    foreach ($data_petugas as $petugas) {
        $text .= $no_petugas . ". {$petugas['nama_u']} ({$petugas['jumlah_scan']} scan)\n";
        $no_petugas++;
    }
} else {
    $text .= "\n👤 Tidak ada data petugas jimpitan.\n";
}
$text .= "==========================\n";
$text .= "*Info :*\n";
$text .= "Mulai sekarang warga dapat mengakses aplikasi ini\n";
$text .= "Silahkan klik disini : *https://rt07.appsbee.my.id*\n";
$text .= "Gunakan User: warga dan Password: warga\n";
$text .= "==========================\n";
// Tambahkan penutup
$text .= "🌟 Terimakasih atas perhatiannya\n";
$text .= "Info lebih lanjut bisa hubungi *ADMIN*\n\n";
$text .= "_- Pesan Otomatis dari System -_";
echo $text;
?>
