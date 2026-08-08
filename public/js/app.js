/**
 * =============================================
 *  IMGFAST - Ana Uygulama JavaScript
 * =============================================
 */

(function () {
    'use strict';

    // DOM Elementleri
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
    const uploadCard = document.querySelector('.upload-card');

    let selectedFile = null;

    // =============================================
    //  UTILITY FUNCTIONS
    // =============================================

    function formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function showError(message) {
        errorArea.textContent = message;
        errorArea.style.display = 'block';
        setTimeout(function () {
            errorArea.style.display = 'none';
        }, 4000);
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
    }

    // =============================================
    //  FILE HANDLING
    // =============================================

    function handleFile(file) {
        hideError();

        // Dosya tipi kontrolü
        if (!file.type.startsWith('image/')) {
            showError('Lütfen geçerli bir resim dosyası seçin.');
            return;
        }

        // Dosya boyutu kontrolü
        if (file.size > 10 * 1024 * 1024) {
            showError('Dosya boyutu 10 MB\'dan küçük olmalıdır.');
            return;
        }

        selectedFile = file;

        // Önizleme göster
        const reader = new FileReader();
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
    //  EVENT LISTENERS
    // =============================================

    // Drop zone click
    dropZone.addEventListener('click', function (e) {
        e.preventDefault();
        fileInput.click();
    });

    // Mobil dokunma
    dropZone.addEventListener('touchend', function (e) {
        e.preventDefault();
        fileInput.click();
    });

    // Drag & drop
    dropZone.addEventListener('dragover', function (e) {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', function (e) {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', function (e) {
        e.preventDefault();
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

    // Remove button
    removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        resetUI();
    });

    // Upload button
    uploadBtn.addEventListener('click', async function () {
        if (!selectedFile) return;

        uploadBtn.disabled = true;
        loadingArea.style.display = 'block';
        uploadBtn.style.display = 'none';
        previewArea.style.display = 'none';
        hideError();

        const formData = new FormData();
        formData.append('image', selectedFile);

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData,
            });

            const data = await response.json();

            if (response.ok && data.success) {
                // Linkleri doldur
                document.getElementById('directLink').value = data.url;
                document.getElementById('htmlCode').value = data.html;
                document.getElementById('bbCode').value = data.bbcode;
                document.getElementById('markdownCode').value = data.markdown;
                document.getElementById('deleteLink').href = data.deleteUrl;
                resultImg.src = data.url;

                resultArea.style.display = 'block';
                dropZone.style.display = 'none';

                // Sayfayı sonuca kaydır
                resultArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                showError(data.error || 'Yükleme sırasında bir hata oluştu.');
                uploadBtn.style.display = 'flex';
                previewArea.style.display = 'block';
                dropZone.style.display = 'none';
            }
        } catch (err) {
            showError('Sunucuya bağlanılamadı. Lütfen internet bağlantınızı kontrol edin.');
            uploadBtn.style.display = 'flex';
            previewArea.style.display = 'block';
            dropZone.style.display = 'none';
        } finally {
            loadingArea.style.display = 'none';
            uploadBtn.disabled = false;
        }
    });

    // Yeni yükleme butonu
    newUploadBtn.addEventListener('click', function () {
        resetUI();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // =============================================
    //  COPY BUTTONS
    // =============================================

    document.addEventListener('click', function (e) {
        if (!e.target.classList.contains('btn-copy')) return;

        const targetId = e.target.getAttribute('data-target');
        const input = document.getElementById(targetId);

        if (!input) return;

        input.select();
        input.setSelectionRange(0, 99999);

        navigator.clipboard.writeText(input.value).then(function () {
            e.target.textContent = 'Kopyalandı';
            e.target.classList.add('copied');
            setTimeout(function () {
                e.target.textContent = 'Kopyala';
                e.target.classList.remove('copied');
            }, 2000);
        }).catch(function () {
            // Fallback
            e.target.textContent = 'Hata';
            setTimeout(function () {
                e.target.textContent = 'Kopyala';
            }, 1500);
        });
    });

    // =============================================
    //  GLOBAL PASTE HANDLER
    // =============================================

    document.addEventListener('paste', function (e) {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.indexOf('image') !== -1) {
                e.preventDefault();
                const file = items[i].getAsFile();
                handleFile(file);
                break;
            }
        }
    });

})();
