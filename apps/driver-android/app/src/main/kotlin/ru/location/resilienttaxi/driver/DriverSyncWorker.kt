package ru.location.resilienttaxi.driver

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class DriverSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters,
) : CoroutineWorker(appContext, workerParams) {
    override suspend fun doWork(): Result = Result.success()
}
