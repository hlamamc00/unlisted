import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { SiteHeader } from "@/components/site-header";
import { AuthForm } from "../auth-form";

export const metadata = { title: "Log in" };

export default async function LoginPage() {
  if (await getUser()) redirect("/app");
  return (
    <>
      <SiteHeader />
      <main className="wrap public"><AuthForm mode="login" /></main>
    </>
  );
}
