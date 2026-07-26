package ru.location.resilienttaxi.driver.core.network

import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface DriverApi {
    @POST("auth/request-code")
    suspend fun requestCode(
        @Body request: RequestCodeRequest,
    )

    @POST("auth/verify-code")
    suspend fun verifyCode(
        @Body request: VerifyCodeRequest,
    ): TokenPairResponse

    @GET("auth/me")
    suspend fun currentDriver(): CurrentDriverResponse

    @POST("auth/refresh")
    suspend fun refresh(
        @Body request: RefreshTokenRequest,
    ): TokenPairResponse

    @POST("drivers/me/location/batch")
    suspend fun uploadLocationBatch(
        @Body request: DriverLocationBatchRequest,
    )

    @POST("drivers/me/online")
    suspend fun goOnline(): DriverStatusResponse

    @POST("drivers/me/offline")
    suspend fun goOffline(): DriverStatusResponse

    @GET("drivers/me/status")
    suspend fun driverStatus(): DriverStatusResponse

    @GET("driver/trips/available")
    suspend fun availableTrips(): List<AvailableTripResponse>

    @POST("trips/{tripId}/bids")
    suspend fun createBid(
        @Path("tripId") tripId: String,
        @Body request: CreateBidRequest,
    ): DriverBidResponse

    @DELETE("trips/{tripId}/bids/{bidId}")
    suspend fun withdrawBid(
        @Path("tripId") tripId: String,
        @Path("bidId") bidId: String,
    ): DriverBidResponse
}

data class RequestCodeRequest(
    val phone: String,
)

data class VerifyCodeRequest(
    val phone: String,
    val code: String,
    val deviceId: String,
    val platform: String = "ANDROID",
)

data class RefreshTokenRequest(
    val refreshToken: String,
)

data class TokenPairResponse(
    val accessToken: String,
    val refreshToken: String,
)

data class CurrentDriverResponse(
    val id: String,
    val phone: String,
    val role: String,
)

data class DriverStatusResponse(
    val status: String,
    val verificationStatus: String,
)

data class AvailableTripResponse(
    val tripId: String,
    val passengerPriceKopecks: Int,
    val pickupAddress: String,
    val estimatedPickupSeconds: Int,
    val distanceToPickupMeters: Int,
)

data class CreateBidRequest(
    val vehicleId: String,
    val offeredPriceKopecks: Int? = null,
)

data class DriverBidResponse(
    val id: String,
    val tripId: String,
    val vehicleId: String,
    val offeredPriceKopecks: Int,
    val estimatedPickupSeconds: Int,
    val distanceToPickupMeters: Int,
    val status: String,
    val expiresAt: String,
    val version: Int,
)

data class DriverLocationBatchRequest(
    val locations: List<DriverLocationUploadRequest>,
)

data class DriverLocationUploadRequest(
    val recordedAtEpochMillis: Long,
    val latitude: Double,
    val longitude: Double,
    val accuracyMeters: Float,
    val speedMetersPerSecond: Float?,
    val bearingDegrees: Float?,
    val altitudeMeters: Double?,
    val provider: String,
    val quality: String,
    val suspectedSpoofing: Boolean,
    val satellitesVisible: Int?,
    val cellCount: Int?,
)
