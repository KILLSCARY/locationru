package ru.location.resilienttaxi.driver.core.location

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent

@Module
@InstallIn(SingletonComponent::class)
abstract class LocationBindings {
    @Binds abstract fun bindFusedLocationSource(collector: FusedLocationCollector): FusedLocationSource

    @Binds abstract fun bindGnssStatusSource(collector: GnssStatusCollector): GnssStatusSource

    @Binds abstract fun bindGnssMeasurementsSource(collector: GnssMeasurementsCollector): GnssMeasurementsSource

    @Binds abstract fun bindCellInfoSource(collector: CellInfoCollector): CellInfoSource

    @Binds abstract fun bindMotionSensorSource(collector: MotionSensorCollector): MotionSensorSource

    @Binds abstract fun bindNetworkStateSource(collector: NetworkStateCollector): NetworkStateSource
}
