import type { Metadata } from "next";
import { AuthFrame } from "@baumy/ui";
import { SignOutView } from "./sign-out-view";

export const metadata: Metadata = { title: "Signing out" };

export default function SignOutPage() {
  return (
    <AuthFrame>
      <SignOutView />
    </AuthFrame>
  );
}
