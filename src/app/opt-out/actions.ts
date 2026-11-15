"use server";

import { db } from "@/lib/db";

export type OptOutState = { done?: boolean; error?: string };

/** Removes a person's data and stops them from being found again. Takes a GitHub username or profile link. */
export async function optOut(_prev: OptOutState, form: FormData): Promise<OptOutState> {
  const raw = String(form.get("github") ?? "").trim();
  const login = raw.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i.test(login)) {
    return { error: "Enter a GitHub username, like octocat, or a link to your GitHub profile." };
  }
  await db.optOut.upsert({ where: { githubLogin: login.toLowerCase() }, create: { githubLogin: login.toLowerCase() }, update: {} });
  // Person rows keep GitHub's capitalization; deleting them also deletes their matches.
  await db.person.deleteMany({ where: { githubLogin: { equals: login, mode: "insensitive" } } });
  return { done: true };
}
