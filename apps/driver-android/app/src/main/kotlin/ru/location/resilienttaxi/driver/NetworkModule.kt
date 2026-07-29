package ru.location.resilienttaxi.driver

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import ru.location.resilienttaxi.driver.core.network.DriverApi
import ru.location.resilienttaxi.driver.domain.TokenStorage
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides
    @Singleton
    fun provideRetrofit(tokenStorage: TokenStorage): Retrofit =
        Retrofit
            .Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(
                OkHttpClient
                    .Builder()
                    .addInterceptor { chain ->
                        val token = runBlocking { tokenStorage.read()?.accessToken }
                        chain.proceed(
                            chain
                                .request()
                                .newBuilder()
                                .apply { if (token != null) header("Authorization", "Bearer $token") }
                                .build(),
                        )
                    }.build(),
            ).addConverterFactory(
                Json {
                    ignoreUnknownKeys = true
                    // Fields left at their default value (e.g. platform =
                    // "ANDROID") must still be sent, or server-side validation
                    // rejects the incomplete body.
                    encodeDefaults = true
                }.asConverterFactory("application/json".toMediaType()),
            )
            .build()

    @Provides
    @Singleton
    fun provideDriverApi(retrofit: Retrofit): DriverApi = retrofit.create(DriverApi::class.java)
}
