/**
 * IMGFAST - Ana Uygulama JavaScript
 * Tüm özellikler: CTRL+V, Sürükle-Bırak, Sosyal Paylaşım,
 * Dosya Bilgileri, Görüntülenme Sayacı, Dark/Light Tema
 */
(function () {
    'use strict';

    // =============================================
    // DOM ELEMENTLERİ
    // =============================================
    var dropZone = document.getElementById('dropZone');
    var fileInput = document.getElementById('fileInput');
    var previewArea = document.getElementById('previewArea');
    var previewImg = document.getElementById('previewImg');
    var previewInfo = document.getElementById('previewInfo');
    var removeBtn = document.getElementById('removeBtn');
    var uploadBtn = document.getElementById('uploadBtn');
    var loadingArea = document.getElementById('loadingArea');
    var errorArea = document.getElementById('errorArea');
    var resultArea = document.getElementById('resultArea');
    var resultImg = document.getElementById('resultImg');
    var newUploadBtn = document.getElementById('newUploadBtn');
    var themeToggle = document.getElementById('themeToggle');

    var selectedFile = null;

    // =============================================
    // YARDIMCI FONKSİYONLAR
    // =============================================

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        var k = 1024;
        var sizes = ['B', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function showError(msg) {
        errorArea.textContent = msg;
        errorArea.style.display = 'block';
        setTimeout(function () {
            errorArea.style.display = 'none';
        }, 5000);
    }

    function hideError() {
        errorArea.style.display = 'none';
    }

    function resetUI() {
        selectedFile = null;
        fileInput.value = '';
        previewArea.style.display = 'none';
        uploadBtn.style.display = 'none';
        loadingArea.style.display = 'none';
        resultArea.style.display = 'none';
        hideError();
        dropZone.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Başarılı yükleme ses efekti
    function playSuccessSound() {
        try {
            var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            var oscillator = audioCtx.createOscillator();
            var gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(523.25, audioCtx.currentTime);
            oscillator.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.1);
            oscillator.frequency.setValueAtTime(783.99, audioCtx.currentTime + 0.2);

            gainNode.gain.setValueAtTime(0.3, audioCtx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.4);
        } catch (e) {
            // Ses çalınamazsa sorun değil
        }
    }

    // =============================================
    // DOSYA İŞLEME
    // =============================================

    function handleFile(file) {
        hideError();

        // Dosya tipi kontrolü
        if (!file.type.startsWith('image/')) {
            showError('Lütfen geçerli bir resim dosyası seçin. (JPG, PNG, GIF, WebP, BMP)');
            return;
        }

        // Dosya boyutu kontrolü
        if (file.size > 10 * 1024 * 1024) {
            showError('Dosya boyutu 10 MB\'dan küçük olmalıdır.');
            return;
        }

        selectedFile = file;

        // Önizleme göster
        var reader = new FileReader();
        reader.onload = function (e) {
            previewImg.src = e.target.result;
            previewInfo.textContent = file.name + ' • ' + formatBytes(file.size);
            previewArea.style.display = 'block';
            uploadBtn.style.display = 'flex';
            resultArea.style.display = 'none';
            dropZone.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    // =============================================
    // EVENT LISTENERS
    // =============================================

    // Drop zone - tıklama
    dropZone.addEventListener('click', function (e) {
        e.preventDefault();
        fileInput.click();
    });

    // Drop zone - mobil dokunma
    dropZone.addEventListener('touchend', function (e) {
        e.preventDefault();
        fileInput.click();
    });

    // Drag & drop
    dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    // File input change
    fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Kaldır butonu
    removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        resetUI();
    });

    // =============================================
    // YÜKLEME İŞLEMİ
    // =============================================

    uploadBtn.addEventListener('click', async function () {
        if (!selectedFile) return;

        // Butonu devre dışı bırak, loading göster
        uploadBtn.disabled = true;
        loadingArea.style.display = 'block';
        uploadBtn.style.display = 'none';
        previewArea.style.display = 'none';
        hideError();

        // FormData oluştur
        var formData = new FormData();
        formData.append('image', selectedFile);

        try {
            var response = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });

            var data = await response.json();

            if (response.ok && data.success) {

                // Başarı sesi
                playSuccessSound();

                // Linkleri doldur
                document.getElementById('directLink').value = data.url;
                document.getElementById('shortLink').value = data.shortUrl;
                document.getElementById('htmlCode').value = data.html;
                document.getElementById('bbCode').value = data.bbcode;
                document.getElementById('markdownCode').value = data.markdown;
                document.getElementById('deleteLink').href = data.deleteUrl;
                resultImg.src = data.url;

                // Dosya bilgilerini doldur
                document.getElementById('resultFileName').textContent = data.fileName || '-';
                document.getElementById('resultOriginalSize').textContent = formatBytes(data.originalSize);
                document.getElementById('resultOptimizedSize').textContent = formatBytes(data.optimizedSize);
                document.getElementById('resultViews').textContent = data.views || 0;

                // Sonucu göster
                resultArea.style.display = 'block';
                dropZone.style.display = 'none';

                // Sonuca kaydır
                resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

            } else {
                showError(data.error || 'Yükleme sırasında bir hata oluştu.');
                uploadBtn.style.display = 'flex';
                previewArea.style.display = 'block';
                dropZone.style.display = 'none';
            }
        } catch (err) {
            console.error('Yükleme hatası:', err);
            showError('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
            uploadBtn.style.display = 'flex';
            previewArea.style.display = 'block';
            dropZone.style.display = 'none';
        } finally {
            loadingArea.style.display = 'none';
            uploadBtn.disabled = false;
        }
    });

    // =============================================
    // YENİ YÜKLEME BUTONU
    // =============================================

    newUploadBtn.addEventListener('click', function () {
        resetUI();
    });

    // =============================================
    // KOPYALAMA BUTONLARI
    // =============================================

    document.addEventListener('click', function (e) {
        if (!e.target.classList.contains('btn-copy')) return;

        var targetId = e.target.getAttribute('data-target');
        var input = document.getElementById(targetId);
        if (!input) return;

        input.select();
        input.setSelectionRange(0, 99999);

        navigator.clipboard.writeText(input.value).then(function () {
            var originalText = e.target.textContent;
            e.target.textContent = '✓ Kopyalandı';
            e.target.classList.add('copied');
            setTimeout(function () {
                e.target.textContent = originalText;
                e.target.classList.remove('copied');
            }, 2000);
        }).catch(function () {
            var originalText = e.target.textContent;
            e.target.textContent = 'Hata!';
            setTimeout(function () {
                e.target.textContent = originalText;
            }, 1500);
        });
    });

    // =============================================
    // SOSYAL PAYLAŞIM
    // =============================================

    document.addEventListener('click', function (e) {
        var btn = e.target.closest('.share-btn');
        if (!btn) return;

        e.preventDefault();

        var platform = btn.getAttribute('data-platform');
        var shortLinkEl = document.getElementById('shortLink');
        var directLinkEl = document.getElementById('directLink');
        var url = encodeURIComponent(
            (shortLinkEl && shortLinkEl.value) ||
            (directLinkEl && directLinkEl.value) ||
            ''
        );
        var text = encodeURIComponent('ImgFast ile yükledim!');
        var shareUrl = '';

        switch (platform) {
            case 'twitter':
                shareUrl = 'https://twitter.com/intent/tweet?url=' + url + '&text=' + text;
                break;
            case 'whatsapp':
                shareUrl = 'https://wa.me/?text=' + text + '%20' + url;
                break;
            case 'facebook':
                shareUrl = 'https://www.facebook.com/sharer/sharer.php?u=' + url;
                break;
            case 'telegram':
                shareUrl = 'https://t.me/share/url?url=' + url + '&text=' + text;
                break;
        }

        if (shareUrl) {
            window.open(shareUrl, '_blank', 'noopener,noreferrer');
        }
    });

    // =============================================
    // CTRL+V YAPIŞTIRMA DESTEĞİ
    // =============================================

    document.addEventListener('paste', function (e) {
        // Eğer bir input alanındaysa yapıştırma işlemini engelleme
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            return;
        }

        var items = e.clipboardData.items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                var file = items[i].getAsFile();
                handleFile(file);
                break;
            }
        }
    });

    // =============================================
    // TEMA DEĞİŞTİRME (DARK / LIGHT)
    // =============================================

    var savedTheme = localStorage.getItem('imgfast-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    themeToggle.addEventListener('click', function () {
        var current = document.documentElement.getAttribute('data-theme');
        var next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('imgfast-theme', next);
    });

})();
