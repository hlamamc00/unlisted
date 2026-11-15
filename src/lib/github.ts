import "server-only";

// Public GitHub data only, through GitHub's REST API. With GITHUB_TOKEN set,
// GitHub allows 30 searches a minute and 5,000 other requests an hour.
const API = "https://api.github.com";

/** A GitHub problem the recruiter should see: limits used up or a rejected token. */
export class GitHubError extends Error {}

async function gh<T>(path: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "unlisted-app",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(API + path, { headers, cache: "no-store" });
  if (res.status === 403 || res.status === 429) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
    throw new GitHubError(
      `GitHub's request limit is used up${mins ? `; try again in about ${mins} minute${mins > 1 ? "s" : ""}` : ""}.` +
        (process.env.GITHUB_TOKEN ? "" : " Add a GITHUB_TOKEN to raise the limit."),
    );
  }
  if (res.status === 401) throw new GitHubError("GitHub rejected the GITHUB_TOKEN. Check it in your site's environment variables.");
  if (!res.ok) throw new Error(`GitHub returned ${res.status} for ${path}`);
  return (await res.json()) as T;
}

type GhAccount = { login: string; type: string };
type GhRepo = {
  name: string; description: string | null; stargazers_count: number; language: string | null;
  topics?: string[]; pushed_at: string; html_url: string; fork: boolean;
};
type GhUser = GhAccount & {
  name: string | null; avatar_url: string; location: string | null; bio: string | null; company: string | null;
  blog: string | null; email: string | null; hireable: boolean | null; followers: number;
};

/** People whose code is mostly in a language (and optionally in a place). */
export async function searchUsers(q: string, page: number): Promise<string[]> {
  const r = await gh<{ items: GhAccount[] }>(`/search/users?q=${encodeURIComponent(q)}&per_page=20&page=${page}`);
  return r.items.filter((u) => u.type === "User").map((u) => u.login);
}

/** Owners of repositories matching a phrase: people found through what they've built. */
export async function searchRepoOwners(q: string, page: number): Promise<string[]> {
  const r = await gh<{ items: { owner: GhAccount }[] }>(
    `/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=30&page=${page}`,
  );
  return [...new Set(r.items.filter((i) => i.owner.type === "User").map((i) => i.owner.login))];
}

export type Repo = { name: string; description: string | null; stars: number; language: string | null; topics: string[]; pushedAt: string; url: string };

export type Profile = {
  githubLogin: string; name: string | null; avatarUrl: string | null; location: string | null; bio: string | null;
  company: string | null; blog: string | null; email: string | null; hireable: boolean | null; followers: number;
  hasLinkedIn: boolean; languages: Record<string, number>; topRepos: Repo[]; totalStars: number; lastPushAt: Date | null;
};

/** A person's public profile, own repositories and linked accounts. Null for organizations. */
export async function fetchProfile(login: string): Promise<Profile | null> {
  const enc = encodeURIComponent(login);
  const [user, repos, social] = await Promise.all([
    gh<GhUser>(`/users/${enc}`),
    gh<GhRepo[]>(`/users/${enc}/repos?type=owner&sort=pushed&per_page=100`),
    gh<{ provider: string; url: string }[]>(`/users/${enc}/social_accounts`).catch(() => []),
  ]);
  if (user.type !== "User") return null;

  const own = repos.filter((r) => !r.fork);
  const languages: Record<string, number> = {};
  for (const r of own) if (r.language) languages[r.language] = (languages[r.language] ?? 0) + 1;
  const topRepos = [...own]
    .sort((a, b) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
    .slice(0, 6)
    .map((r) => ({ name: r.name, description: r.description, stars: r.stargazers_count, language: r.language, topics: r.topics ?? [], pushedAt: r.pushed_at, url: r.html_url }));
  const linkedInText = /linkedin\.com/i;

  return {
    githubLogin: user.login,
    name: user.name,
    avatarUrl: user.avatar_url,
    location: user.location,
    bio: user.bio,
    company: user.company,
    blog: user.blog || null,
    email: user.email,
    hireable: user.hireable,
    followers: user.followers,
    hasLinkedIn: social.some((s) => s.provider === "linkedin") || linkedInText.test(user.blog ?? "") || linkedInText.test(user.bio ?? ""),
    languages,
    topRepos,
    totalStars: own.reduce((sum, r) => sum + r.stargazers_count, 0),
    lastPushAt: own.length ? new Date(Math.max(...own.map((r) => Date.parse(r.pushed_at)))) : null,
  };
}
