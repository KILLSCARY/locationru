export type ShareTripResult = {
  shareUrl: string;
  token: string;
  /** True until the backend exposes a real share-token endpoint. */
  isDevelopmentOnly: boolean;
};

export interface ShareTripService {
  createShareLink(tripId: string): Promise<ShareTripResult>;
}

/**
 * The backend does not yet expose a share-token endpoint for trips, so this
 * generates a locally-scoped, clearly-marked development link instead of
 * pretending to create a real one. Swap `createShareTripService` to return an
 * HTTP-backed implementation once `POST /trips/:id/share` (or similar) exists
 * — no caller changes needed, since screens depend on `ShareTripService` only.
 */
class DevelopmentShareTripService implements ShareTripService {
  createShareLink(tripId: string): Promise<ShareTripResult> {
    const token = `dev-${tripId}-${Date.now().toString(36)}`;
    return Promise.resolve({
      shareUrl: `https://share.resilienttaxi.dev/t/${token}`,
      token,
      isDevelopmentOnly: true,
    });
  }
}

export function createShareTripService(): ShareTripService {
  return new DevelopmentShareTripService();
}
