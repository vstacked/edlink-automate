/**
 * Mengirim notifikasi ke Telegram menggunakan Bot API via HTTP.
 * Format pesan sesuai SSOT §5 (Fase 3).
 *
 * @param courseName Nama mata kuliah
 * @param sessionTopic Topik sesi
 * @param instructionType Tipe instruksi (STANDARD atau ACTION)
 * @param driveFolderUrl Tautan ke folder Google Drive sesi
 * @param files Daftar nama file yang berhasil diunduh
 * @param youtubeUrls Daftar URL YouTube yang ditemukan
 * @param notes Catatan dosen gabungan (digunakan jika ACTION)
 * @param contentItems Konten non-file: quiz, tugas, diskusi, dll
 */
export async function sendTelegramNotification(
  courseName: string,
  sessionNumber: string,
  sessionTopic: string,
  instructionType: "STANDARD" | "ACTION",
  driveFolderUrl: string,
  files: string[] = [],
  youtubeUrls: string[] = [],
  notes: string = "",
  contentItems: string[] = []
): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log("[WARN] Kredensial Telegram tidak lengkap di .env. Notifikasi dilewati.");
    return;
  }

  /** Escape karakter spesial untuk MarkdownV2 */
  const escapeMd = (text: string): string =>
    text.replace(/[_*[\]()~`>#+=|{}.!\-]/g, "\\$&");

  const safeCourseName = escapeMd(courseName);
  const safeSessionNumber = escapeMd(sessionNumber);
  const safeSessionTopic = escapeMd(sessionTopic);

  // ── Bagian Materi (file + video + konten non-file) ─────────────────────
  const materiLines: string[] = [];
  for (const f of files) {
    materiLines.push(`\\- 📄 ${escapeMd(f)}`);
  }
  for (const v of youtubeUrls) {
    materiLines.push(`\\- 🎥 Video: ${escapeMd(v)}`);
  }
  for (const c of contentItems) {
    materiLines.push(`\\- ${escapeMd(c)}`);
  }
  const materiSection =
    materiLines.length > 0
      ? `📁 *Materi:*\n${materiLines.join("\n")}`
      : "";

  // ── Format pesan berdasarkan tipe instruksi ───────────────────────────
  let messageText: string;

  if (instructionType === "ACTION") {
    // Tampilkan notes secara penuh tanpa dipotong
    const safeNotes = notes.trim()
      ? escapeMd(notes.trim())
      : "_\\(tidak ada catatan dosen\\)_";

    messageText = [
      `⚠️ *ACTION DIPERLUKAN* — ${safeCourseName}`,
      `📌 Sesi ${safeSessionNumber}: ${safeSessionTopic}`,
      "",
      `📋 *Detail:*`,
      safeNotes,
      "",
      ...(materiSection ? [materiSection, ""] : []),
      `🔗 [Buka Folder Drive](${driveFolderUrl})`,
    ].join("\n");
  } else {
    messageText = [
      `📚 *${safeCourseName}*`,
      `📌 Sesi ${safeSessionNumber}: ${safeSessionTopic}`,
      "",
      `🏷️ Tipe: ✅ STANDARD`,
      "",
      ...(materiSection ? [materiSection, ""] : []),
      `🔗 [Buka Folder Drive](${driveFolderUrl})`,
    ].join("\n");
  }

  const apiUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: messageText,
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.log(`[WARN] Gagal mengirim notifikasi Telegram: ${response.status} — ${errorData}`);
    } else {
      console.log(`[SUCCESS] Notifikasi Telegram terkirim untuk sesi "${sessionTopic}".`);
    }
  } catch (error) {
    console.log(`[ERROR] Terjadi kesalahan saat menghubungi API Telegram:`, error);
  }
}
