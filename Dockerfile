# Menggunakan Node 26.3.0 secara eksplisit
FROM node:26.3.0-bookworm

# Set working directory di dalam container
WORKDIR /app

# Install dependencies yang dibutuhkan yt-dlp (ffmpeg, python3)
RUN apt-get update && apt-get install -y python3 ffmpeg wget && \
    wget https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -O /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Salin file konfigurasi package (agar cache docker lebih efisien)
COPY package.json package-lock.json* ./

# Install dependencies Node.js
RUN npm install

# Memaksa instalasi Browser Chromium beserta dependencies Linux-nya (karena kita tidak pakai image bawaan Microsoft lagi)
RUN npx playwright install --with-deps chromium

# Salin seluruh kode sumber ke dalam container
COPY . .

# Jalankan skrip utama kita (karena ini Cloud Run Job, tugas ini akan dieksekusi, lalu mati saat selesai)
CMD ["npx", "tsx", "src/index.ts"]
