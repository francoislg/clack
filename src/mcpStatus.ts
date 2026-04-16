let failedServers = new Set<string>();

export function setFailedMcpServers(names: string[]): void {
  failedServers = new Set(names);
}

export function getFailedMcpServers(): Set<string> {
  return failedServers;
}
