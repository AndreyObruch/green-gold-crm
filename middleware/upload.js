const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
const MAX_FILES = 3;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.docx',
  '.xlsx',
  '.csv',
  '.txt',
  '.md'
]);

if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

function decodeName(name) {
  if (!name) return name;
  try {
    const fixed = Buffer.from(name, 'latin1').toString('utf8');
    if (fixed.indexOf('\uFFFD') !== -1) return name;
    return fixed;
  } catch (e) {
    return name;
  }
}

function safeExt(originalname) {
  const ext = path.extname(decodeName(originalname) || '').toLowerCase();
  return ALLOWED_EXT.has(ext) ? ext : '';
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = safeExt(file.originalname) || path.extname(file.originalname).toLowerCase();
    const base = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    cb(null, base + ext);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
    files: MAX_FILES,
    fields: 20,
    fieldSize: 1024 * 1024
  }
});

async function readHead(filePath, length = 1024) {
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fd.read(buf, 0, length, 0);
    return buf.slice(0, bytesRead);
  } finally {
    await fd.close();
  }
}

function startsWith(buf, sig) {
  if (!buf || buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[i] !== sig[i]) return false;
  }
  return true;
}

function isProbablyText(buf) {
  if (!buf || buf.length === 0) return true;

  if (startsWith(buf, [0xFF, 0xFE]) || startsWith(buf, [0xFE, 0xFF])) return true;
  if (startsWith(buf, [0xEF, 0xBB, 0xBF])) return true;

  return buf.indexOf(0x00) === -1;
}

async function verifyMagic(filePath, extRaw) {
  const ext = String(extRaw || '').toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return false;

  let head;
  try {
    head = await readHead(filePath, 1024);
  } catch (e) {
    return false;
  }

  switch (ext) {
    case '.pdf':
      return startsWith(head, [0x25, 0x50, 0x44, 0x46]);

    case '.png':
      return startsWith(head, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    case '.jpg':
    case '.jpeg':
      return head.length >= 2 && head[0] === 0xFF && head[1] === 0xD8;

    case '.docx':
    case '.xlsx':
      return head.length >= 4 &&
        head[0] === 0x50 &&
        head[1] === 0x4B &&
        ((head[2] === 0x03 && head[3] === 0x04) || (head[2] === 0x05 && head[3] === 0x06));

    case '.txt':
    case '.csv':
    case '.md':
      return isProbablyText(head);

    default:
      return false;
  }
}

module.exports = {
  upload,
  UPLOAD_DIR,
  MAX_FILES,
  MAX_FILE_SIZE,
  ALLOWED_EXT,
  verifyMagic,
  decodeName
};