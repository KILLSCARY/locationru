import { Injectable } from '@nestjs/common';

type MetricType = 'counter' | 'gauge';

interface MetricDefinition {
  help: string;
  type: MetricType;
}

/**
 * A minimal in-process Prometheus text-format registry — no `prom-client`
 * dependency, since the metric set here is small and fixed. Values reset on
 * restart, which is the same behavior a `prom-client` counter has by
 * default (Prometheus itself handles counter resets via rate()).
 *
 * Label values must never be a phone number, OTP code, or any other raw
 * PII — callers pass purpose/channel/status/reason enums only. See
 * docs/auth/observability.md for the full metric list and alert rules.
 */
@Injectable()
export class MetricsService {
  private readonly definitions = new Map<string, MetricDefinition>();
  private readonly values = new Map<string, number>();

  increment(
    name: string,
    help: string,
    labels: Record<string, string> = {},
    value = 1,
  ): void {
    this.register(name, help, 'counter');
    const key = this.key(name, labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  setGauge(
    name: string,
    help: string,
    labels: Record<string, string>,
    value: number,
  ): void {
    this.register(name, help, 'gauge');
    this.values.set(this.key(name, labels), value);
  }

  renderPrometheusText(): string {
    const linesByName = new Map<string, string[]>();

    for (const [key, value] of this.values) {
      const { name, labels } = this.parseKey(key);
      const labelPairs = Object.entries(labels)
        .map(([label, labelValue]) => `${label}="${this.escape(labelValue)}"`)
        .join(',');
      const line = labelPairs
        ? `${name}{${labelPairs}} ${value}`
        : `${name} ${value}`;
      const lines = linesByName.get(name) ?? [];
      lines.push(line);
      linesByName.set(name, lines);
    }

    const output: string[] = [];
    for (const [name, definition] of this.definitions) {
      output.push(`# HELP ${name} ${definition.help}`);
      output.push(`# TYPE ${name} ${definition.type}`);
      output.push(...(linesByName.get(name) ?? []));
    }
    return `${output.join('\n')}\n`;
  }

  private register(name: string, help: string, type: MetricType): void {
    if (!this.definitions.has(name)) {
      this.definitions.set(name, { help, type });
    }
  }

  private key(name: string, labels: Record<string, string>): string {
    const sortedLabels = Object.keys(labels)
      .sort()
      .map((label) => `${label}=${labels[label]}`)
      .join(',');
    return `${name}|${sortedLabels}`;
  }

  private parseKey(key: string): {
    name: string;
    labels: Record<string, string>;
  } {
    const [name = '', labelSegment] = key.split('|');
    const labels: Record<string, string> = {};
    if (labelSegment) {
      for (const pair of labelSegment.split(',')) {
        const [label, value] = pair.split('=');
        if (label) labels[label] = value ?? '';
      }
    }
    return { name, labels };
  }

  private escape(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n');
  }
}
