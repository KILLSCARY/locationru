package ru.location.resilienttaxi.driver.core.network

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

interface DriverApi {
    @POST("auth/request-code")
    suspend fun requestCode(
        @Body request: RequestCodeRequest,
    ): RequestCodeResponse

    @POST("auth/resend-code")
    suspend fun resendCode(
        @Body request: ResendCodeRequest,
    ): RequestCodeResponse

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

@Serializable
data class RequestCodeRequest(
    val phone: String,
    val deviceId: String,
)

@Serializable
data class ResendCodeRequest(
    val requestId: String,
    val phone: String,
    val deviceId: String,
)

@Serializable
data class RequestCodeResponse(
    val requestId: String,
    val expiresInSeconds: Int,
    val resendInSeconds: Int,
)

@Serializable
data class VerifyCodeRequest(
    val requestId: String,
    val phone: String,
    val code: String,
    val deviceId: String,
    val platform: String = "ANDROID",
)

@Serializable
data class RefreshTokenRequest(
    val refreshToken: String,
)

@Serializable
data class TokenPairResponse(
    val accessToken: String,
    val refreshToken: String,
)

@Serializable
data class CurrentDriverResponse(
    val id: String,
    val phone: String,
    val role: String,
)

@Serializable
data class DriverStatusResponse(
    val status: String,
    val verificationStatus: String,
)

@Serializable
data class AvailableTripResponse(
    val tripId: String,
    val passengerPriceKopecks: Int,
    val pickupAddress: String,
    val pickupLatitude: Double,
    val pickupLongitude: Double,
    val destinationAddress: String,
    val estimatedDistanceMeters: Int,
    val estimatedDurationSeconds: Int,
    val estimatedPickupSeconds: Int,
    val distanceToPickupMeters: Int,
)

@Serializable
data class CreateBidRequest(
    val vehicleId: String,
    val offeredPriceKopecks: Int? = null,
)

@Serializable
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

@Serializable
data class DriverLocationBatchRequest(
    val locations: List<DriverLocationUploadRequest>,
)

@Serializable
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
