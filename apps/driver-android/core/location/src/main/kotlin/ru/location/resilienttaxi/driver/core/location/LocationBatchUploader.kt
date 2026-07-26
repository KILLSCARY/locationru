package ru.location.resilienttaxi.driver.core.location

import ru.location.resilienttaxi.driver.core.database.OfflineLocationEntity
import ru.location.resilienttaxi.driver.core.network.DriverApi
import ru.location.resilienttaxi.driver.core.network.DriverLocationBatchRequest
import ru.location.resilienttaxi.driver.core.network.DriverLocationUploadRequest
import javax.inject.Inject

class LocationBatchUploader
    @Inject
    constructor(
        private val api: DriverApi,
        private val queue: OfflineLocationQueue,
    ) {
        suspend fun uploadOrQueue(
            location: EvaluatedLocation,
            isConnected: Boolean,
        ) {
            if (!isConnected || runCatching { upload(location.toRequest()) }.isFailure) queue.enqueue(location)
        }

        suspend fun flushPending() {
            while (true) {
                val batch = queue.nextBatch()
                if (batch.isEmpty()) return
                runCatching { api.uploadLocationBatch(DriverLocationBatchRequest(batch.map { it.toRequest() })) }
                    .onFailure { return }
                queue.removeUploaded(batch.map { it.id })
            }
        }

        private suspend fun upload(location: DriverLocationUploadRequest) {
            api.uploadLocationBatch(DriverLocationBatchRequest(listOf(location)))
        }

        private fun EvaluatedLocation.toRequest() =
            DriverLocationUploadRequest(
                recordedAtEpochMillis = sample.recordedAtEpochMillis,
                latitude = sample.latitude,
                longitude = sample.longitude,
                accuracyMeters = sample.accuracyMeters,
                speedMetersPerSecond = sample.speedMetersPerSecond,
                bearingDegrees = sample.bearingDegrees,
                altitudeMeters = sample.altitudeMeters,
                provider = sample.provider,
                quality = quality.name,
                suspectedSpoofing = suspectedSpoofing,
                satellitesVisible = satellitesVisible,
                cellCount = cellCount,
            )

        private fun OfflineLocationEntity.toRequest() =
            DriverLocationUploadRequest(
                recordedAtEpochMillis = recordedAtEpochMillis,
                latitude = latitude,
                longitude = longitude,
                accuracyMeters = accuracyMeters,
                speedMetersPerSecond = speedMetersPerSecond,
                bearingDegrees = bearingDegrees,
                altitudeMeters = altitudeMeters,
                provider = provider,
                quality = quality,
                suspectedSpoofing = suspectedSpoofing,
                satellitesVisible = satellitesVisible,
                cellCount = cellCount,
            )
    }
