package ru.location.resilienttaxi.driver.core.location

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.onStart
import kotlinx.coroutines.launch
import javax.inject.Inject

class LocationTrackingEngine
    @Inject
    constructor(
        private val fusedLocationSource: FusedLocationSource,
        private val gnssStatusSource: GnssStatusSource,
        private val gnssMeasurementsSource: GnssMeasurementsSource,
        private val cellInfoSource: CellInfoSource,
        private val motionSensorSource: MotionSensorSource,
        private val networkStateSource: NetworkStateSource,
        private val qualityEvaluator: LocationQualityEvaluator,
        private val batchUploader: LocationBatchUploader,
    ) {
        private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        private var trackingJob: Job? = null

        fun start(state: DriverTrackingState) {
            if (!state.shouldTrack) return
            trackingJob?.cancel()
            trackingJob =
                scope.launch {
                    val motion = motionSensorSource.motion().onStart { emit(MotionSnapshot()) }
                    val gnss = gnssStatusSource.statuses().onStart { emit(GnssStatusSnapshot()) }
                    // Subscribing starts an optional capability; unavailable devices emit a harmless fallback.
                    launch { gnssMeasurementsSource.measurements().collectLatest { } }
                    launch {
                        networkStateSource.connectivityChanges().collectLatest { connected ->
                            if (connected) batchUploader.flushPending()
                        }
                    }
                    motion.collectLatest { motionSnapshot ->
                        val frequency = qualityEvaluator.frequencyFor(state, motionSnapshot)
                        fusedLocationSource.locations(frequency.request).collect { sample ->
                            val evaluated = qualityEvaluator.evaluate(sample, gnss.first(), cellInfoSource.currentCellInfo())
                            batchUploader.uploadOrQueue(evaluated, isConnected = networkStateSource.isConnected())
                            if (networkStateSource.isConnected()) batchUploader.flushPending()
                        }
                    }
                }
        }

        suspend fun stop() {
            trackingJob?.cancelAndJoin()
            trackingJob = null
        }
    }
