import type { Page } from "playwright";
import { clearPopups } from "./utils.js";

export interface ExtractedPost {
  courseId: string;
  sectionId: string;
  sessionNumber: string; // Nomor sesi (contoh: "12" dari "Sesi ke 12")
  topic: string;
  sourceUrl: string;
  containerHandle: any; // ElementHandle untuk engage langsung
}

/**
 * Menavigasi ke halaman timeline (/panel), mengekstrak semua postingan materi
 * yang BELUM di-Like, langsung meng-Like setiap postingan tersebut,
 * lalu mengembalikannya untuk diproses di Layer 2 & 3.
 * @param page Playwright Page
 * @returns {Promise<ExtractedPost[]>}
 */
export async function getRecentPosts(page: Page): Promise<ExtractedPost[]> {
  const baseUrl = process.env.EDLINK_BASE_URL || "https://edlink.id";

  console.log("[INFO] Navigasi ke halaman timeline (/panel)...");
  await clearPopups(page);
  await page.goto(`${baseUrl}/panel`, { waitUntil: "domcontentloaded" });

  await page
    .waitForURL("**/panel*", { timeout: 15000 })
    .catch(() => console.log("[WARN] URL tidak persis /panel"));

  await clearPopups(page);

  console.log(
    "[INFO] Memastikan timeline termuat dan melakukan scroll (Infinity Scroll)...",
  );

  try {
    await page.waitForSelector(".box.is-boxed-3", {
      state: "visible",
      timeout: 15000,
    });
  } catch (e) {
    console.log(
      "[WARN] Tidak ditemukan postingan apapun, mungkin timeline kosong atau lambat memuat.",
    );
  }

  // Ambil konfigurasi scroll dari .env (default: 3 untuk harian)
  // Ubah ke angka yang lebih besar (misal 10-20) untuk sinkronisasi awal yang dalam
  const scrollCount = parseInt(process.env.SCROLL_COUNT || "3", 10);
  console.log(`[INFO] Melakukan scroll ke bawah sebanyak ${scrollCount} kali...`);

  for (let i = 0; i < scrollCount; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1500);
  }

  console.log("[INFO] Mengekstrak postingan materi dari timeline...");

  // Cari semua elemen <a> yang menuju ke section dan belum di-Like
  // Gunakan Playwright handles agar bisa diklik langsung (tidak lewat page.evaluate)
  const sectionLinkHandles = await page.$$(
    'a[href*="/panel/classes/"][href*="/sections/"]',
  );

  const result: ExtractedPost[] = [];

  for (const linkHandle of sectionLinkHandles) {
    const href = (await linkHandle.getAttribute("href")) || "";
    const text = (await linkHandle.innerText()).trim();

    // Parse courseId & sectionId dari URL
    const parts = href.split("/");
    const classIndex = parts.indexOf("classes");
    const sectionIndex = parts.indexOf("sections");
    const courseId = classIndex !== -1 ? parts[classIndex + 1] : "unknown";
    const sectionId = sectionIndex !== -1 ? parts[sectionIndex + 1] : "unknown";

    if (!sectionId) continue;

    // Cari container postingan yang punya tombol Like (naik sampai 10 level)
    const containerHandle = await linkHandle.evaluateHandle((el) => {
      let container: HTMLElement | null = el.parentElement;
      for (let depth = 0; depth < 10 && container; depth++) {
        if (
          container.querySelector(".mdi-heart:not(.mdi-heart-outline)") ||
          container.querySelector(".mdi-heart-outline")
        ) {
          return container;
        }
        container = container.parentElement;
      }
      return null;
    });

    // Jika tidak ada container dengan Like button, skip
    const containerElement = containerHandle.asElement();
    if (!containerElement) continue;

    // Cek apakah container ini sudah pernah kita proses di loop ini
    // (karena 1 container bisa punya >1 link)
    const isDuplicateContainer = await containerHandle.evaluate((el: HTMLElement) => {
      if (el.hasAttribute('data-bot-seen')) return true;
      el.setAttribute('data-bot-seen', 'true');
      return false;
    });

    if (isDuplicateContainer) continue;

    // Cek apakah sudah di-Like — hanya ambil yang belum
    const isLiked =
      (await containerElement.$(".mdi-heart:not(.mdi-heart-outline)")) !== null;

    if (isLiked) {
      console.log(`[SKIP] Sudah di-Like: ${sectionId}`);
      continue;
    }

    // Like akan dilakukan SETELAH extraction selesai (engage.ts) — tidak di sini
    console.log(`[INFO] Sesi ${sectionId} akan di-Like setelah extraction selesai.`);

    // Parse sessionNumber dari text ("Sesi ke 12" -> "12")
    const match = text.match(/\d+/);
    const sessionNumber = match ? match[0] : text;

    result.push({
      topic: text,
      sourceUrl: `${baseUrl}${href}`,
      courseId: courseId || "unknown",
      sectionId: sectionId || "unknown",
      sessionNumber,
      containerHandle: containerElement,
    });
  }

  console.log(
    `[INFO] Total akan diproses: ${result.length} postingan (sisanya sudah di-Like / skip).`,
  );

  return result;
}
