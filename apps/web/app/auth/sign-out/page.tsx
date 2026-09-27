import type { Metadata } from "next";
import { SignOutView } from "./sign-out-view";

export const metadata: Metadata = { title: "Signing out - Baumy Olympics" };

export default function SignOutPage() {
  return (
    <main>
      <SignOutView />
    </main>
  );
}
