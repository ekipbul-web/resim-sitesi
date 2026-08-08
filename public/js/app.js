/**
 * IMGFAST - Ana Uygulama
 * QR Kod + Sosyal Paylaşım + CTRL+V + Tema
 */
(function () {
    'use strict';

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const previewArea = document.getElementById('previewArea');
    const previewImg = document.getElementById('previewImg');
    const previewInfo = document.getElementById('previewInfo');
    const removeBtn = document.getElementById('removeBtn');
    const uploadBtn = document.getElementById('uploadBtn');
    const loadingArea = document.getElementById('loadingArea');
    const errorArea = document.getElementById('errorArea');
    const resultArea = document.getElementById('resultArea');
    const resultImg = document.getElementById('resultImg');
    const newUploadBtn = document.getElementById('newUploadBtn');
    const themeToggle = document.getElementById('themeToggle');
    const qrCanvas = document.getElementById('qrCanvas');

    let selectedFile = null;

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function showError(msg) {
        errorArea.textContent = msg;
        errorArea.style.display = 'block';
        setTimeout(() => { errorArea.style.display = 'none'; }, 4000);
    }

    function resetUI() {
        selectedFile = null;
        fileInput.value = '';
        previewArea.style.display = 'none';
        uploadBtn.style.display = 'none';
        loadingArea.style.display = 'none';
        resultArea.style.display = 'none';
        errorArea.style.display = 'none';
        dropZone.style.display = 'block';
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function handleFile(file) {
        if (!file.type.startsWith('image/')) {
            showError('Lütfen geçerli bir resim dosyası seçin.');
            return;
        }
        if (file.size > 10 * 1024 * 1024) {
            showError('Dosya boyutu 10 MB\'dan küçük olmalıdır.');
            return;
        }
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = function (e) {
            previewImg.src = e.target.result;
            previewInfo.textContent = file.name + ' • ' + formatBytes(file.size);
            previewArea.style.display = 'block';
            uploadBtn.style.display = 'flex';
            resultArea.style.display = 'none';
            dropZone.style.display = 'none';
            errorArea.style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    // Drop zone
    dropZone.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
    dropZone.addEventListener('touchend', (e) => { e.preventDefault(); fileInput.click(); });
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
    });

    // File input
    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFile(e.target.files[0]);
    });

    // Remove
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); resetUI(); });

    // Upload
    uploadBtn.addEventListener('click', async () => {
        if (!selectedFile) return;
        uploadBtn.disabled = true;
        loadingArea.style.display = 'block';
        uploadBtn.style.display = 'none';
        previewArea.style.display = 'none';
        errorArea.style.display = 'none';

        const formData = new FormData();
        formData.append('image', selectedFile);

        try {
            const res = await fetch('/upload', { method: 'POST', body: formData });
            const data = await res.json();

            if (res.ok && data.success) {
                document.getElementById('directLink').value = data.url;
                document.getElementById('shortLink').value = data.shortUrl;
                document.getElementById('htmlCode').value = data.html;
                document.getElementById('bbCode').value = data.bbcode;
                document.getElementById('markdownCode').value = data.markdown;
                document.getElementById('deleteLink').href = data.deleteUrl;
                resultImg.src = data.url;

                // QR Kod oluştur
                if (typeof QRCode !== 'undefined' && qrCanvas) {
                    QRCode.toCanvas(qrCanvas, data.shortUrl, { width: 150, margin: 1 });
                }

                resultArea.style.display = 'block';
                dropZone.style.display = 'none';
                resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                showError(data.error || 'Yükleme hatası.');
                uploadBtn.style.display = 'flex';
                previewArea.style.display = 'block';
                dropZone.style.display = 'none';
            }
        } catch (err) {
            showError('Sunucuya bağlanılamadı.');
            uploadBtn.style.display = 'flex';
            previewArea.style.display = 'block';
            dropZone.style.display = 'none';
        } finally {
            loadingArea.style.display = 'none';
            uploadBtn.disabled = false;
        }
    });

    // New upload
    newUploadBtn.addEventListener('click', resetUI);

    // Copy buttons
    document.addEventListener('click', function (e) {
        if (!e.target.classList.contains('btn-copy')) return;
        const input = document.getElementById(e.target.getAttribute('data-target'));
        if (!input) return;
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value).then(() => {
            e.target.textContent = '✓';
            e.target.classList.add('copied');
            setTimeout(() => { e.target.textContent = 'Kopyala'; e.target.classList.remove('copied'); }, 2000);
        });
    });

    // Sosyal paylaşım
    document.addEventListener('click', function (e) {
        if (!e.target.closest('.share-btn')) return;
        const platform = e.target.closest('.share-btn').getAttribute('data-platform');
        const url = encodeURIComponent(document.getElementById('shortLink').value || document.getElementById('directLink').value);
        const text = encodeURIComponent('ImgFast ile yükledim!');
        let shareUrl = '';
        switch (platform) {
            case 'twitter': shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${text}`; break;
            case 'whatsapp': shareUrl = `https://wa.me/?text=${text}%20${url}`; break;
            case 'facebook': shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`; break;
            case 'telegram': shareUrl = `https://t.me/share/url?url=${url}&text=${text}`; break;
        }
        if (shareUrl) window.open(shareUrl, '_blank');
    });

    // CTRL+V yapıştırma
    document.addEventListener('paste', function (e) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                handleFile(items[i].getAsFile());
                break;
            }
        }
    });

    // Tema değiştirme
    const savedTheme = localStorage.getItem('imgfast-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    themeToggle.addEventListener('click', function () {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('imgfast-theme', next);
    });

})();
