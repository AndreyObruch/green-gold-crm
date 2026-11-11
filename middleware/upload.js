const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.docx', '.xlsx', '.csv', '.txt'];
const MAX_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 3;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) return cb(new Error('EXT_NOT_ALLOWED'));
  cb(null, true);
}

const upload = multer({ storage: storage, fileFilter: fileFilter, limits: { fileSize: MAX_SIZE, files: MAX_FILES } });

const SIGS = {
  '.png': [0x89, 0x50, 0x4E, 0x47],
  '.jpg': [0xFF, 0xD8, 0xFF],
  '.jpeg': [0xFF, 0xD8, 0xFF],
  '.pdf': [0x25, 0x50, 0x44, 0x66],
  '.docx': [0x50, 0x4B, 0x03, 0x04],
  '.xlsx': [0x50, 0x4B, 0x03, 0x04]
};

async function verifyMagic(filePath, ext) {
  const sig = SIGS[ext];
  if (!sig) return true;
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(sig.length);
    const r = await fh.read(buf, 0, sig.length, 0);
    if (r.bytesRead < sig.length) return false;
    return sig.every((b, i) => buf[i] === b);
  } finally {
    await fh.close();
  }
}

module.exports = { upload: upload, verifyMagic: verifyMagic, UPLOAD_DIR: UPLOAD_DIR, ALLOWED_EXT: ALLOWED_EXT, MAX_SIZE: MAX_SIZE, MAX_FILES: MAX_FILES };