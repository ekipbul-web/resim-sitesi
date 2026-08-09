/**
 * IMGFAST - Ana Uygulama JavaScript
 * Tüm özellikler: Animasyon, EXIF, Açıklama, Dosya Bilgileri,
 * Sosyal Paylaşım, CTRL+V, Dark/Light Tema, NSFW
 */
(function () {
    'use strict';

    // =============================================
    // SAYFA YÜKLENME ANİMASYONU
    // =============================================
    window.addEventListener('load', function () {
        setTimeout(function () {
            var loader = document.getElementById('pageLoader');
            if (loader) {
                loader.classList.add('hidden');
                setTimeout(function () {
                    if (loader.parentNode) {
                        loader.parentNode.removeChild(loader);
                    }
                }, 500);
            }
        }, 800);
    });

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
    var saveDescriptionBtn = document.getElementById('saveDescription');
    var descriptionInput = document.getElementById('descriptionInput');
    var descSaved = document.getElementById('descSaved');

    var selectedFile = null;
    var currentUploadKey = null;

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
        currentUploadKey = null;
        fileInput.value = '';
        previewArea.style.display = 'none';
        uploadBtn.style.display = 'none';
        loadingArea.style.display = 'none';
        resultArea.style.display = 'none';
        hideError();
        dropZone.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

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
        } catch (e) {}
    }

    function showExifData(exif) {
        var exifSection = document.getElementById('exifSection');
        var exifGrid = document.getElementById('exifGrid');
        if (!exif || !exifSection || !exifGrid) {
            if (exifSection) exifSection.style.display = 'none';
            return;
        }
        exifSection.style.display = 'block';
        var items = [
            { label: 'Genişlik', value: exif.width + 'px' },
            { label: 'Yükseklik', value: exif.height + 'px' },
            { label: 'Format', value: exif.format },
            { label: 'Renk Uzayı', value: exif.colorSpace },
            { label: 'Kanal', value: exif.channels },
            { label: 'Oryantasyon', value: exif.orientation },
            { label: 'Alpha', value: exif.hasAlpha ? 'Var' : 'Yok' }
        ];
        exifGrid.innerHTML = '';
        items.forEach(function (item) {
            var row = document.createElement('div');
            row.className = 'exif-item';
            row.innerHTML = '<span class="exif-label">' + item.label + '</span><span class="exif-value">' + item.value + '</span>';
            exifGrid.appendChild(row);
        });
    }

    // =============================================
    // DOSYA İŞLEME
    // =============================================
    function handleFile(file) {
        hideError();
        if (!file.type.startsWith('image/')) {
            showError('Lütfen geçerli bir resim dosyası seçin. (JPG, PNG, GIF, WebP, BMP)');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showError('Dosya boyutu 10 MB\'dan küçük olmalıdır.');
            return;
        }
        selectedFile = file;
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
    dropZone.addEventListener('click', function (e) {
        e.preventDefault();
        fileInput.click();
    });

    dropZone.addEventListener('touchend', function (e) {
        e.preventDefault();
        fileInput.click();
    });

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

    fileInput.addEventListener('change', function (e) {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        resetUI();
    });

    // =============================================
    // YÜKLEME İŞLEMİ
    // =============================================
    uploadBtn.addEventListener('click', async function () {
        if (!selectedFile) return;
        uploadBtn.disabled = true;
        loadingArea.style.display = 'block';
        uploadBtn.style.display = 'none';
        previewArea.style.display = 'none';
        hideError();

        var formData = new FormData();
        formData.append('image', selectedFile);

        var description = descriptionInput ? descriptionInput.value.trim() : '';
        if (description) {
            formData.append('description', description);
        }

        try {
            var response = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });

            var data = await response.json();

            if (response.ok && data.success) {
                playSuccessSound();
                currentUploadKey = data.shortUrl ? data.shortUrl.split('/').pop() : null;

                document.getElementById('directLink').value = data.url;
                document.getElementById('shortLink').value = data.shortUrl;
                document.getElementById('htmlCode').value = data.html;
                document.getElementById('bbCode').value = data.bbcode;
                document.getElementById('markdownCode').value = data.markdown;
                document.getElementById('deleteLink').href = data.deleteUrl;
                resultImg.src = data.url;

                document.getElementById('resultFileName').textContent = data.fileName || '-';

                var badge = document.getElementById('resultFileBadge');
                if (badge && data.fileBadge) {
                    badge.textContent = data.fileBadge.label;
                    badge.style.background = data.fileBadge.color;
                }

                document.getElementById('resultOriginalSize').textContent = formatBytes(data.originalSize);
                document.getElementById('resultOptimizedSize').textContent = formatBytes(data.optimizedSize);
                document.getElementById('resultSavings').textContent = '%' + (data.savingsPercent || 0);
                document.getElementById('resultViews').textContent = data.views || 0;

                showExifData(data.exif);

                resultArea.style.display = 'block';
                dropZone.style.display = 'none';
                resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });

            } else {
                showError(data.error || 'Yükleme sırasında bir hata oluştu.');
                uploadBtn.style.display = 'flex';
                previewArea.style.display = 'block';
                dropZone.style.display = 'none';
            }
        } catch (err) {
            console.error('Yükleme hatası:', err);
            showError('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.');
            uploadBtn.style.display = 'flex';
            previewArea.style.display = 'block';
            dropZone.style.display = 'none';
        } finally {
            loadingArea.style.display = 'none';
            uploadBtn.disabled = false;
        }
    });

    // =============================================
    // AÇIKLAMA KAYDETME
    // =============================================
    if (saveDescriptionBtn && descriptionInput) {
        saveDescriptionBtn.addEventListener('click', async function () {
            if (!currentUploadKey) return;
            var desc = descriptionInput.value.trim();
            try {
                var res = await fetch('/api/description/' + currentUploadKey, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ description: desc })
                });
                var data = await res.json();
                if (data.success && descSaved) {
                    descSaved.style.display = 'inline';
                    setTimeout(function () {
                        descSaved.style.display = 'none';
                    }, 2000);
                }
            } catch (err) {
                console.error('Açıklama kaydedilemedi:', err);
            }
        });
    }

    // =============================================
    // YENİ YÜKLEME
    // =============================================
    newUploadBtn.addEventListener('click', function () {
        resetUI();
    });

    // =============================================
    // KOPYALAMA
    // =============================================
    document.addEventListener('click', function (e) {
        if (!e.target.classList.contains('btn-copy')) return;
        var targetId = e.target.getAttribute('data-target');
        var input = document.getElementById(targetId);
        if (!input) return;
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value).then(function () {
            var orig = e.target.textContent;
            e.target.textContent = '✓ Kopyalandı';
            e.target.classList.add('copied');
            setTimeout(function () {
                e.target.textContent = orig;
                e.target.classList.remove('copied');
            }, 2000);
        }).catch(function () {
            var orig = e.target.textContent;
            e.target.textContent = 'Hata!';
            setTimeout(function () {
                e.target.textContent = orig;
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
        var url = encodeURIComponent(
            (document.getElementById('shortLink') && document.getElementById('shortLink').value) ||
            (document.getElementById('directLink') && document.getElementById('directLink').value) ||
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
    // CTRL+V YAPIŞTIRMA
    // =============================================
    document.addEventListener('paste', function (e) {
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
            return;
        }
        var items = e.clipboardData.items;
        for (var i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                handleFile(items[i].getAsFile());
                break;
            }
        }
    });

    // =============================================
    // TEMA DEĞİŞTİRME
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
