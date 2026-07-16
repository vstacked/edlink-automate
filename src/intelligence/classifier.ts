import { generateWithFallback } from "./groq.js";

export interface SessionIntelligence {
  instruction_type: "STANDARD" | "ACTION";
  proper_topic: string;
}

/**
 * Meminta Groq AI untuk:
 * 1. Menentukan nama topik yang proper (mengganti "Sesi 12" menjadi topik aslinya dari nama file)
 * 2. Mengklasifikasikan apakah ini tugas/kuis (ACTION) atau sekedar materi (STANDARD)
 */
export async function classifySession(
  sessionTopic: string,
  learningMaterials: {
    title: string;
    notes: string;
    attachments: { filename?: string; label?: string; videoUrl?: string }[];
  }[]
): Promise<SessionIntelligence> {
  console.log(`\n[INFO] Mengklasifikasikan sesi via AI: "${sessionTopic}"...`);

  const materialDesc = learningMaterials
    .map((m, i) => {
      const attachDesc = m.attachments
        .map((a) => a.filename || a.label || (a.videoUrl ? "Video YouTube" : ""))
        .filter(Boolean)
        .join(", ");
      return `Materi ${i + 1}: [Judul: ${m.title}] [Catatan Dosen: ${
        m.notes || "(kosong)"
      }] [File/Konten: ${attachDesc || "(kosong)"}]`;
    })
    .join("\n");

  const prompt = `Kamu adalah asisten akademik super pintar. Analisa detail sesi perkuliahan ini.
Topik awal dari Edlink: "${sessionTopic}"
Daftar materi:
${materialDesc}

Tugasmu:
1. proper_topic: Nilai apakah 'Topik awal' di atas sudah mendeskripsikan materi. Jika hanya berisi kata-kata generik (misal: 'Sesi ke 12', 'Pertemuan 13'), carilah judul materi utama dari atribut 'Judul' pada daftar materi di atas. JIKA MENEMUKAN POLA JUDUL YANG SAMA/MIRIP (contoh: "Modul Teknik Perancangan Basis Data(Model Konseptual Basis Data)"), AMBIL STRING TERSEBUT SAMA PERSIS TANPA DIUBAH ATAU DIPARAFRASE. Cukup salin judul tersebut apa adanya (jangan mengubah bahasanya demi penyesuaian kalimat). Jika topik awalnya sudah bagus (bukan sekedar "Sesi..."), gunakan saja topik awalnya.
2. instruction_type: Apakah dari judul, tipe konten (misal quiz/tugas), atau 'Catatan Dosen' mengindikasikan mahasiswa harus bertindak (ada tugas, kuis, kumpulkan laporan, diskusi, hadiri vicon/video conference/zoom, dsb)? Jika YA -> ACTION. Jika tidak ada indikasi tugas (hanya membaca materi pasif) -> STANDARD.

KEMBALIKAN JAWABANMU HANYA DALAM FORMAT JSON BERIKUT (tanpa markdown atau teks pembuka apapun):
{
  "instruction_type": "ACTION atau STANDARD",
  "proper_topic": "Topik yang sudah dirapikan"
}
`;

  try {
    const response = await generateWithFallback(prompt);
    let raw = response.text.trim();

    // Hapus block <think>...</think> sepenuhnya jika ada,
    // karena model reasoning sering menaruh contoh JSON di dalam pikirannya
    // yang akan merusak regex kita.
    raw = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Ambil spesifik dari { pertama hingga } terakhir.
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      raw = jsonMatch[0];
    } else {
      throw new Error("Format JSON tidak ditemukan pada response AI.");
    }

    const data = JSON.parse(raw);

    const result: SessionIntelligence = {
      instruction_type: data.instruction_type === "ACTION" ? "ACTION" : "STANDARD",
      proper_topic: data.proper_topic || sessionTopic,
    };

    console.log(`[INFO] AI Classification Result:`);
    console.log(`       Topik Baru : ${result.proper_topic}`);
    console.log(`       Tipe       : ${result.instruction_type}`);

    return result;
  } catch (err: any) {
    console.log(`[WARN] Gagal memparsing JSON dari AI. Fallback ke STANDARD. Error: ${err.message}`);
    return {
      instruction_type: "STANDARD",
      proper_topic: sessionTopic,
    };
  }
}
