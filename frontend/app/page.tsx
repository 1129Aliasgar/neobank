import { redirect } from "next/navigation";

/**
 * `/` is only a doorway: there is no marketing page in Module 1.
 *
 * The redirect throws `NEXT_REDIRECT` while the segment is being prerendered,
 * which is not a renderable shell — so the Cache Components instant-navigation
 * validator reports "Could not validate `instant`". That is expected for a
 * pure redirect and is not a failure: opt the segment out of validation.
 *
 * @see https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config/instant
 */
export const instant = false;

export default function Home() {
  redirect("/login");
}
