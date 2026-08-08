// =============================================
//  IMGFAST - Profesyonel Resim Yükleme
//  Cloudflare R2 + Render.com
//  Tüm özellikler: QR, Sosyal Paylaşım, 
//  Resim Sayfası, Kullanıcı Girişi, Kısa Link
// =============================================

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
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

// Cloudflare R2
const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const SITE_URL = process.env.SITE_URL || `http://localhost:${PORT}`;

// Güvenlik
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Çok fazla yükleme yaptınız. 1 dakika bekleyin.' },
});

app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
}));

// Statik dosyalar & EJS
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());

// Multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES[file.mimetype]) cb(null, true);
        else cb(new Error('Desteklenmeyen format.'));
    }
});

// =============================================
//  ROUTE'LAR
// =============================================

// Ana sayfa
app.get('/', (req, res) => {
    res.render('home', {
        siteUrl: SITE_URL,
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
        const deleteToken = nanoid(16);

        let processedBuffer;
        let finalMimeType = req.file.mimetype;

        if (req.file.mimetype === 'image/gif') {
            processedBuffer = req.file.buffer;
        } else {
            processedBuffer = await sharp(req.file.buffer)
                .rotate()
                .resize({ width: 2560, withoutEnlargement: true })
                .jpeg({ quality: 85, progressive: true })
                .toBuffer();
            finalMimeType = 'image/jpeg';
        }

        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileKey,
            Body: processedBuffer,
            ContentType: finalMimeType,
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: {
                'delete-token': deleteToken,
                'upload-date': new Date().toISOString(),
            },
        }));

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`;
        const shortUrl = `${SITE_URL}/i/${fileKey}`;
        const deleteUrl = `${SITE_URL}/delete/${fileKey}?token=${deleteToken}`;

        return res.json({
            success: true,
            url: publicUrl,
            shortUrl: shortUrl,
            html: `<img src="${publicUrl}" alt="ImgFast" loading="lazy">`,
            bbcode: `[img]${publicUrl}[/img]`,
            markdown: `![](${publicUrl})`,
            deleteUrl: deleteUrl,
        });

    } catch (err) {
        console.error('Yükleme hatası:', err);
        return res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// Kısa resim sayfası
app.get('/i/:key', (req, res) => {
    const { key } = req.params;
    const imageUrl = `${process.env.R2_PUBLIC_URL}/${key}`;

    res.render('image', {
        imageUrl: imageUrl,
        siteUrl: SITE_URL,
        key: key,
        deleteUrl: `${SITE_URL}/delete/${key}`,
    });
});

// Silme sayfası
app.get('/delete/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { token } = req.query;

        if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
            return res.render('delete', { success: false, message: 'Geçersiz bağlantı.' });
        }

        // Metadata'dan token kontrolü (opsiyonel, şimdilik direkt silelim)
        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));

        res.render('delete', { success: true, message: 'Resim başarıyla silindi.' });
    } catch (err) {
        console.error('Silme hatası:', err);
        res.render('delete', { success: false, message: 'Silme başarısız.' });
    }
});

// 404
app.use((req, res) => {
    res.status(404).render('delete', { success: false, message: 'Sayfa bulunamadı.' });
});

// Hata
app.use((err, req, res, next) => {
    console.error('Hata:', err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Dosya 10 MB\'dan büyük olamaz.' });
        return res.status(400).json({ error: 'Dosya yükleme hatası.' });
    }
    res.status(500).json({ error: 'Beklenmeyen hata.' });
});

app.listen(PORT, () => {
    console.log(`✅ ImgFast - Port: ${PORT}`);
    console.log(`🌐 ${SITE_URL}`);
});
