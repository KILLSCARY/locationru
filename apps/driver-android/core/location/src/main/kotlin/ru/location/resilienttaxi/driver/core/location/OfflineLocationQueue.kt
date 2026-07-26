package ru.location.resilienttaxi.driver.core.location

import ru.location.resilienttaxi.driver.core.database.OfflineLocationDao
import ru.location.resilienttaxi.driver.core.database.OfflineLocationEntity
import javax.inject.Inject

class OfflineLocationQueue
    @Inject
    constructor(
        private val dao: OfflineLocationDao,
    ) {
        suspend fun enqueue(location: EvaluatedLocation) {
            dao.insert(location.toEntity())
        }

        suspend fun nextBatch(limit: Int = MAX_BATCH_SIZE): List<OfflineLocationEntity> = dao.nextBatch(limit)

        suspend fun removeUploaded(ids: List<Long>) {
            if (ids.isNotEmpty()) dao.delete(ids)
        }

        private fun EvaluatedLocation.toEntity() =
            OfflineLocationEntity(
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

        private companion object {
            const val MAX_BATCH_SIZE = 50
        }
    }
