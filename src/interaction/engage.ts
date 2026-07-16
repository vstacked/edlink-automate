import type { Page, BrowserContext } from "playwright";
import { clearPopups } from "../extraction/utils.js";

/**
 * Melakukan engagement (Like + komentar "terima kasih") untuk satu sesi.
 * Harus dipanggil SETELAH extraction Layer 2 & 3 selesai — sesuai SSOT §6:
 * "Like dilakukan SETELAH extraction selesai, mencegah flag terset jika bot crash."
 *
 * Fix: scroll /panel sampai sectionId ditemukan, bukan hanya lihat viewport awal.
 *
 * @param page Playwright Page
 * @param sectionId ID sesi target
 * @param baseUrl URL dasar Edlink
 */
export async function engagePost(
  page: Page,
  containerElement: any,
  sectionId: string,
  instructionType: "STANDARD" | "ACTION" = "STANDARD"
): Promise<void> {
  console.log(`\n[INFO] [ENGAGE] Memulai engagement untuk sectionId: ${sectionId}`);

  try {
    if (!containerElement) {
      console.log(`[WARN] [ENGAGE] containerElement kosong untuk sectionId: ${sectionId}. Skip engagement.`);
      return;
    }

    // Scroll container ini ke tampilan user agar click bisa dilakukan
    await containerElement.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);

    // ── Step 1: Klik Like ────────────────────────────────────────────────
    const alreadyLiked =
      (await containerElement.$(".mdi-heart:not(.mdi-heart-outline)")) !== null;

    if (alreadyLiked) {
      console.log(`[INFO] [ENGAGE] Sesi ${sectionId} sudah di-Like.`);
    } else {
      const likeIcon = await containerElement.$(".mdi-heart-outline");
      if (likeIcon) {
        // Klik icon-nya langsung (event akan ter-bubble ke parent)
        await likeIcon.click({ force: true });
        
        // Tunggu class berubah dari mdi-heart-outline → mdi-heart
        await page

            .waitForFunction(
              (id: string) => {
                const links = document.querySelectorAll(`a[href*="/sections/${id}"]`);
                for (const link of Array.from(links)) {
                  let c: HTMLElement | null = (link as HTMLElement).parentElement;
                  for (let d = 0; d < 10 && c; d++) {
                    if (c.querySelector(".mdi-heart:not(.mdi-heart-outline)")) return true;
                    c = c.parentElement;
                  }
                }
                return false;
              },
              sectionId,
              { timeout: 5000 }
            )
            .catch(() => {
              console.log(`[WARN] [ENGAGE] Timeout konfirmasi Like untuk ${sectionId}.`);
            });
          console.log(`[SUCCESS] [ENGAGE] Like diberikan untuk sectionId: ${sectionId}`);
      } else {
        console.log(`[WARN] [ENGAGE] Tombol Like tidak ditemukan untuk sectionId: ${sectionId}`);
      }
    }

    // ── Step 2: Komentar (Hanya untuk STANDARD) ─────────────────────────
    if (instructionType === "ACTION") {
      console.log(`[INFO] [ENGAGE] Tipe instruksi ACTION (tugas/kuis). Bot tidak akan berkomentar (butuh aksi manual Anda).`);
      return;
    }

    try {
      const commentSelectors = [
        `textarea[placeholder*="komentar" i]`,
        `textarea[placeholder*="comment" i]`,
        `.comment-input textarea`,
        `.comment-box textarea`,
        `input[type="text"][placeholder*="komentar" i]`,
      ];
      let commentInput: any = null;
      for (const sel of commentSelectors) {
        commentInput = await containerElement.$(sel);
        if (commentInput) break;
      }

      if (!commentInput) {
        console.log(`[WARN] [ENGAGE] Input komentar tidak ditemukan untuk sectionId: ${sectionId}`);
        return;
      }

      await commentInput.fill("terima kasih");
      await page.waitForTimeout(500);

      let submitted = false;
      for (const sel of [
        `button[type="submit"]`,
        `button:has-text("Kirim")`,
        `button:has-text("Send")`,
        `.comment-submit`,
        `button:has-text("Post")`,
      ]) {
        const btn = await containerElement.$(sel);
        if (btn) { await btn.click(); submitted = true; break; }
      }
      if (!submitted) await commentInput.press("Enter");

      await page.waitForTimeout(1000);
      console.log(
        `[SUCCESS] [ENGAGE] Komentar "terima kasih" terkirim untuk sectionId: ${sectionId}`
      );
    } catch (commentErr: any) {
      console.log(`[WARN] [ENGAGE] Gagal mengirim komentar: ${commentErr.message || commentErr}`);
    }
  } catch (err: any) {
    console.log(
      `[ERROR] [ENGAGE] Gagal engage sectionId ${sectionId}: ${err.message || err}`
    );
    try { await page.screenshot({ path: `debug/error-engage-${sectionId}.png` }); } catch {}
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VIDEO PROGRESS WATCHER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Memutar semua video YouTube dalam satu sesi hingga selesai di tab baru,
 * agar progress Edlink terhitung (0% → 100%).
 *
 * Strategi:
 * - Buka tab BARU per video (pipeline tab tidak terganggu)
 * - Play natural dari posisi saat ini (NO seek — per permintaan user)
 * - Get duration dari YouTube player API
 * - Poll progress bar Edlink setiap 30s hingga ≥95% atau timeout
 * - Tutup tab setelah selesai
 *
 * @param context BrowserContext untuk membuka tab baru
 * @param learningMaterials Daftar materi Layer 3
 */
export async function watchVideos(
  context: BrowserContext,
  learningMaterials: {
    sourceUrl: string;
    title: string;
    attachments: { videoUrl?: string; filename?: string; url?: string; contentType?: string }[];
  }[]
): Promise<void> {
  const materialsWithVideo = learningMaterials.filter((m) =>
    m.attachments.some((a) => a.videoUrl)
  );

  if (materialsWithVideo.length === 0) {
    console.log("[INFO] [WATCH] Tidak ada video dalam sesi ini. Skip.");
    return;
  }

  console.log(`\n[INFO] [WATCH] ${materialsWithVideo.length} video ditemukan.`);

  for (const material of materialsWithVideo) {
    console.log(`\n[INFO] [WATCH] Memutar (tab baru): "${material.title}"`);

    let videoPage!: Page;
    try {
      // Buka tab baru agar pipeline tab tidak terganggu
      videoPage = await context.newPage();
      await videoPage.goto(material.sourceUrl, { waitUntil: "domcontentloaded" });
      await clearPopups(videoPage);

      // Cek progress sekarang — jika sudah ≥95%, skip
      try {
        const currentProgress = await videoPage.$eval(
          "progress.progress",
          (el) => parseFloat((el as HTMLProgressElement).value.toString())
        );
        if (currentProgress >= 95) {
          console.log(`[INFO] [WATCH] Progress sudah ${currentProgress}% — skip.`);
          await videoPage.close();
          continue;
        }
        console.log(`[INFO] [WATCH] Progress saat ini: ${currentProgress}%`);
      } catch {}

      // Tunggu iframe YouTube ter-load
      const iframeEl = await videoPage
        .waitForSelector("iframe#player", { timeout: 15000 })
        .catch(() => null);
      if (!iframeEl) {
        console.log(`[WARN] [WATCH] iframe#player tidak ditemukan: "${material.title}"`);
        continue;
      }

      // Bawa tab ini ke depan agar browser tidak pause video background
      await videoPage.bringToFront();
      await videoPage.waitForTimeout(3000); // tunggu YouTube JS init

      // Klik tengah iframe untuk mensimulasikan interaksi user (mencegah autoplay block dari browser)
      try {
        await iframeEl.click({ force: true, position: { x: 320, y: 180 } });
      } catch {}

      // Cari YouTube frame
      const ytFrame = videoPage.frames().find((f) => f.url().includes("youtube.com/embed"));

      let duration = 0;
      let playerReady = false;

      if (ytFrame) {
        // Tunggu hingga player siap (getDuration > 0), max 15 detik
        for (let attempt = 0; attempt < 5; attempt++) {
          try {
            const result = await ytFrame.evaluate(() => {
              const p = (document as any).getElementById("movie_player");
              if (!p || typeof p.getDuration !== "function") return 0;
              return p.getDuration();
            });
            if (result > 0) {
              duration = result;
              playerReady = true;
              break;
            }
          } catch {}
          await videoPage.waitForTimeout(3000);
        }

        if (playerReady) {
          // Play dari posisi saat ini (NO seek)
          await ytFrame.evaluate(() => {
            const p = (document as any).getElementById("movie_player");
            p?.playVideo();
          });
          console.log(`[INFO] [WATCH] Durasi: ${Math.round(duration)}s. Memutar...`);
        } else {
          console.log(`[WARN] [WATCH] Player belum siap. Coba postMessage fallback.`);
        }
      }

      // Fallback: postMessage jika frame tidak accessible
      if (!playerReady) {
        await videoPage.evaluate(() => {
          const iframe = document.querySelector("iframe#player") as HTMLIFrameElement;
          if (!iframe?.contentWindow) return;
          iframe.contentWindow.postMessage(
            JSON.stringify({ event: "command", func: "playVideo", args: [] }),
            "*"
          );
        });
        // Estimasi duration 30 menit jika tidak bisa ambil dari player
        duration = duration || 1800;
      }

      // ── Poll progress setiap 30 detik hingga selesai ─────────────────
      const maxWaitMs = (duration + 120) * 1000; // duration + 2 min buffer
      const pollMs = 30_000;
      let elapsed = 0;
      let done = false;

      console.log(`[INFO] [WATCH] Menunggu video selesai (max ${Math.round(maxWaitMs / 60000)} menit)...`);

      while (elapsed < maxWaitMs && !done) {
        await videoPage.waitForTimeout(pollMs);
        elapsed += pollMs;

        // Cek progress bar Edlink
        try {
          const progress = await videoPage.$eval(
            "progress.progress",
            (el) => parseFloat((el as HTMLProgressElement).value.toString())
          );
          console.log(
            `[INFO] [WATCH] Progress: ${progress}% ` +
            `(${Math.round(elapsed / 1000)}s / ${Math.round(duration)}s)`
          );
          if (progress >= 95) { done = true; break; }
        } catch {}

        // Juga cek YouTube player state (0 = ENDED)
        if (ytFrame && playerReady) {
          try {
            const state = await ytFrame.evaluate(() => {
              const p = (document as any).getElementById("movie_player");
              return p?.getPlayerState?.() ?? -1;
            });
            if (state === 0) {
              console.log(`[INFO] [WATCH] YouTube player state: ENDED`);
              // Tunggu 5 detik agar Edlink proses event sebelum cek progress
              await videoPage.waitForTimeout(5000);
              done = true;
            }
          } catch {}
        }
      }

      if (done) {
        console.log(`[SUCCESS] [WATCH] ✅ Video "${material.title}" selesai.`);
      } else {
        console.log(`[WARN] [WATCH] Timeout menunggu video "${material.title}". Lanjut pipeline.`);
      }

    } catch (err: any) {
      console.log(`[ERROR] [WATCH] Gagal memutar "${material.title}": ${err.message || err}`);
      try { if (videoPage) await videoPage.screenshot({ path: `debug/error-watch-${Date.now()}.png` }); } catch {}
    } finally {
      try {
        if (videoPage && !videoPage.isClosed()) {
          await videoPage.close();
          console.log(`[INFO] [WATCH] Tab video ditutup.`);
        }
      } catch {}
    }
  }
}
