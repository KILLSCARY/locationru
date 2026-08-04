package ru.location.resilienttaxi.driver

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import ru.location.resilienttaxi.driver.core.network.AvailableTripResponse
import ru.location.resilienttaxi.driver.core.network.CreateBidRequest
import ru.location.resilienttaxi.driver.core.network.CreateVehicleRequest
import ru.location.resilienttaxi.driver.core.network.DeviceIdProvider
import ru.location.resilienttaxi.driver.core.network.DriverApi
import ru.location.resilienttaxi.driver.core.network.DriverBidResponse
import ru.location.resilienttaxi.driver.core.network.DriverConsentResponse
import ru.location.resilienttaxi.driver.core.network.DriverDocumentResponse
import ru.location.resilienttaxi.driver.core.network.RecordConsentRequest
import ru.location.resilienttaxi.driver.core.network.RequestCodeRequest
import ru.location.resilienttaxi.driver.core.network.RequestDocumentUploadUrlRequest
import ru.location.resilienttaxi.driver.core.network.ResendCodeRequest
import ru.location.resilienttaxi.driver.core.network.UpdateDriverProfileRequest
import ru.location.resilienttaxi.driver.core.network.VehicleResponse
import ru.location.resilienttaxi.driver.core.network.VerifyCodeRequest
import ru.location.resilienttaxi.driver.core.push.PushTokenRegistrar
import ru.location.resilienttaxi.driver.domain.DriverSession
import ru.location.resilienttaxi.driver.domain.OtpCode
import ru.location.resilienttaxi.driver.domain.PhoneNumber
import ru.location.resilienttaxi.driver.domain.TokenStorage
import java.net.URI
import java.time.Instant
import javax.inject.Inject

/**
 * Task 29 section 21 — hardcoded to match the backend's default
 * DRIVER_REQUIRED_DOCUMENT_TYPES/VEHICLE_REQUIRED_DOCUMENT_TYPES
 * (.env.example). There is no endpoint for a client to discover the
 * required set dynamically; if the backend config changes, this list must
 * be updated by hand — a known, documented gap (see the final Task 29
 * report).
 */
object RequiredDocuments {
    val driver =
        listOf(
            "PASSPORT_MAIN_PAGE" to "Разворот паспорта с фото",
            "DRIVER_LICENSE_FRONT" to "Водительское удостоверение (лицевая сторона)",
            "DRIVER_LICENSE_BACK" to "Водительское удостоверение (обратная сторона)",
            "PROFILE_PHOTO" to "Фото профиля",
            "SELFIE_WITH_DOCUMENT" to "Селфи с документом",
        )
    val vehicle =
        listOf(
            "VEHICLE_REGISTRATION_FRONT" to "Свидетельство о регистрации ТС",
            "INSURANCE_POLICY" to "Полис ОСАГО",
            "VEHICLE_PHOTO_FRONT" to "Фото автомобиля спереди",
            "VEHICLE_PHOTO_BACK" to "Фото автомобиля сзади",
        )
    val requiredConsentTypes =
        listOf(
            "PERSONAL_DATA_PROCESSING" to "Обработка персональных данных",
            "DOCUMENT_PROCESSING" to "Обработка документов",
            "TERMS_OF_SERVICE" to "Условия использования",
            "DRIVER_PARTNER_AGREEMENT" to "Партнёрское соглашение водителя",
        )
    const val CONSENT_DOCUMENT_VERSION = "v1"
}

sealed interface DriverUiState {
    data object Restoring : DriverUiState

    data class PhoneEntry(
        val error: String? = null,
        val isLoading: Boolean = false,
    ) : DriverUiState

    data class CodeEntry(
        val phone: String,
        val requestId: String,
        // Absolute wall-clock target, not a running countdown — survives
        // process death/app backgrounding without needing its own timer state.
        val resendAvailableAtEpochMillis: Long,
        val error: String? = null,
        val isLoading: Boolean = false,
    ) : DriverUiState

    data class Workspace(
        val online: Boolean,
        val orders: List<AvailableTripResponse>,
        val activeBid: DriverBidResponse? = null,
        val isLoading: Boolean = false,
        val error: String? = null,
        val isOffline: Boolean = false,
    ) : DriverUiState

    /**
     * Shown instead of Workspace whenever verificationStatus != APPROVED.
     * `uploadingType` is the DriverDocumentType/VehicleDocumentType
     * currently mid-upload (drives a per-row progress indicator, never more
     * than one at a time since uploads are sequential).
     */
    data class Onboarding(
        val verificationStatus: String,
        val verificationComment: String? = null,
        val profileSaved: Boolean = false,
        val vehicle: VehicleResponse? = null,
        val driverDocuments: List<DriverDocumentResponse> = emptyList(),
        val vehicleDocuments: List<DriverDocumentResponse> = emptyList(),
        val consentsGiven: Set<String> = emptySet(),
        val uploadingType: String? = null,
        val isLoading: Boolean = false,
        val error: String? = null,
        val submitted: Boolean = false,
    ) : DriverUiState {
        val readyForSubmission: Boolean
            get() =
                profileSaved &&
                    vehicle != null &&
                    RequiredDocuments.driver.all { (type, _) ->
                        driverDocuments.any { it.type == type && it.status in READY_STATUSES }
                    } &&
                    RequiredDocuments.vehicle.all { (type, _) ->
                        vehicleDocuments.any { it.type == type && it.status in READY_STATUSES }
                    } &&
                    RequiredDocuments.requiredConsentTypes.all { (type, _) -> type in consentsGiven }

        private companion object {
            val READY_STATUSES = setOf("READY_FOR_REVIEW", "APPROVED")
        }
    }
}

@HiltViewModel
class DriverWorkspaceViewModel
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val api: DriverApi,
        private val tokenStorage: TokenStorage,
        private val deviceIdProvider: DeviceIdProvider,
        private val pushTokenRegistrar: PushTokenRegistrar,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow<DriverUiState>(DriverUiState.Restoring)
        val state = mutableState.asStateFlow()
        private var socket: Socket? = null

        // A presigned upload URL points at object storage, not the API — it
        // must never carry our own Bearer token (unlike `api`'s Retrofit
        // client, which always attaches one via NetworkModule's interceptor).
        private val uploadHttpClient = OkHttpClient()

        // Set when a push notification tap delivers a tripId (see
        // DriverFirebaseMessagingService's deepLink data field and
        // MainActivity.handleIntent). Kept separate from DriverUiState since
        // Workspace gets replaced wholesale by loadWorkspace/refreshWorkspace
        // and a lingering "opened from a notification" banner shouldn't be
        // lost every time that happens.
        private val mutableDeepLinkTripId = MutableStateFlow<String?>(null)
        val deepLinkTripId = mutableDeepLinkTripId.asStateFlow()

        init {
            restoreSession()
        }

        fun handleDeepLink(tripId: String?) {
            if (tripId.isNullOrBlank()) return
            mutableDeepLinkTripId.value = tripId
            refreshWorkspace()
        }

        fun consumeDeepLink() {
            mutableDeepLinkTripId.value = null
        }

        fun requestCode(phone: String) {
            val normalized = PhoneNumber.normalizeOrNull(phone)
            if (normalized == null) {
                mutableState.value = DriverUiState.PhoneEntry(error = "Введите номер в международном формате")
                return
            }
            mutableState.value = DriverUiState.PhoneEntry(isLoading = true)
            viewModelScope.launch {
                runCatching { api.requestCode(RequestCodeRequest(normalized, deviceId())) }
                    .onSuccess { response ->
                        mutableState.value =
                            DriverUiState.CodeEntry(
                                phone = normalized,
                                requestId = response.requestId,
                                resendAvailableAtEpochMillis =
                                    System.currentTimeMillis() + response.resendInSeconds * 1_000L,
                            )
                    }.onFailure { mutableState.value = DriverUiState.PhoneEntry(error = humanError(it)) }
            }
        }

        fun resendCode() {
            val codeEntry = state.value as? DriverUiState.CodeEntry ?: return
            mutableState.value = codeEntry.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching {
                    api.resendCode(ResendCodeRequest(codeEntry.requestId, codeEntry.phone, deviceId()))
                }.onSuccess { response ->
                    mutableState.value =
                        codeEntry.copy(
                            isLoading = false,
                            resendAvailableAtEpochMillis =
                                System.currentTimeMillis() + response.resendInSeconds * 1_000L,
                        )
                }.onFailure {
                    mutableState.value = codeEntry.copy(isLoading = false, error = humanError(it))
                }
            }
        }

        fun verifyCode(
            codeEntry: DriverUiState.CodeEntry,
            code: String,
        ) {
            if (!OtpCode.isValid(code)) {
                mutableState.value = codeEntry.copy(error = "Введите код из SMS")
                return
            }
            mutableState.value = codeEntry.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching {
                    api.verifyCode(
                        VerifyCodeRequest(codeEntry.requestId, codeEntry.phone, code, deviceId()),
                    )
                }.onSuccess {
                    tokenStorage.save(DriverSession(it.accessToken, it.refreshToken))
                    loadWorkspace(it.accessToken)
                    pushTokenRegistrar.registerOrRefresh()
                }.onFailure {
                    mutableState.value = codeEntry.copy(isLoading = false, error = humanError(it))
                }
            }
        }

        fun toggleOnline() {
            val workspace = state.value as? DriverUiState.Workspace ?: return
            mutableState.value = workspace.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching { if (workspace.online) api.goOffline() else api.goOnline() }
                    .onSuccess { refreshWorkspace() }
                    .onFailure { mutableState.value = workspace.copy(error = humanError(it), isOffline = true) }
            }
        }

        fun refreshWorkspace() {
            val workspace = state.value as? DriverUiState.Workspace ?: return
            mutableState.value = workspace.copy(isLoading = true, error = null)
            viewModelScope.launch { loadWorkspace(tokenStorage.read()?.accessToken) }
        }

        fun submitBid(
            trip: AvailableTripResponse,
            vehicleId: String,
            offeredPriceKopecks: Int?,
        ) {
            val workspace = state.value as? DriverUiState.Workspace ?: return
            if (vehicleId.isBlank()) {
                mutableState.value = workspace.copy(error = "Укажите UUID подтверждённого автомобиля")
                return
            }
            mutableState.value = workspace.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching { api.createBid(trip.tripId, CreateBidRequest(vehicleId, offeredPriceKopecks)) }
                    .onSuccess { bid ->
                        saveActiveBid(bid)
                        mutableState.value =
                            workspace.copy(
                                orders = workspace.orders.filterNot { it.tripId == trip.tripId },
                                activeBid = bid,
                            )
                    }.onFailure { mutableState.value = workspace.copy(error = humanError(it), isOffline = true) }
            }
        }

        fun withdrawBid() {
            val workspace = state.value as? DriverUiState.Workspace ?: return
            val bid = workspace.activeBid ?: return
            mutableState.value = workspace.copy(isLoading = true)
            viewModelScope.launch {
                runCatching { api.withdrawBid(bid.tripId, bid.id) }
                    .onSuccess {
                        clearActiveBid()
                        refreshWorkspace()
                    }.onFailure { mutableState.value = workspace.copy(error = humanError(it), isOffline = true) }
            }
        }

        fun skip(tripId: String) {
            val workspace = state.value as? DriverUiState.Workspace ?: return
            mutableState.value = workspace.copy(orders = workspace.orders.filterNot { it.tripId == tripId })
        }

        fun signOut() {
            socket?.disconnect()
            viewModelScope.launch {
                pushTokenRegistrar.revokeCurrent()
                tokenStorage.clear()
                clearActiveBid()
                mutableState.value = DriverUiState.PhoneEntry()
            }
        }

        private fun restoreSession() {
            viewModelScope.launch {
                val session = tokenStorage.read()
                if (session == null) {
                    mutableState.value = DriverUiState.PhoneEntry()
                    return@launch
                }
                runCatching {
                    api.refresh(
                        ru.location.resilienttaxi.driver.core.network
                            .RefreshTokenRequest(session.refreshToken),
                    )
                }.onSuccess {
                    tokenStorage.save(DriverSession(it.accessToken, it.refreshToken))
                    loadWorkspace(it.accessToken)
                    pushTokenRegistrar.registerOrRefresh()
                }.onFailure { mutableState.value = DriverUiState.PhoneEntry(error = "Сессия истекла — войдите снова") }
            }
        }

        private suspend fun loadWorkspace(accessToken: String?) {
            runCatching { api.driverStatus() }
                .onSuccess { status ->
                    if (status.verificationStatus != "APPROVED") {
                        loadOnboarding(status.verificationStatus)
                        return@onSuccess
                    }
                    val orders = runCatching { api.availableTrips() }.getOrDefault(emptyList())
                    mutableState.value =
                        DriverUiState.Workspace(
                            online = status.status == "ONLINE",
                            orders = orders,
                            activeBid = readActiveBid(),
                        )
                    accessToken?.let(::connectRealtime)
                }.onFailure {
                    mutableState.value = DriverUiState.Workspace(false, emptyList(), error = humanError(it), isOffline = true)
                }
        }

        /** Task 29 section 21 — loads everything the onboarding screen needs in one shot. Called instead of the orders workspace whenever verificationStatus != APPROVED. */
        private suspend fun loadOnboarding(verificationStatus: String) {
            runCatching {
                val profile = api.getDriverProfile()
                val vehicles = runCatching { api.listVehicles() }.getOrDefault(emptyList())
                val vehicle = vehicles.firstOrNull()
                val driverDocuments = runCatching { api.listDriverDocuments() }.getOrDefault(emptyList())
                val vehicleDocuments =
                    vehicle?.let { v -> runCatching { api.listVehicleDocuments(v.id) }.getOrDefault(emptyList()) }
                        ?: emptyList()
                val consents = runCatching { api.listConsents() }.getOrDefault(emptyList())
                OnboardingSnapshot(
                    profile.profileComplete,
                    profile.verificationComment,
                    vehicle,
                    driverDocuments,
                    vehicleDocuments,
                    consents,
                )
            }.onSuccess { loaded ->
                mutableState.value =
                    DriverUiState.Onboarding(
                        verificationStatus = verificationStatus,
                        verificationComment = loaded.verificationComment,
                        profileSaved = loaded.profileSaved,
                        vehicle = loaded.vehicle,
                        driverDocuments = loaded.driverDocuments,
                        vehicleDocuments = loaded.vehicleDocuments,
                        consentsGiven =
                            loaded.consents
                                .filter { it.revokedAt == null }
                                .map { it.consentType }
                                .toSet(),
                    )
            }.onFailure {
                mutableState.value = DriverUiState.Onboarding(verificationStatus = verificationStatus, error = humanError(it))
            }
        }

        private data class OnboardingSnapshot(
            val profileSaved: Boolean,
            val verificationComment: String?,
            val vehicle: VehicleResponse?,
            val driverDocuments: List<DriverDocumentResponse>,
            val vehicleDocuments: List<DriverDocumentResponse>,
            val consents: List<DriverConsentResponse>,
        )

        fun refreshOnboarding() {
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            mutableState.value = onboarding.copy(isLoading = true, error = null)
            viewModelScope.launch { loadOnboarding(onboarding.verificationStatus) }
        }

        fun saveProfile(
            firstName: String,
            lastName: String,
            middleName: String?,
            birthDate: String,
            email: String?,
            cityId: String,
        ) {
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            mutableState.value = onboarding.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching {
                    api.updateDriverProfile(
                        UpdateDriverProfileRequest(
                            firstName,
                            lastName,
                            middleName?.ifBlank { null },
                            birthDate,
                            email?.ifBlank { null },
                            cityId,
                        ),
                    )
                }.onSuccess { refreshOnboardingSilently() }
                    .onFailure { mutableState.value = onboarding.copy(isLoading = false, error = humanError(it)) }
            }
        }

        fun createVehicle(
            brand: String,
            model: String,
            color: String,
            productionYear: Int,
            registrationNumber: String,
            vin: String?,
            category: String,
            seats: Int,
        ) {
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            mutableState.value = onboarding.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching {
                    api.createVehicle(
                        CreateVehicleRequest(
                            brand,
                            model,
                            color,
                            productionYear,
                            registrationNumber,
                            vin?.ifBlank { null },
                            category,
                            seats,
                        ),
                    )
                }.onSuccess { refreshOnboardingSilently() }
                    .onFailure { mutableState.value = onboarding.copy(isLoading = false, error = humanError(it)) }
            }
        }

        /** Picks up, crops nothing (Task 29 section 21 known gap — no crop UI), and uploads a single document: request presigned URL -> raw PUT -> confirm -> reload the list. */
        fun uploadDocument(
            type: String,
            isVehicleDocument: Boolean,
            bytes: ByteArray,
            mimeType: String,
        ) {
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            val vehicleId = onboarding.vehicle?.id
            if (isVehicleDocument && vehicleId == null) return
            mutableState.value = onboarding.copy(uploadingType = type, error = null)
            viewModelScope.launch {
                runCatching {
                    val uploadRequest =
                        RequestDocumentUploadUrlRequest(
                            documentType = type,
                            fileName = "$type.jpg",
                            mimeType = mimeType,
                            fileSize = bytes.size,
                        )
                    val uploadUrl =
                        if (isVehicleDocument) {
                            api.requestVehicleDocumentUploadUrl(vehicleId!!, uploadRequest)
                        } else {
                            api.requestDriverDocumentUploadUrl(uploadRequest)
                        }
                    withContext(Dispatchers.IO) { putToPresignedUrl(uploadUrl.uploadUrl, bytes, mimeType) }
                    if (isVehicleDocument) {
                        api.confirmVehicleDocumentUpload(vehicleId!!, uploadUrl.documentId)
                    } else {
                        api.confirmDriverDocumentUpload(uploadUrl.documentId)
                    }
                }.onSuccess { refreshOnboardingSilently() }
                    .onFailure {
                        val current = state.value as? DriverUiState.Onboarding ?: return@onFailure
                        mutableState.value = current.copy(uploadingType = null, error = humanError(it))
                    }
            }
        }

        private fun putToPresignedUrl(
            url: String,
            bytes: ByteArray,
            mimeType: String,
        ) {
            val request =
                Request
                    .Builder()
                    .url(url)
                    .put(bytes.toRequestBody(mimeType.toMediaType()))
                    .build()
            uploadHttpClient.newCall(request).execute().use { response ->
                if (!response.isSuccessful) error("Не удалось загрузить файл (${response.code})")
            }
        }

        fun toggleConsent(
            consentType: String,
            given: Boolean,
        ) {
            if (!given) return // consents are only ever granted here, never revoked from this screen
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            if (consentType in onboarding.consentsGiven) return
            mutableState.value = onboarding.copy(consentsGiven = onboarding.consentsGiven + consentType)
            viewModelScope.launch {
                runCatching {
                    api.recordConsent(
                        RecordConsentRequest(consentType, RequiredDocuments.CONSENT_DOCUMENT_VERSION, deviceId()),
                    )
                }.onFailure {
                    val current = state.value as? DriverUiState.Onboarding ?: return@onFailure
                    mutableState.value = current.copy(consentsGiven = current.consentsGiven - consentType, error = humanError(it))
                }
            }
        }

        fun submitForReview() {
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            if (!onboarding.readyForSubmission) return
            mutableState.value = onboarding.copy(isLoading = true, error = null)
            viewModelScope.launch {
                runCatching { api.submitVerification() }
                    .onSuccess {
                        mutableState.value =
                            onboarding.copy(isLoading = false, submitted = true, verificationStatus = "DOCUMENTS_SUBMITTED")
                    }.onFailure { mutableState.value = onboarding.copy(isLoading = false, error = humanError(it)) }
            }
        }

        private fun refreshOnboardingSilently() {
            val onboarding = state.value as? DriverUiState.Onboarding ?: return
            viewModelScope.launch { loadOnboarding(onboarding.verificationStatus) }
        }

        private fun connectRealtime(accessToken: String) {
            if (socket?.connected() == true) return
            val serverUrl = BuildConfig.API_BASE_URL.substringBefore("/api/").trimEnd('/') + "/realtime"
            socket =
                IO
                    .socket(URI(serverUrl), IO.Options().apply { auth = mapOf("token" to accessToken) })
                    .apply {
                        on("trip.searching") { refreshWorkspace() }
                        on("trip.updated") { refreshWorkspace() }
                        on("bid.accepted") { refreshWorkspace() }
                        on(Socket.EVENT_CONNECT_ERROR) {
                            val workspace = state.value as? DriverUiState.Workspace ?: return@on
                            mutableState.value = workspace.copy(isOffline = true)
                        }
                        connect()
                    }
        }

        private fun saveActiveBid(bid: DriverBidResponse) {
            context
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .putString(BID_ID, bid.id)
                .putString(BID_TRIP_ID, bid.tripId)
                .putString(BID_VEHICLE_ID, bid.vehicleId)
                .putInt(BID_PRICE, bid.offeredPriceKopecks)
                .putInt(BID_PICKUP_SECONDS, bid.estimatedPickupSeconds)
                .putInt(BID_DISTANCE, bid.distanceToPickupMeters)
                .putString(BID_STATUS, bid.status)
                .putString(BID_EXPIRES_AT, bid.expiresAt)
                .putInt(BID_VERSION, bid.version)
                .apply()
        }

        private fun readActiveBid(): DriverBidResponse? {
            val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
            val expiresAt = preferences.getString(BID_EXPIRES_AT, null) ?: return null
            if (runCatching { Instant.parse(expiresAt).isBefore(Instant.now()) }.getOrDefault(true)) {
                clearActiveBid()
                return null
            }
            return DriverBidResponse(
                id = preferences.getString(BID_ID, null) ?: return null,
                tripId = preferences.getString(BID_TRIP_ID, null) ?: return null,
                vehicleId = preferences.getString(BID_VEHICLE_ID, null) ?: return null,
                offeredPriceKopecks = preferences.getInt(BID_PRICE, 0),
                estimatedPickupSeconds = preferences.getInt(BID_PICKUP_SECONDS, 0),
                distanceToPickupMeters = preferences.getInt(BID_DISTANCE, 0),
                status = preferences.getString(BID_STATUS, "ACTIVE") ?: "ACTIVE",
                expiresAt = expiresAt,
                version = preferences.getInt(BID_VERSION, 0),
            )
        }

        private fun clearActiveBid() {
            context
                .getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
        }

        private fun deviceId(): String = deviceIdProvider.deviceId()

        private companion object {
            const val PREFERENCES = "driver_workspace"
            const val BID_ID = "bid_id"
            const val BID_TRIP_ID = "bid_trip_id"
            const val BID_VEHICLE_ID = "bid_vehicle_id"
            const val BID_PRICE = "bid_price"
            const val BID_PICKUP_SECONDS = "bid_pickup_seconds"
            const val BID_DISTANCE = "bid_distance"
            const val BID_STATUS = "bid_status"
            const val BID_EXPIRES_AT = "bid_expires_at"
            const val BID_VERSION = "bid_version"
        }

        private fun humanError(error: Throwable): String = error.message ?: "Не удалось выполнить запрос. Проверьте интернет."
    }
