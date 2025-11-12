package com.example.yourapp

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKeys

class AuthTokenManager(context: Context) {

    private val masterKeyAlias = MasterKeys.getOrCreate(MasterKeys.AES256_GCM_SPEC)

    private val sharedPreferences = EncryptedSharedPreferences.create(
        "auth_token_prefs",
        masterKeyAlias,
        context,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )

    fun saveToken(token: String) {
        sharedPreferences.edit()
            .putString(KEY_AUTH_TOKEN, token)
            .apply()
    }

    fun getToken(): String? {
        return sharedPreferences.getString(KEY_AUTH_TOKEN, null)
    }

    fun saveBiometricEncryptedToken(encryptedToken: ByteArray, iv: ByteArray) {
        val encryptedTokenBase64 = Base64.encodeToString(encryptedToken, Base64.DEFAULT)
        val ivBase64 = Base64.encodeToString(iv, Base64.DEFAULT)
        sharedPreferences.edit()
            .putString(KEY_BIOMETRIC_ENCRYPTED_TOKEN, encryptedTokenBase64)
            .putString(KEY_BIOMETRIC_IV, ivBase64)
            .apply()
    }

    fun getBiometricEncryptedToken(): Pair<ByteArray, ByteArray>? {
        val encryptedTokenBase64 = sharedPreferences.getString(KEY_BIOMETRIC_ENCRYPTED_TOKEN, null)
        val ivBase64 = sharedPreferences.getString(KEY_BIOMETRIC_IV, null)

        if (encryptedTokenBase64 == null || ivBase64 == null) {
            return null
        }
        val encryptedToken = Base64.decode(encryptedTokenBase64, Base64.DEFAULT)
        val iv = Base64.decode(ivBase64, Base64.DEFAULT)
        return Pair(encryptedToken, iv)
    }

    fun clearToken() {
        sharedPreferences.edit().remove(KEY_AUTH_TOKEN).apply()
    }

    fun clearBiometricEncryptedToken() {
        sharedPreferences.edit()
            .remove(KEY_BIOMETRIC_ENCRYPTED_TOKEN)
            .remove(KEY_BIOMETRIC_IV)
            .apply()
    }
    companion object {
        private const val KEY_AUTH_TOKEN = "auth_token"
        private const val KEY_BIOMETRIC_ENCRYPTED_TOKEN = "biometric_encrypted_token"
        private const val KEY_BIOMETRIC_IV = "biometric_iv"
    }
}