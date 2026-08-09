// =============================================
//  IMGFAST - PROFESYONEL RESİM YÜKLEME
//  Admin Paneli + Tüm Özellikler
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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'imgfast2024';

// =============================================
//  VERİ DEPOLAMA
// =============================================
const images = new Map();
const comments = new Map();
const viewCounts = new Map();
const imageDescriptions = new Map();
const imageExifData = new Map();
const sessions = new Map();
const recentUploads = [];
const MAX_RECENT = 100;

function addToRecent(imageData) {
    recentUploads.unshift(imageData);
    if (recentUploads.length > MAX_RECENT) {
        recentUploads.pop();
    }
}

// =============================================
//  MIDDLEWARE
// =============================================
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https://pub-*.r2.dev", "https://*.r2.cloudflarestorage.com"],
            connectSrc: ["'self'"],
            frameSrc: ["'self'"],
        },
    },
}));

const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Çok fazla yükleme. 1 dakika bekleyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
}));

app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use((req, res, next) => {
    req.cookies = {};
    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
        cookieHeader.split(';').forEach(cookie => {
            const parts = cookie.trim().split('=');
            req.cookies[parts[0]] = parts[1];
        });
    }
    next();
});

// Cookie setter helper
app.use((req, res, next) => {
    res.cookie = (name, value, options = {}) => {
        const opts = {
            httpOnly: options.httpOnly || false,
            maxAge: options.maxAge || 86400000,
            path: options.path || '/',
        };
        let cookieStr = `${name}=${value}; Path=${opts.path}; Max-Age=${opts.maxAge}`;
        if (opts.httpOnly) cookieStr += '; HttpOnly';
        res.setHeader('Set-Cookie', cookieStr);
    };
    next();
});

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
//  EXIF ÇIKARMA
// =============================================
async function extractImageInfo(buffer) {
    try {
        const metadata = await sharp(buffer).metadata();
        return {
            width: metadata.width || 0,
            height: metadata.height || 0,
            format: metadata.format || 'unknown',
            colorSpace: metadata.space || 'unknown',
            hasAlpha: metadata.hasAlpha || false,
            orientation: metadata.orientation || 1,
            channels: metadata.channels || 0,
        };
    } catch {
        return null;
    }
}

// Admin kontrol
function checkAdmin(req, res, next) {
    const sessionId = req.cookies?.admin_session;
    if (sessionId && sessions.has(sessionId) && sessions.get(sessionId) === 'admin') {
        return next();
    }
    return res.redirect('/admin/login');
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

// Galeri
app.get('/gallery', (req, res) => {
    const sort = req.query.sort || 'newest';
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const perPage = 24;

    let filteredImages = [...recentUploads];

    if (search) {
        const searchLower = search.toLowerCase();
        filteredImages = filteredImages.filter(img => {
            const name = img.originalName || '';
            const desc = imageDescriptions.get(img.key) || '';
            return name.toLowerCase().includes(searchLower) || desc.toLowerCase().includes(searchLower);
        });
    }

    switch (sort) {
        case 'popular':
            filteredImages.sort((a, b) => (viewCounts.get(b.key) || 0) - (viewCounts.get(a.key) || 0));
            break;
        case 'oldest':
            filteredImages.reverse();
            break;
        case 'name':
            filteredImages.sort((a, b) => (a.originalName || '').localeCompare(b.originalName || ''));
            break;
    }

    const totalImages = filteredImages.length;
    const totalPages = Math.ceil(totalImages / perPage);
    const startIndex = (page - 1) * perPage;
    const paginatedImages = filteredImages.slice(startIndex, startIndex + perPage);

    res.render('gallery', {
        siteUrl: SITE_URL,
        images: paginatedImages,
        currentPage: page,
        totalPages: totalPages,
        sort: sort,
        search: search,
        viewCounts: viewCounts,
        descriptions: imageDescriptions,
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
        const description = req.body.description || '';

        const exifInfo = await extractImageInfo(req.file.buffer);

        let processedBuffer;
        let finalMimeType = req.file.mimetype;

        if (req.file.mimetype === 'image/gif') {
            processedBuffer = req.file.buffer;
        } else {
            processedBuffer = await sharp(req.file.buffer)
                .rotate()
                .resize({ width: 2560, withoutEnlargement: true })
                .jpeg({ quality: 85, progressive: true, mozjpeg: true })
                .toBuffer();
            finalMimeType = 'image/jpeg';
        }

        const optimizedSize = processedBuffer.length;
        const savingsPercent = Math.round((1 - optimizedSize / originalSize) * 100);

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

        viewCounts.set(fileKey, 0);
        if (description) imageDescriptions.set(fileKey, description);
        if (exifInfo) imageExifData.set(fileKey, exifInfo);

        images.set(fileKey, {
            key: fileKey,
            url: publicUrl,
            shortUrl: shortUrl,
            originalName: req.file.originalname,
            originalSize: originalSize,
            optimizedSize: optimizedSize,
            savingsPercent: savingsPercent,
            mimeType: finalMimeType,
            uploadedAt: new Date().toISOString(),
            description: description,
        });

        const imageData = {
            key: fileKey,
            url: publicUrl,
            shortUrl: shortUrl,
            originalName: req.file.originalname,
            uploadedAt: new Date().toISOString(),
            description: description,
        };
        addToRecent(imageData);

        return res.json({
            success: true,
            url: publicUrl,
            shortUrl: shortUrl,
            html: `<img src="${publicUrl}" alt="${req.file.originalname}" loading="lazy">`,
            bbcode: `[img]${publicUrl}[/img]`,
            markdown: `![${req.file.originalname}](${publicUrl})`,
            deleteUrl: deleteUrl,
            originalSize: originalSize,
            optimizedSize: optimizedSize,
            savingsPercent: savingsPercent,
            fileName: req.file.originalname,
            views: 0,
            exif: exifInfo,
            description: description,
        });

    } catch (err) {
        console.error('Yükleme hatası:', err);
        return res.status(500).json({ error: 'Sunucu hatası.' });
    }
});

// Resim detay sayfası
app.get('/i/:key', (req, res) => {
    const { key } = req.params;

    if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
        return res.status(400).send('Geçersiz bağlantı.');
    }

    const imageUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
    const currentViews = viewCounts.get(key) || 0;
    viewCounts.set(key, currentViews + 1);

    const imageData = images.get(key) || {};
    const imageComments = comments.get(key) || [];
    const description = imageDescriptions.get(key) || '';
    const exifData = imageExifData.get(key) || null;

    res.render('image', {
        imageUrl: imageUrl,
        siteUrl: SITE_URL,
        key: key,
        views: currentViews + 1,
        deleteUrl: `${SITE_URL}/delete/${key}`,
        imageData: imageData,
        comments: imageComments,
        description: description,
        exifData: exifData,
    });
});

// Yorum ekle
app.post('/api/comment/:key', (req, res) => {
    const { key } = req.params;
    const { author, text } = req.body;

    if (!author || !text) {
        return res.status(400).json({ error: 'İsim ve yorum gereklidir.' });
    }

    if (author.length > 30 || text.length > 500) {
        return res.status(400).json({ error: 'İsim 30, yorum 500 karakteri geçemez.' });
    }

    if (!comments.has(key)) {
        comments.set(key, []);
    }

    const comment = {
        id: nanoid(8),
        author: author.trim(),
        text: text.trim(),
        date: new Date().toISOString(),
    };

    comments.get(key).push(comment);

    return res.json({ success: true, comment: comment });
});

// Yorumları getir
app.get('/api/comments/:key', (req, res) => {
    const { key } = req.params;
    const imageComments = comments.get(key) || [];
    return res.json({ comments: imageComments });
});

// Açıklama güncelle
app.post('/api/description/:key', (req, res) => {
    const { key } = req.params;
    const { description } = req.body;

    if (typeof description !== 'string' || description.length > 1000) {
        return res.status(400).json({ error: 'Açıklama 1000 karakteri geçemez.' });
    }

    imageDescriptions.set(key, description.trim());

    const idx = recentUploads.findIndex(img => img.key === key);
    if (idx !== -1) recentUploads[idx].description = description.trim();

    return res.json({ success: true, description: description.trim() });
});

// Görüntülenme sayısı
app.get('/api/views/:key', (req, res) => {
    const { key } = req.params;
    const views = viewCounts.get(key) || 0;
    return res.json({ views: views });
});

// Silme
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

        viewCounts.delete(key);
        images.delete(key);
        comments.delete(key);
        imageDescriptions.delete(key);
        imageExifData.delete(key);

        const idx = recentUploads.findIndex(img => img.key === key);
        if (idx !== -1) recentUploads.splice(idx, 1);

        res.render('delete', { success: true, message: 'Resim başarıyla silindi.' });
    } catch (err) {
        res.render('delete', { success: false, message: 'Silme başarısız.' });
    }
});

// =============================================
//  ADMIN PANELİ
// =============================================

// Admin login sayfası
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { siteUrl: SITE_URL, error: null });
});

// Admin login işlemi
app.post('/admin/login', (req, res) => {
    const { password } = req.body;
    if (password === ADMIN_PASSWORD) {
        const sessionId = nanoid(32);
        sessions.set(sessionId, 'admin');
        res.cookie('admin_session', sessionId, { httpOnly: true, maxAge: 86400000 });
        return res.redirect('/admin');
    }
    res.render('admin-login', { siteUrl: SITE_URL, error: 'Hatalı şifre!' });
});

// Admin çıkış
app.get('/admin/logout', (req, res) => {
    const sessionId = req.cookies?.admin_session;
    if (sessionId) sessions.delete(sessionId);
    res.redirect('/admin/login');
});

// Admin panel ana sayfa
app.get('/admin', checkAdmin, (req, res) => {
    const totalImages = images.size;
    const totalViews = Array.from(viewCounts.values()).reduce((sum, v) => sum + v, 0);
    const totalComments = Array.from(comments.values()).reduce((sum, arr) => sum + arr.length, 0);
    const storageUsed = Array.from(images.values()).reduce((sum, img) => sum + (img.optimizedSize || 0), 0);

    res.render('admin', {
        siteUrl: SITE_URL,
        stats: {
            totalImages,
            totalViews,
            totalComments,
            storageUsed,
            recentUploads: recentUploads.length,
        },
        recentImages: recentUploads.slice(0, 30),
        viewCounts: viewCounts,
        comments: comments,
    });
});

// Admin - Tüm resimler
app.get('/admin/images', checkAdmin, (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const perPage = 50;
    const allImages = [...recentUploads];
    const totalPages = Math.ceil(allImages.length / perPage);
    const start = (page - 1) * perPage;
    const paginated = allImages.slice(start, start + perPage);

    res.render('admin-images', {
        siteUrl: SITE_URL,
        images: paginated,
        currentPage: page,
        totalPages: totalPages,
        viewCounts: viewCounts,
    });
});

// Admin - Resim sil
app.get('/admin/delete/:key', checkAdmin, async (req, res) => {
    try {
        const { key } = req.params;
        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));

        viewCounts.delete(key);
        images.delete(key);
        comments.delete(key);
        imageDescriptions.delete(key);
        imageExifData.delete(key);

        const idx = recentUploads.findIndex(img => img.key === key);
        if (idx !== -1) recentUploads.splice(idx, 1);

        res.redirect('/admin/images?deleted=1');
    } catch (err) {
        res.redirect('/admin/images?error=1');
    }
});

// Admin - Toplu silme
app.post('/admin/bulk-delete', checkAdmin, async (req, res) => {
    const { keys } = req.body;
    if (!keys || !Array.isArray(keys)) {
        return res.redirect('/admin/images?error=1');
    }

    for (const key of keys) {
        try {
            await r2.send(new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: key,
            }));
            viewCounts.delete(key);
            images.delete(key);
            comments.delete(key);
            imageDescriptions.delete(key);
            imageExifData.delete(key);
            const idx = recentUploads.findIndex(img => img.key === key);
            if (idx !== -1) recentUploads.splice(idx, 1);
        } catch (err) {
            console.error(`Silme hatası (${key}):`, err);
        }
    }

    res.redirect('/admin/images?deleted=' + keys.length);
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
            return res.status(400).json({ error: 'Dosya 10 MB\'dan büyük olamaz.' });
        }
        return res.status(400).json({ error: 'Dosya yükleme hatası.' });
    }
    res.status(500).json({ error: 'Beklenmeyen hata.' });
});

// Başlat
app.listen(PORT, () => {
    console.log('============================================');
    console.log('  IMGFAST - Admin Panelli');
    console.log(`  Site: ${SITE_URL}`);
    console.log(`  Admin: ${SITE_URL}/admin`);
    console.log('============================================');
});
