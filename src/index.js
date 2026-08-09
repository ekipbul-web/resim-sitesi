// =============================================
//  IMGFAST - Profesyonel Resim Yükleme
//  Tüm özellikler dahil
// =============================================

require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
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

// Görüntülenme sayacı için basit in-memory storage
const viewCounts = new Map();

// Güvenlik
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Çok fazla yükleme yaptınız. 1 dakika bekleyin.' },
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
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());

// Multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES[file.mimetype]) {
            cb(null, true);
        } else {
            cb(new Error('Desteklenmeyen dosya formatı.'));
        }
    }
});

// =============================================
//  SON YÜKLENENLER (In-Memory)
// =============================================
const recentUploads = [];
const MAX_RECENT = 30;

function addToRecent(imageData) {
    recentUploads.unshift(imageData);
    if (recentUploads.length > MAX_RECENT) {
        recentUploads.pop();
    }
}

// =============================================
//  ROUTE'LAR
// =============================================

// Ana sayfa
app.get('/', (req, res) => {
    res.render('home', {
        siteUrl: SITE_URL,
        maxFileSize: MAX_FILE_SIZE,
        recentUploads: recentUploads.slice(0, 12),
    });
});

// Galeri sayfası
app.get('/gallery', (req, res) => {
    res.render('gallery', {
        siteUrl: SITE_URL,
        recentUploads: recentUploads,
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
        const originalSize = req.file.size;

        let processedBuffer;
        let finalMimeType = req.file.mimetype;

        // GIF ise dokunma, değilse optimize et
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

        const optimizedSize = processedBuffer.length;

        // R2'ye yükle
        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileKey,
            Body: processedBuffer,
            ContentType: finalMimeType,
            CacheControl: 'public, max-age=31536000, immutable',
            Metadata: {
                'delete-token': deleteToken,
                'upload-date': new Date().toISOString(),
                'original-name': Buffer.from(req.file.originalname, 'utf8').toString('base64'),
            },
        }));

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`;
        const shortUrl = `${SITE_URL}/i/${fileKey}`;
        const deleteUrl = `${SITE_URL}/delete/${fileKey}?token=${deleteToken}`;

        // Görüntülenme sayacı başlat
        viewCounts.set(fileKey, 0);

        // Son yüklenenlere ekle
        addToRecent({
            key: fileKey,
            url: publicUrl,
            shortUrl: shortUrl,
            originalName: req.file.originalname,
            uploadedAt: new Date().toISOString(),
        });

        return res.json({
            success: true,
            url: publicUrl,
            shortUrl: shortUrl,
            html: `<img src="${publicUrl}" alt="ImgFast" loading="lazy">`,
            bbcode: `[img]${publicUrl}[/img]`,
            markdown: `![](${publicUrl})`,
            deleteUrl: deleteUrl,
            originalSize: originalSize,
            optimizedSize: optimizedSize,
            fileName: req.file.originalname,
            views: 0,
        });

    } catch (err) {
        console.error('Yükleme hatası:', err);
        return res.status(500).json({ error: 'Sunucu hatası. Lütfen tekrar deneyin.' });
    }
});

// Kısa resim sayfası - görüntülenme sayacı ile
app.get('/i/:key', (req, res) => {
    const { key } = req.params;
    const imageUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    
    // Görüntülenme sayacını artır
    const currentViews = viewCounts.get(key) || 0;
    viewCounts.set(key, currentViews + 1);

    res.render('image', {
        imageUrl: imageUrl,
        siteUrl: SITE_URL,
        key: key,
        views: currentViews + 1,
        deleteUrl: `${SITE_URL}/delete/${key}`,
    });
});

// Görüntülenme sayısı API
app.get('/api/views/:key', (req, res) => {
    const { key } = req.params;
    const views = viewCounts.get(key) || 0;
    res.json({ views: views });
});

// Silme sayfası
app.get('/delete/:key', async (req, res) => {
    try {
        const { key } = req.params;

        if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
            return res.render('delete', { success: false, message: 'Geçersiz bağlantı.' });
        }

        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));

        // Sayaçtan ve son yüklenenlerden kaldır
        viewCounts.delete(key);
        const index = recentUploads.findIndex(item => item.key === key);
        if (index !== -1) {
            recentUploads.splice(index, 1);
        }

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

// Sunucuyu başlat
app.listen(PORT, () => {
    console.log(`✅ ImgFast başlatıldı - Port: ${PORT}`);
    console.log(`🌐 ${SITE_URL}`);
});
