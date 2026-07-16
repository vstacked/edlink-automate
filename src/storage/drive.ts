import { google } from "googleapis";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import process from "process";
import * as http from "http";
import url from "url";

const SCOPES = ["https://www.googleapis.com/auth/drive"];
const TOKEN_PATH =
  process.env.GOOGLE_TOKEN_PATH || path.join(process.cwd(), "token.json");
const CREDENTIALS_PATH =
  process.env.GOOGLE_CREDENTIALS_PATH ||
  path.join(process.cwd(), "credentials.json");

/**
 * Membaca token.json jika sudah ada (agar tidak perlu login ulang).
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH, "utf-8");
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Menyimpan token.json setelah berhasil login pertama kali.
 */
async function saveCredentials(client: any) {
  const content = await fs.readFile(CREDENTIALS_PATH, "utf-8");
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: "authorized_user",
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Mendapatkan otorisasi manual (Local Server)
 * Kita gunakan fungsi custom karena @google-cloud/local-auth kadang
 * gagal membuka browser di environment tertentu (seperti WSL/Server).
 */
async function authorizeManual(credentialsPath: string): Promise<any> {
  const content = await fs.readFile(credentialsPath, "utf-8");
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;

  const oauth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    "http://localhost:3000/oauth2callback",
  );

  return new Promise((resolve, reject) => {
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: SCOPES,
    });

    console.log("====================================================");
    console.log("1. Silakan KLIK TAUTAN INI untuk Otorisasi Google Drive:");
    console.log(`\n${authUrl}\n`);
    console.log(
      "2. Menunggu balasan dari browser di http://localhost:3000 ...",
    );
    console.log("====================================================\n");

    const server = http.createServer(async (req, res) => {
      try {
        if (req.url && req.url.startsWith("/oauth2callback")) {
          const qs = new url.URL(req.url, "http://localhost:3000").searchParams;
          const code = qs.get("code");

          if (code) {
            res.end(
              "Otorisasi berhasil! Silakan tutup tab browser ini dan kembali ke terminal Anda.",
            );
            server.close();

            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            resolve(oauth2Client);
          } else {
            res.end("Otorisasi gagal. Kode tidak ditemukan.");
            server.close();
            reject(new Error("Kode otorisasi tidak ditemukan di URL."));
          }
        }
      } catch (error) {
        res.end("Terjadi kesalahan internal.");
        server.close();
        reject(error);
      }
    });

    server.listen(3000);
  });
}

/**
 * Mengautentikasi dan mengembalikan client Drive.
 */
async function authorize() {
  let client: any = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }

  console.log("\n[INFO] Otorisasi diperlukan karena token.json belum ada.");
  client = await authorizeManual(CREDENTIALS_PATH);

  if (client.credentials) {
    await saveCredentials(client);
    console.log("[SUCCESS] Token berhasil disimpan ke token.json\n");
  }
  return client;
}

// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS DRIVE
// ─────────────────────────────────────────────────────────────

async function getOrCreateFolder(
  drive: any,
  name: string,
  parentId: string,
): Promise<string> {
  const query = `name = '${name}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;

  let response;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await drive.files.list({
        q: query,
        fields: "files(id, name)",
        spaces: "drive",
      });
      break;
    } catch (err: any) {
      console.log(
        `[WARN] Gagal mencari folder ${name} di Drive (percobaan ${attempt}):`,
        err.message || err.code,
      );
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }

  if (response && response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  console.log(`[INFO] Membuat folder baru di Drive: "${name}"...`);
  const folderMetadata = {
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [parentId],
  };

  let folder;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      folder = await drive.files.create({
        requestBody: folderMetadata,
        fields: "id",
      });
      break;
    } catch (err: any) {
      console.log(
        `[WARN] Gagal membuat folder ${name} di Drive (percobaan ${attempt}):`,
        err.message || err.code,
      );
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }

  return folder.data.id!;
}

async function uploadFileToDrive(
  drive: any,
  localFilePath: string,
  folderId: string,
  mimeType: string,
): Promise<void> {
  const fileName = path.basename(localFilePath);

  const query = `name = '${fileName}' and '${folderId}' in parents and trashed = false`;
  const existingFiles = await drive.files.list({
    q: query,
    fields: "files(id, name)",
    spaces: "drive",
  });

  if (existingFiles.data.files && existingFiles.data.files.length > 0) {
    console.log(
      `[INFO] File ${fileName} sudah ada di Drive. Menimpa file lama...`,
    );
    const fileId = existingFiles.data.files[0].id!;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await drive.files.update({
          fileId,
          media: {
            mimeType,
            body: fsSync.createReadStream(localFilePath),
          },
        });
        return;
      } catch (err: any) {
        console.log(
          `[WARN] Gagal update ${fileName} di Drive (percobaan ${attempt}):`,
          err.message || err.code,
        );
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 3000 * attempt));
      }
    }
    return;
  }

  console.log(`[INFO] Mengunggah ${fileName} ke Drive...`);
  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };
  const media = {
    mimeType,
    body: fsSync.createReadStream(localFilePath),
  };

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await drive.files.create({
        requestBody: fileMetadata,
        media: {
          mimeType,
          body: fsSync.createReadStream(localFilePath), // re-create stream tiap retry
        },
        fields: "id",
      });
      return;
    } catch (err: any) {
      console.log(
        `[WARN] Gagal upload ${fileName} ke Drive (percobaan ${attempt}):`,
        err.message || err.code,
      );
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

// ─────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────

export async function uploadSessionToDrive(
  courseName: string,
  sessionNumber: string,
  sessionDir: string,
): Promise<string> {
  const rootFolderId = process.env.GOOGLE_DRIVE_SEMESTER_FOLDER_ID;
  if (!rootFolderId)
    throw new Error("GOOGLE_DRIVE_SEMESTER_FOLDER_ID belum diisi di .env");

  const authClient = await authorize();
  const drive = google.drive({ version: "v3", auth: authClient });

  const safeCourseName = courseName.replace(/[\/\\]/g, "-").trim();
  const courseFolderId = await getOrCreateFolder(
    drive,
    safeCourseName,
    rootFolderId,
  );

  const sessionFolderName = sessionNumber.toString().trim();
  const sessionFolderId = await getOrCreateFolder(
    drive,
    sessionFolderName,
    courseFolderId,
  );

  // Fungsi helper internal untuk upload satu level folder
  const uploadDirContent = async (localDir: string, driveParentId: string) => {
    const items = await fs.readdir(localDir);
    for (const item of items) {
      const localItemPath = path.join(localDir, item);
      const stat = await fs.stat(localItemPath);

      if (stat.isFile()) {
        const ext = path.extname(item).toLowerCase();
        let mimeType = "application/octet-stream";
        if (ext === ".pdf") mimeType = "application/pdf";
        else if (ext === ".pptx")
          mimeType =
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";
        else if (ext === ".docx")
          mimeType =
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        else if (ext === ".txt") mimeType = "text/plain";

        try {
          await uploadFileToDrive(
            drive,
            localItemPath,
            driveParentId,
            mimeType,
          );
        } catch (err) {
          console.log(`[WARN] Gagal mengunggah ${item} ke Drive:`, err);
        }
      } else if (stat.isDirectory()) {
        // Jika item adalah folder (misal: "Bahan_AI"), buat folder tersebut di Drive lalu rekursif
        const subFolderId = await getOrCreateFolder(drive, item, driveParentId);
        await uploadDirContent(localItemPath, subFolderId);
      }
    }
  };

  // 3. Upload semua file dari sessionDir ke folder Sesi
  await uploadDirContent(sessionDir, sessionFolderId);

  return `https://drive.google.com/drive/folders/${sessionFolderId}`;
}
