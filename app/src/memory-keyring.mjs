// The OS protects only the random vault key. Memory records use authenticated
// encryption independently, so no plaintext index or per-record keychain entry is needed.
export function memoryKeyring(storage){return{
 async wrapKey(text){if(storage.isAsyncEncryptionAvailable&&storage.encryptStringAsync){if(!await storage.isAsyncEncryptionAvailable())throw new Error('Secure storage unavailable');return storage.encryptStringAsync(text);}if(!storage.isEncryptionAvailable())throw new Error('Secure storage unavailable');return storage.encryptString(text);},
 async unwrapKey(bytes){if(!storage.decryptStringAsync)return storage.decryptString(bytes);const decrypted=await storage.decryptStringAsync(bytes);return typeof decrypted==='string'?decrypted:{value:decrypted.result,rewrap:decrypted.shouldReEncrypt};}
};}
