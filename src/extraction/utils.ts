import type { Page } from 'playwright';

/**
 * Fungsi utilitas untuk mengecek dan menutup berbagai jenis popup/modal
 * secara OTOMATIS dan TERUS-MENERUS di latar belakang.
 * Sangat cocok untuk SPA di mana popup bisa muncul mendadak saat scrolling.
 */
export async function clearPopups(page: Page) {
    try {
        const scriptContent = `
            if (!window.__popupBlockerActive) {
                window.__popupBlockerActive = true;
                console.log('[Bot] Popup blocker aktif di background.');

                setInterval(() => {
                    // Kasus 1: HTML Notifikasi Dinonaktifkan
                    // <div class="blocked-guide-header"><button class="close-btn">...</button></div>
                    const blockedGuideBtns = document.querySelectorAll('.blocked-guide-header button.close-btn');
                    blockedGuideBtns.forEach(btn => {
                        try { btn.click(); } catch(e) {}
                    });

                    // Kasus 2: HTML Modal Newsletter (Berita Kampus)
                    // Mengandung button dengan teks "Tutup" di dalam footer
                    const modalFooterBtns = document.querySelectorAll('.modal.is-active .modal-card-foot button');
                    modalFooterBtns.forEach(btn => {
                        const text = btn.textContent ? btn.textContent.trim().toLowerCase() : '';
                        if (text === 'tutup') {
                            try { btn.click(); } catch(e) {}
                        }
                    });
                }, 1000);
            }
        `;

        // 1. Suntikkan agar otomatis berjalan di setiap halaman / navigasi baru (misal pindah layer)
        await page.addInitScript(scriptContent);

        // 2. Eksekusi juga langsung di halaman saat ini (berjaga-jaga jika halaman sudah termuat)
        await page.evaluate(scriptContent);
        
        await page.waitForTimeout(1000);
        
    } catch (e) {
        console.log('[WARN] Terjadi error saat mengaktifkan popup blocker...', e);
    }
}
