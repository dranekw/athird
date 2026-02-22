/* * Steganography Logic
 * Шифрование, сжатие ZIP и работа с Canvas
 */

const Stego = {
    async generateKeys(nick) {
        const keyPair = await crypto.subtle.generateKey(
            { name: "RSA-OAEP", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
            true, ["encrypt", "decrypt"]
        );
        // Экспорт публичного ключа в SPKI (бинарный DER) -> base64
        const spki = await crypto.subtle.exportKey("spki", keyPair.publicKey);
        const pubBase64 = btoa(String.fromCharCode(...new Uint8Array(spki)));
        // Экспорт приватного ключа в PKCS#8 -> base64
        const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
        const privBase64 = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
        return {
            pub: `${nick}:${pubBase64}`,
            priv: `${nick}:${privBase64}`
        };
    },

    async encryptAndEmbed(fileOrText, isFile, coverImage, targetPublicKeyStr, statusCallback) {
        if(statusCallback) statusCallback("Подготовка и сжатие...");
        
        const zip = new JSZip();
        if (isFile) zip.file(fileOrText.name, fileOrText);
        else zip.file("message.txt", new TextEncoder().encode(fileOrText));
        
        const compressedData = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 9 } });

        if(statusCallback) statusCallback("Шифрование AES-256...");
        const aesKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encryptedPayload = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, aesKey, compressedData));

        const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
        
        // Импортируем публичный ключ получателя из компактной строки
        const [_, pubBase64] = targetPublicKeyStr.split(':');
        const pubDer = Uint8Array.from(atob(pubBase64), c => c.charCodeAt(0));
        const rsaPubKey = await crypto.subtle.importKey("spki", pubDer, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
        
        const encryptedAesKey = new Uint8Array(await crypto.subtle.encrypt({ name: "RSA-OAEP" }, rsaPubKey, rawAesKey));

        // Динамический расчет плотности встраивания (BPC - Bits Per Channel)
        const totalPayloadBits = encryptedPayload.length * 8;
        let bpc = 1; 
        const MAX_PIXELS = 1920 * 1080; 
        
        let pixelsNeeded = Math.ceil((273 * 8 + totalPayloadBits) / (3 * bpc));
        while (pixelsNeeded > MAX_PIXELS && bpc < 3) {
            bpc++;
            pixelsNeeded = Math.ceil((273 * 8 + totalPayloadBits) / (3 * bpc));
        }

        // Заголовок (273 байта)
        const header = new Uint8Array(273);
        new DataView(header.buffer).setUint32(0, encryptedPayload.length);
        header[4] = bpc;
        header.set(iv, 5);
        header.set(encryptedAesKey, 17);

        if(statusCallback) statusCallback(`Подготовка холста (Вмешательство: ${bpc} бит/канал)...`);
        
        let width = coverImage.width, height = coverImage.height;
        if ((width * height) < pixelsNeeded) {
            const ratio = width / height;
            const area = pixelsNeeded * 1.1; // +10% запаса
            width = Math.ceil(Math.sqrt(area * ratio));
            height = Math.ceil(area / width);
        }

        const cvs = document.getElementById('cvs');
        cvs.width = width; cvs.height = height;
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = "#000"; ctx.fillRect(0,0, width, height);
        ctx.drawImage(coverImage, 0, 0, width, height);
        
        const imgData = ctx.getImageData(0, 0, width, height);
        const pixels = imgData.data;

        // Маска для зачистки младших битов перед записью
        const maskClear = 255 ^ ((1 << bpc) - 1); 

        let pixelIdx = 0, channel = 0;

        if(statusCallback) statusCallback("Встраивание заголовка...");
        // Заголовок пишем всегда по 1 биту для обратной совместимости при расшифровке
        for (let byte of header) {
            for (let i = 7; i >= 0; i--) {
                const p = pixelIdx * 4 + channel;
                pixels[p] = (pixels[p] & 0xFE) | ((byte >> i) & 1);
                channel++; if (channel > 2) { channel = 0; pixelIdx++; }
            }
        }

        if(statusCallback) statusCallback("Встраивание данных (это может занять время)...");
        const seed = await CryptoUtils.deriveSeedFromKey(rawAesKey);
        const rng = CryptoUtils.createPRNG(seed);

        // Идеальная математика цветовых слотов
        const startPixel = pixelIdx + 1;
        const availablePixels = (width * height) - startPixel;
        const availableSlots = availablePixels * 3; // Каждый пиксель имеет 3 канала (RGB)
        
        const writesNeeded = Math.ceil(totalPayloadBits / bpc);
        const step = Math.floor(availableSlots / writesNeeded);
        
        if (step < 1) throw new Error(`Критическая ошибка математики: слотов=${availableSlots}, нужно записей=${writesNeeded}`);

        let writeIndex = 0;
        let bitBuffer = 0;
        let bitBufferLength = 0;
        
        for (let b = 0; b < encryptedPayload.length; b++) {
            if (b > 0 && b % 100000 === 0) await new Promise(r => setTimeout(r, 0));

            let byte = encryptedPayload[b];
            for (let i = 7; i >= 0; i--) {
                bitBuffer = (bitBuffer << 1) | ((byte >> i) & 1);
                bitBufferLength++;

                if (bitBufferLength === bpc) {
                    const baseSlot = writeIndex * step;
                    const jitter = Math.floor(rng() * step);
                    const targetSlot = baseSlot + jitter;
                    
                    const targetPixel = startPixel + Math.floor(targetSlot / 3);
                    const targetChannel = targetSlot % 3;
                    const p = targetPixel * 4 + targetChannel;
                    
                    pixels[p] = (pixels[p] & maskClear) | bitBuffer;
                    
                    writeIndex++;
                    bitBuffer = 0;
                    bitBufferLength = 0;
                }
            }
        }
        
        // Дописываем остатки, если файл не кратен выбранной плотности бит
        if (bitBufferLength > 0) {
            bitBuffer = bitBuffer << (bpc - bitBufferLength);
            const baseSlot = writeIndex * step;
            const jitter = Math.floor(rng() * step);
            const targetSlot = baseSlot + jitter;
            
            const targetPixel = startPixel + Math.floor(targetSlot / 3);
            const targetChannel = targetSlot % 3;
            const p = targetPixel * 4 + targetChannel;
            
            pixels[p] = (pixels[p] & maskClear) | bitBuffer;
        }

        ctx.putImageData(imgData, 0, 0);

        if(statusCallback) statusCallback("Формирование итогового PNG...");
        return new Promise((resolve) => {
            cvs.toBlob((blob) => resolve(blob), 'image/png');
        });
    },

    async decryptAndExtract(stegoImage, myPrivateKeyStr, statusCallback) {
        if(statusCallback) statusCallback("Чтение пикселей...");
        const cvs = document.getElementById('cvs');
        const ctx = cvs.getContext('2d', { willReadFrequently: true });
        cvs.width = stegoImage.width; cvs.height = stegoImage.height;
        ctx.drawImage(stegoImage, 0, 0);
        
        const pixels = ctx.getImageData(0, 0, cvs.width, cvs.height).data;

        let pixelIdx = 0, channel = 0;
        const readBit1 = () => {
            const p = pixelIdx * 4 + channel; channel++;
            if (channel > 2) { channel = 0; pixelIdx++; }
            return pixels[p] & 1;
        };

        const readByte = () => { let b = 0; for (let i=0; i<8; i++) b = (b << 1) | readBit1(); return b; };

        // Читаем заголовок
        const headerBytes = new Uint8Array(273);
        for(let i=0; i<273; i++) headerBytes[i] = readByte();

        const view = new DataView(headerBytes.buffer);
        const payloadLen = view.getUint32(0);
        const bpc = headerBytes[4];
        const iv = headerBytes.slice(5, 17);
        const encAesKey = headerBytes.slice(17, 273);

        if(statusCallback) statusCallback("Расшифровка ключей...");
        // Импортируем приватный ключ из компактной строки
        const [_, privBase64] = myPrivateKeyStr.split(':');
        const privDer = Uint8Array.from(atob(privBase64), c => c.charCodeAt(0));
        const rsaPrivKey = await crypto.subtle.importKey("pkcs8", privDer, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
        
        let rawAesKey;
        try { rawAesKey = await crypto.subtle.decrypt({ name: "RSA-OAEP" }, rsaPrivKey, encAesKey); } 
        catch (e) { throw new Error("Неверный приватный ключ!"); }

        const aesKey = await crypto.subtle.importKey("raw", rawAesKey, "AES-GCM", false, ["decrypt"]);

        if(statusCallback) statusCallback("Извлечение данных (асинхронно)...");
        const seed = await CryptoUtils.deriveSeedFromKey(rawAesKey);
        const rng = CryptoUtils.createPRNG(seed);

        const startPixel = pixelIdx + 1;
        const availablePixels = (cvs.width * cvs.height) - startPixel;
        const availableSlots = availablePixels * 3;
        
        const totalBits = payloadLen * 8;
        const readsNeeded = Math.ceil(totalBits / bpc);
        const step = Math.floor(availableSlots / readsNeeded);

        const encryptedPayload = new Uint8Array(payloadLen);
        
        let readIndex = 0;
        let bitBuffer = 0;
        let bitsInBuffer = 0;
        let byteIndex = 0;
        const maskExtract = (1 << bpc) - 1;

        while (byteIndex < payloadLen) {
            if (byteIndex > 0 && byteIndex % 100000 === 0) await new Promise(r => setTimeout(r, 0));

            const baseSlot = readIndex * step;
            const jitter = Math.floor(rng() * step);
            const targetSlot = baseSlot + jitter;
            
            const targetPixel = startPixel + Math.floor(targetSlot / 3);
            const targetChannel = targetSlot % 3;
            const p = targetPixel * 4 + targetChannel;
            
            const extractedBits = pixels[p] & maskExtract;
            
            bitBuffer = (bitBuffer << bpc) | extractedBits;
            bitsInBuffer += bpc;

            while (bitsInBuffer >= 8 && byteIndex < payloadLen) {
                const shift = bitsInBuffer - 8;
                encryptedPayload[byteIndex] = (bitBuffer >> shift) & 0xFF;
                byteIndex++;
                bitBuffer = bitBuffer & ((1 << shift) - 1);
                bitsInBuffer = shift;
            }
            readIndex++;
        }

        if(statusCallback) statusCallback("Расшифровка AES-256...");
        const decryptedZip = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, aesKey, encryptedPayload);

        if(statusCallback) statusCallback("Распаковка архива...");
        const zip = await JSZip.loadAsync(decryptedZip);
        const filename = Object.keys(zip.files)[0];
        const fileData = await zip.file(filename).async("uint8array");
        
        return { filename: filename, data: fileData, isText: filename === "message.txt" };
    }
};