package com.example.yourapp

import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.Toast
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricManager.Authenticators.BIOMETRIC_STRONG
import androidx.biometric.BiometricPrompt
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import androidx.core.content.ContextCompat
import com.example.yourapp.databinding.ActivityLoginBinding
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import kotlinx.coroutines.launch
import java.io.IOException

class LoginActivity : AppCompatActivity() {

    private lateinit var binding: ActivityLoginBinding
    private lateinit var authTokenManager: AuthTokenManager
    private lateinit var cryptoManager: CryptoManager
    private lateinit var biometricPrompt: BiometricPrompt
    private lateinit var promptInfo: BiometricPrompt.PromptInfo

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityLoginBinding.inflate(layoutInflater)
        setContentView(binding.root)

        authTokenManager = AuthTokenManager(applicationContext)
        cryptoManager = CryptoManager()

        binding.buttonLogin.setOnClickListener {
            handleLogin()
        }
    }

    private fun handleLogin() {
        val username = binding.editTextUsername.text.toString().trim()
        val password = binding.editTextPassword.text.toString()

        if (username.isEmpty() || password.isEmpty()) {
            Toast.makeText(this, "Please enter username and password", Toast.LENGTH_SHORT).show()
            return
        }

        // Show loading state
        setLoading(true)

        // Launch a coroutine in the lifecycle scope
        lifecycleScope.launch {
            try {
                val request = LoginRequest(username, password)
                val response = RetrofitClient.instance.login(request)

                if (response.isSuccessful && response.body()?.success == true) {
                    val responseBody = response.body()!!
                    val user = responseBody.user
                    val token = responseBody.token

                    if (token != null) {
                        // Login successful, save the token securely
                        authTokenManager.saveToken(token)
                        Toast.makeText(this@LoginActivity, "Welcome, $user!", Toast.LENGTH_LONG).show()
                        showEnableBiometricDialog()
                    } else {
                        Toast.makeText(this@LoginActivity, "Login successful, but no token received.", Toast.LENGTH_LONG).show()
                    }

                } else {
                    // Login failed (e.g., 401 Invalid Credentials)
                    val errorMessage = response.body()?.message ?: "Invalid credentials"
                    Toast.makeText(this@LoginActivity, errorMessage, Toast.LENGTH_LONG).show()
                }
            } catch (e: IOException) {
                // Network error (no internet, server down)
                Toast.makeText(this@LoginActivity, "Network error: ${e.message}", Toast.LENGTH_LONG).show()
            } catch (e: Exception) {
                // Other errors (JSON parsing, etc.)
                Toast.makeText(this@LoginActivity, "An unexpected error occurred: ${e.message}", Toast.LENGTH_LONG).show()
            } finally {
                // Hide loading state
                setLoading(false)
            }
        }
    }

    private fun showEnableBiometricDialog() {
        val biometricManager = BiometricManager.from(this)
        if (biometricManager.canAuthenticate(BIOMETRIC_STRONG) != BiometricManager.BIOMETRIC_SUCCESS) {
            // Device doesn't support strong biometrics, so just navigate to the app.
            Toast.makeText(this, "Biometric authentication not available.", Toast.LENGTH_SHORT).show()
            navigateToMainApp()
            return
        }

        MaterialAlertDialogBuilder(this)
            .setTitle("Enable Fingerprint Login")
            .setMessage("Would you like to enable fingerprint login for next time?")
            .setCancelable(false)
            .setNegativeButton("No, thanks") { dialog, _ ->
                dialog.dismiss()
                navigateToMainApp()
            }
            .setPositiveButton("Yes") { dialog, _ ->
                dialog.dismiss()
                setupAndShowBiometricPrompt()
            }
            .show()
    }

    private fun setupAndShowBiometricPrompt() {
        val executor = ContextCompat.getMainExecutor(this)

        biometricPrompt = BiometricPrompt(this, executor,
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    super.onAuthenticationSucceeded(result)
                    // Authentication was successful, now encrypt the token
                    encryptAndSaveToken(result.cryptoObject)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    super.onAuthenticationError(errorCode, errString)
                    Toast.makeText(applicationContext, "Authentication error: $errString", Toast.LENGTH_SHORT).show()
                    navigateToMainApp() // Navigate even if they cancel
                }
            })

        promptInfo = BiometricPrompt.PromptInfo.Builder()
            .setTitle("Authenticate to enable Fingerprint Login")
            .setSubtitle("Place your finger on the sensor")
            .setNegativeButtonText("Cancel")
            .build()

        // Get a cipher for encryption and trigger the prompt
        val cipher = cryptoManager.getEncryptCipher("biometric_jwt_key")
        biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(cipher))
    }

    private fun encryptAndSaveToken(cryptoObject: BiometricPrompt.CryptoObject?) {
        val cipher = cryptoObject?.cipher ?: return
        val token = authTokenManager.getToken() ?: return

        try {
            val encryptedData = cryptoManager.encrypt(token, cipher)
            // Save the encrypted token and its IV, then clear the plaintext one.
            authTokenManager.saveBiometricEncryptedToken(encryptedData.data, encryptedData.iv)
            authTokenManager.clearToken()
            Toast.makeText(this, "Fingerprint login enabled successfully!", Toast.LENGTH_SHORT).show()
        } catch (e: Exception) {
            Toast.makeText(this, "Error enabling fingerprint login: ${e.message}", Toast.LENGTH_LONG).show()
        } finally {
            navigateToMainApp()
        }
    }

    private fun navigateToMainApp() {
        // Navigate to your main activity after login
        // val intent = Intent(this, MainActivity::class.java)
        // startActivity(intent)
        // finish() // Close the login activity
        Toast.makeText(this, "Navigating to main app...", Toast.LENGTH_SHORT).show()
    }

    private fun setLoading(isLoading: Boolean) {
        if (isLoading) {
            binding.progressBar.visibility = View.VISIBLE
            binding.buttonLogin.isEnabled = false
            binding.buttonLogin.text = "Logging in..."
        } else {
            binding.progressBar.visibility = View.GONE
            binding.buttonLogin.isEnabled = true
            binding.buttonLogin.text = "Login"
        }
    }
}