package ru.location.resilienttaxi.driver.core.push

/**
 * Mirrors the backend's `PushDataPayloadSchema` (`.strict()`,
 * packages/contracts) — the only fields ever present in an FCM `data`
 * block. Deliberately never contains a token, OTP, phone number, or any
 * other sensitive value; the app re-fetches everything else via
 * REST/WebSocket once it knows which trip/bid/payment this is about.
 */
data class PushDataPayload(
    val notificationId: String,
    val type: String,
    val tripId: String?,
    val bidId: String?,
    val paymentId: String?,
    val sequence: Long?,
    val deepLink: String?,
    val occurredAt: String?,
) {
    companion object {
        /** Never throws — a malformed/incomplete data payload (e.g. a stale client build receiving a newer field set) yields null rather than crashing the receiver. */
        fun parse(data: Map<String, String>): PushDataPayload? {
            val notificationId = data["notificationId"] ?: return null
            val type = data["type"] ?: return null
            return PushDataPayload(
                notificationId = notificationId,
                type = type,
                tripId = data["tripId"],
                bidId = data["bidId"],
                paymentId = data["paymentId"],
                sequence = data["sequence"]?.toLongOrNull(),
                deepLink = data["deepLink"],
                occurredAt = data["occurredAt"],
            )
        }
    }
}

private const val DEEP_LINK_SCHEME_PREFIX = "resilienttaxi://driver/"

/** Extracts the path segment after the driver-app scheme host, e.g. "orders/abc" from "resilienttaxi://driver/orders/abc" — null if the link doesn't match this app's scheme/host. */
fun PushDataPayload.deepLinkPath(): String? {
    val link = deepLink ?: return null
    if (!link.startsWith(DEEP_LINK_SCHEME_PREFIX)) return null
    return link.removePrefix(DEEP_LINK_SCHEME_PREFIX).takeIf { it.isNotBlank() }
}
