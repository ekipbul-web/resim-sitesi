// =============================================
//  RESİM YÜKLEME VE PAYLAŞIM PLATFORMU
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

// =============================================
//  KONFİGÜRASYON
// =============================================
const app = express();
const PORT = process.env.PORT || 3000;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];
const MAX_WIDTH = 2048; // Maksimum resim genişliği

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

// =============================================
//  GÜVENLİK MIDDLEWARE'LERİ
// =============================================
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false,
}));

// Rate limiting - spam koruması
const uploadLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 dakika
    max: 10, // maksimum 10 yükleme
    message: { error: 'Çok fazla yükleme yaptınız. Lütfen 1 dakika bekleyin.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const generalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(generalLimiter);

// =============================================
//  MULTER AYARI - Bellekte işle
// =============================================
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (ALLOWED_TYPES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Sadece JPG, PNG, GIF, WebP ve BMP formatları desteklenir.'));
        }
    }
});

// =============================================
//  HTML ŞABLONU
// =============================================
function getHTML() {
    return `<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="description" content="Ücretsiz, hızlı ve güvenli resim yükleme. Anında paylaşım linkleri.">
    <meta name="theme-color" content="#0d1117">
    <title>Resim Yükle | Hızlı Paylaşım</title>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        :root {
            --bg: #0d1117;
            --surface: #161b22;
            --border: #30363d;
            --text: #c9d1d9;
            --muted: #8b949e;
            --accent: #58a6ff;
            --success: #238636;
            --success-hover: #2ea043;
            --error-bg: #490202;
            --error-border: #f85149;
            --radius: 12px;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 20px;
            line-height: 1.5;
        }
        .container {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: var(--radius);
            padding: 32px 28px;
            width: 100%;
            max-width: 520px;
            box-shadow: 0 8px 32px rgba(0,0,0,0.3);
        }
        .header { text-align: center; margin-bottom: 28px; }
        .header .icon { font-size: 2.5em; margin-bottom: 8px; }
        .header h1 { font-size: 1.7em; font-weight: 700; color: var(--accent); letter-spacing: -0.5px; }
        .header p { font-size: 0.88em; color: var(--muted); margin-top: 4px; }

        .upload-zone {
            border: 2px dashed var(--border);
            border-radius: var(--radius);
            padding: 44px 24px;
            text-align: center;
            cursor: pointer;
            transition: all 0.25s ease;
            background: var(--bg);
            position: relative;
            overflow: hidden;
        }
        .upload-zone:hover, .upload-zone.active { border-color: var(--accent); background: #1a1f2b; }
        .upload-zone svg { width: 44px; height: 44px; margin-bottom: 14px; color: var(--muted); transition: color 0.25s; }
        .upload-zone:hover svg { color: var(--accent); }
        .upload-zone .main-text { font-size: 0.95em; color: var(--muted); }
        .upload-zone .main-text span { color: var(--accent); font-weight: 600; cursor: pointer; }
        .upload-zone .hint { font-size: 0.75em; color: var(--muted); margin-top: 10px; opacity: 0.7; }
        input[type="file"] { display: none; }

        .preview { display: none; margin-top: 20px; text-align: center; }
        .preview img { max-width: 100%; max-height: 280px; border-radius: 8px; border: 1px solid var(--border); object-fit: contain; background: #000; }
        .preview .file-info { font-size: 0.78em; color: var(--muted); margin-top: 8px; }

        .btn {
            width: 100%; padding: 14px; border: none; border-radius: 8px;
            font-size: 0.95em; font-weight: 600; cursor: pointer;
            transition: all 0.2s; margin-top: 18px; letter-spacing: 0.3px;
        }
        .btn-upload { background: var(--success); color: #fff; display: none; }
        .btn-upload:hover { background: var(--success-hover); transform: translateY(-1px); }
        .btn-upload:disabled { background: #21262d; color: #484f58; cursor: not-allowed; transform: none; }

        .loading { display: none; text-align: center; padding: 24px 0; }
        .spinner { width: 38px; height: 38px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; margin: 0 auto 12px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .loading p { font-size: 0.85em; color: var(--muted); }

        .error { display: none; padding: 12px 16px; background: var(--error-bg); border: 1px solid var(--error-border); border-radius: 8px; color: #f85149; margin-top: 16px; font-size: 0.85em; }

        .result { display: none; margin-top: 22px; }
        .result-header { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
        .result-header .check { color: #3fb950; font-size: 1.2em; }
        .result-header h3 { font-size: 0.95em; color: #3fb950; font-weight: 600; }
        .result-img { width: 100%; border-radius: 8px; border: 1px solid var(--border); margin-bottom: 16px; background: #000; }

        .link-group { margin-bottom: 8px; }
        .link-label { font-size: 0.7em; color: var(--muted); text-transform: uppercase; font-weight: 700; letter-spacing: 0.8px; margin-bottom: 4px; }
        .link-row {
            display: flex; align-items: center; gap: 8px;
            background: var(--bg); border: 1px solid var(--border);
            border-radius: 6px; padding: 8px 12px;
        }
        .link-row input {
            flex: 1; background: transparent; border: none;
            color: var(--text); font-size: 0.8em; font-family: 'SF Mono', 'Fira Code', monospace;
            outline: none; min-width: 0;
        }
        .copy-btn {
            background: #21262d; color: var(--text); border: 1px solid var(--border);
            padding: 5px 14px; border-radius: 5px; cursor: pointer;
            font-size: 0.73em; font-weight: 600; white-space: nowrap;
            transition: all 0.15s;
        }
        .copy-btn:hover { background: #30363d; }
        .copy-btn.copied { background: #1a3a2a; border-color: #3fb950; color: #3fb950; }

        footer { text-align: center; margin-top: 24px; font-size: 0.7em; color: #484f58; }
        footer span { color: var(--accent); }

        @media (max-width: 480px) {
            .container { padding: 24px 18px; }
            .upload-zone { padding: 30px 16px; }
            .header h1 { font-size: 1.4em; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div class="icon">📸</div>
            <h1>Resim Yükle</h1>
            <p>Hızlı, güvenli ve kalıcı paylaşım</p>
        </div>

        <div class="error" id="error"></div>

        <div class="upload-zone" id="dropZone">
            <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/>
            </svg>
            <p class="main-text"><span>Dosya seçin</span> veya sürükleyip bırakın</p>
            <p class="hint">Max 5 MB • JPG, PNG, GIF, WebP, BMP</p>
        </div>
        <input type="file" id="fileInput" accept="image/*">

        <div class="preview" id="preview">
            <img id="previewImg" src="" alt="Önizleme">
            <p class="file-info" id="fileInfo"></p>
        </div>

        <button class="btn btn-upload" id="uploadBtn">Yükle</button>

        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>Resim optimize ediliyor ve yükleniyor...</p>
        </div>

        <div class="result" id="result">
            <div class="result-header">
                <span class="check">✅</span>
                <h3>Yükleme başarılı</h3>
            </div>
            <img class="result-img" id="resultImg" src="" alt="Yüklenen resim">
            <div class="link-group">
                <div class="link-label">Doğrudan Bağlantı</div>
                <div class="link-row">
                    <input type="text" id="directLink" readonly>
                    <button class="copy-btn" data-target="directLink">Kopyala</button>
                </div>
            </div>
            <div class="link-group">
                <div class="link-label">HTML Kodu</div>
                <div class="link-row">
                    <input type="text" id="htmlCode" readonly>
                    <button class="copy-btn" data-target="htmlCode">Kopyala</button>
                </div>
            </div>
            <div class="link-group">
                <div class="link-label">BBCode (Forum)</div>
                <div class="link-row">
                    <input type="text" id="bbCode" readonly>
                    <button class="copy-btn" data-target="bbCode">Kopyala</button>
                </div>
            </div>
            <div class="link-group">
                <div class="link-label">Silme Bağlantısı</div>
                <div class="link-row">
                    <input type="text" id="deleteLink" readonly>
                    <button class="copy-btn" data-target="deleteLink">Kopyala</button>
                </div>
            </div>
        </div>

        <footer>Resimler <span>Cloudflare R2</span> altyapısında güvenle saklanır</footer>
    </div>

    <script>
        (function() {
            const dropZone = document.getElementById('dropZone');
            const fileInput = document.getElementById('fileInput');
            const preview = document.getElementById('preview');
            const previewImg = document.getElementById('previewImg');
            const fileInfo = document.getElementById('fileInfo');
            const uploadBtn = document.getElementById('uploadBtn');
            const loading = document.getElementById('loading');
            const result = document.getElementById('result');
            const errorDiv = document.getElementById('error');
            let selectedFile = null;

            function formatBytes(bytes) {
                if (bytes < 1024) return bytes + ' B';
                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
                return (bytes / 1048576).toFixed(1) + ' MB';
            }

            function showError(msg) {
                errorDiv.textContent = msg;
                errorDiv.style.display = 'block';
                setTimeout(() => { errorDiv.style.display = 'none'; }, 5000);
            }

            function handleFile(file) {
                if (!file.type.startsWith('image/')) {
                    showError('Lütfen geçerli bir resim dosyası seçin.');
                    return;
                }
                if (file.size > 5 * 1024 * 1024) {
                    showError('Dosya boyutu 5 MB\'dan küçük olmalıdır.');
                    return;
                }
                selectedFile = file;
                const reader = new FileReader();
                reader.onload = function(e) {
                    previewImg.src = e.target.result;
                    fileInfo.textContent = file.name + ' • ' + formatBytes(file.size);
                    preview.style.display = 'block';
                    uploadBtn.style.display = 'block';
                    result.style.display = 'none';
                    errorDiv.style.display = 'none';
                };
                reader.readAsDataURL(file);
            }

            dropZone.addEventListener('click', function() { fileInput.click(); });
            dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.classList.add('active'); });
            dropZone.addEventListener('dragleave', function() { dropZone.classList.remove('active'); });
            dropZone.addEventListener('drop', function(e) {
                e.preventDefault();
                dropZone.classList.remove('active');
                if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
            });
            fileInput.addEventListener('change', function(e) {
                if (e.target.files.length) handleFile(e.target.files[0]);
            });

            uploadBtn.addEventListener('click', async function() {
                if (!selectedFile) return;
                uploadBtn.disabled = true;
                loading.style.display = 'block';
                result.style.display = 'none';
                preview.style.display = 'none';
                errorDiv.style.display = 'none';

                var formData = new FormData();
                formData.append('image', selectedFile);

                try {
                    var response = await fetch('/upload', { method: 'POST', body: formData });
                    var data = await response.json();
                    if (response.ok) {
                        document.getElementById('directLink').value = data.url;
                        document.getElementById('htmlCode').value = data.html;
                        document.getElementById('bbCode').value = data.bbcode;
                        document.getElementById('deleteLink').value = data.deleteUrl;
                        document.getElementById('resultImg').src = data.url;
                        result.style.display = 'block';
                        uploadBtn.style.display = 'none';
                    } else {
                        showError(data.error || 'Yükleme sırasında bir hata oluştu.');
                        uploadBtn.style.display = 'block';
                    }
                } catch (err) {
                    showError('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
                    uploadBtn.style.display = 'block';
                } finally {
                    loading.style.display = 'none';
                    uploadBtn.disabled = false;
                }
            });

            document.querySelectorAll('.copy-btn').forEach(function(btn) {
                btn.addEventListener('click', function() {
                    var targetId = this.getAttribute('data-target');
                    var input = document.getElementById(targetId);
                    input.select();
                    input.setSelectionRange(0, 99999);
                    navigator.clipboard.writeText(input.value).then(function() {
                        btn.textContent = '✓ Kopyalandı';
                        btn.classList.add('copied');
                        setTimeout(function() {
                            btn.textContent = 'Kopyala';
                            btn.classList.remove('copied');
                        }, 2000);
                    }).catch(function() {
                        btn.textContent = 'Hata!';
                        setTimeout(function() { btn.textContent = 'Kopyala'; }, 1500);
                    });
                });
            });
        })();
    </script>
</body>
</html>`;
}

// =============================================
//  ROUTE'LAR
// =============================================

// Ana sayfa
app.get('/', (req, res) => {
    res.send(getHTML());
});

// Resim yükleme endpoint'i
app.post('/upload', uploadLimiter, upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Lütfen bir resim dosyası seçin.' });
        }

        // Sharp ile resmi optimize et, EXIF verilerini temizle
        let processedImage = sharp(req.file.buffer)
            .rotate() // Oryantasyonu düzelt
            .withMetadata({ exif: {} }) // EXIF'i temizle (gizlilik)
            .resize({ width: MAX_WIDTH, withoutEnlargement: true }) // Boyutlandır
            .jpeg({ quality: 85, progressive: true }); // JPEG'e çevir ve sıkıştır

        const optimizedBuffer = await processedImage.toBuffer();
        const fileExt = '.jpg';
        const fileKey = `${nanoid(12)}${fileExt}`;

        // Cloudflare R2'ye yükle
        await r2.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: fileKey,
            Body: optimizedBuffer,
            ContentType: 'image/jpeg',
            CacheControl: 'public, max-age=31536000, immutable',
        }));

        const publicUrl = `${process.env.R2_PUBLIC_URL}/${fileKey}`;
        const siteUrl = process.env.SITE_URL || `http://localhost:${PORT}`;
        const deleteUrl = `${siteUrl}/delete/${fileKey}`;

        return res.status(200).json({
            success: true,
            url: publicUrl,
            html: `<img src="${publicUrl}" alt="Resim" loading="lazy" />`,
            bbcode: `[img]${publicUrl}[/img]`,
            deleteUrl: deleteUrl,
        });

    } catch (err) {
        console.error('Yükleme hatası:', err.message);
        return res.status(500).json({ error: 'Sunucu tarafında bir hata oluştu. Lütfen daha sonra tekrar deneyin.' });
    }
});

// Resim silme
app.get('/delete/:key', async (req, res) => {
    try {
        const { key } = req.params;

        // Güvenlik: Sadece nanoid formatındaki key'leri kabul et
        if (!/^[a-zA-Z0-9_-]{12,16}\.[a-z]+$/.test(key)) {
            return res.status(400).send('Geçersiz silme bağlantısı.');
        }

        await r2.send(new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: key,
        }));

        res.send(`<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Resim Silindi</title>
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0d1117; color: #c9d1d9; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; text-align: center; }
        .card { background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 40px 30px; }
        h2 { color: #3fb950; margin-bottom: 12px; }
        a { color: #58a6ff; text-decoration: none; font-weight: 500; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="card">
        <h2>✅ Resim başarıyla silindi</h2>
        <p>Dosya Cloudflare R2 sunucularından kalıcı olarak kaldırıldı.</p>
        <p style="margin-top:16px;"><a href="/">➕ Yeni resim yükle</a></p>
    </div>
</body>
</html>`);

    } catch (err) {
        console.error('Silme hatası:', err.message);
        res.status(500).send('Silme işlemi sırasında bir hata oluştu.');
    }
});

// 404 - Bulunamadı
app.use((req, res) => {
    res.status(404).send(`<!DOCTYPE html>
<html lang="tr">
<head>
    <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>404 - Bulunamadı</title>
    <style>
        body { font-family: -apple-system, sans-serif; background: #0d1117; color: #c9d1d9; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; text-align: center; }
        h1 { font-size: 4em; color: #58a6ff; margin: 0; }
        a { color: #58a6ff; }
    </style>
</head>
<body>
    <div>
        <h1>404</h1>
        <p>Sayfa bulunamadı.</p>
        <p><a href="/">Ana sayfaya dön</a></p>
    </div>
</body>
</html>`);
});

// Hata yakalama
app.use((err, req, res, next) => {
    console.error('Sunucu hatası:', err.message);
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: 'Dosya boyutu 5 MB\'dan büyük olamaz.' });
        }
        return res.status(400).json({ error: 'Dosya yükleme hatası.' });
    }
    res.status(500).json({ error: 'Beklenmeyen bir hata oluştu.' });
});

// =============================================
//  SUNUCUYU BAŞLAT
// =============================================
app.listen(PORT, () => {
    console.log(`✅ Sunucu başlatıldı: Port ${PORT}`);
    console.log(`📦 Cloudflare R2 Bucket: ${BUCKET_NAME}`);
});
