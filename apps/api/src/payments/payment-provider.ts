export type ProviderPayment = {
  id: string;
  status: 'AUTHORIZED' | 'CAPTURED' | 'CANCELED' | 'FAILED' | 'REFUNDED';
};

export type ProviderWebhook = {
  eventId: string;
  paymentId: string;
  type:
    | 'payment.authorized'
    | 'payment.captured'
    | 'payment.failed'
    | 'payment.refunded';
};

export interface PaymentProvider {
  /** Provider identifier stored on payment intents, payouts and webhook events. */
  readonly name: string;
  cancelPayment(
    paymentId: string,
    idempotencyKey: string,
  ): Promise<ProviderPayment>;
  capturePayment(
    paymentId: string,
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<ProviderPayment>;
  createDriverPayout(input: {
    amountKopecks: number;
    idempotencyKey: string;
    driverId: string;
  }): Promise<{ id: string; status: 'PAID' | 'FAILED' }>;
  createPayment(input: {
    amountKopecks: number;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<ProviderPayment>;
  getPaymentStatus(paymentId: string): Promise<ProviderPayment>;
  refundPayment(
    paymentId: string,
    amountKopecks: number,
    idempotencyKey: string,
  ): Promise<ProviderPayment>;
  verifyWebhook(input: { payload: string; signature: string }): ProviderWebhook;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
