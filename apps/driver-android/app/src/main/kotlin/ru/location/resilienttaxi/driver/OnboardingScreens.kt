package ru.location.resilienttaxi.driver

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Divider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import ru.location.resilienttaxi.driver.core.network.DriverDocumentResponse
import java.io.ByteArrayOutputStream

/**
 * Task 29 section 21 — one scrolling screen covering profile, vehicle,
 * required documents and consents, gated on verificationStatus. Known,
 * documented gaps versus the full 11-step spec: no in-app crop UI (the
 * picked/captured image is uploaded as-is — cropping would need a new
 * image-editing dependency); the camera path uses
 * `TakePicturePreview` (a downscaled in-memory thumbnail, no FileProvider
 * setup needed) rather than a full-resolution capture, so a photo taken with
 * the in-app camera button is lower-resolution than one picked from the
 * gallery; and there is no offline upload queue/resume across app restarts
 * (an interrupted upload must be retried manually by picking the image
 * again; nothing is silently retried in the background).
 */
@Composable
fun OnboardingScreen(
    state: DriverUiState.Onboarding,
    onSaveProfile: (String, String, String?, String, String?, String) -> Unit,
    onCreateVehicle: (String, String, String, Int, String, String?, String, Int) -> Unit,
    onUploadDocument: (type: String, isVehicleDocument: Boolean, bytes: ByteArray, mimeType: String) -> Unit,
    onToggleConsent: (String, Boolean) -> Unit,
    onSubmit: () -> Unit,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        modifier =
            Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(20.dp),
    ) {
        Text("Верификация водителя", style = MaterialTheme.typography.headlineMedium)
        StatusBanner(state)
        state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        if (state.submitted || state.verificationStatus in TERMINAL_AFTER_SUBMIT) {
            SubmittedCard(state, onRefresh, onSignOut)
            return@Column
        }

        SectionCard(title = "1. Профиль") {
            ProfileForm(saved = state.profileSaved, onSave = onSaveProfile)
        }
        SectionCard(title = "2. Автомобиль") {
            if (state.vehicle == null) {
                VehicleForm(onCreate = onCreateVehicle)
            } else {
                Text("${state.vehicle.brand} ${state.vehicle.model}, ${state.vehicle.registrationNumberMasked}")
            }
        }
        SectionCard(title = "3. Документы водителя") {
            DocumentList(
                required = RequiredDocuments.driver,
                documents = state.driverDocuments,
                uploadingType = state.uploadingType,
                onUpload = { type, bytes, mimeType -> onUploadDocument(type, false, bytes, mimeType) },
            )
        }
        if (state.vehicle != null) {
            SectionCard(title = "4. Документы автомобиля") {
                DocumentList(
                    required = RequiredDocuments.vehicle,
                    documents = state.vehicleDocuments,
                    uploadingType = state.uploadingType,
                    onUpload = { type, bytes, mimeType -> onUploadDocument(type, true, bytes, mimeType) },
                )
            }
        }
        SectionCard(title = "5. Согласия") {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                RequiredDocuments.requiredConsentTypes.forEach { (type, label) ->
                    val given = type in state.consentsGiven
                    Row {
                        Checkbox(checked = given, onCheckedChange = { onToggleConsent(type, it) }, enabled = !given)
                        Text(label, modifier = Modifier.padding(top = 12.dp))
                    }
                }
            }
        }

        Button(
            onClick = onSubmit,
            enabled = state.readyForSubmission && !state.isLoading,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (state.isLoading) "Отправляем…" else "Отправить на проверку")
        }
        Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) { Text("Обновить") }
        Button(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Выйти") }
    }
}

private val TERMINAL_AFTER_SUBMIT =
    setOf("DOCUMENTS_SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUESTED", "REJECTED", "SUSPENDED", "EXPIRED")

@Composable
private fun StatusBanner(state: DriverUiState.Onboarding) {
    val text =
        when (state.verificationStatus) {
            "PROFILE_INCOMPLETE", "DOCUMENTS_REQUIRED" -> "Заполните профиль, добавьте автомобиль и загрузите документы."
            "DOCUMENTS_SUBMITTED" -> "Документы отправлены, ожидают постановки в очередь на проверку."
            "UNDER_REVIEW" -> "Заявка на рассмотрении у администратора."
            "CHANGES_REQUESTED" -> "Требуются исправления — см. комментарий ниже."
            "REJECTED" -> "Заявка отклонена."
            "SUSPENDED" -> "Допуск приостановлен."
            "EXPIRED" -> "Один из документов истёк — потребуется повторная проверка."
            else -> state.verificationStatus
        }
    Text(text, style = MaterialTheme.typography.bodyLarge)
    state.verificationComment?.let { Text("Комментарий: $it", color = MaterialTheme.colorScheme.error) }
}

@Composable
private fun SubmittedCard(
    state: DriverUiState.Onboarding,
    onRefresh: () -> Unit,
    onSignOut: () -> Unit,
) {
    Card(shape = RoundedCornerShape(16.dp), modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(18.dp)) {
            Text("Заявка отправлена на рассмотрение", style = MaterialTheme.typography.titleMedium)
            Text("Мы уведомим вас, как только администратор примет решение.")
            if (state.verificationStatus == "CHANGES_REQUESTED" || state.verificationStatus == "REJECTED") {
                Text("Отклонённые документы можно загрузить заново ниже.", color = MaterialTheme.colorScheme.error)
                DocumentList(
                    required = RequiredDocuments.driver,
                    documents = state.driverDocuments,
                    uploadingType = state.uploadingType,
                    onUpload = { _, _, _ -> },
                    showOnlyRejected = true,
                )
            }
            Button(onClick = onRefresh, modifier = Modifier.fillMaxWidth()) { Text("Проверить статус") }
            Button(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Выйти") }
        }
    }
}

@Composable
private fun SectionCard(
    title: String,
    content: @Composable () -> Unit,
) {
    Card(shape = RoundedCornerShape(16.dp), colors = CardDefaults.cardColors(), modifier = Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Divider()
            content()
        }
    }
}

@Composable
private fun ProfileForm(
    saved: Boolean,
    onSave: (String, String, String?, String, String?, String) -> Unit,
) {
    var firstName by remember { mutableStateOf("") }
    var lastName by remember { mutableStateOf("") }
    var middleName by remember { mutableStateOf("") }
    var birthDate by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var cityId by remember { mutableStateOf("") }

    if (saved) {
        Text("Профиль сохранён.")
        return
    }
    OutlinedTextField(firstName, { firstName = it }, label = { Text("Имя") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(lastName, { lastName = it }, label = { Text("Фамилия") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(middleName, { middleName = it }, label = { Text("Отчество") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        birthDate,
        { birthDate = it },
        label = { Text("Дата рождения (ГГГГ-ММ-ДД)") },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(email, { email = it }, label = { Text("Email (необязательно)") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(cityId, { cityId = it }, label = { Text("Город") }, modifier = Modifier.fillMaxWidth())
    Button(
        onClick = { onSave(firstName, lastName, middleName, birthDate, email, cityId) },
        enabled = firstName.isNotBlank() && lastName.isNotBlank() && birthDate.isNotBlank() && cityId.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Сохранить профиль") }
}

@Composable
private fun VehicleForm(onCreate: (String, String, String, Int, String, String?, String, Int) -> Unit) {
    var brand by remember { mutableStateOf("") }
    var model by remember { mutableStateOf("") }
    var color by remember { mutableStateOf("") }
    var productionYear by remember { mutableStateOf("") }
    var registrationNumber by remember { mutableStateOf("") }
    var vin by remember { mutableStateOf("") }
    var category by remember { mutableStateOf("economy") }
    var seats by remember { mutableStateOf("4") }

    OutlinedTextField(brand, { brand = it }, label = { Text("Марка") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(model, { model = it }, label = { Text("Модель") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(color, { color = it }, label = { Text("Цвет") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        productionYear,
        { productionYear = it.filter(Char::isDigit) },
        label = { Text("Год выпуска") },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(
        registrationNumber,
        { registrationNumber = it },
        label = { Text("Госномер") },
        modifier = Modifier.fillMaxWidth(),
    )
    OutlinedTextField(vin, { vin = it }, label = { Text("VIN (необязательно)") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(category, { category = it }, label = { Text("Категория") }, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(
        seats,
        { seats = it.filter(Char::isDigit) },
        label = { Text("Количество мест") },
        modifier = Modifier.fillMaxWidth(),
    )
    Button(
        onClick = {
            onCreate(
                brand,
                model,
                color,
                productionYear.toIntOrNull() ?: return@Button,
                registrationNumber,
                vin.ifBlank { null },
                category,
                seats.toIntOrNull() ?: 4,
            )
        },
        enabled = brand.isNotBlank() && model.isNotBlank() && registrationNumber.isNotBlank(),
        modifier = Modifier.fillMaxWidth(),
    ) { Text("Добавить автомобиль") }
}

@Composable
private fun DocumentList(
    required: List<Pair<String, String>>,
    documents: List<DriverDocumentResponse>,
    uploadingType: String?,
    onUpload: (type: String, bytes: ByteArray, mimeType: String) -> Unit,
    showOnlyRejected: Boolean = false,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        required.forEach { (type, label) ->
            val document = documents.firstOrNull { it.type == type }
            if (showOnlyRejected && document?.status != "REJECTED") return@forEach
            DocumentRow(type, label, document, uploadingType == type, onUpload)
        }
    }
}

@Composable
private fun DocumentRow(
    type: String,
    label: String,
    document: DriverDocumentResponse?,
    isUploading: Boolean,
    onUpload: (type: String, bytes: ByteArray, mimeType: String) -> Unit,
) {
    val context = LocalContext.current
    var previewBitmap by remember { mutableStateOf<Bitmap?>(null) }

    fun handleBitmap(bitmap: Bitmap?) {
        if (bitmap == null) return
        previewBitmap = bitmap
        val output = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, DOCUMENT_JPEG_QUALITY, output)
        onUpload(type, output.toByteArray(), "image/jpeg")
    }

    val cameraLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.TakePicturePreview()) { bitmap -> handleBitmap(bitmap) }
    // Deliberately never logs the picked content:// URI (Task 29 section 21) — only the decoded bytes are used.
    val galleryLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri: Uri? ->
            if (uri == null) return@rememberLauncherForActivityResult
            val bitmap =
                context.contentResolver.openInputStream(uri)?.use { stream -> BitmapFactory.decodeStream(stream) }
            handleBitmap(bitmap)
        }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.fillMaxWidth()) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Text(
            text = documentStatusLabel(document),
            color = if (document?.status == "REJECTED") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )
        document?.rejectionComment?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        previewBitmap?.let {
            Image(bitmap = it.asImageBitmap(), contentDescription = null, modifier = Modifier.fillMaxWidth())
        }
        if (isUploading) {
            CircularProgressIndicator(modifier = Modifier.padding(4.dp))
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { cameraLauncher.launch(null) }) { Text("Камера") }
                Button(
                    onClick = { galleryLauncher.launch("image/*") },
                    colors = ButtonDefaults.buttonColors(),
                ) { Text(if (document == null) "Из галереи" else "Заменить") }
            }
        }
    }
}

private const val DOCUMENT_JPEG_QUALITY = 90

private fun documentStatusLabel(document: DriverDocumentResponse?): String =
    when (document?.status) {
        null -> "Не загружено"
        "UPLOADING", "UPLOADED", "PROCESSING" -> "Обрабатывается…"
        "READY_FOR_REVIEW" -> "Ожидает проверки"
        "APPROVED" -> "Одобрено"
        "REJECTED" -> "Отклонено"
        "FAILED_SECURITY_CHECK" -> "Не прошло проверку безопасности — загрузите другой файл"
        "EXPIRED" -> "Истёк срок действия"
        "REVOKED" -> "Удалено"
        else -> document.status
    }
