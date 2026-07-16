import { Groq } from "groq-sdk";

// Instance tunggal Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

/**
 * Pengganti generateWithFallback yang sebelumnya menggunakan Gemini.
 * Sekarang menggunakan Groq SDK dengan model llama-3.1-8b-instant sesuai permintaan.
 *
 * @param prompt - Isi prompt
 * @returns Object berisi teks hasil (kompatibel dengan ekspektasi classifier)
 */
export async function generateWithFallback(
  prompt: string,
): Promise<{ text: string }> {
  let fullText = "";

  console.log(`[INFO] Mengirim prompt ke Groq (qwen/qwen3.6-27b)...`);
  const chatCompletion = await groq.chat.completions.create({
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    model: "qwen/qwen3.6-27b",
    temperature: 0.6,
    max_completion_tokens: 4096,
    top_p: 0.95,
    stream: true,
    // @ts-ignore
    reasoning_effort: "default",
    stop: null,
  });

  // Kumpulkan semua chunk stream dan tampilkan ke console
  for await (const chunk of chatCompletion) {
    const content = chunk.choices[0]?.delta?.content || "";
    process.stdout.write(content);
    fullText += content;
  }
  process.stdout.write("\n");

  console.log(`[INFO] ✓ Berhasil menerima response dari Groq.`);
  return { text: fullText };
}
