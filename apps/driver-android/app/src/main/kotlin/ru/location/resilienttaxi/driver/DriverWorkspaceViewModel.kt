package ru.location.resilienttaxi.driver

import android.content.Context
import android.provider.Settings
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import ru.location.resilienttaxi.driver.core.network.AvailableTripResponse
import ru.location.resilienttaxi.driver.core.network.CreateBidRequest
import ru.location.resilienttaxi.driver.core.network.DriverApi
import ru.location.resilienttaxi.driver.core.network.DriverBidResponse
import ru.location.resilienttaxi.driver.core.network.RequestCodeRequest
import ru.location.resilienttaxi.driver.core.network.VerifyCodeRequest
import ru.location.resilienttaxi.driver.domain.DriverSession
import ru.location.resilienttaxi.driver.domain.OtpCode
import ru.location.resilienttaxi.driver.domain.PhoneNumber
import ru.location.resilienttaxi.driver.domain.TokenStorage
import java.net.URI
import java.time.Instant
import javax.inject.Inject

sealed interface DriverUiState {
    data object Restoring : DriverUiState

    data class PhoneEntry(
        val error: String? = null,
        val isLoading: Boolean = false,
    ) : DriverUiState

    data class CodeEntry(
        val phone: String,
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
}

@HiltViewModel
class DriverWorkspaceViewModel
    @Inject
    constructor(
        @ApplicationContext private val context: Context,
        private val api: DriverApi,
        private val tokenStorage: TokenStorage,
    ) : ViewModel() {
        private val mutableState = MutableStateFlow<DriverUiState>(DriverUiState.Restoring)
        val state = mutableState.asStateFlow()
        private var socket: Socket? = null

        init {
            restoreSession()
        }

        fun requestCode(phone: String) {
            val normalized = PhoneNumber.normalizeOrNull(phone)
            if (normalized == null) {
                mutableState.value = DriverUiState.PhoneEntry(error = "Введите номер в международном формате")
                return
            }
            mutableState.value = DriverUiState.PhoneEntry(isLoading = true)
            viewModelScope.launch {
                runCatching { api.requestCode(RequestCodeRequest(normalized)) }
                    .onSuccess { mutableState.value = DriverUiState.CodeEntry(normalized) }
                    .onFailure { mutableState.value = DriverUiState.PhoneEntry(error = humanError(it)) }
            }
        }

        fun verifyCode(
            phone: String,
            code: String,
        ) {
            if (!OtpCode.isValid(code)) {
                mutableState.value = DriverUiState.CodeEntry(phone, error = "Код состоит из 6 цифр")
                return
            }
            mutableState.value = DriverUiState.CodeEntry(phone, isLoading = true)
            viewModelScope.launch {
                runCatching {
                    api.verifyCode(VerifyCodeRequest(phone, code, deviceId()))
                }.onSuccess {
                    tokenStorage.save(DriverSession(it.accessToken, it.refreshToken))
                    loadWorkspace(it.accessToken)
                }.onFailure { mutableState.value = DriverUiState.CodeEntry(phone, error = humanError(it)) }
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
                }.onFailure { mutableState.value = DriverUiState.PhoneEntry(error = "Сессия истекла — войдите снова") }
            }
        }

        private suspend fun loadWorkspace(accessToken: String?) {
            runCatching {
                val status = api.driverStatus()
                val orders = if (status.status == "ONLINE") api.availableTrips() else emptyList()
                status to orders
            }.onSuccess { (status, orders) ->
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

        private fun deviceId(): String {
            val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            return if (androidId.isNullOrBlank()) "android-device" else androidId
        }

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
