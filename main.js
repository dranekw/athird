/* * Main UI Logic
 * Связывает интерфейс с crypto/stego модулями
 */

let activeFile = null;
let coverImg = null;
let decImg = null;
let downloadResultBlob = null;
let downloadResultName = "";

document.addEventListener('DOMContentLoaded', () => {
    
// Переключатель сайдбара для мобилок
const sideToggle = document.getElementById('side-toggle');
const sidebar = document.getElementById('sidebar');

sideToggle.onclick = () => {
    sidebar.classList.toggle('active');
    sideToggle.innerText = sidebar.classList.contains('active') ? '×' : 'i';
};

    // --- Tabs ---
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn, .pane').forEach(el => el.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById('t-' + e.target.dataset.tab).classList.add('active');
        });
    });

    function setupDropZone(id, inputId, callback) {
        const zone = document.getElementById(id), input = document.getElementById(inputId);
        zone.onclick = () => input.click();
        zone.ondragover = (e) => { e.preventDefault(); zone.classList.add('drag-over'); };
        zone.ondragleave = () => zone.classList.remove('drag-over');
        zone.ondrop = (e) => { e.preventDefault(); zone.classList.remove('drag-over'); if (e.dataTransfer.files[0]) callback(e.dataTransfer.files[0]); };
        input.onchange = (e) => { if (e.target.files[0]) callback(e.target.files[0]); };
    }

    setupDropZone('dz-f', 'f-in', (file) => {
        activeFile = file;
        document.getElementById('txt-f').innerText = "ВЫБРАН: " + file.name;
        document.getElementById('msg-in').disabled = true;
        document.getElementById('dz-f').classList.add('filled');
    });

    document.getElementById('msg-in').addEventListener('input', (e) => {
        const dz = document.getElementById('dz-f');
        if (e.target.value.length > 0) { dz.classList.add('disabled'); activeFile = null; } 
        else { dz.classList.remove('disabled'); }
    });

    setupDropZone('dz-c', 'c-in', (file) => loadImage(file, 'prev-c', 'txt-c', (img) => coverImg = img));
    setupDropZone('dz-d', 'd-in', (file) => loadImage(file, 'prev-d', 'txt-d', (img) => decImg = img));

    // --- Кнопки копирования ключей ---
    document.querySelectorAll('.copy-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const textarea = document.getElementById(targetId);
            textarea.select();
            document.execCommand('copy');
            btn.innerText = 'Скопировано!';
            setTimeout(() => btn.innerText = 'Копировать', 2000);
        });
    });

    document.getElementById('btn-gen-keys').onclick = async () => {
        const nick = document.getElementById('nick').value || "ANON";
        const keys = await Stego.generateKeys(nick);
        document.getElementById('pub-o').value = keys.pub;
        document.getElementById('priv-o').value = keys.priv;
        document.getElementById('keys-out').classList.remove('hidden');
    };

    document.getElementById('btn-do-enc').onclick = async () => {
        const status = document.getElementById('st-enc');
        setStatus(status, "Инициализация...", "ok");
        
        try {
            const txt = document.getElementById('msg-in').value;
            const targetKey = document.getElementById('target-k').value;
            if ((!activeFile && !txt) || !coverImg || !targetKey) throw new Error("Заполните все поля");

            const data = activeFile || txt;
            const isFile = !!activeFile;

            setTimeout(async () => {
                try {
                    const resultBlob = await Stego.encryptAndEmbed(data, isFile, coverImg, targetKey, (msg) => {
                        setStatus(status, msg, "ok");
                    });
                    
                    const link = document.createElement('a');
                    link.download = `pic_${Date.now()}.png`;
                    link.href = URL.createObjectURL(resultBlob);
                    link.click();
                    
                    setStatus(status, "Готово! Файл скачан.", "ok");
                } catch (e) {
                    console.error(e);
                    setStatus(status, "Ошибка: " + e.message, "err");
                }
            }, 50);

        } catch (e) { setStatus(status, e.message, "err"); }
    };

    document.getElementById('btn-do-dec').onclick = async () => {
        const status = document.getElementById('st-dec');
        const resBox = document.getElementById('res-box');
        const previewContainer = document.getElementById('preview-container');
        resBox.classList.add('hidden');
        previewContainer.classList.add('hidden');
        previewContainer.innerHTML = '';
        setStatus(status, "Инициализация...", "ok");

        try {
            const myKey = document.getElementById('my-k').value;
            if (!decImg || !myKey) throw new Error("Нужен файл и ваш приватный ключ");

            setTimeout(async () => {
                try {
                    const result = await Stego.decryptAndExtract(decImg, myKey, (msg) => {
                        setStatus(status, msg, "ok");
                    });
                    
                    resBox.classList.remove('hidden');
                    document.getElementById('res-name').innerText = "Содержимое: " + result.filename;
                    
                    // Определяем тип файла для предпросмотра
                    const ext = result.filename.split('.').pop().toLowerCase();
                    const mimeTypes = {
                        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'bmp': 'image/bmp',
                        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
                        'mp4': 'video/mp4', 'webm': 'video/webm', 'ogv': 'video/ogg'
                    };
                    const mime = mimeTypes[ext];

                    if (mime && (mime.startsWith('image/') || mime.startsWith('audio/') || mime.startsWith('video/'))) {
                        const blob = new Blob([result.data], { type: mime });
                        const url = URL.createObjectURL(blob);
                        let elem;
                        if (mime.startsWith('image/')) {
                            elem = document.createElement('img');
                            elem.src = url;
                        } else if (mime.startsWith('audio/')) {
                            elem = document.createElement('audio');
                            elem.controls = true;
                            elem.src = url;
                        } else if (mime.startsWith('video/')) {
                            elem = document.createElement('video');
                            elem.controls = true;
                            elem.src = url;
                        }
                        previewContainer.appendChild(elem);
                        previewContainer.classList.remove('hidden');
                        document.getElementById('res-t').value = ''; // Очищаем текстовое поле
                        document.getElementById('btn-dl').classList.remove('hidden');
                    } else if (result.isText) {
                        document.getElementById('res-t').value = new TextDecoder().decode(result.data);
                        document.getElementById('btn-dl').classList.add('hidden');
                    } else {
                        document.getElementById('res-t').value = "[БИНАРНЫЙ ФАЙЛ] Используйте кнопку скачать";
                        document.getElementById('btn-dl').classList.remove('hidden');
                    }

                    // Сохраняем blob для скачивания (для всех нетекстовых случаев)
                    if (!result.isText) {
                        downloadResultBlob = new Blob([result.data]);
                        downloadResultName = result.filename;
                    } else {
                        downloadResultBlob = null;
                    }

                    setStatus(status, "Успешно расшифровано!", "ok");
                } catch (e) {
                    console.error(e);
                    setStatus(status, "Ошибка: Неверный ключ или поврежденный файл.", "err");
                }
            }, 50);

        } catch (e) { setStatus(status, e.message, "err"); }
    };

    document.getElementById('btn-dl').onclick = () => {
        if (!downloadResultBlob) return;
        const link = document.createElement('a');
        link.href = URL.createObjectURL(downloadResultBlob);
        link.download = downloadResultName;
        link.click();
    };
});

function loadImage(file, imgId, txtId, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            cb(img);
            const el = document.getElementById(imgId);
            el.src = img.src;
            el.classList.remove('hidden');
            document.getElementById(txtId).classList.add('hidden');
            el.parentElement.classList.add('filled');
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function setStatus(el, msg, type) {
    el.innerText = msg;
    el.className = "status-msg " + type;
    el.style.display = "block";
}