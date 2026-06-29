function safeSerialize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return String(value);
    }
  }

  return value;
}

function formatRecord(level: string, args: unknown[]): string {
  const timestamp = new Date().toISOString();
  const message = args.map(arg => {
    if (typeof arg === 'string') return arg;
    return safeSerialize(arg);
  });

  return JSON.stringify({
    timestamp,
    level,
    message: message.length === 1 && typeof message[0] === 'string' ? message[0] : undefined,
    data: message.length === 1 && typeof message[0] === 'string' ? undefined : message,
  });
}

export function patchConsoleForProduction(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  console.log = (...args: unknown[]) => {
    process.stdout.write(`${formatRecord('INFO', args)}\n`);
  };

  console.warn = (...args: unknown[]) => {
    process.stderr.write(`${formatRecord('WARN', args)}\n`);
  };

  console.error = (...args: unknown[]) => {
    process.stderr.write(`${formatRecord('ERROR', args)}\n`);
  };

  console.debug = (...args: unknown[]) => {
    process.stdout.write(`${formatRecord('DEBUG', args)}\n`);
  };
}
