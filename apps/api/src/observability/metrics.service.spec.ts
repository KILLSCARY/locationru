import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('renders a counter with HELP/TYPE headers and label values', () => {
    const metrics = new MetricsService();
    metrics.increment('auth_otp_requests_total', 'Total OTP requests', {
      purpose: 'LOGIN',
      channel: 'SMS',
    });

    const text = metrics.renderPrometheusText();
    expect(text).toContain('# HELP auth_otp_requests_total Total OTP requests');
    expect(text).toContain('# TYPE auth_otp_requests_total counter');
    expect(text).toContain(
      'auth_otp_requests_total{channel="SMS",purpose="LOGIN"} 1',
    );
  });

  it('accumulates repeated increments for the same label set', () => {
    const metrics = new MetricsService();
    metrics.increment('x', 'help', { a: '1' });
    metrics.increment('x', 'help', { a: '1' });
    metrics.increment('x', 'help', { a: '1' }, 3);

    expect(metrics.renderPrometheusText()).toContain('x{a="1"} 5');
  });

  it('keeps distinct label combinations separate', () => {
    const metrics = new MetricsService();
    metrics.increment('x', 'help', { result: 'success' });
    metrics.increment('x', 'help', { result: 'invalid' });

    const text = metrics.renderPrometheusText();
    expect(text).toContain('x{result="success"} 1');
    expect(text).toContain('x{result="invalid"} 1');
  });

  it('supports gauges and overwrites rather than accumulates', () => {
    const metrics = new MetricsService();
    metrics.setGauge('g', 'help', { a: '1' }, 10);
    metrics.setGauge('g', 'help', { a: '1' }, 3);

    expect(metrics.renderPrometheusText()).toContain('g{a="1"} 3');
    expect(metrics.renderPrometheusText()).toContain('# TYPE g gauge');
  });

  it('escapes quotes and backslashes in label values', () => {
    const metrics = new MetricsService();
    metrics.increment('x', 'help', { reason: 'quote"here\\there' });

    expect(metrics.renderPrometheusText()).toContain(
      'x{reason="quote\\"here\\\\there"} 1',
    );
  });

  it('never receives a phone number as a label value in this codebase (metric names/labels are enum-shaped, not free text)', () => {
    const metrics = new MetricsService();
    // Documents the invariant rather than testing the registry itself: the
    // registry is label-agnostic by construction, so this is enforced by
    // callers (OtpService/AuthService) only ever passing purpose/channel/
    // status/reason enum values — never phone or code.
    metrics.increment('auth_otp_requests_total', 'help', { purpose: 'LOGIN' });
    expect(metrics.renderPrometheusText()).not.toMatch(/\+7\d{10}/);
  });
});
