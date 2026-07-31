package ru.location.resilienttaxi.driver

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.delay
import ru.location.resilienttaxi.driver.core.designsystem.ResilientTaxiTheme
import ru.location.resilienttaxi.driver.core.maps.GeoPoint
import ru.location.resilienttaxi.driver.core.maps.MapBoundsModel
import ru.location.resilienttaxi.driver.core.maps.MapController
import ru.location.resilienttaxi.driver.core.maps.MapMarkerKind
import ru.location.resilienttaxi.driver.core.maps.MapMarkerModel
import ru.location.resilienttaxi.driver.core.network.AvailableTripResponse
import ru.location.resilienttaxi.driver.domain.CommissionCalculator
import ru.location.resilienttaxi.driver.domain.OtpCode

private const val ESTIMATED_COMMISSION_BASIS_POINTS = 1_500

private val InkCard = Color(0xFF0A0A0B)
private val InkMuted = Color(0xFF9B9EA6)
private val InkLine = Color(0xFF26282E)
private val Accent = Color(0xFF12B0FF)

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            ResilientTaxiTheme {
                Surface { DriverApp() }
            }
        }
    }
}

@Composable
private fun DriverApp(viewModel: DriverWorkspaceViewModel = hiltViewModel()) {
    when (val state = viewModel.state.collectAsState().value) {
        DriverUiState.Restoring -> LoadingScreen("Восстанавливаем сессию…")
        is DriverUiState.PhoneEntry -> PhoneScreen(state, viewModel::requestCode)
        is DriverUiState.CodeEntry -> CodeScreen(state, viewModel::verifyCode, viewModel::resendCode)
        is DriverUiState.Workspace ->
            WorkspaceScreen(
                state = state,
                onToggleOnline = viewModel::toggleOnline,
                onRefresh = viewModel::refreshWorkspace,
                onBid = viewModel::submitBid,
                onSkip = viewModel::skip,
                onWithdraw = viewModel::withdrawBid,
                onSignOut = viewModel::signOut,
            )
    }
}

@Composable
private fun PhoneScreen(
    state: DriverUiState.PhoneEntry,
    onSubmit: (String) -> Unit,
) {
    var phone by remember { mutableStateOf("") }
    FormScreen("Вход водителя") {
        Text("Введите номер телефона — отправим одноразовый код.")
        OutlinedTextField(phone, { phone = it }, label = { Text("+7 999 123-45-67") }, modifier = Modifier.fillMaxWidth())
        state.error?.let { ErrorText(it) }
        Button(onClick = { onSubmit(phone) }, enabled = !state.isLoading, modifier = Modifier.fillMaxWidth()) {
            Text(if (state.isLoading) "Отправляем…" else "Получить код")
        }
    }
}

@Composable
private fun CodeScreen(
    state: DriverUiState.CodeEntry,
    onSubmit: (DriverUiState.CodeEntry, String) -> Unit,
    onResend: () -> Unit,
) {
    var code by remember { mutableStateOf("") }
    var remainingSeconds by remember { mutableStateOf(0) }

    LaunchedEffect(state.resendAvailableAtEpochMillis) {
        while (true) {
            remainingSeconds =
                ((state.resendAvailableAtEpochMillis - System.currentTimeMillis()) / 1000)
                    .toInt()
                    .coerceAtLeast(0)
            if (remainingSeconds == 0) break
            delay(1_000)
        }
    }

    FormScreen("Подтверждение номера") {
        Text("Код отправлен на ${maskPhone(state.phone)}")
        OutlinedTextField(
            value = code,
            onValueChange = { code = OtpCode.sanitize(it) },
            label = { Text("Код из SMS") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        state.error?.let { ErrorText(it) }
        Button(onClick = { onSubmit(state, code) }, enabled = !state.isLoading, modifier = Modifier.fillMaxWidth()) {
            Text(if (state.isLoading) "Проверяем…" else "Войти")
        }
        Button(
            onClick = onResend,
            enabled = !state.isLoading && remainingSeconds == 0,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (remainingSeconds > 0) "Отправить повторно (${remainingSeconds}с)" else "Отправить код повторно")
        }
    }
}

private fun maskPhone(phone: String): String =
    if (phone.length > 4) {
        "${phone.take(2)}${"*".repeat(phone.length - 4)}${phone.takeLast(2)}"
    } else {
        phone
    }

@Composable
private fun WorkspaceScreen(
    state: DriverUiState.Workspace,
    onToggleOnline: () -> Unit,
    onRefresh: () -> Unit,
    onBid: (AvailableTripResponse, String, Int?) -> Unit,
    onSkip: (String) -> Unit,
    onWithdraw: () -> Unit,
    onSignOut: () -> Unit,
) {
    var vehicleId by remember { mutableStateOf("") }
    var mapController by remember { mutableStateOf<MapController?>(null) }
    val orderMarkers =
        remember(state.orders) {
            state.orders.map { trip ->
                MapMarkerModel(
                    id = trip.tripId,
                    kind = MapMarkerKind.ORDER_CANDIDATE,
                    location = GeoPoint(trip.pickupLatitude, trip.pickupLongitude),
                    label = trip.pickupAddress,
                )
            }
        }

    LaunchedEffect(mapController, orderMarkers) {
        if (orderMarkers.isNotEmpty()) {
            mapController?.fitRouteBounds(
                MapBoundsModel.of(orderMarkers.map { it.location }).padded(0.3),
            )
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        // Полноэкранная карта — фон, как в макете; точки доступных заказов поверх неё.
        DriverMap(
            markers = orderMarkers,
            polylines = emptyList(),
            modifier = Modifier.fillMaxSize(),
            onControllerReady = { mapController = it },
        )

        // Плавающая панель управления сверху: статус + кнопки.
        Column(
            verticalArrangement = Arrangement.spacedBy(10.dp),
            modifier =
                Modifier
                    .align(Alignment.TopCenter)
                    .fillMaxWidth()
                    .padding(16.dp),
        ) {
            StatusPill(online = state.online, offline = state.isOffline)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(
                    onClick = onToggleOnline,
                    enabled = !state.isLoading,
                    shape = CircleShape,
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = if (state.online) Accent else InkCard,
                            contentColor = Color.White,
                        ),
                    modifier = Modifier.weight(1f),
                ) {
                    Text(if (state.online) "ONLINE — нажмите, чтобы выйти" else "Выйти на линию")
                }
                CircleIconButton(label = "↻", onClick = onRefresh, enabled = !state.isLoading)
                CircleIconButton(label = "⏻", onClick = onSignOut, enabled = true)
            }
            state.error?.let {
                Card(
                    shape = RoundedCornerShape(16.dp),
                    colors = CardDefaults.cardColors(containerColor = InkCard, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(it, color = Color(0xFFFF6B6B), modifier = Modifier.padding(14.dp))
                }
            }
        }

        // Плавающие карточки снизу: заказы / активная ставка / пустое состояние.
        Column(
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier =
                Modifier
                    .align(Alignment.BottomCenter)
                    .fillMaxWidth()
                    .heightIn(max = 460.dp)
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp),
        ) {
            if (state.online && state.activeBid == null) {
                OutlinedTextField(
                    value = vehicleId,
                    onValueChange = { vehicleId = it },
                    label = { Text("UUID подтверждённого автомобиля") },
                    shape = RoundedCornerShape(18.dp),
                    colors = inkFieldColors(),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            state.activeBid?.let { bid ->
                ActiveBidCard(bid.id, bid.offeredPriceKopecks, bid.expiresAt, onWithdraw)
            }
            if (state.isLoading) {
                Card(
                    shape = RoundedCornerShape(22.dp),
                    colors = CardDefaults.cardColors(containerColor = InkCard, contentColor = Color.White),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(16.dp),
                    ) {
                        CircularProgressIndicator(color = Accent, modifier = Modifier.size(20.dp))
                        Text("Обновляем данные…")
                    }
                }
            }
            if (state.online && !state.isLoading && state.orders.isEmpty() && state.activeBid == null) {
                EmptyStateCard()
            }
            state.orders.forEach { trip ->
                TripCard(trip, vehicleId, onBid, onSkip)
            }
        }
    }
}

@Composable
private fun StatusPill(
    online: Boolean,
    offline: Boolean,
) {
    Card(
        shape = CircleShape,
        colors = CardDefaults.cardColors(containerColor = InkCard, contentColor = Color.White),
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.padding(horizontal = 18.dp, vertical = 12.dp),
        ) {
            Surface(color = if (online) Color(0xFF34C759) else InkMuted, shape = CircleShape) {
                Box(modifier = Modifier.size(10.dp))
            }
            Text(
                text = if (online) "Вы на линии" else "Не на линии",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
            )
            if (offline) Text("· нет сети", color = InkMuted, style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun CircleIconButton(
    label: String,
    onClick: () -> Unit,
    enabled: Boolean,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        shape = CircleShape,
        contentPadding =
            androidx.compose.foundation.layout
                .PaddingValues(0.dp),
        colors = ButtonDefaults.buttonColors(containerColor = InkCard, contentColor = Color.White),
        modifier = Modifier.size(52.dp),
    ) {
        Text(label, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun EmptyStateCard() {
    Card(
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = InkCard, contentColor = Color.White),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.padding(18.dp)) {
            Text("Ищем заказы поблизости…", style = MaterialTheme.typography.titleMedium)
            Text("Доступных заказов пока нет. Оставайтесь на линии.", color = InkMuted)
        }
    }
}

@Composable
private fun inkFieldColors() =
    OutlinedTextFieldDefaults.colors(
        focusedContainerColor = InkCard,
        unfocusedContainerColor = InkCard,
        focusedTextColor = Color.White,
        unfocusedTextColor = Color.White,
        focusedBorderColor = Accent,
        unfocusedBorderColor = InkLine,
        focusedLabelColor = Accent,
        unfocusedLabelColor = InkMuted,
        cursorColor = Accent,
    )

@Composable
private fun TripCard(
    trip: AvailableTripResponse,
    vehicleId: String,
    onBid: (AvailableTripResponse, String, Int?) -> Unit,
    onSkip: (String) -> Unit,
) {
    var ownPrice by remember { mutableStateOf("") }
    val fare =
        CommissionCalculator.breakdown(
            totalKopecks = trip.passengerPriceKopecks,
            commissionBasisPoints = ESTIMATED_COMMISSION_BASIS_POINTS,
        )
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors =
            CardDefaults.cardColors(
                containerColor = InkCard,
                contentColor = Color.White,
            ),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(16.dp)) {
            Text(
                "Подача: ${trip.pickupAddress}",
                style = MaterialTheme.typography.titleMedium,
            )
            Text("Назначение: ${trip.destinationAddress}", style = MaterialTheme.typography.titleMedium)
            Text("Цена пассажира: ${trip.passengerPriceKopecks} коп.", color = InkMuted)
            Text(
                "Оценочная комиссия (15%): ${fare.commissionKopecks} коп.; чистый доход: ${fare.driverPayoutKopecks} коп.",
                color = InkMuted,
            )
            Text("До пассажира: ${trip.distanceToPickupMeters} м, ~${trip.estimatedPickupSeconds} сек", color = InkMuted)
            Text(
                "Длина поездки: ${trip.estimatedDistanceMeters} м, ~${trip.estimatedDurationSeconds / 60} мин",
                color = InkMuted,
            )
            Divider(color = InkLine)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(
                    onClick = { onBid(trip, vehicleId, null) },
                    colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = InkCard),
                ) { Text("Принять цену") }
                Button(
                    onClick = { onSkip(trip.tripId) },
                    colors = ButtonDefaults.buttonColors(containerColor = InkLine, contentColor = Color.White),
                ) { Text("Пропустить") }
            }
            OutlinedTextField(
                value = ownPrice,
                onValueChange = { ownPrice = it.filter(Char::isDigit) },
                label = { Text("Своя цена в копейках") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                colors =
                    OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedBorderColor = Accent,
                        unfocusedBorderColor = InkLine,
                        focusedLabelColor = Accent,
                        unfocusedLabelColor = InkMuted,
                        cursorColor = Accent,
                    ),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { onBid(trip, vehicleId, ownPrice.toIntOrNull()) },
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = InkCard),
                modifier = Modifier.fillMaxWidth(),
            ) {
                Text("Предложить свою цену")
            }
        }
    }
}

@Composable
private fun ActiveBidCard(
    bidId: String,
    priceKopecks: Int,
    expiresAt: String,
    onWithdraw: () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors =
            CardDefaults.cardColors(
                containerColor = InkCard,
                contentColor = Color.White,
            ),
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(16.dp)) {
            Text("Активное предложение", style = MaterialTheme.typography.headlineSmall)
            Text("Ставка: $priceKopecks коп.; действует до $expiresAt", color = InkMuted)
            Text("ID предложения: $bidId", color = InkMuted)
            Button(
                onClick = onWithdraw,
                colors = ButtonDefaults.buttonColors(containerColor = InkLine, contentColor = Color.White),
            ) { Text("Отозвать предложение") }
        }
    }
}

@Composable
private fun FormScreen(
    title: String,
    content: @Composable () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize().padding(24.dp),
    ) {
        Text(title, style = MaterialTheme.typography.headlineMedium)
        content()
    }
}

@Composable
private fun LoadingScreen(text: String) {
    Column(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize().padding(24.dp),
    ) {
        CircularProgressIndicator()
        Text(text)
    }
}

@Composable
private fun ErrorText(text: String) = Text(text = text, color = MaterialTheme.colorScheme.error)
