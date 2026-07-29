package ru.location.resilienttaxi.driver

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import dagger.hilt.android.AndroidEntryPoint
import ru.location.resilienttaxi.driver.core.designsystem.ResilientTaxiTheme
import ru.location.resilienttaxi.driver.core.network.AvailableTripResponse
import ru.location.resilienttaxi.driver.domain.CommissionCalculator
import ru.location.resilienttaxi.driver.domain.OtpCode

private const val ESTIMATED_COMMISSION_BASIS_POINTS = 1_500

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
        is DriverUiState.CodeEntry -> CodeScreen(state, viewModel::verifyCode)
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
    onSubmit: (String, String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    FormScreen("Подтверждение номера") {
        Text("Код отправлен на ${state.phone}")
        OutlinedTextField(
            value = code,
            onValueChange = { code = OtpCode.sanitize(it) },
            label = { Text("Код из 6 цифр") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.fillMaxWidth(),
        )
        state.error?.let { ErrorText(it) }
        Button(onClick = { onSubmit(state.phone, code) }, enabled = !state.isLoading, modifier = Modifier.fillMaxWidth()) {
            Text(if (state.isLoading) "Проверяем…" else "Войти")
        }
    }
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
    LazyColumn(
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize().padding(16.dp),
    ) {
        item {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                Button(onClick = onToggleOnline, enabled = !state.isLoading) {
                    Text(if (state.online) "Перейти OFFLINE" else "Перейти ONLINE")
                }
                Button(onClick = onRefresh, enabled = !state.isLoading) { Text("Обновить") }
                Button(onClick = onSignOut) { Text("Выйти") }
            }
        }
        item {
            Text(
                text = if (state.online) "Статус: ONLINE" else "Статус: OFFLINE",
                style = MaterialTheme.typography.headlineSmall,
            )
            if (state.isOffline) Text("Нет соединения: новые данные появятся после восстановления сети.")
            state.error?.let { ErrorText(it) }
        }
        if (state.online && state.activeBid == null) {
            item {
                OutlinedTextField(
                    value = vehicleId,
                    onValueChange = { vehicleId = it },
                    label = { Text("UUID подтверждённого автомобиля") },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
        state.activeBid?.let { bid ->
            item { ActiveBidCard(bid.id, bid.offeredPriceKopecks, bid.expiresAt, onWithdraw) }
        }
        if (state.isLoading) item { LoadingScreen("Обновляем данные…") }
        if (state.online && !state.isLoading && state.orders.isEmpty() && state.activeBid == null) {
            item { Text("Доступных заказов пока нет.") }
        }
        items(state.orders, key = { it.tripId }) { trip ->
            TripCard(trip, vehicleId, onBid, onSkip)
        }
    }
}

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
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(16.dp)) {
            Text(
                "Маршрут: ${trip.pickupAddress} → координаты назначения будут доступны после выбора",
                style = MaterialTheme.typography.titleMedium,
            )
            Text("Цена пассажира: ${trip.passengerPriceKopecks} коп.")
            Text("Оценочная комиссия (15%): ${fare.commissionKopecks} коп.; чистый доход: ${fare.driverPayoutKopecks} коп.")
            Text("До пассажира: ${trip.distanceToPickupMeters} м, ~${trip.estimatedPickupSeconds} сек")
            Divider()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onBid(trip, vehicleId, null) }) { Text("Принять цену") }
                Button(onClick = { onSkip(trip.tripId) }) { Text("Пропустить") }
            }
            OutlinedTextField(
                value = ownPrice,
                onValueChange = { ownPrice = it.filter(Char::isDigit) },
                label = { Text("Своя цена в копейках") },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(onClick = { onBid(trip, vehicleId, ownPrice.toIntOrNull()) }, modifier = Modifier.fillMaxWidth()) {
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
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(16.dp)) {
            Text("Активное предложение", style = MaterialTheme.typography.headlineSmall)
            Text("Ставка: $priceKopecks коп.; действует до $expiresAt")
            Text("ID предложения: $bidId")
            Button(onClick = onWithdraw) { Text("Отозвать предложение") }
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
