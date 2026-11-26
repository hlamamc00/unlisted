// What the role screen's components pass around. Types only, so client components can import this.
import type { Brief, RoleContext } from "@/lib/brief";
import type { Feedback, Note, Question } from "@/lib/agent";
import type { Stage } from "@/lib/pipeline";
import type { Check } from "@/lib/score";

/** One job from someone's work history. `when` is "2019 – Present"; `match` marks a job title or employer the search asked for. */
export type JobView = { title: string; company: string | null; when: string; match: boolean };

export type PersonView = {
  login: string | null; linkedinUrl: string | null; headline: string | null; name: string | null; avatarUrl: string | null;
  location: string | null; company: string | null; email: string | null; blog: string | null; hasLinkedIn: boolean; hireable: boolean;
  experience: JobView[];
};

export type Item = {
  id: string;
  status: "review" | "approved" | "skipped";
  score: number;
  checks: Check[];
  evidence: { src: string; text: string }[];
  hasDraft: boolean;
  note: Note | null;
  /** search | agent | pool | you */
  foundBy: string;
  stage: Stage;
  notes: string;
  followUpDue: boolean;
  messages: { kind: string; channel: string; sentAt: string }[];
  feedback: Feedback[];
  person: PersonView;
};

export type Tab = Item["status"];

export type RoleView = {
  id: string; title: string; brief: Brief; context: RoleContext; excluded: string[];
  /** How many people match on LinkedIn, from the last search, when known. */
  linkedInTotal: number | null;
  /** What the last search had to say, e.g. that there's no one left to find. */
  searchNote: string | null;
  /** LinkedIn profiles are connected (People Data Labs). */
  linkedIn: boolean;
  /** The recruiter has finished calibrating, so the agent may search for this role. */
  calibrated: boolean;
  share: { path: string; expires: string } | null;
};

export type RunView = { id: string; status: string; progress: string; added: number; looked: number; summary: string | null; error: string | null; createdAt: string };
/** `enabled`: Claude is connected. `paused`: the recruiter has the agent switched off in Settings. */
export type AgentView = { enabled: boolean; paused: boolean; nightly: boolean; run: RunView | null; questions: Question[] };
