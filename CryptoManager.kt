package com.example.yourapp

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.Charset
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class CryptoManager {

    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply {
        load(null)
    }

    private fun getOrCreateSecretKey(keyAlias: String): SecretKey {
        // If key already exists, return it
        keyStore.getKey(keyAlias, null)?.let { return it as SecretKey }

        // Otherwise, create a new key
        val keyGenParams = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setUserAuthenticationRequired(true) // Require user auth (biometrics) to use the key
            .setInvalidatedByBiometricEnrollment(true) // Invalidate key if new biometrics are enrolled
            .build()

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        keyGenerator.init(keyGenParams)
        return keyGenerator.generateKey()
    }

    fun getEncryptCipher(keyAlias: String): Cipher {
        val secretKey = getOrCreateSecretKey(keyAlias)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, secretKey)
        return cipher
    }

    fun getDecryptCipherForIv(keyAlias: String, iv: ByteArray): Cipher {
        val secretKey = getOrCreateSecretKey(keyAlias)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, secretKey, GCMParameterSpec(128, iv))
        return cipher
    }

    fun encrypt(data: String, cipher: Cipher): EncryptedData {
        val encryptedBytes = cipher.doFinal(data.toByteArray(Charset.defaultCharset()))
        return EncryptedData(encryptedBytes, cipher.iv)
    }

    fun decrypt(encryptedData: EncryptedData, cipher: Cipher): String {
        val decryptedBytes = cipher.doFinal(encryptedData.data)
        return String(decryptedBytes, Charset.defaultCharset())
    }

    data class EncryptedData(val data: ByteArray, val iv: ByteArray)

    companion object {
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
    }
}