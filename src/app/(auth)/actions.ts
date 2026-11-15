"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { endSession, hashPassword, startSession, verifyPassword } from "@/lib/auth";

export type AuthState = { error?: string; email?: string; name?: string; company?: string };

const SignupSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(100),
  company: z.string().trim().max(120).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters for your password.").max(200),
});

export async function signup(_prev: AuthState, form: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = SignupSchema.safeParse(raw);
  const echo = { email: raw.email, name: raw.name, company: raw.company };
  if (!parsed.success) return { error: parsed.error.issues[0].message, ...echo };

  const { name, company, email, password } = parsed.data;
  if (await db.user.findUnique({ where: { email } })) {
    return { error: "There's already an account with this email. Log in instead.", ...echo };
  }
  const user = await db.user.create({
    data: { name, company: company || null, email, passwordHash: await hashPassword(password) },
  });
  await startSession(user.id);
  redirect("/app");
}

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export async function login(_prev: AuthState, form: FormData): Promise<AuthState> {
  const raw = Object.fromEntries(form) as Record<string, string>;
  const parsed = LoginSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues[0].message, email: raw.email };

  const user = await db.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return { error: "That email and password don't match an account.", email: raw.email };
  }
  await startSession(user.id);
  redirect("/app");
}

export async function logout() {
  await endSession();
  redirect("/");
}
