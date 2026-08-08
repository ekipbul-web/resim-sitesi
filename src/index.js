// =============================================
//  IMGFAST - Profesyonel Resim Yükleme
//  Cloudflare R2 + Render.com
// =============================================

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { nanoid } = require('nanoid');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

const ALLOWED_TYPES = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp',
    'image/bmp': '.bmp'
};

// Cloudflare R2 Bağlantısı
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;

// =============================================
//  MIDDLEWARE
// =============================================

// Güvenlik başlıkları
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// Rate limiting
const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Çok fazla yükleme yaptınız. Lütfen 1 dakika bekleyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
}));

// Statik dosyalar
app.use(express.static('public'));

// EJS template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parser
app.use(express.json());

// =============================================
//  MULTER KONFİGÜRASYONU
// =============================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES[file.mimetype]) {
            cb(null, true);
        } else {
            cb(new Error('Desteklenmeyen dosya formatı. Sadece JPG, PNG, GIF, WebP ve BMP yüklenebilir.'));
        }
    }
});

// =============================================
//  ROUTE'LAR
// =============================================

// Ana sayfa
app.get('/', (req, res) => {
    res.render('home', {
        siteUrl: process.env.SITE_URL || `http://localhost:${PORT}`,
        maxFileSize: MAX_FILE_SIZE,
    });
});

// Yükleme API
app.post('/upload', uploadLimiter, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Lütfen bir resim dosyası seçin.' });
        }

        const ext = ALLOWED_TYPES[req.file.mimetype] || '.jpg';
        const fileKey = `${nanoid(12)}${ext}`;

        let processedBuffer;

        // GIF ise olduğu gibi bırak, değilse optimize et
        if (req.file.mimetype === 'image/gif') {
            processedBuffer = req.file.buffer;
        } else {
            processedBuffer = await sharp(req.file.buffer)
                .rotate()
                .resize({ width: 2560, withoutEnlargement: true })
                .jpeg({ quality: 85, progressive: true })
                .toBuffer();
        }

        // R2'ye yükle
        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileKey,
            Body: processedBuffer,
            ContentType: req.file.mimetype === 'image/gif' ? 'image/gif' : 'image/jpeg',
            CacheControl: 'public, max-age=31536000, immutable',
        }));

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`;
        const siteUrl = process.env.SITE_URL || `http://localhost:${PORT}`;
        const deleteUrl = `${siteUrl}/delete/${fileKey}`;

        return res.json({
            success: true,
            url: publicUrl,
            html: `<img src="${publicUrl}" alt="ImgFast" loading="lazy">`,
            bbcode: `[img]${publicUrl}[/img]`,
            markdown: `![](${publicUrl})`,
            deleteUrl: deleteUrl,
        });

    } catch (err) {
        console.error('Yükleme hatası:', err);
        return res.status(500).json({ error: 'Sunucu hatası. Lütfen tekrar deneyin.' });
    }
});

// Silme sayfası
app.get('/delete/:key', async (req, res) => {
    try {
        const { key } = req.params;

        if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
            return res.status(400).render('delete', { success: false, message: 'Geçersiz bağlantı.' });
        }

        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));

        res.render('delete', { success: true, message: 'Resim başarıyla silindi.' });
    } catch (err) {
        console.error('Silme hatası:', err);
        res.render('delete', { success: false, message: 'Silme işlemi başarısız oldu.' });
    }
});

// 404
app.use((req, res) => {
    res.status(404).render('delete', { success: false, message: 'Sayfa bulunamadı.' });
});

// Hata yakalama
app.use((err, req, res, next) => {
    console.error('Hata:', err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Dosya boyutu 10 MB\'dan büyük olamaz.' });
        }
        return res.status(400).json({ error: 'Dosya yükleme hatası.' });
    }
    res.status(500).json({ error: 'Beklenmeyen bir hata oluştu.' });
});

// =============================================
//  BAŞLAT
// =============================================
app.listen(PORT, () => {
    console.log(`✅ ImgFast başlatıldı - Port: ${PORT}`);
});
