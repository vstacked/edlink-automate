import type { Page } from "playwright";
import { clearPopups } from "./utils.js";

export interface AttachmentFile {
  filename: string;
  url: string;
}

export interface AttachmentVideo {
  videoUrl: string;
}

/** Konten non-file: quiz, tugas, diskusi, forum, dll — tetap dilaporkan di header & telegram */
export interface AttachmentContent {
  contentType: "quiz" | "tugas" | "diskusi" | "forum" | "vicon" | "lainnya";
  label: string;
}

export type Attachment = AttachmentFile | AttachmentVideo | AttachmentContent;

export interface LearningMaterial {
  learningMaterialId: string;
  sourceUrl: string;
  title: string;
  notes: string;
  attachments: Attachment[];
}

export interface SectionDetails {
  courseName: string;
  topic: string;
  learningObjective: string;
  learningMaterials: LearningMaterial[];
}

/**
 * Eksekutor Layer 2 & Layer 3 sesuai SSOT edlink-pipeline.md
 */
export async function extractPostDetails(
  page: Page,
  sourceUrl: string,
): Promise<SectionDetails> {
  console.log(`\n[INFO] [LAYER 2] Membuka daftar materi sesi: ${sourceUrl}`);
  const baseUrl = process.env.EDLINK_BASE_URL || "https://edlink.id";

  await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
  await clearPopups(page);

  // SPA SPA SPA: Beri waktu Edlink untuk fetch API dan merender elemen
  await page.waitForTimeout(2000);
  await page.waitForSelector("p.title.font-24.font-w-600", { timeout: 10000 }).catch(() => {});

  // Ambil nama mata kuliah dari elemen p.title.font-24.font-w-600 di Layer 2
  let courseName = "";
  try {
    courseName = await page.$eval(
      "p.title.font-24.font-w-600",
      (el) => (el as HTMLElement).innerText?.trim() || ""
    );
    console.log(`[INFO] [LAYER 2] Mata Kuliah: ${courseName || "-"}`);
  } catch (e) {
    console.log("[WARN] Gagal mengekstrak nama mata kuliah di Layer 2.");
  }

  // Ambil Topik & learningObjective dari kotak "Informasi" di Layer 2
  let learningObjective = "";
  let topic = "";

  try {
    const infoData = await page.$$eval(".field", (fields) => {
      let foundTopic = "";
      let foundObj = "";
      for (const field of fields) {
        const label = field.querySelector(".label")?.textContent?.trim();
        if (label === "Topik") {
          const span = field.querySelector("span:not(.label), div:not(.label)");
          if (span) foundTopic = (span as HTMLElement).innerText?.trim() || "";
        } else if (label === "Tujuan Pembelajaran") {
          const content = field.querySelector(".content");
          if (content)
            foundObj = (content as HTMLElement).innerText?.trim() || "";
        }
      }
      return { foundTopic, foundObj };
    });
    topic = infoData.foundTopic;
    learningObjective = infoData.foundObj;
    console.log(
      `[INFO] [LAYER 2] Topik: ${topic || "-"} | Tujuan Pembelajaran: ${learningObjective ? "Ada" : "Kosong"}`,
    );
  } catch (e) {
    console.log("[WARN] Gagal mengekstrak kotak Informasi di Layer 2.");
  }

  // Mengumpulkan semua link materi (Layer 3) dari Layer 2
  // Ekstrak path dasar (misal: /panel/classes/1896839/sections/28276409)
  const basePath = new URL(sourceUrl).pathname.replace(/\/$/, "");

  const rawSubLinks = await page.$$eval('a[href*="/sections/"]', (links) =>
    links.map((a) => a.getAttribute("href") || ""),
  );

  // Filter dan ekstrak ID
  const uniqueMaterials = Array.from(new Set(rawSubLinks))
    .map((href) => {
      // [CRITICAL FIX] Pastikan link tersebut adalah "anak" dari Sesi ini
      // Ini mencegah bot mengklik link Sesi lain yang mungkin ada di sidebar/menu navigasi
      if (!href.includes(basePath)) return null;

      const parts = href.split("/").filter(Boolean);
      const sectionIdx = parts.indexOf("sections");
      // Pastikan formatnya berujung pada materialId tambahan di belakang sectionId
      // Contoh valid: .../sections/28276409/7835371 (ada index + 2)
      if (sectionIdx !== -1 && parts.length > sectionIdx + 2) {
        const learningMaterialId = parts[sectionIdx + 2];
        return {
          learningMaterialId,
          href,
        };
      }
      return null;
    })
    .filter((item) => item !== null) as {
    learningMaterialId: string;
    href: string;
  }[];

  console.log(
    `[INFO] [LAYER 2] Ditemukan ${uniqueMaterials.length} item bahan pembelajaran (learningMaterials).`,
  );

  const learningMaterials: LearningMaterial[] = [];

  // Layer 3: Loop setiap materi spesifik
  for (let i = 0; i < uniqueMaterials.length; i++) {
    const material = uniqueMaterials[i]!;
    const fullSubLink = material.href.startsWith("http")
      ? material.href
      : `${baseUrl}${material.href}`;

    console.log(
      `[INFO] [LAYER 3 - ${i + 1}/${uniqueMaterials.length}] Membuka: ${fullSubLink}`,
    );
    await page.goto(fullSubLink, { waitUntil: "domcontentloaded" });
    await clearPopups(page);

    // SPA SPA SPA: Beri waktu Edlink merender materi di Layer 3
    await page.waitForTimeout(2000);
    await page.waitForSelector("h3.title.is-5, h3.title", { timeout: 10000 }).catch(() => {});

    let title = "";
    let notes = "";
    const attachments: Attachment[] = [];

    // 1. Ambil Judul Materi (Lapis 3)
    try {
      title = await page.$eval(
        "h3.title.is-5, h3.title",
        (el) => el.textContent?.trim() || "",
      );
    } catch (e) {}

    // 2. Ambil Notes (Catatan Dosen) (Lapis 3)
    try {
      notes = await page.$$eval(".card.is-boxed", (cards) => {
        for (const card of cards) {
          const header = card.querySelector(".card-header-title");
          if (header && header.textContent?.trim() === "Catatan") {
            const content = card.querySelector(".card-content");
            return (
              (content as HTMLElement)?.innerText?.trim() ||
              content?.textContent?.trim() ||
              ""
            );
          }
        }
        return "";
      });
    } catch (e) {}

    // 3. Deteksi Video (Bisa jadi ada lebih dari satu, atau selector bukan #player)
    try {
      // Beri waktu 5 detik barangkali iframe di-render terlambat oleh JS Edlink
      await page.waitForSelector("iframe", { timeout: 5000 }).catch(() => null);

      const iframes = await page.$$("iframe");
      for (const iframe of iframes) {
        const src = await iframe.getAttribute("src");
        if (src && (src.includes("youtube.com") || src.includes("youtu.be"))) {
          // Gunakan full URL (termasuk origin=... agar progress postMessage Edlink tetap valid)
          const videoUrl = src;
          attachments.push({ videoUrl });
          console.log(`[SUCCESS] Ditemukan video: ${videoUrl}`);
        }
      }
    } catch (e) {
      console.log("[WARN] Gagal mencari iframe video:", e);
    }

    // 4. Deteksi File/Dokumen (Bisa lebih dari satu dokumen)
    try {
      const downloadBtns = await page.$$(".post-media-item");
      for (const item of downloadBtns) {
        const btn = await item.$(".post-media-item__download");
        if (btn) {
          let filename = "unknown";
          try {
            filename = await item.$eval(
              ".post-media-item__filename",
              (el) => el.textContent?.trim() || "unknown",
            );
          } catch (e) {}

          console.log(`[INFO] Mencegat download dokumen: ${filename}...`);
          const [download] = await Promise.all([
            page.waitForEvent("download", { timeout: 15000 }),
            btn.click(),
          ]);
          attachments.push({ filename, url: download.url() });
          console.log(`[SUCCESS] URL download berhasil didapat: ${filename}`);
        }
      }
    } catch (e) {
      console.log("[WARN] Gagal mencari/mengekstrak dokumen:", e);
    }

    // 5. Jika tidak ada attachment (file/video) — deteksi tipe konten dari judul + elemen halaman
    //    Quiz, tugas, diskusi tetap dilaporkan walaupun tidak ada file yang bisa diunduh
    if (attachments.length === 0) {
      const titleLower = title.toLowerCase();
      let contentType: "quiz" | "tugas" | "diskusi" | "forum" | "vicon" | "lainnya" = "lainnya";

      if (/\b(quiz|kuis)\b/.test(titleLower)) {
        contentType = "quiz";
      } else if (/\btugas\b/.test(titleLower)) {
        contentType = "tugas";
      } else if (/\b(diskusi|forum|discussion)\b/.test(titleLower)) {
        contentType = "diskusi";
      } else if (/\b(vicon|video conference|video konferensi|zoom|gmeet|google meet)\b/.test(titleLower)) {
        contentType = "vicon";
      }

      // Konfirmasi dari elemen halaman jika title tidak cukup jelas
      try {
        const hasQuizElements = await page.$(
          ".quiz-container, form[class*='quiz'], .question-item, input[type='radio'], input[type='checkbox'][name*='answer']"
        ) !== null;
        if (hasQuizElements && contentType === "lainnya") {
          contentType = "quiz";
        }
      } catch {}

      attachments.push({ contentType, label: title });
      console.log(`[INFO] Konten non-file terdeteksi: [${contentType.toUpperCase()}] "${title}"`);
    }

    learningMaterials.push({
      learningMaterialId: material.learningMaterialId,
      sourceUrl: fullSubLink,
      title,
      notes,
      attachments,
    });
  }

  return { courseName, topic, learningObjective, learningMaterials };
}
