package ru.location.resilienttaxi.driver.core.network

import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
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

    // `application` is deliberately not a request field — the server derives
    // PASSENGER/DRIVER from the authenticated role, matching
    // RegisterDeviceTokenDto on the backend.
    @POST("notifications/devices")
    suspend fun registerDeviceToken(
        @Body request: RegisterDeviceTokenRequest,
    ): DeviceTokenResponse

    @DELETE("notifications/devices/{id}")
    suspend fun revokeDeviceToken(
        @Path("id") id: String,
    )

    @GET("drivers/me/profile")
    suspend fun getDriverProfile(): DriverProfileResponse

    @PUT("drivers/me/profile")
    suspend fun updateDriverProfile(
        @Body request: UpdateDriverProfileRequest,
    ): DriverProfileResponse

    @GET("drivers/me/vehicles")
    suspend fun listVehicles(): List<VehicleResponse>

    @POST("drivers/me/vehicles")
    suspend fun createVehicle(
        @Body request: CreateVehicleRequest,
    ): VehicleResponse

    @GET("drivers/me/documents")
    suspend fun listDriverDocuments(): List<DriverDocumentResponse>

    @POST("drivers/me/documents/upload-url")
    suspend fun requestDriverDocumentUploadUrl(
        @Body request: RequestDocumentUploadUrlRequest,
    ): DocumentUploadUrlResponse

    @POST("drivers/me/documents/{documentId}/confirm")
    suspend fun confirmDriverDocumentUpload(
        @Path("documentId") documentId: String,
    ): DriverDocumentResponse

    @GET("drivers/me/vehicles/{vehicleId}/documents")
    suspend fun listVehicleDocuments(
        @Path("vehicleId") vehicleId: String,
    ): List<DriverDocumentResponse>

    @POST("drivers/me/vehicles/{vehicleId}/documents/upload-url")
    suspend fun requestVehicleDocumentUploadUrl(
        @Path("vehicleId") vehicleId: String,
        @Body request: RequestDocumentUploadUrlRequest,
    ): DocumentUploadUrlResponse

    @POST("drivers/me/vehicles/{vehicleId}/documents/{documentId}/confirm")
    suspend fun confirmVehicleDocumentUpload(
        @Path("vehicleId") vehicleId: String,
        @Path("documentId") documentId: String,
    ): DriverDocumentResponse

    @GET("drivers/me/consents")
    suspend fun listConsents(): List<DriverConsentResponse>

    @POST("drivers/me/consents")
    suspend fun recordConsent(
        @Body request: RecordConsentRequest,
    ): DriverConsentResponse

    @POST("drivers/me/verification/submit")
    suspend fun submitVerification(): VerificationSubmitResponse
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
data class RegisterDeviceTokenRequest(
    val deviceId: String,
    val platform: String = "ANDROID",
    // Never logged client-side either — see PushTokenRegistrar.
    val pushToken: String,
    val notificationsPermission: Boolean,
)

@Serializable
data class DeviceTokenResponse(
    val id: String,
    val status: String,
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

// --- Task 29: driver profile/vehicle/document verification onboarding ---

@Serializable
data class UpdateDriverProfileRequest(
    val firstName: String,
    val lastName: String,
    val middleName: String? = null,
    // ISO date, e.g. "1990-05-20" — @IsDateString on the backend.
    val birthDate: String,
    val email: String? = null,
    val cityId: String,
)

@Serializable
data class DriverProfileResponse(
    val verificationStatus: String,
    val profileComplete: Boolean,
    val firstName: String? = null,
    val lastName: String? = null,
    val middleName: String? = null,
    val birthDate: String? = null,
    val cityId: String? = null,
    val email: String? = null,
    val verificationComment: String? = null,
)

@Serializable
data class CreateVehicleRequest(
    val brand: String,
    val model: String,
    val color: String,
    val productionYear: Int,
    val registrationNumber: String,
    val vin: String? = null,
    val category: String,
    val seats: Int,
    val childSeatAvailable: Boolean? = null,
    val luggageCapacity: Int? = null,
    val petAllowed: Boolean? = null,
)

@Serializable
data class VehicleResponse(
    val id: String,
    val brand: String,
    val model: String,
    val color: String,
    val productionYear: Int,
    val registrationNumberMasked: String,
    val vinLastFour: String? = null,
    val category: String,
    val status: String,
    val verificationStatus: String,
    val seats: Int,
)

@Serializable
data class RequestDocumentUploadUrlRequest(
    val documentType: String,
    val fileName: String,
    val mimeType: String,
    val fileSize: Int,
)

@Serializable
data class DocumentUploadUrlResponse(
    val documentId: String,
    val uploadUrl: String,
    val expiresAt: String,
    val requiredHeaders: Map<String, String>,
)

@Serializable
data class DriverDocumentResponse(
    val id: String,
    val type: String,
    val status: String,
    val fileNameSanitized: String,
    val mimeType: String,
    val fileSize: Int,
    val rejectionReasonCode: String? = null,
    val rejectionComment: String? = null,
)

@Serializable
data class RecordConsentRequest(
    val consentType: String,
    val documentVersion: String,
    val deviceId: String? = null,
)

@Serializable
data class DriverConsentResponse(
    val id: String,
    val consentType: String,
    val documentVersion: String,
    val acceptedAt: String,
    val revokedAt: String? = null,
)

@Serializable
data class VerificationSubmitResponse(
    val caseId: String,
    val status: String,
    val submittedAt: String,
)
