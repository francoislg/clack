const failedServers = new Set<string>();

export function addFailedMcpServers(names: string[]): void {
  for (const n of names) failedServers.add(n);
}

export function getFailedMcpServers(): Set<string> {
  return failedServers;
}
