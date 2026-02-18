import type { UserRole } from "./roles.js";
import type { RepositoryConfig } from "./config.js";

const ROLE_LEVELS: Record<UserRole, number> = {
  member: 0,
  dev: 1,
  admin: 2,
  owner: 3,
};

export function roleLevel(role: UserRole): number {
  return ROLE_LEVELS[role];
}

export function canReadRepo(role: UserRole, repo: RepositoryConfig): boolean {
  const required = repo.access?.read ?? "member";
  return roleLevel(role) >= roleLevel(required);
}

export function canWriteRepo(role: UserRole, repo: RepositoryConfig): boolean {
  if (!repo.access?.write) return false;
  return roleLevel(role) >= roleLevel(repo.access.write);
}

export function getVisibleRepos(role: UserRole, repos: RepositoryConfig[]): RepositoryConfig[] {
  return repos.filter((r) => canReadRepo(role, r));
}

export function getWritableRepos(role: UserRole, repos: RepositoryConfig[]): RepositoryConfig[] {
  return repos.filter((r) => canWriteRepo(role, r));
}
