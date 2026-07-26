package ru.location.resilienttaxi.driver.core.network

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import ru.location.resilienttaxi.driver.domain.TokenStorage

@Module
@InstallIn(SingletonComponent::class)
abstract class TokenStorageModule {
    @Binds
    abstract fun bindTokenStorage(storage: SecureTokenStorage): TokenStorage
}
