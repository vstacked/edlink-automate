import { chromium, type BrowserContext, type Page } from "playwright";
import * as dotenv from "dotenv";
import path from "path";
import { clearPopups } from "./utils.js";

// Mengambil environment variables dari file .env
dotenv.config();

/**
 * Fungsi untuk melakukan login ke platform Edlink
 * @returns {Promise<{ context: BrowserContext, page: Page }>}
 */
export async function loginToEdlink(): Promise<{
  context: BrowserContext;
  page: Page;
}> {
  const email = process.env.EDLINK_EMAIL;
  const password = process.env.EDLINK_PASSWORD;
  const baseUrl = process.env.EDLINK_BASE_URL || "https://edlink.id";

  if (!email || !password) {
    throw new Error(
      "[ERROR] EDLINK_EMAIL atau EDLINK_PASSWORD belum diatur di dalam file .env",
    );
  }

  console.log("[INFO] Memulai proses login ke Edlink...");
  // Gunakan headless: true (wajib untuk Cloud Run karena tidak ada monitor/GUI)
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.goto(`${baseUrl}/panel/`, { waitUntil: "domcontentloaded" });

    // Tunggu input email muncul dan ketik email
    await page.waitForSelector('input[type="text"]');
    await page.fill('input[type="text"]', email);

    // Tunggu input password muncul dan ketik password
    await page.waitForSelector('input[type="password"]');
    await page.fill('input[type="password"]', password);

    // Klik tombol submit/login
    await page.click('button[type="submit"]');

    console.log("[INFO] Sedang memvalidasi kredensial login...");

    // --- IMPLEMENTASI LOGIKA ASYNC MENUJU DASHBOARD ---
    // Kita menunggu elemen yang hanya ada di dashboard muncul untuk mengonfirmasi login berhasil.
    // Asumsi: Navbar profile atau daftar jadwal/kelas muncul saat berhasil login.
    // Jika dalam 15 detik elemen tidak muncul, Playwright akan melemparkan Error.
    await page.waitForSelector(".header__user-name, .avatar", {
      timeout: 15000,
    });

    console.log("[INFO] Login berhasil dikonfirmasi!");

    // --- PENANGANAN POPUP & MODAL ---
    // Karena popup ini bisa muncul kapan saja (terutama setelah navigasi),
    // kita menggunakan fungsi helper agar bisa dipanggil berkali-kali nanti.
    await clearPopups(page);

    return { context, page };
  } catch (error) {
    console.error(
      "[ERROR] Gagal login atau timeout menunggu dashboard:",
      error,
    );
    await page.screenshot({
      path: path.join(process.cwd(), "output", "error-login.png"),
    });
    throw error;
  }
}

// Block kode ini memungkinkan file dijalankan secara langsung dari CLI
// Contoh: npx tsx src/extraction/login.ts
if (process.argv[1] && process.argv[1].endsWith("login.ts")) {
  loginToEdlink()
    .then(({ context }) => {
      // Biarkan browser tetap terbuka sebentar untuk inspeksi
      console.log("[INFO] Script berjalan sebagai standalone.");
    })
    .catch((err) => {
      console.error("Standalone error:", err);
      process.exit(1);
    });
}
