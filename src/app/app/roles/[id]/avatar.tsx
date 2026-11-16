import type { PersonView } from "./types";

export const displayName = (p: Pick<PersonView, "name" | "login">) => p.name || p.login || "Unnamed";
const initials = (p: Pick<PersonView, "name" | "login">) => displayName(p).split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

/** Their GitHub photo when there is one, otherwise their initials. */
export function Avatar({ person }: { person: Pick<PersonView, "name" | "login" | "avatarUrl"> }) {
  return (
    <span className="avatar" aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {person.avatarUrl ? <img src={person.avatarUrl} alt="" /> : initials(person)}
    </span>
  );
}
