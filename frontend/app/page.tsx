import { redirect } from "next/navigation";

/** The product has no marketing page in Module 1: the door is sign-in. */
export default function Home() {
  redirect("/login");
}
