package ru.location.resilienttaxi.driver.core.network

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import ru.location.resilienttaxi.driver.domain.DriverSession
import ru.location.resilienttaxi.driver.domain.TokenStorage
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.spec.GCMParameterSpec
import javax.inject.Inject
import javax.inject.Singleton

private val Context.secureTokensDataStore by preferencesDataStore(name = "secure_driver_tokens")

@Singleton
class SecureTokenStorage
    @Inject
    constructor(
        @param:ApplicationContext private val context: Context,
    ) : TokenStorage {
        override suspend fun clear() {
            context.secureTokensDataStore.edit { it.clear() }
        }

        override suspend fun read(): DriverSession? =
            context.secureTokensDataStore.data
                .map { preferences ->
                    val access = preferences[ACCESS_TOKEN]?.let(::decrypt)
                    val refresh = preferences[REFRESH_TOKEN]?.let(::decrypt)
                    if (access == null || refresh == null) null else DriverSession(access, refresh)
                }.first()

        override suspend fun save(session: DriverSession) {
            context.secureTokensDataStore.edit { preferences ->
                preferences[ACCESS_TOKEN] = encrypt(session.accessToken)
                preferences[REFRESH_TOKEN] = encrypt(session.refreshToken)
            }
        }

        private fun encrypt(value: String): String {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val data = cipher.iv + cipher.doFinal(value.encodeToByteArray())
            return Base64.encodeToString(data, Base64.NO_WRAP)
        }

        private fun decrypt(value: String): String? =
            runCatching {
                val data = Base64.decode(value, Base64.NO_WRAP)
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(GCM_TAG_BITS, data.copyOf(IV_BYTES)))
                cipher.doFinal(data.copyOfRange(IV_BYTES, data.size)).decodeToString()
            }.getOrNull()

        private fun secretKey() =
            KeyStore.getInstance(ANDROID_KEYSTORE).run {
                load(null)
                getKey(KEY_ALIAS, null) ?: KeyGenerator
                    .getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
                    .apply {
                        init(
                            KeyGenParameterSpec
                                .Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                                .build(),
                        )
                    }.generateKey()
            }

        private companion object {
            const val ANDROID_KEYSTORE = "AndroidKeyStore"
            const val GCM_TAG_BITS = 128
            const val IV_BYTES = 12
            const val KEY_ALIAS = "resilient_taxi_driver_tokens"
            const val TRANSFORMATION = "AES/GCM/NoPadding"
            val ACCESS_TOKEN = stringPreferencesKey("access_token")
            val REFRESH_TOKEN = stringPreferencesKey("refresh_token")
        }
    }
