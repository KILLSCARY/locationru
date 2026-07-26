package ru.location.resilienttaxi.driver.core.database

import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.RoomDatabase

@Entity(tableName = "driver_cache")
data class DriverCacheEntity(
    @PrimaryKey val key: String,
    val value: String,
)

@Dao
interface DriverCacheDao {
    @Query("SELECT * FROM driver_cache WHERE key = :key LIMIT 1")
    suspend fun find(key: String): DriverCacheEntity?
}

@Entity(tableName = "offline_location")
data class OfflineLocationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
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

@Dao
interface OfflineLocationDao {
    @Insert
    suspend fun insert(location: OfflineLocationEntity): Long

    @Query("SELECT * FROM offline_location ORDER BY id LIMIT :limit")
    suspend fun nextBatch(limit: Int): List<OfflineLocationEntity>

    @Query("DELETE FROM offline_location WHERE id IN (:ids)")
    suspend fun delete(ids: List<Long>)
}

@Database(entities = [DriverCacheEntity::class, OfflineLocationEntity::class], version = 2, exportSchema = false)
abstract class DriverDatabase : RoomDatabase() {
    abstract fun driverCacheDao(): DriverCacheDao

    abstract fun offlineLocationDao(): OfflineLocationDao
}
