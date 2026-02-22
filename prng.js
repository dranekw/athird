/* * PRNG & PBKDF2 Utilities
 * Отвечает за генерацию детерминированного шума.
 */

const CryptoUtils = {
    // Используем PBKDF2 для превращения секретного AES ключа в Seed
    // Без приватного ключа RSA невозможно узнать AES ключ, а значит — и расположение пикселей
    async deriveSeedFromKey(rawKey) {
        const enc = new TextEncoder();
        const baseKey = await crypto.subtle.importKey(
            "raw", 
            rawKey, 
            "PBKDF2", 
            false, 
            ["deriveBits"]
        );

        const salt = enc.encode("ATHIRD_HIGH_SALT_SECURE_LAYER_V2");
        
        const derivedBits = await crypto.subtle.deriveBits(
            {
                name: "PBKDF2",
                salt: salt,
                iterations: 100000,
                hash: "SHA-256"
            },
            baseKey,
            32 // получаем 32 бита для seed
        );

        return new DataView(derivedBits).getUint32(0);
    },

    // Mulberry32 PRNG
    createPRNG(seed) {
        return function() {
            var t = seed += 0x6D2B79F5;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        }
    }
};