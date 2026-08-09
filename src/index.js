// =============================================
//  IMGFAST - FULL ÖZELLİKLİ
//  Resim Yükleme + Admin + API + Yorum + EXIF
//  + Arama + Sıralama + Dosya Türü Etiketi
//  + NSFW Uyarı + Açıklama + Görüntülenme
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

// =============================================
//  CLOUDFLARE R2 BAĞLANTISI
// =============================================
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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
    console.error('============================================');
    console.error('  UYARI: ADMIN_PASSWORD bulunamadı!');
    console.error('  Admin paneli çalışmayacak.');
    console.error('============================================');
}

// =============================================
//  VERİ DEPOLAMA (In-Memory)
// =============================================
const images = new Map();
const comments = new Map();
const viewCounts = new Map();
const imageDescriptions = new Map();
const imageExifData = new Map();
const nsfwFlags = new Map();
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
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Çok fazla yükleme yaptınız. Lütfen 1 dakika bekleyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 30,
    message: { error: 'API limit aşıldı. Lütfen 1 dakika bekleyin.' },
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
        cookieHeader.split(';').forEach(function(cookie) {
            const parts = cookie.trim().split('=');
            if (parts.length >= 2) {
                req.cookies[parts[0]] = parts.slice(1).join('=');
            }
        });
    }
    next();
});

// Cookie setter
app.use((req, res, next) => {
    res.cookie = function(name, value, options) {
        options = options || {};
        let cookieStr = name + '=' + value + '; Path=' + (options.path || '/') + '; Max-Age=' + (options.maxAge || 86400);
        if (options.httpOnly) cookieStr += '; HttpOnly';
        if (options.secure) cookieStr += '; Secure';
        res.setHeader('Set-Cookie', cookieStr);
    };
    next();
});

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: function(req, file, cb) {
        if (ALLOWED_TYPES[file.mimetype]) {
            cb(null, true);
        } else {
            cb(new Error('Desteklenmeyen dosya formatı. Sadece JPG, PNG, GIF, WebP ve BMP yüklenebilir.'));
        }
    }
});

// =============================================
//  YARDIMCI FONKSİYONLAR
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
    } catch (err) {
        return null;
    }
}

function getFileTypeBadge(mimeType) {
    if (!mimeType) return { label: 'IMG', color: '#6366f1' };
    if (mimeType === 'image/gif') return { label: 'GIF', color: '#22c55e' };
    if (mimeType === 'image/png') return { label: 'PNG', color: '#f59e0b' };
    if (mimeType === 'image/webp') return { label: 'WEBP', color: '#8b5cf6' };
    if (mimeType === 'image/bmp') return { label: 'BMP', color: '#ec4899' };
    return { label: 'JPG', color: '#6366f1' };
}

function checkAdmin(req, res, next) {
    if (!ADMIN_PASSWORD) {
        return res.status(500).send('Admin paneli yapılandırılmamış. Lütfen ADMIN_PASSWORD environment variable ekleyin.');
    }
    const sessionId = req.cookies && req.cookies.admin_session;
    if (sessionId && sessions.has(sessionId) && sessions.get(sessionId) === 'admin') {
        return next();
    }
    return res.redirect('/admin/login');
}

// =============================================
//  ROUTE'LAR
// =============================================

// Ana sayfa
app.get('/', function(req, res) {
    res.render('home', {
        siteUrl: SITE_URL,
        maxFileSize: MAX_FILE_SIZE,
        recentUploads: recentUploads.slice(0, 12),
        viewCounts: viewCounts,
        nsfwFlags: nsfwFlags,
    });
});

// Galeri sayfası
app.get('/gallery', function(req, res) {
    const sort = req.query.sort || 'newest';
    const search = req.query.search || '';
    const page = parseInt(req.query.page) || 1;
    const perPage = 24;

    let filteredImages = [...recentUploads];

    if (search) {
        const searchLower = search.toLowerCase();
        filteredImages = filteredImages.filter(function(img) {
            const name = (img.originalName || '').toLowerCase();
            const desc = (imageDescriptions.get(img.key) || '').toLowerCase();
            return name.includes(searchLower) || desc.includes(searchLower);
        });
    }

    switch (sort) {
        case 'popular':
            filteredImages.sort(function(a, b) {
                return (viewCounts.get(b.key) || 0) - (viewCounts.get(a.key) || 0);
            });
            break;
        case 'oldest':
            filteredImages.reverse();
            break;
        case 'name':
            filteredImages.sort(function(a, b) {
                return (a.originalName || '').localeCompare(b.originalName || '');
            });
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
        nsfwFlags: nsfwFlags,
        getFileTypeBadge: getFileTypeBadge,
    });
});

// =============================================
//  RESİM YÜKLEME API
// =============================================
app.post('/upload', uploadLimiter, upload.single('image'), async function(req, res) {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Lütfen bir resim dosyası seçin.' });
        }

        const ext = ALLOWED_TYPES[req.file.mimetype] || '.jpg';
        const fileKey = nanoid(12) + ext;
        const deleteToken = nanoid(16);
        const originalSize = req.file.size;
        const description = req.body.description || '';

        // EXIF bilgilerini çıkar
        const exifInfo = await extractImageInfo(req.file.buffer);

        let processedBuffer;
        let finalMimeType = req.file.mimetype;

        // GIF ise dokunma, değilse optimize et
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

        const publicUrl = process.env.R2_PUBLIC_URL + '/' + fileKey;
        const shortUrl = SITE_URL + '/i/' + fileKey;
        const deleteUrl = SITE_URL + '/delete/' + fileKey + '?token=' + deleteToken;

        // Verileri sakla
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
            mimeType: finalMimeType,
        };
        addToRecent(imageData);

        const fileBadge = getFileTypeBadge(finalMimeType);

        return res.json({
            success: true,
            url: publicUrl,
            shortUrl: shortUrl,
            html: '<img src="' + publicUrl + '" alt="' + req.file.originalname + '" loading="lazy">',
            bbcode: '[img]' + publicUrl + '[/img]',
            markdown: '![' + req.file.originalname + '](' + publicUrl + ')',
            deleteUrl: deleteUrl,
            originalSize: originalSize,
            optimizedSize: optimizedSize,
            savingsPercent: savingsPercent,
            fileName: req.file.originalname,
            views: 0,
            exif: exifInfo,
            description: description,
            fileBadge: fileBadge,
            mimeType: finalMimeType,
        });

    } catch (err) {
        console.error('Yükleme hatası:', err);
        return res.status(500).json({ error: 'Sunucu hatası. Lütfen daha sonra tekrar deneyin.' });
    }
});

// =============================================
//  RESİM DETAY SAYFASI
// =============================================
app.get('/i/:key', function(req, res) {
    const key = req.params.key;

    if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
        return res.status(400).send('Geçersiz bağlantı.');
    }

    const imageUrl = process.env.R2_PUBLIC_URL + '/' + key;
    const currentViews = viewCounts.get(key) || 0;
    viewCounts.set(key, currentViews + 1);

    const imageData = images.get(key) || {};
    const imageComments = comments.get(key) || [];
    const description = imageDescriptions.get(key) || '';
    const exifData = imageExifData.get(key) || null;
    const isNsfw = nsfwFlags.get(key) || false;
    const fileBadge = getFileTypeBadge(imageData.mimeType);

    res.render('image', {
        imageUrl: imageUrl,
        siteUrl: SITE_URL,
        key: key,
        views: currentViews + 1,
        deleteUrl: SITE_URL + '/delete/' + key,
        imageData: imageData,
        comments: imageComments,
        description: description,
        exifData: exifData,
        isNsfw: isNsfw,
        fileBadge: fileBadge,
    });
});

// =============================================
//  YORUM EKLEME API
// =============================================
app.post('/api/comment/:key', function(req, res) {
    const key = req.params.key;
    const author = req.body.author;
    const text = req.body.text;

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

// =============================================
//  YORUMLARI GETİR API
// =============================================
app.get('/api/comments/:key', function(req, res) {
    const key = req.params.key;
    const imageComments = comments.get(key) || [];
    return res.json({ comments: imageComments });
});

// =============================================
//  AÇIKLAMA GÜNCELLEME API
// =============================================
app.post('/api/description/:key', function(req, res) {
    const key = req.params.key;
    const description = req.body.description;

    if (typeof description !== 'string' || description.length > 1000) {
        return res.status(400).json({ error: 'Açıklama 1000 karakteri geçemez.' });
    }

    imageDescriptions.set(key, description.trim());

    const idx = recentUploads.findIndex(function(img) { return img.key === key; });
    if (idx !== -1) {
        recentUploads[idx].description = description.trim();
    }

    return res.json({ success: true, description: description.trim() });
});

// =============================================
//  NSFW İŞARETLEME API
// =============================================
app.post('/api/nsfw/:key', function(req, res) {
    const key = req.params.key;
    const nsfw = req.body.nsfw === true || req.body.nsfw === 'true';

    nsfwFlags.set(key, nsfw);

    return res.json({ success: true, nsfw: nsfw });
});

// =============================================
//  GÖRÜNTÜLENME SAYISI API
// =============================================
app.get('/api/views/:key', function(req, res) {
    const key = req.params.key;
    const views = viewCounts.get(key) || 0;
    return res.json({ views: views });
});

// =============================================
//  İSTATİSTİK API (Geliştiriciler için)
// =============================================
app.get('/api/stats/:key', function(req, res) {
    const key = req.params.key;
    const views = viewCounts.get(key) || 0;
    const imageComments = comments.get(key) || [];
    const description = imageDescriptions.get(key) || '';
    const exifData = imageExifData.get(key) || null;
    const imageData = images.get(key) || {};
    const isNsfw = nsfwFlags.get(key) || false;

    return res.json({
        key: key,
        views: views,
        commentCount: imageComments.length,
        description: description,
        exif: exifData,
        imageData: imageData,
        nsfw: isNsfw,
    });
});

// =============================================
//  TOPLU İSTATİSTİK API
// =============================================
app.get('/api/site-stats', apiLimiter, function(req, res) {
    const totalImages = images.size;
    const totalViews = Array.from(viewCounts.values()).reduce(function(sum, v) { return sum + v; }, 0);
    const totalComments = Array.from(comments.values()).reduce(function(sum, arr) { return sum + arr.length; }, 0);

    return res.json({
        totalImages: totalImages,
        totalViews: totalViews,
        totalComments: totalComments,
        recentUploads: recentUploads.length,
        siteUrl: SITE_URL,
    });
});

// =============================================
//  SİLME SAYFASI
// =============================================
app.get('/delete/:key', async function(req, res) {
    try {
        const key = req.params.key;

        if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
            return res.render('delete', { success: false, message: 'Geçersiz silme bağlantısı.' });
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
        nsfwFlags.delete(key);

        const idx = recentUploads.findIndex(function(img) { return img.key === key; });
        if (idx !== -1) {
            recentUploads.splice(idx, 1);
        }

        res.render('delete', { success: true, message: 'Resim başarıyla silindi.' });
    } catch (err) {
        console.error('Silme hatası:', err);
        res.render('delete', { success: false, message: 'Silme işlemi başarısız oldu.' });
    }
});

// =============================================
//  ADMIN PANELİ
// =============================================

// Admin login sayfası
app.get('/admin/login', function(req, res) {
    res.render('admin-login', { siteUrl: SITE_URL, error: null });
});

// Admin login işlemi
app.post('/admin/login', function(req, res) {
    const password = req.body.password;

    if (!ADMIN_PASSWORD) {
        return res.render('admin-login', { siteUrl: SITE_URL, error: 'Admin paneli henüz yapılandırılmamış.' });
    }

    if (password === ADMIN_PASSWORD) {
        const sessionId = nanoid(32);
        sessions.set(sessionId, 'admin');
        res.cookie('admin_session', sessionId, { httpOnly: true, maxAge: 86400 });
        return res.redirect('/admin');
    }

    res.render('admin-login', { siteUrl: SITE_URL, error: 'Hatalı şifre! Lütfen tekrar deneyin.' });
});

// Admin çıkış
app.get('/admin/logout', function(req, res) {
    const sessionId = req.cookies && req.cookies.admin_session;
    if (sessionId) {
        sessions.delete(sessionId);
    }
    res.redirect('/admin/login');
});

// Admin panel ana sayfa
app.get('/admin', checkAdmin, function(req, res) {
    const totalImages = images.size;
    const totalViews = Array.from(viewCounts.values()).reduce(function(sum, v) { return sum + v; }, 0);
    const totalComments = Array.from(comments.values()).reduce(function(sum, arr) { return sum + arr.length; }, 0);
    const storageUsed = Array.from(images.values()).reduce(function(sum, img) { return sum + (img.optimizedSize || 0); }, 0);
    const nsfwCount = Array.from(nsfwFlags.values()).filter(function(v) { return v === true; }).length;

    res.render('admin', {
        siteUrl: SITE_URL,
        stats: {
            totalImages: totalImages,
            totalViews: totalViews,
            totalComments: totalComments,
            storageUsed: storageUsed,
            recentUploads: recentUploads.length,
            nsfwCount: nsfwCount,
        },
        recentImages: recentUploads.slice(0, 30),
        viewCounts: viewCounts,
        comments: comments,
        nsfwFlags: nsfwFlags,
    });
});

// Admin - Tüm resimler
app.get('/admin/images', checkAdmin, function(req, res) {
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
        comments: comments,
        nsfwFlags: nsfwFlags,
    });
});

// Admin - Resim sil
app.get('/admin/delete/:key', checkAdmin, async function(req, res) {
    try {
        const key = req.params.key;
        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));

        viewCounts.delete(key);
        images.delete(key);
        comments.delete(key);
        imageDescriptions.delete(key);
        imageExifData.delete(key);
        nsfwFlags.delete(key);

        const idx = recentUploads.findIndex(function(img) { return img.key === key; });
        if (idx !== -1) {
            recentUploads.splice(idx, 1);
        }

        res.redirect('/admin/images?deleted=1');
    } catch (err) {
        console.error('Admin silme hatası:', err);
        res.redirect('/admin/images?error=1');
    }
});

// Admin - NSFW işaretle
app.get('/admin/nsfw/:key', checkAdmin, function(req, res) {
    const key = req.params.key;
    const current = nsfwFlags.get(key) || false;
    nsfwFlags.set(key, !current);
    res.redirect('/admin/images?nsfw=1');
});

// =============================================
//  404
// =============================================
app.use(function(req, res) {
    res.status(404).render('delete', { success: false, message: 'Aradığınız sayfa bulunamadı.' });
});

// =============================================
//  HATA YAKALAMA
// =============================================
app.use(function(err, req, res, next) {
    console.error('Sunucu hatası:', err);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Dosya boyutu 10 MB\'dan büyük olamaz.' });
        }
        return res.status(400).json({ error: 'Dosya yükleme hatası.' });
    }
    res.status(500).json({ error: 'Beklenmeyen bir sunucu hatası oluştu.' });
});

// =============================================
//  SUNUCUYU BAŞLAT
// =============================================
app.listen(PORT, function() {
    console.log('============================================');
    console.log('  IMGFAST - Tüm Özellikler Yüklendi');
    console.log('  Site: ' + SITE_URL);
    console.log('  Admin: ' + SITE_URL + '/admin');
    console.log('  API: ' + SITE_URL + '/api/site-stats');
    console.log('============================================');
});
