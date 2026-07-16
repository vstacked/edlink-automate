import fs from "fs";
import path from "path";
import https from "https";
import http from "http";

export interface PreparedSession {
  /** Path folder sesi, misal: output/sessions/28276409/ */
  sessionDir: string;
  /** Teks header siap baca */
  headerText: string;
  /** Daftar nama file yang berhasil diunduh (untuk notifikasi Telegram) */
  downloadedFiles: string[];
  /** Daftar URL YouTube yang ditemukan (untuk notifikasi Telegram) */
  youtubeUrls: string[];
  /** Daftar item non-file: quiz, tugas, diskusi, dll (untuk notifikasi Telegram) */
  contentItems: string[];
}

/** Download file dari URL ke path lokal menggunakan http/https native */
async function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith("https") ? https : http;
    const file = fs.createWriteStream(destPath);
    protocol
      .get(url, (res) => {
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          resolve();
        });
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

/**
 * Konversi URL YouTube embed ke URL watch standar.
 * Contoh: https://www.youtube.com/embed/abc123 → https://www.youtube.com/watch?v=abc123
 */
function normalizeYoutubeUrl(videoUrl: string): string {
  const embedMatch = videoUrl.match(/youtube\.com\/embed\/([^?&/]+)/);
  if (embedMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${embedMatch[1]}`;
  }
  return videoUrl;
}

/** Ikon per tipe konten untuk header.txt dan Telegram */
const CONTENT_TYPE_ICON: Record<string, string> = {
  quiz: "📝",
  tugas: "📋",
  diskusi: "💬",
  forum: "💬",
  vicon: "💻",
  lainnya: "📌",
};

/**
 * Menyiapkan seluruh bahan satu sesi kuliah.
 *
 * Yang dilakukan:
 * 1. Buat folder output/sessions/[sectionId]/ (flat, sesuai SSOT §5)
 * 2. Download semua file attachment (PDF/PPTX/DOCX)
 * 3. Kumpulkan URL YouTube (TIDAK fetch transcript — per SSOT §6 design decision)
 * 4. Catat konten non-file: quiz, tugas, diskusi
 * 5. Generate header.txt dengan format per SSOT §5 — SEMUA item dicantumkan
 */
export async function prepareSession(
  sectionId: string,
  courseName: string,
  sessionTopic: string,
  sessionNumber: string,
  instructionType: "STANDARD" | "ACTION",
  learningMaterials: {
    title: string;
    notes: string;
    attachments: {
      filename?: string;
      url?: string;
      videoUrl?: string;
      contentType?: string;
      label?: string;
    }[];
  }[]
): Promise<PreparedSession> {
  const sessionDir = path.join(process.cwd(), "output", "sessions", sectionId);
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }

  console.log(`\n[INFO] [PREPARE] Menyiapkan bahan sesi di: ${sessionDir}`);

  const downloadedFiles: string[] = [];
  const youtubeUrls: string[] = [];
  const contentItems: string[] = []; // quiz, tugas, diskusi, dll

  for (const material of learningMaterials) {
    for (const attachment of material.attachments) {

      // ── File attachment (PDF/PPTX/DOCX) ──────────────────────────────
      if (attachment.url && attachment.filename) {
        const destPath = path.join(sessionDir, attachment.filename);
        try {
          console.log(`[INFO] Mengunduh: ${attachment.filename}...`);
          await downloadFile(attachment.url, destPath);
          downloadedFiles.push(attachment.filename);
          console.log(`[SUCCESS] Tersimpan: ${attachment.filename}`);
        } catch (e: any) {
          console.log(`[WARN] Gagal mengunduh ${attachment.filename}: ${e.message || e}`);
        }
      }

      // ── URL YouTube (TIDAK transcript — ini tugas Chat AI) ────────────
      if (attachment.videoUrl) {
        const normalizedUrl = normalizeYoutubeUrl(attachment.videoUrl);
        const videoStr = `${material.title} | ${normalizedUrl}`;
        if (!youtubeUrls.includes(videoStr)) {
          youtubeUrls.push(videoStr);
          console.log(`[INFO] URL YouTube disimpan: ${videoStr}`);
        }
      }

      // ── Konten non-file: quiz, tugas, diskusi ────────────────────────
      if (attachment.contentType && attachment.label) {
        const icon = CONTENT_TYPE_ICON[attachment.contentType] || "📌";
        const display = `${icon} ${attachment.label} [${attachment.contentType.toUpperCase()}]`;
        if (!contentItems.includes(display)) {
          contentItems.push(display);
          console.log(`[INFO] Konten dicatat: ${display}`);
        }
      }
    }
  }

  // ── Generate header.txt — format sesuai SSOT §5 ──────────────────────
  // SEMUA jenis konten dicantumkan: file, video, quiz, tugas, dll
  const materiLines: string[] = [];
  for (const f of downloadedFiles) {
    materiLines.push(`File        : ${f}`);
  }
  for (const v of youtubeUrls) {
    materiLines.push(`Video       : ${v}`);
  }
  for (const c of contentItems) {
    materiLines.push(`Konten      : ${c}`);
  }
  if (materiLines.length === 0) {
    materiLines.push("(tidak ada materi yang terdeteksi)");
  }

  // Catatan Dosen — label per item jika lebih dari satu
  const notesWithContent = learningMaterials.filter((m) => m.notes?.trim());
  const catatanLines: string[] = [];
  if (notesWithContent.length === 1) {
    catatanLines.push(notesWithContent[0]!.notes.trim());
  } else {
    for (const m of notesWithContent) {
      catatanLines.push(`[${m.title}]`);
      catatanLines.push(m.notes.trim());
      catatanLines.push("");
    }
  }

  const headerLines = [
    `Mata Kuliah : ${courseName}`,
    `Sesi        : ${sessionNumber}`,
    `Topik       : ${sessionTopic}`,
    `Tipe        : ${instructionType}`,
    "",
    "--- Materi ---",
    ...materiLines,
    "",
    "--- Catatan Dosen ---",
    ...(catatanLines.length > 0 ? catatanLines : ["(tidak ada catatan)"]),
    "",
    "--- Petunjuk untuk Chat AI ---",
    "Baca header ini. Jika ada File → cari di Google Drive folder sesi ini.",
    "Jika ada Video → buka URL, transkripsi, lalu gunakan sebagai bahan rangkuman.",
    "Jika ada Konten [QUIZ/TUGAS/DISKUSI] → buka link sesi di Edlink untuk mengerjakan.",
    "Jika Tipe = ACTION → cek bagian Catatan Dosen untuk detail instruksi yang perlu ditindaklanjuti.",
  ];

  const headerText = headerLines.join("\n");
  const headerPath = path.join(sessionDir, "header.txt");
  fs.writeFileSync(headerPath, headerText, "utf-8");
  console.log(`[SUCCESS] header.txt tersimpan di: ${headerPath}`);

  return { sessionDir, headerText, downloadedFiles, youtubeUrls, contentItems };
}
