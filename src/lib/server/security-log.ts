type SecurityLevel = 'info' | 'warn' | 'error';

export function logSecurity(
  level: SecurityLevel,
  event: string,
  details?: Record<string, unknown>
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...details,
  };

  switch (level) {
    case 'error':
      console.error(JSON.stringify(entry));
      break;
    case 'warn':
      console.warn(JSON.stringify(entry));
      break;
    default:
      console.log(JSON.stringify(entry));
  }
}
