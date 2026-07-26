package ru.location.resilienttaxi.driver.domain

data class DriverSession(
    val accessToken: String,
    val refreshToken: String,
)

interface TokenStorage {
    suspend fun clear()

    suspend fun read(): DriverSession?

    suspend fun save(session: DriverSession)
}
